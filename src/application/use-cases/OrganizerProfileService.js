// "Hoja en blanco" para quien NO es médico.
//
// El flujo clínico organiza una transcripción con un system prompt fijo escrito
// por nosotros. Para un vendedor, un supervisor de planta o un abogado ese
// prompt no sirve: cambia qué es importante, cómo se agrupa y cómo se entrega.
// Aquí el system prompt deja de ser una constante y pasa a ser un DATO que se
// genera una vez por usuario, a partir de:
//
//   1. Lo que la persona cuenta en voz alta ("soy supervisor de planta, cada
//      hora reporto producción, paradas y novedades de seguridad…"), y
//   2. Screenshots opcionales de cómo organiza hoy esa información — de ahí se
//      copia el FORMATO real que ya usa, no uno inventado.
//
// De ahí en adelante, organizar un audio es el mismo movimiento que en el lado
// médico: transcripción → system prompt → reporte estructurado.
//
// Nunca se persiste ninguna imagen: del screenshot solo queda la descripción
// del formato observado. El texto dictado sí se guarda, porque es la fuente
// desde la cual se puede regenerar el prompt si mañana mejora el generador.

const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
// ~5 MB de imagen binaria en base64 (mismo tope que el resto de clientes).
const MAX_BASE64_CHARS = 7_000_000;
const MAX_SCREENSHOTS = 8;
const MAX_DESCRIPTION_CHARS = 8_000;
const MAX_TRANSCRIPT_CHARS = 40_000;
const MAX_SECTIONS = 12;
const MAX_SECTION_CONTENT_CHARS = 4_000;
const MAX_SYSTEM_PROMPT_CHARS = 12_000;
const MAX_WARNINGS = 8;
const PROFESSIONS = new Set(['medico', 'otra']);

// Genera el system prompt personalizado. Deliberadamente NO le pedimos que
// invente un formato "bonito": le pedimos que copie el que la persona ya usa,
// porque el valor está en que el reporte salga listo para pegar donde siempre.
const DESIGNER_SYSTEM = `Eres un diseñador de asistentes de trabajo. Tu tarea es escribir el SYSTEM PROMPT que usará otro modelo para convertir lo que una persona dicta por micrófono en un reporte organizado, listo para enviar.

Recibes: (a) la descripción que la propia persona dio, en voz alta, sobre su trabajo y sobre qué información quiere que se le organice y cómo, y (b) opcionalmente, la descripción de capturas de pantalla de reportes que esa persona ya hace hoy.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con esta forma exacta:
{"occupation": string, "summary": string, "sections": [{"key": string, "label": string, "instruction": string}], "system_prompt": string, "confirmation": string}

Reglas:
- "occupation": el oficio en pocas palabras, como lo diría la persona ("supervisor de planta", "asesor comercial", "técnico de mantenimiento").
- "summary": una frase que le confirme a la persona qué entendiste que va a organizar.
- "sections": entre 3 y 10 secciones que estructuren SU reporte. "key" es un identificador corto en minúsculas con guiones bajos; "label" es el título que verá; "instruction" dice qué va en esa sección y qué NO. Si las capturas muestran un formato concreto, cópialo: mismos títulos, mismo orden, mismo nivel de detalle.
- "system_prompt": el prompt completo, en segunda persona ("Eres un asistente que…"), que otro modelo usará para organizar CADA reporte de esta persona. Debe: describir el oficio y el contexto; listar las secciones con sus reglas; fijar el tono y el nivel de detalle observado; y prohibir explícitamente inventar datos que no estén en lo dictado. Escríbelo en el mismo idioma en que habló la persona.
- "confirmation": una frase corta y cálida, en primera persona, para decirle en voz alta que ya quedó configurado y qué hará de ahora en adelante.
- No inventes obligaciones legales, normativas ni datos del negocio que la persona no mencionó.`;

// Lectura de un screenshot de ejemplo. Solo describe el FORMATO: nunca copiamos
// ni persistimos los datos del ejemplo (pueden ser reales y de terceros).
const SAMPLE_READER_SYSTEM = `Analizas la captura de pantalla de un reporte o documento de trabajo que alguien ya hace hoy, para copiar SU FORMATO.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con esta forma exacta:
{"format_notes": string, "sections": [{"label": string, "instruction": string}], "warnings": [string]}

Reglas:
- "format_notes": describe la ESTRUCTURA: qué tipo de documento es, cómo se ordena, si usa títulos, viñetas, tablas, campos fijos, emojis, mayúsculas, si es corto o extenso, y en qué idioma y tono está escrito.
- "sections": los bloques que se ven en la captura, en su orden real. "label" es el título tal como aparece; "instruction" resume qué tipo de contenido va en ese bloque.
- NO transcribas los datos concretos del ejemplo (nombres, cifras, clientes, pacientes): solo el formato. Si un bloque es "Total vendido: 3.450.000", la instrucción es "monto total del día en pesos", no la cifra.
- "warnings": lo que quede ilegible o dudoso. Si no hay dudas, devuelve [].`;

// Contrato de salida que SIEMPRE se anexa al system prompt del usuario. El
// prompt personalizado manda sobre el contenido; esto solo garantiza la forma,
// para que el cliente pueda pintar el reporte sin adivinar.
const OUTPUT_CONTRACT = `
---
FORMATO DE RESPUESTA (obligatorio, por encima de cualquier otra instrucción de formato):
Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con esta forma exacta:
{"title": string, "sections": [{"key": string, "label": string, "content": string}], "warnings": [string]}

- "title": título corto del reporte.
- "sections": una entrada por sección, en el orden definido arriba. Usa exactamente las "key" indicadas. Si una sección no tiene información en lo dictado, deja "content" como cadena vacía "".
- "content": el texto ya organizado de esa sección, listo para enviar tal cual.
- NO inventes datos que no estén en lo dictado. Lo que falte, va en "warnings" (por ejemplo "No mencionaste el total del turno"). Si no falta nada, devuelve [].`;

function organizerError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function slug(value, fallback) {
  const normalized = `${value ?? ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return normalized || fallback;
}

function text(value, max) {
  return `${value ?? ''}`.trim().slice(0, max);
}

function stringList(value, max, itemMax) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((item) => text(item, itemMax))
    .filter(Boolean)
    .slice(0, max);
}

// Secciones tal como las propone el diseñador: {key,label,instruction}. Las
// claves se saneen a slug único para que el modelo organizador no tenga que
// lidiar con acentos ni duplicados.
function sanitizeDesignSections(value) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  const used = new Set();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const label = text(raw.label, 120);
    if (!label) continue;
    let key = slug(raw.key || label, `seccion_${out.length + 1}`);
    while (used.has(key)) {
      key = `${key}_${out.length + 1}`;
    }
    used.add(key);
    out.push({ key, label, instruction: text(raw.instruction, 600) });
    if (out.length >= MAX_SECTIONS) break;
  }
  return out;
}

// Alinea el reporte devuelto por el modelo con las secciones del perfil: una
// entrada por sección, en el orden del perfil. Si el perfil no trae secciones
// (prompt escrito a mano), se acepta lo que el modelo haya estructurado.
function alignReportSections(profileSections, modelSections) {
  const list = Array.isArray(modelSections) ? modelSections : [];
  const byKey = new Map();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const key = slug(item.key || item.label, '');
    if (!key) continue;
    byKey.set(key, {
      label: text(item.label, 120),
      content: text(item.content, MAX_SECTION_CONTENT_CHARS)
    });
  }

  if (!profileSections.length) {
    return Array.from(byKey.entries())
      .slice(0, MAX_SECTIONS)
      .map(([key, value]) => ({ key, label: value.label || key, content: value.content }));
  }

  return profileSections.map((section) => {
    const match = byKey.get(section.key);
    return {
      key: section.key,
      label: section.label,
      content: match ? match.content : ''
    };
  });
}

// El reporte también sale como texto plano: es lo que la persona pega en
// WhatsApp o en su formato de siempre, sin que el cliente tenga que rearmarlo.
function renderMarkdown(title, sections) {
  const lines = [];
  if (title) {
    lines.push(`*${title}*`, '');
  }
  for (const section of sections) {
    if (!section.content) continue;
    lines.push(`*${section.label}*`, section.content, '');
  }
  return lines.join('\n').trim();
}

class OrganizerProfileService {
  constructor({ repository, llmProvider, visionLlmProvider } = {}) {
    if (!repository || !llmProvider) {
      throw new Error('OrganizerProfileService requires repository and llmProvider');
    }
    this.repository = repository;
    this.llmProvider = llmProvider;
    // La lectura de screenshots necesita un modelo con visión; si no hay uno
    // aparte, se intenta con el mismo (muchos modelos actuales ven imágenes).
    this.visionLlmProvider = visionLlmProvider || llmProvider;
  }

  hasLlm() {
    return Boolean(this.llmProvider?.hasApiKey?.());
  }

  hasVision() {
    return Boolean(this.visionLlmProvider?.hasApiKey?.());
  }

  requireLlm() {
    if (!this.hasLlm()) {
      throw organizerError('ORGANIZER_LLM_NOT_CONFIGURED', 'El proveedor de IA no está configurado.', 503);
    }
  }

  requireStorage() {
    if (!this.repository.isConfigured?.()) {
      throw organizerError('ORGANIZER_STORAGE_NOT_CONFIGURED', 'El almacenamiento de perfiles no está configurado.', 503);
    }
  }

  static normalizeDeviceId(value) {
    const deviceId = text(value, 120);
    if (!deviceId) {
      throw organizerError('ORGANIZER_DEVICE_REQUIRED', 'device_id es obligatorio.', 400);
    }
    return deviceId;
  }

  static normalizeProfession(value) {
    const profession = text(value, 20).toLowerCase() || 'otra';
    return PROFESSIONS.has(profession) ? profession : 'otra';
  }

  // Acepta el dataURL completo (data:image/...;base64,...) o { image, media_type }.
  static normalizeImage(image, mediaTypeHint) {
    const raw = `${image ?? ''}`.trim();
    if (!raw) {
      throw organizerError('ORGANIZER_IMAGE_MISSING', 'Falta la imagen.', 400);
    }
    const match = raw.match(/^data:([a-z0-9/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
    const mediaType = (match ? match[1] : `${mediaTypeHint ?? ''}`).toLowerCase();
    const b64 = (match ? match[2] : raw).replace(/\s/g, '');
    if (!MEDIA_TYPES.has(mediaType)) {
      throw organizerError('ORGANIZER_IMAGE_UNSUPPORTED', 'Formato de imagen no soportado. Usa JPG, PNG o WebP.', 400);
    }
    if (b64.length > MAX_BASE64_CHARS) {
      throw organizerError('ORGANIZER_IMAGE_TOO_LARGE', 'La imagen supera 5 MB. Usa una captura más liviana.', 413);
    }
    return `data:${mediaType};base64,${b64}`;
  }

  static normalizeScreenshots(value) {
    const list = Array.isArray(value) ? value : [];
    if (list.length > MAX_SCREENSHOTS) {
      throw organizerError(
        'ORGANIZER_TOO_MANY_IMAGES',
        `Puedes enviar hasta ${MAX_SCREENSHOTS} capturas a la vez.`,
        413
      );
    }
    return list.map((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        return OrganizerProfileService.normalizeImage(item.image ?? item.data, item.media_type ?? item.mediaType);
      }
      return OrganizerProfileService.normalizeImage(item);
    });
  }

  async getProfile(deviceId) {
    this.requireStorage();
    return this.repository.findActiveByDevice(OrganizerProfileService.normalizeDeviceId(deviceId));
  }

  // Lee un screenshot y devuelve solo la descripción de su FORMATO.
  async readSample(imageDataUrl) {
    const raw = await this.visionLlmProvider.chatExpectingJson([
      { role: 'system', content: SAMPLE_READER_SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe el formato de este reporte para poder replicarlo.' },
          { type: 'image_url', image_url: { url: imageDataUrl } }
        ]
      }
    ]);
    const parsed = this.visionLlmProvider.parseJsonObject(raw);
    return {
      format_notes: text(parsed.format_notes, 2_000),
      sections: sanitizeDesignSections(
        (Array.isArray(parsed.sections) ? parsed.sections : []).map((section, index) => ({
          key: section?.label || `bloque_${index + 1}`,
          label: section?.label,
          instruction: section?.instruction
        }))
      ),
      warnings: stringList(parsed.warnings, MAX_WARNINGS, 240)
    };
  }

  // Lee las capturas una por una. Una captura ilegible NO tumba la
  // configuración: se registra como advertencia y se sigue con el resto, porque
  // el prompt puede generarse igual desde lo que la persona dictó.
  async readSamples(imageDataUrls) {
    const notes = [];
    const warnings = [];
    for (const dataUrl of imageDataUrls) {
      try {
        const sample = await this.readSample(dataUrl);
        notes.push(sample);
        warnings.push(...sample.warnings);
      } catch (error) {
        warnings.push('No pude leer una de las capturas; seguí con las demás.');
      }
    }
    return { notes, warnings: warnings.slice(0, MAX_WARNINGS) };
  }

  buildDesignerUserMessage(description, sampleNotes) {
    const parts = [`LO QUE CONTÓ LA PERSONA (transcrito de su voz):\n"${description}"`];
    if (sampleNotes.length) {
      const formatted = sampleNotes
        .map((note, index) => {
          const sections = note.sections.length
            ? note.sections.map((section) => `   · ${section.label}: ${section.instruction}`).join('\n')
            : '   (sin bloques identificados)';
          return `Captura ${index + 1}:\n   Formato: ${note.format_notes}\n${sections}`;
        })
        .join('\n\n');
      parts.push(`EJEMPLOS DE CÓMO YA ORGANIZA ESTA INFORMACIÓN HOY:\n${formatted}`);
      parts.push('Copia ese formato: los mismos títulos, el mismo orden y el mismo nivel de detalle.');
    } else {
      parts.push('No envió ejemplos: diseña el formato más útil y directo para ese oficio.');
    }
    return parts.join('\n\n');
  }

  // Escribe (o reescribe) el system prompt a partir de la descripción dictada y
  // de lo leído en las capturas.
  async designSystemPrompt(description, sampleNotes) {
    const raw = await this.llmProvider.chatExpectingJson([
      { role: 'system', content: DESIGNER_SYSTEM },
      { role: 'user', content: this.buildDesignerUserMessage(description, sampleNotes) }
    ]);
    const parsed = this.llmProvider.parseJsonObject(raw);
    const sections = sanitizeDesignSections(parsed.sections);
    const systemPrompt = text(parsed.system_prompt, MAX_SYSTEM_PROMPT_CHARS);
    if (!systemPrompt) {
      throw organizerError('ORGANIZER_DESIGN_FAILED', 'No fue posible generar la configuración.', 502);
    }
    return {
      occupation: text(parsed.occupation, 120),
      summary: text(parsed.summary, 400),
      confirmation: text(parsed.confirmation, 400),
      sections,
      system_prompt: systemPrompt
    };
  }

  /**
   * Configuración inicial: la persona contó su oficio en voz alta y, si quiso,
   * mandó capturas de cómo organiza hoy. Sale el perfil ya guardado y activo.
   */
  async createProfile({ deviceId, authUserId, profession, description, screenshots } = {}) {
    this.requireLlm();
    this.requireStorage();

    const device = OrganizerProfileService.normalizeDeviceId(deviceId);
    const spoken = text(description, MAX_DESCRIPTION_CHARS);
    if (!spoken) {
      throw organizerError('ORGANIZER_DESCRIPTION_REQUIRED', 'Cuéntame primero qué trabajo haces y qué quieres que organice.', 400);
    }

    const images = OrganizerProfileService.normalizeScreenshots(screenshots);
    const { notes, warnings } = images.length ? await this.readSamples(images) : { notes: [], warnings: [] };
    const design = await this.designSystemPrompt(spoken, notes);

    const profile = await this.repository.replaceActive({
      device_id: device,
      auth_user_id: text(authUserId, 64) || null,
      profession: OrganizerProfileService.normalizeProfession(profession),
      occupation: design.occupation,
      description: spoken,
      system_prompt: design.system_prompt,
      sections: design.sections,
      sample_notes: notes,
      sample_count: notes.length
    });

    return { profile, summary: design.summary, confirmation: design.confirmation, warnings };
  }

  /**
   * Ejemplos añadidos DESPUÉS de la configuración inicial: se leen las capturas
   * nuevas, se suman a las anteriores y se reescribe el system prompt con todo.
   */
  async addSamples({ deviceId, screenshots } = {}) {
    this.requireLlm();
    this.requireStorage();

    const device = OrganizerProfileService.normalizeDeviceId(deviceId);
    const profile = await this.repository.findActiveByDevice(device);
    if (!profile) {
      throw organizerError('ORGANIZER_PROFILE_NOT_FOUND', 'Todavía no has configurado cómo organizo tu información.', 404);
    }

    const images = OrganizerProfileService.normalizeScreenshots(screenshots);
    if (!images.length) {
      throw organizerError('ORGANIZER_SAMPLES_REQUIRED', 'Envía al menos una captura.', 400);
    }

    const { notes, warnings } = await this.readSamples(images);
    if (!notes.length) {
      throw organizerError('ORGANIZER_SAMPLES_UNREADABLE', 'No pude leer ninguna de las capturas.', 422);
    }

    const allNotes = [...profile.sample_notes, ...notes].slice(-MAX_SCREENSHOTS);
    const design = await this.designSystemPrompt(profile.description, allNotes);

    const updated = await this.repository.update(profile.id, {
      occupation: design.occupation || profile.occupation,
      system_prompt: design.system_prompt,
      sections: design.sections,
      sample_notes: allNotes,
      sample_count: allNotes.length
    });

    return { profile: updated, summary: design.summary, confirmation: design.confirmation, warnings };
  }

  /**
   * El movimiento de todos los días: transcripción → system prompt del usuario
   * → reporte organizado y listo para enviar.
   */
  async organize({ deviceId, transcript, context } = {}) {
    this.requireLlm();
    this.requireStorage();

    const device = OrganizerProfileService.normalizeDeviceId(deviceId);
    const spoken = text(transcript, MAX_TRANSCRIPT_CHARS);
    if (!spoken) {
      throw organizerError('ORGANIZER_TRANSCRIPT_REQUIRED', 'transcript es obligatorio.', 400);
    }

    const profile = await this.repository.findActiveByDevice(device);
    if (!profile) {
      throw organizerError('ORGANIZER_PROFILE_NOT_FOUND', 'Todavía no has configurado cómo organizo tu información.', 404);
    }

    const extra = text(context, 2_000);
    const userMessage = extra
      ? `CONTEXTO ADICIONAL: ${extra}\n\nLO QUE SE DICTÓ:\n"${spoken}"`
      : `LO QUE SE DICTÓ:\n"${spoken}"`;

    const raw = await this.llmProvider.chatExpectingJson([
      { role: 'system', content: `${profile.system_prompt}\n${OUTPUT_CONTRACT}` },
      { role: 'user', content: userMessage }
    ]);
    const parsed = this.llmProvider.parseJsonObject(raw);
    const sections = alignReportSections(profile.sections, parsed.sections);
    const title = text(parsed.title, 160) || profile.occupation || 'Reporte';

    return {
      profile_id: profile.id,
      occupation: profile.occupation,
      transcript: spoken,
      report: {
        title,
        sections,
        warnings: stringList(parsed.warnings, MAX_WARNINGS, 240),
        markdown: renderMarkdown(title, sections)
      }
    };
  }
}

OrganizerProfileService.MAX_SCREENSHOTS = MAX_SCREENSHOTS;
OrganizerProfileService.MAX_TRANSCRIPT_CHARS = MAX_TRANSCRIPT_CHARS;
OrganizerProfileService.MAX_DESCRIPTION_CHARS = MAX_DESCRIPTION_CHARS;
OrganizerProfileService.DESIGNER_SYSTEM = DESIGNER_SYSTEM;
OrganizerProfileService.OUTPUT_CONTRACT = OUTPUT_CONTRACT;

module.exports = OrganizerProfileService;
