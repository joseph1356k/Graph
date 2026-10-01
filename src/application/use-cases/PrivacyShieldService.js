// El escudo de privacidad: tapa los identificadores directos del paciente
// justo antes de que un texto salga hacia un proveedor externo de IA, y los
// devuelve exactamente cuando vuelve la respuesta.
//
// DÓNDE VIVE: en el último salto antes del proveedor (LLMProvider.postChatCompletions,
// callMiracleRuntime). Por debajo no hay ningún punto de persistencia, así que
// todo lo que Graph guarda —note_json, note_json_ai, el espejo en consultations,
// el snapshot de exportación, los matches que Windows escribe en SAP— lleva
// los datos reales. Ver docs/privacy-egress-gateway.md.
//
// SIN BÓVEDA: lo que hay que tapar se recalcula en cada llamada a partir de lo
// que el servicio ya tiene cargado (paciente registrado, transcripción y nota
// del encounter) y de lo que el detector encuentra en el propio prompt. El
// mapa vive en memoria de la llamada y muere con ella.
//
// MODOS, por funcionalidad (PRIVACY_SHIELD_MODE y PRIVACY_SHIELD_MODE_<FEATURE>):
//   off     — no se hace nada; el ledger lo dice.
//   shadow  — detecta y anota cuánto TAPARÍA, pero manda el original. Sirve
//             para calibrar sin tocar la calidad de la nota.
//   enforce — manda tapado y falla cerrado: si el escudo no puede correr, la
//             llamada no sale (PRIVACY_SHIELD_FAILED).

const crypto = require('crypto');
const ProtectionMap = require('../../domain/privacy/ProtectionMap');
const { TYPES, containsToken } = require('../../domain/privacy/tokens');
const { detectAll, ROLES } = require('../../domain/privacy/detectors');
const { transformTextOrJson, tryParseJson, walkStrings } = require('../../domain/privacy/jsonWalk');
const { posthocLeakCheck, findIdentitySection, parseIdentityLines } = require('../../domain/privacy/identitySection');
const { nameTokens, documentKey } = require('../../domain/privacy/canon');
const { currentPrivacyScope, recordPrivacyResult } = require('../../infrastructure/privacy/PrivacyContext');

const MODES = Object.freeze({ OFF: 'off', SHADOW: 'shadow', ENFORCE: 'enforce' });
const DEFAULT_MODE = MODES.SHADOW;

// Se pega al primer mensaje `system` solo cuando la llamada emitió marcadores.
const SYSTEM_RULE = [
  'PRIVACIDAD: el texto trae marcadores como [PACIENTE_NOMBRE_1], [DOCUMENTO_1], [TELEFONO_1], [CORREO_1], [DIRECCION_1] o [NUMERO_1].',
  'Son datos reales sustituidos por privacidad antes de enviarte el texto. Cópialos tal cual, con sus corchetes, donde correspondan;',
  'en la casilla de identificación usa el marcador base (sin sufijo de alias). Nunca los inventes, los traduzcas, los expandas ni los describas.'
].join(' ');

function shieldError(message, cause) {
  const error = new Error(message);
  error.code = 'PRIVACY_SHIELD_FAILED';
  error.statusCode = 503;
  if (cause) error.cause = cause;
  return error;
}

function sha256(text) {
  return crypto.createHash('sha256').update(`${text}`).digest('hex');
}

function normalizeModeValue(value) {
  const clean = `${value ?? ''}`.trim().toLowerCase();
  return Object.values(MODES).includes(clean) ? clean : null;
}

class PrivacyShieldService {
  constructor({ seedRepository = null, env = process.env, logger = console } = {}) {
    this.seedRepository = seedRepository;
    this.env = env;
    this.logger = logger;
  }

  /* ---------------------------------------------------------------- */
  /* Modo                                                               */
  /* ---------------------------------------------------------------- */

  modeFor(feature) {
    const key = `${feature || ''}`.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    const perFeature = key ? normalizeModeValue(this.env[`PRIVACY_SHIELD_MODE_${key}`]) : null;
    if (perFeature) return perFeature;
    return normalizeModeValue(this.env.PRIVACY_SHIELD_MODE) || DEFAULT_MODE;
  }

  /* ---------------------------------------------------------------- */
  /* Semillas                                                           */
  /* ---------------------------------------------------------------- */

  static seedsFromText(text, { includeNumbers = true } = {}) {
    const seeds = [];
    for (const span of detectAll(text)) {
      if (span.mask === false || span.role === ROLES.MEDICO) continue;
      if (!includeNumbers && span.type === TYPES.NUMERO) continue;
      seeds.push({ type: span.type, value: span.value });
    }
    return seeds;
  }

  static seedsFromNote(noteJson) {
    const seeds = [];
    const identity = findIdentitySection(noteJson);
    if (identity) {
      const lines = parseIdentityLines(identity.content ?? identity.texto ?? '');
      void lines; // la detección anclada de abajo ya lee esas líneas; el parser confirma que hay casilla
    }
    const sections = Array.isArray(noteJson?.sections) ? noteJson.sections : [];
    for (const section of sections) {
      const text = `${section?.content ?? section?.texto ?? ''}`;
      if (text) seeds.push(...PrivacyShieldService.seedsFromText(text));
    }
    if (typeof noteJson?.summary === 'string') seeds.push(...PrivacyShieldService.seedsFromText(noteJson.summary));
    return seeds;
  }

  /**
   * Campos de pantalla con etiqueta de identidad («Nombre del paciente» =
   * «Ana Torres»): el valor es de quien esté en pantalla —a veces otro
   * paciente— y no lleva ancla en el texto, así que se siembra por su etiqueta.
   */
  static seedsFromLabeledFields(parsed) {
    const seeds = [];
    const visit = (node) => {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (!node || typeof node !== 'object') return;
      const label = typeof node.label === 'string' ? node.label : '';
      const value = typeof node.currentValue === 'string' ? node.currentValue.trim() : '';
      if (label && value) {
        const type = PrivacyShieldService.identityTypeForLabel(label);
        if (type) seeds.push({ type, value });
      }
      for (const child of Object.values(node)) {
        if (child && typeof child === 'object') visit(child);
      }
    };
    visit(parsed);
    return seeds;
  }

  static identityTypeForLabel(label) {
    const normalized = `${label}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (/(documento|cedula|identificaci|nuip|pasaporte)/.test(normalized)) return TYPES.DOCUMENTO;
    if (/(telefono|celular|movil|whatsapp)/.test(normalized)) return TYPES.TELEFONO;
    if (/(correo|e-?mail)/.test(normalized)) return TYPES.CORREO;
    if (/(direccion|domicilio)/.test(normalized)) return TYPES.DIRECCION;
    if (/(nombre|paciente|apellido)/.test(normalized)) return TYPES.PACIENTE_NOMBRE;
    return null;
  }

  static seedsFromPatient(patient) {
    const seeds = [];
    if (!patient) return seeds;
    if (nameTokens(patient.nombre).length > 0) seeds.push({ type: TYPES.PACIENTE_NOMBRE, value: `${patient.nombre}`.trim() });
    if (documentKey(patient.documento)) seeds.push({ type: TYPES.DOCUMENTO, value: `${patient.documento}`.trim() });
    const phone = `${patient.telefono ?? ''}`.replace(/\D/g, '');
    if (phone.length >= 7) seeds.push({ type: TYPES.TELEFONO, value: `${patient.telefono}`.trim() });
    return seeds;
  }

  /**
   * Semillas de un ámbito. Se calculan una vez por ámbito (varias llamadas en
   * la misma petición las comparten) y nunca lanzan: sin base de datos el
   * escudo trabaja con lo que detecta en el texto.
   */
  async seedsForScope(scope) {
    if (!scope) return { seeds: [], excludedNames: [], sources: [] };
    if (scope.seedCache) return scope.seedCache;

    const seeds = [];
    const excludedNames = [];
    const sources = [];
    const repo = this.seedRepository;

    try {
      for (const seed of Array.isArray(scope.seeds) ? scope.seeds : []) {
        if (seed && seed.type && seed.value) {
          seeds.push({ type: seed.type, value: `${seed.value}` });
          sources.push('explicit');
        }
      }

      const encounter = scope.encounter || null;
      let doctorOrganizationId = null;
      const doctorId = encounter?.doctor_id || scope.doctorId || null;
      if (repo && doctorId) {
        const profile = await repo.doctorProfile(doctorId);
        if (profile) {
          doctorOrganizationId = profile.organization_id || null;
          if (nameTokens(profile.full_name).length > 0) excludedNames.push(`${profile.full_name}`);
        }
      }

      if (encounter) {
        const patientId = `${encounter.patient_id ?? ''}`.trim();
        if (patientId) {
          if (repo && repo.constructor.isUuid?.(patientId)) {
            const patient = await repo.patientById(patientId);
            if (patient && (!doctorOrganizationId || !patient.organization_id || patient.organization_id === doctorOrganizationId)) {
              const fromPatient = PrivacyShieldService.seedsFromPatient(patient);
              seeds.push(...fromPatient);
              if (fromPatient.length) sources.push('paciente_registrado');
            } else if (patient) {
              this.logger.warn?.(`[Privacidad] paciente ${patientId} de otra organización: no se usa como semilla.`);
            }
          } else if (!repo || !repo.constructor.isUuid?.(patientId)) {
            // Un patient_id que no es uuid puede ser un nombre tecleado a mano.
            const typed = PrivacyShieldService.seedsFromText(`Nombre: ${patientId}`);
            if (typed.length) {
              seeds.push(...typed);
              sources.push('patient_id_texto');
            }
          }
        }
        const transcript = `${encounter.transcript ?? ''}`;
        if (transcript.trim()) {
          const fromTranscript = PrivacyShieldService.seedsFromText(transcript);
          seeds.push(...fromTranscript);
          if (fromTranscript.length) sources.push('transcripcion');
        }
        if (encounter.note_json) {
          const fromNote = PrivacyShieldService.seedsFromNote(encounter.note_json);
          seeds.push(...fromNote);
          if (fromNote.length) sources.push('nota');
        }
      }

      const consultationId = `${scope.consultationId ?? ''}`.trim();
      if (repo && consultationId) {
        const consultation = await repo.consultationIdentity(consultationId);
        if (consultation) {
          // El paciente registrado va PRIMERO: su forma («CC 2345677543») es el
          // alias principal, que es lo que la casilla de identificación
          // restaura; las columnas derivadas (solo cifras) van después.
          if (consultation.patient_id) {
            const patient = await repo.patientById(consultation.patient_id);
            if (patient && (!consultation.organization_id || !patient.organization_id || patient.organization_id === consultation.organization_id)) {
              seeds.push(...PrivacyShieldService.seedsFromPatient(patient));
            }
          }
          if (nameTokens(consultation.paciente_nombre).length > 0) {
            seeds.push({ type: TYPES.PACIENTE_NOMBRE, value: `${consultation.paciente_nombre}`.trim() });
          }
          if (documentKey(consultation.paciente_documento)) {
            seeds.push({ type: TYPES.DOCUMENTO, value: `${consultation.paciente_documento}`.trim() });
          }
          sources.push('consulta');
        }
      }

      if (typeof scope.noteContent === 'string' && scope.noteContent.trim()) {
        const fromNote = PrivacyShieldService.seedsFromText(scope.noteContent);
        seeds.push(...fromNote);
        if (fromNote.length) sources.push('nota_texto');
      }
    } catch (error) {
      this.logger.warn?.(`[Privacidad] Semillas incompletas: ${error.message}`);
    }

    scope.seedCache = { seeds, excludedNames, sources };
    return scope.seedCache;
  }

  /* ---------------------------------------------------------------- */
  /* Chat completions                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Tapa un payload de chat completions. Devuelve una PROTECCIÓN: el payload
   * a enviar (clonado y tapado en enforce; el original en shadow/off), el
   * mapa, y un resumen que va al ledger.
   */
  async protectChatPayload(payload, { feature = '' } = {}) {
    const mode = this.modeFor(feature);
    const protection = {
      mode,
      feature,
      map: null,
      payload,
      json: Boolean(payload?.response_format),
      imageParts: 0,
      leakScan: 'n/a',
      rehydration: 'n/a',
      posthoc: null,
      sha256: '',
      error: null,
      scope: currentPrivacyScope()
    };
    if (mode === MODES.OFF) {
      return protection;
    }
    if (payload?.stream === true && mode === MODES.ENFORCE) {
      throw shieldError('El escudo de privacidad no admite respuestas en streaming: no habría dónde rehidratar.');
    }

    try {
      const { seeds, excludedNames } = await this.seedsForScope(protection.scope);
      const map = new ProtectionMap({ seeds, excludedNames });
      const clone = JSON.parse(JSON.stringify(payload));
      const messages = Array.isArray(clone.messages) ? clone.messages : [];
      // Pre-pase por forma: los campos de pantalla con etiqueta de identidad
      // se siembran antes de tapar nada, para que su valor caiga aunque no
      // lleve ancla en el texto.
      for (const message of messages) {
        const texts = typeof message?.content === 'string'
          ? [message.content]
          : (Array.isArray(message?.content) ? message.content.map((part) => part?.text).filter((t) => typeof t === 'string') : []);
        for (const text of texts) {
          const parsed = tryParseJson(text);
          if (parsed) PrivacyShieldService.seedsFromLabeledFields(parsed).forEach((seed) => map.addSeed(seed));
        }
      }
      const protectedTexts = [];
      for (const message of messages) {
        if (typeof message?.content === 'string') {
          message.content = transformTextOrJson(message.content, (text) => map.protectText(text));
          protectedTexts.push(message.content);
        } else if (Array.isArray(message?.content)) {
          for (const part of message.content) {
            if (part && typeof part.text === 'string') {
              part.text = transformTextOrJson(part.text, (text) => map.protectText(text));
              protectedTexts.push(part.text);
            } else if (part && (part.type === 'image_url' || part.type === 'input_image')) {
              protection.imageParts += 1;
            }
          }
        }
      }

      // Barrido anti-fuga: ninguna semilla poco ambigua puede seguir visible.
      let leaks = map.leakScan(protectedTexts.join('\n'));
      if (leaks.length > 0) {
        for (const message of messages) {
          if (typeof message?.content === 'string') message.content = map.repair(message.content).text;
          else if (Array.isArray(message?.content)) {
            for (const part of message.content) {
              if (part && typeof part.text === 'string') part.text = map.repair(part.text).text;
            }
          }
        }
        leaks = map.leakScan(messages.map((m) => (typeof m?.content === 'string' ? m.content : (m?.content || []).map((p) => p?.text || '').join('\n'))).join('\n'));
        protection.leakScan = leaks.length > 0 ? 'blocked' : 'repaired';
        if (leaks.length > 0 && mode === MODES.ENFORCE) {
          throw shieldError('Un identificador conocido seguía visible tras taparlo y no se pudo reparar.');
        }
      } else {
        protection.leakScan = 'ok';
      }

      if (map.hasTokens()) {
        const system = messages.find((message) => message?.role === 'system' && typeof message.content === 'string');
        if (system) system.content = `${system.content}\n\n${SYSTEM_RULE}`;
        else messages.unshift({ role: 'system', content: SYSTEM_RULE });
      }

      protection.map = map;
      if (mode === MODES.ENFORCE) {
        protection.payload = clone;
      }
      protection.sha256 = sha256(JSON.stringify(protection.payload));
      return protection;
    } catch (error) {
      if (mode === MODES.ENFORCE) {
        if (error.code === 'PRIVACY_SHIELD_FAILED') throw error;
        throw shieldError(`El escudo de privacidad no pudo proteger la llamada: ${error.message}`, error);
      }
      // En shadow un fallo del escudo se anota y la llamada sigue con el original.
      protection.error = error.message;
      this.logger.warn?.(`[Privacidad] shadow: ${error.message}`);
      return protection;
    }
  }

  /** Devuelve los valores reales a la respuesta del proveedor (solo en enforce). */
  restoreChatResponse(data, protection) {
    if (!protection || protection.mode !== MODES.ENFORCE || !protection.map) {
      if (protection) this.publishResult(protection);
      return data;
    }
    const map = protection.map;
    const before = map.stats.unknownTokens;
    const choices = Array.isArray(data?.choices) ? data.choices : [];
    for (const choice of choices) {
      const message = choice?.message;
      if (!message || typeof message.content !== 'string') continue;
      if (protection.posthoc === null && protection.json) {
        const check = posthocLeakCheck(message.content);
        protection.posthoc = check.checked ? check.leak : null;
      }
      message.content = map.restoreText(message.content, { json: protection.json });
    }
    protection.rehydration = map.stats.unknownTokens > before ? 'incomplete' : 'complete';
    this.publishResult(protection);
    return data;
  }

  /* ---------------------------------------------------------------- */
  /* Texto suelto (salto Node → runtime Python)                         */
  /* ---------------------------------------------------------------- */

  /**
   * @param {object} texts  { clave: texto } a tapar
   * @param {object} options
   * @param {string} options.feature  la feature del ledger (decide el modo)
   * @param {string} [options.maxMode]  techo del modo para un salto que todavía no
   *   puede ir tapado (p. ej. SHADOW: mide y deja el texto como está).
   */
  async protectTexts(texts, { feature = '', maxMode = '' } = {}) {
    const configured = this.modeFor(feature);
    const order = [MODES.OFF, MODES.SHADOW, MODES.ENFORCE];
    const mode = maxMode && order.indexOf(maxMode) >= 0 && order.indexOf(configured) > order.indexOf(maxMode)
      ? maxMode
      : configured;
    const protection = { mode, feature, map: null, texts, leakScan: 'n/a', rehydration: 'n/a', posthoc: null, imageParts: 0, sha256: '', error: null, scope: currentPrivacyScope() };
    if (mode === MODES.OFF) return protection;
    try {
      const { seeds, excludedNames } = await this.seedsForScope(protection.scope);
      const map = new ProtectionMap({ seeds, excludedNames });
      const out = {};
      for (const [key, value] of Object.entries(texts || {})) {
        out[key] = typeof value === 'string' ? map.protectText(value) : value;
      }
      const leaks = map.leakScan(Object.values(out).filter((v) => typeof v === 'string').join('\n'));
      if (leaks.length > 0) {
        for (const key of Object.keys(out)) {
          if (typeof out[key] === 'string') out[key] = map.repair(out[key]).text;
        }
        protection.leakScan = 'repaired';
      } else {
        protection.leakScan = 'ok';
      }
      protection.map = map;
      if (mode === MODES.ENFORCE) protection.texts = out;
      protection.sha256 = sha256(JSON.stringify(protection.texts));
      return protection;
    } catch (error) {
      if (mode === MODES.ENFORCE) throw shieldError(`El escudo de privacidad no pudo proteger el texto: ${error.message}`, error);
      protection.error = error.message;
      return protection;
    }
  }

  restoreText(text, protection) {
    if (!protection || protection.mode !== MODES.ENFORCE || !protection.map || typeof text !== 'string') return text;
    const before = protection.map.stats.unknownTokens;
    const restored = protection.map.restoreText(text);
    protection.rehydration = protection.map.stats.unknownTokens > before ? 'incomplete' : 'complete';
    return restored;
  }

  /* ---------------------------------------------------------------- */
  /* Resumen: lo que va al ledger y al médico                           */
  /* ---------------------------------------------------------------- */

  /** Claves planas para `ai_usage_events.metadata` (allowlist). Nunca valores. */
  metadataFor(protection) {
    if (!protection) return {};
    const summary = protection.map ? protection.map.summary() : null;
    const byType = summary ? summary.byType : {};
    return {
      privacyMode: protection.mode,
      privacyTokens: Object.entries(byType).map(([type, count]) => `${type}:${count}`).join(',') || 'none',
      privacySeeded: summary ? summary.seeded : 0,
      privacyDetected: summary ? summary.detected : 0,
      privacyLeakScan: protection.leakScan,
      privacyRehydration: protection.rehydration,
      privacyImageParts: protection.imageParts,
      privacyPayloadSha256: protection.sha256 || '',
      ...(protection.posthoc === null ? {} : { privacyPosthoc: Boolean(protection.posthoc) }),
      ...(protection.error ? { privacyError: `${protection.error}`.slice(0, 120) } : {})
    };
  }

  /** Lo que se le devuelve al médico: modo, conteos por tipo, estado. */
  publicSummaryFor(protection) {
    if (!protection) return null;
    const summary = protection.map ? protection.map.summary() : null;
    return {
      mode: protection.mode,
      shielded: protection.mode === MODES.ENFORCE && Boolean(protection.map),
      tokens: summary ? summary.byType : {},
      leak_scan: protection.leakScan,
      rehydration: protection.rehydration,
      posthoc_leak: protection.posthoc === null ? null : Boolean(protection.posthoc),
      image_parts: protection.imageParts
    };
  }

  publishResult(protection) {
    recordPrivacyResult(this.publicSummaryFor(protection));
  }

  /** Verdadero si un texto trae marcadores (guarda antes de escribir en SAP). */
  static containsToken(text) {
    return containsToken(text);
  }
}

PrivacyShieldService.MODES = MODES;
PrivacyShieldService.SYSTEM_RULE = SYSTEM_RULE;
PrivacyShieldService.shieldError = shieldError;

module.exports = PrivacyShieldService;
