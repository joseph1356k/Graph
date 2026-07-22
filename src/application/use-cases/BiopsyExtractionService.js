// Biopsy / lab-sheet photo extraction: reads a photo of a hand-written
// laboratory worksheet (bacteriology, pathology, clinical lab) and transcribes
// it into the sections ("casillas") of the template the client sends.
//
// Stateless by design: it never persists anything and never logs PHI. One
// vision call per photo -> structured JSON aligned to the template. The result
// is the note; editing a section or re-downloading the PDF never spends tokens.
//
// Uses the shared LLMProvider (its own MIRACLE_BIOPSY_LLM_* instance, see
// web/server.js). OpenAI/Gemini vision travels on the same /chat/completions
// endpoint: the `messages` array carries an `image_url` content part.

const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
// ~5 MB de imagen binaria en base64 (mismo tope que el cliente).
const MAX_BASE64_CHARS = 7_000_000;
// Tope defensivo por sección: una casilla de laboratorio no debería excederlo.
const MAX_SECTION_CHARS = 4_000;
const MAX_SECTIONS = 40;
const MAX_WARNINGS = 12;
const MAX_LABEL_CHARS = 120;

const SYSTEM = `Eres un asistente que TRANSCRIBE y ORGANIZA una hoja de trabajo de laboratorio escrita a mano por un profesional (bacteriología, patología o laboratorio clínico) mientras analiza una muestra al microscopio.

Tu tarea: leer la foto de la hoja y volcar su contenido en las secciones (casillas) de la plantilla que se te indica, respetando EXACTAMENTE las claves ("key") dadas.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con esta forma exacta:
{"sections": [{"key": string, "content": string}], "warnings": [string]}

Reglas:
- Incluye una entrada por cada "key" de la plantilla, en el mismo orden. No agregues claves que no estén en la plantilla.
- "content": transcribe fielmente lo escrito para esa sección. Conserva términos técnicos, nombres de microorganismos, medidas, recuentos y notación de cruces (+, ++, +++). Corrige solo abreviaturas obvias.
- NO inventes ni completes datos clínicos que no estén en la hoja. Si una sección no tiene información en la hoja, deja "content" como cadena vacía "".
- Usa "warnings" para señalar texto ilegible o dudoso (p. ej. "El recuento de leucocitos es poco legible"). Si no hay dudas, devuelve [].
- No incluyas datos de otras secciones dentro de una que no corresponde.`;

// Modo dinámico: sin plantilla fija. La IA DISEÑA la estructura del informe a
// partir de lo que realmente contiene la hoja, y luego la rellena.
const SYSTEM_DYNAMIC = `Eres un asistente que TRANSCRIBE y ORGANIZA una hoja de trabajo de laboratorio escrita a mano por un profesional (bacteriología, patología o laboratorio clínico) mientras analiza una muestra.

A diferencia del modo con plantilla fija, aquí TÚ DISEÑAS la estructura del informe a partir de lo que realmente contiene la hoja: identifica el tipo de estudio (p. ej. histopatología/biopsia, microbiología con cultivo y antibiograma, baciloscopia, uroanálisis, coprológico/parasitológico, etc.) y crea las secciones (casillas) que mejor representen su contenido.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con esta forma exacta:
{"template_name": string, "sections": [{"key": string, "label": string, "content": string}], "warnings": [string]}

Reglas:
- "template_name": título corto y claro del informe según el tipo de estudio (p. ej. "Informe de histopatología", "Urocultivo y antibiograma").
- "sections": entre 3 y 10 secciones, en orden lógico. "key" es un identificador corto en minúsculas con guiones bajos (p. ej. "datos_muestra"); "label" es el título legible de la casilla.
- Crea SOLO las secciones que tengan sentido para esta hoja. Empieza por los datos de la muestra y cierra con el diagnóstico, la interpretación o las observaciones cuando apliquen.
- "content": transcribe fielmente lo escrito para esa sección. Conserva términos técnicos, nombres de microorganismos, medidas, recuentos y notación de cruces (+, ++, +++). Corrige solo abreviaturas obvias.
- NO inventes ni completes datos clínicos que no estén en la hoja. Si una sección queda sin información, deja "content" como cadena vacía "".
- Usa "warnings" para señalar texto ilegible o dudoso. Si no hay dudas, devuelve [].`;

function extractionError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

/* eslint-disable no-unused-vars */
function parseTemplateSections(value) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const key = `${raw.key ?? ''}`.trim();
    const label = `${raw.label ?? ''}`.trim();
    if (!key) continue;
    out.push({
      key,
      label: label || key,
      order: typeof raw.order === 'number' ? raw.order : undefined,
      required: Boolean(raw.required),
      instruction: typeof raw.instruction === 'string' ? raw.instruction : undefined
    });
    if (out.length >= MAX_SECTIONS) break;
  }
  return out.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// Eleva a mayúscula la primera letra de la casilla (requisito de patología:
// cada casilla empieza con mayúscula). No toca números (p. ej. rótulos como
// "26-3456"), signos ni el resto del texto; respeta espacios iniciales.
function capitalizeFirst(content = '') {
  return `${content || ''}`.replace(
    /^(\s*)(\p{Ll})/u,
    (_, space, letter) => `${space}${letter.toUpperCase()}`
  );
}

// Alinea la respuesta del modelo con las secciones de la plantilla: una entrada
// por key, en el orden de la plantilla, con el content saneado. Garantiza que la
// nota casa con la plantilla aunque el modelo omita, reordene o invente claves.
function alignSections(template, modelValue) {
  const list = modelValue && Array.isArray(modelValue.sections) ? modelValue.sections : [];
  const byKey = new Map();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const key = `${item.key ?? ''}`.trim();
    if (!key) continue;
    const content = typeof item.content === 'string' ? item.content : '';
    byKey.set(key, content.trim().slice(0, MAX_SECTION_CHARS));
  }
  return template.map((section) => ({
    key: section.key,
    label: section.label,
    content: capitalizeFirst(byKey.get(section.key) ?? '')
  }));
}

// Modo dinámico: la IA define key + label + content. Saneamos claves (slug
// único), etiquetas y contenido, sin plantilla contra la cual alinear.
function sanitizeDynamicSections(modelValue) {
  const list = modelValue && Array.isArray(modelValue.sections) ? modelValue.sections : [];
  const out = [];
  const usedKeys = new Set();
  for (let index = 0; index < list.length && out.length < MAX_SECTIONS; index += 1) {
    const item = list[index];
    if (!item || typeof item !== 'object') continue;
    const label = `${item.label ?? ''}`.trim().slice(0, MAX_LABEL_CHARS) || `Sección ${index + 1}`;
    let key = `${item.key ?? ''}`.trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    if (!key) key = `seccion_${index + 1}`;
    let uniqueKey = key;
    let suffix = 2;
    while (usedKeys.has(uniqueKey)) {
      uniqueKey = `${key}_${suffix}`;
      suffix += 1;
    }
    usedKeys.add(uniqueKey);
    const content = typeof item.content === 'string' ? item.content.trim().slice(0, MAX_SECTION_CHARS) : '';
    out.push({ key: uniqueKey, label, content: capitalizeFirst(content) });
  }
  return out;
}

function sanitizeWarnings(modelValue) {
  const list = modelValue && Array.isArray(modelValue.warnings) ? modelValue.warnings : [];
  const out = [];
  for (const w of list) {
    if (typeof w === 'string' && w.trim()) out.push(w.trim().slice(0, 240));
    if (out.length >= MAX_WARNINGS) break;
  }
  return out;
}
/* eslint-enable no-unused-vars */

class BiopsyExtractionService {
  constructor({ llmProvider } = {}) {
    if (!llmProvider) {
      throw new Error('BiopsyExtractionService requires llmProvider');
    }
    this.llmProvider = llmProvider;
  }

  hasLlm() {
    return Boolean(this.llmProvider?.hasApiKey?.());
  }

  requireLlm() {
    if (!this.hasLlm()) {
      throw extractionError('BIOPSY_LLM_NOT_CONFIGURED', 'El proveedor de visión no está configurado.', 503);
    }
  }

  // Acepta el dataURL completo (data:image/...;base64,...) que envía el cliente,
  // o { image_base64, media_type } por separado. Devuelve { dataUrl, mediaType }.
  static normalizeImage(image, mediaTypeHint) {
    const raw = `${image ?? ''}`.trim();
    if (!raw) {
      throw extractionError('BIOPSY_IMAGE_MISSING', 'Falta la imagen.', 400);
    }
    const match = raw.match(/^data:([a-z0-9/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
    let mediaType;
    let b64;
    if (match) {
      mediaType = match[1].toLowerCase();
      b64 = match[2].replace(/\s/g, '');
    } else {
      mediaType = `${mediaTypeHint ?? ''}`.toLowerCase();
      b64 = raw.replace(/\s/g, '');
    }
    if (!MEDIA_TYPES.has(mediaType)) {
      throw extractionError('BIOPSY_IMAGE_UNSUPPORTED', 'Formato de imagen no soportado. Usa JPG, PNG o WebP.', 400);
    }
    if (b64.length > MAX_BASE64_CHARS) {
      throw extractionError('BIOPSY_IMAGE_TOO_LARGE', 'La imagen supera 5 MB. Usa una foto más liviana.', 413);
    }
    return { dataUrl: `data:${mediaType};base64,${b64}`, mediaType };
  }

  buildMessages(template, imageDataUrl) {
    const guide = template.sections
      .map((section, index) =>
        `${index + 1}. key="${section.key}" — ${section.label}${section.instruction ? ` (${section.instruction})` : ''}`)
      .join('\n');

    const userText = `Plantilla: "${template.name}".
Rellena estas secciones a partir de la hoja de la foto (usa exactamente estas keys):
${guide}`;

    return [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: imageDataUrl } }
        ]
      }
    ];
  }

  buildDynamicMessages(imageDataUrl) {
    const userText = 'Lee la hoja de la foto, identifica el tipo de estudio de laboratorio y diseña el informe con las secciones que mejor representen su contenido, transcribiendo lo escrito. No inventes datos.';
    return [
      { role: 'system', content: SYSTEM_DYNAMIC },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: imageDataUrl } }
        ]
      }
    ];
  }

  usageSummary(usage) {
    if (!usage) return null;
    return {
      provider: this.llmProvider.provider || '',
      api_family: 'chat_completions',
      model: this.llmProvider.model || '',
      input_tokens: Number(usage.prompt_tokens) || 0,
      output_tokens: Number(usage.completion_tokens) || 0,
      total_tokens: Number(usage.total_tokens) || 0
    };
  }

  // extract({ image, template: { name, sections }, mode }) -> { template, sections, warnings, usage }
  // mode 'dynamic': la IA diseña la plantilla desde la foto (sin `template`).
  async extract({ image, mediaType = '', template, mode = '' } = {}) {
    const dynamic = `${mode || ''}`.trim().toLowerCase() === 'dynamic';

    let sections = [];
    let templateName = `${template?.name ?? ''}`.trim();
    if (!dynamic) {
      sections = parseTemplateSections(template?.sections);
      if (!sections.length) {
        throw extractionError('BIOPSY_TEMPLATE_EMPTY', 'La plantilla no tiene secciones.', 400);
      }
      templateName = templateName || 'Informe de laboratorio';
    }

    const { dataUrl } = BiopsyExtractionService.normalizeImage(image, mediaType);
    this.requireLlm();

    const messages = dynamic
      ? this.buildDynamicMessages(dataUrl)
      : this.buildMessages({ name: templateName, sections }, dataUrl);

    let content;
    let usage;
    try {
      const result = await this.llmProvider.chatExpectingJsonWithUsage(messages, { type: 'json_object' });
      content = result.content;
      usage = result.usage;
    } catch (error) {
      console.error(`[Biopsy] vision request failed: ${error.message}`);
      throw extractionError('BIOPSY_LLM_FAILED', 'No fue posible leer la hoja con la IA. Intenta de nuevo.', 502);
    }

    let parsed;
    try {
      parsed = this.llmProvider.parseJsonObject(content || '{}');
    } catch (error) {
      // No se registra `content`: puede contener datos de la muestra/paciente.
      console.error('[Biopsy] JSON parse failed');
      throw extractionError('BIOPSY_PARSE_FAILED', 'La IA no devolvió un resultado interpretable. Intenta de nuevo.', 502);
    }

    if (dynamic) {
      const outSections = sanitizeDynamicSections(parsed);
      if (!outSections.length) {
        throw extractionError('BIOPSY_DYNAMIC_EMPTY', 'La IA no pudo estructurar la hoja. Intenta con una foto más nítida.', 502);
      }
      const name = `${parsed?.template_name ?? ''}`.trim().slice(0, MAX_LABEL_CHARS) || 'Informe de laboratorio';
      return {
        template: { name },
        sections: outSections,
        warnings: sanitizeWarnings(parsed),
        usage: this.usageSummary(usage)
      };
    }

    return {
      template: { name: templateName },
      sections: alignSections(sections, parsed),
      warnings: sanitizeWarnings(parsed),
      usage: this.usageSummary(usage)
    };
  }
}

BiopsyExtractionService.MEDIA_TYPES = MEDIA_TYPES;
BiopsyExtractionService.MAX_BASE64_CHARS = MAX_BASE64_CHARS;

module.exports = BiopsyExtractionService;
