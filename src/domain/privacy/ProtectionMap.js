// El mapa de protección de UNA llamada al proveedor: qué valor real se tapó
// con qué marcador, para poder devolverlo exactamente cuando vuelva la
// respuesta. Vive en memoria de la llamada y muere con ella.
//
// Tres reglas que no se relajan:
//   1. Un marcador restaura EXACTAMENTE la forma que tapó (alias por forma).
//   2. Solo se restauran marcadores de entidades que ESTE mapa tapó en un
//      texto saliente de la llamada: un marcador que venga en el texto del
//      cliente es texto opaco, nunca el dato de nadie. Registrar una semilla
//      (el paciente de la consulta) NO la vuelve restaurable: hasta el
//      2026-09-26 sí lo hacía, y bastaba mandar «[PACIENTE_NOMBRE_1]» con un
//      consultation_id para que la respuesta trajera el nombre y el documento
//      de ese paciente. La única excepción son las semillas `trusted`: las de
//      un encounter que el servicio ya verificó como PROPIO del que llama.
//      Devolverle a ese médico el paciente de su propia consulta no le enseña
//      nada que no pueda leer, y así «Nombre: [PACIENTE_NOMBRE_1]» sigue
//      saliendo con el paciente registrado aunque nadie lo dijera en voz alta.
//   3. Mismo valor ⇒ mismo marcador dentro de la llamada.

const { TYPES, formatToken, replaceTokens, normalizeIdentityAliases, countDeformedTokens } = require('./tokens');
const {
  NOT_WORD_BEFORE,
  NOT_WORD_AFTER,
  PARTICLE_SET,
  escapeRegExp,
  normalizeToken,
  normalizeComparable,
  tokenToPattern,
  nameTokens,
  isCommonWordName,
  startsUpper,
  documentKey,
  digitsOf,
  digitRunPattern
} = require('./canon');
const { detectAll, ROLES, STRONG_PATIENT_ANCHOR, WEAK_PATIENT_ANCHOR, DOCTOR_ANCHOR } = require('./detectors');

const PATIENT_ANCHOR_NEAR = new RegExp(`(?:${STRONG_PATIENT_ANCHOR}|(?<![\\p{L}])${WEAK_PATIENT_ANCHOR}|nombre\\s*:)[^\\n]{0,40}$`, 'iu');
const DOCTOR_ANCHOR_NEAR = new RegExp(`(?<![\\p{L}])${DOCTOR_ANCHOR}[^\\n]{0,40}$`, 'iu');

function entityKeyFor(type, value) {
  switch (type) {
    case TYPES.PACIENTE_NOMBRE:
      return nameTokens(value);
    case TYPES.DOCUMENTO:
      return documentKey(value) || digitsOf(value) || normalizeComparable(value);
    case TYPES.TELEFONO:
    case TYPES.NUMERO:
      return digitsOf(value);
    case TYPES.CORREO:
      return normalizeComparable(value);
    case TYPES.DIRECCION:
      return normalizeComparable(value);
    default:
      return normalizeComparable(value);
  }
}

class ProtectionMap {
  /**
   * @param {object} options
   * @param {Array<{type:string,value:string}>} options.seeds  identificadores conocidos de antemano
   * @param {string[]} options.excludedNames  nombres que NO son del paciente (el médico)
   */
  constructor({ seeds = [], excludedNames = [] } = {}) {
    this.entities = [];
    this.nextN = {};
    this.tokenIndex = new Map();
    // `${type}_${n}` de las entidades tapadas en un texto saliente (regla 2).
    this.emitted = new Set();
    this.excludedTokens = new Set(excludedNames.flatMap((name) => nameTokens(name)));
    this.stats = { seeded: 0, detected: 0, occurrences: 0, byType: {}, leakRepaired: 0, restored: 0, unknownTokens: 0 };
    for (const seed of seeds) this.addSeed(seed);
  }

  /* ---------------------------------------------------------------- */
  /* Entidades y alias                                                  */
  /* ---------------------------------------------------------------- */

  findEntity(type, key) {
    if (type === TYPES.PACIENTE_NOMBRE) {
      const candidate = Array.isArray(key) ? key : [];
      if (candidate.length === 0) return null;
      let best = null;
      for (const entity of this.entities) {
        if (entity.type !== type) continue;
        const subset = candidate.every((token) => entity.tokens.has(token));
        const superset = [...entity.tokens].every((token) => candidate.includes(token));
        if (subset) {
          if (!best || entity.source === 'seed') best = entity;
        } else if (superset && entity.source !== 'seed') {
          // Una forma más larga de una persona ya vista: se amplía la entidad.
          candidate.forEach((token) => entity.tokens.add(token));
          if (!best) best = entity;
        }
      }
      return best;
    }
    return this.entities.find((entity) => entity.type === type && entity.key === key) || null;
  }

  createEntity(type, key, source) {
    const n = (this.nextN[type] || 0) + 1;
    this.nextN[type] = n;
    const entity = {
      type,
      n,
      key: type === TYPES.PACIENTE_NOMBRE ? null : key,
      tokens: type === TYPES.PACIENTE_NOMBRE ? new Set(key) : null,
      aliases: new Map(),
      source
    };
    this.entities.push(entity);
    if (source === 'seed') this.stats.seeded += 1;
    else this.stats.detected += 1;
    return entity;
  }

  aliasToken(entity, surface) {
    const existing = entity.aliases.get(surface);
    if (existing) return existing.token;
    const k = entity.aliases.size + 1;
    const token = formatToken(entity.type, entity.n, k);
    entity.aliases.set(surface, { k, token });
    this.tokenIndex.set(token, surface);
    return token;
  }

  /**
   * Registra un identificador conocido de antemano (paciente registrado,
   * líneas de la nota…). `trusted` la vuelve restaurable aunque la llamada no
   * la envíe: solo para datos de una consulta propia del que llama (regla 2).
   */
  addSeed({ type, value, trusted = false }) {
    const surface = `${value ?? ''}`.trim();
    if (!surface || !Object.values(TYPES).includes(type)) return null;
    const key = entityKeyFor(type, surface);
    if (type === TYPES.PACIENTE_NOMBRE && key.length === 0) return null;
    if (type !== TYPES.PACIENTE_NOMBRE && !key) return null;
    let entity = this.findEntity(type, key);
    if (!entity) entity = this.createEntity(type, key, 'seed');
    else if (entity.source !== 'seed') entity.source = 'seed';
    // La forma de la semilla es el alias principal aunque nunca aparezca en el
    // texto: así «[PACIENTE_NOMBRE_1]» en la casilla de identificación devuelve
    // el nombre registrado completo (si la entidad es restaurable).
    this.aliasToken(entity, surface);
    if (trusted === true) this.emitted.add(`${entity.type}_${entity.n}`);
    return entity;
  }

  entityFor(type, surface, source = 'detected') {
    const key = entityKeyFor(type, surface);
    let entity = this.findEntity(type, key);
    if (!entity) entity = this.createEntity(type, key, source);
    return entity;
  }

  tokenFor(type, surface, source = 'detected') {
    return this.aliasToken(this.entityFor(type, surface, source), surface);
  }

  /**
   * Marcador para un valor que SÍ se tapa en un texto saliente. Es lo único
   * que vuelve restaurable a una entidad (regla 2); aliasToken a secas solo
   * reserva el nombre del marcador.
   */
  emitToken(entity, surface) {
    this.emitted.add(`${entity.type}_${entity.n}`);
    return this.aliasToken(entity, surface);
  }

  wasEmitted(type, n) {
    return this.emitted.has(`${type}_${n}`);
  }

  /* ---------------------------------------------------------------- */
  /* Búsqueda de semillas en un texto                                   */
  /* ---------------------------------------------------------------- */

  seedSpans(text) {
    const spans = [];
    // TODAS las entidades, no solo las semillas: un valor detectado en una hoja
    // del JSON («se llama Ana Mora» en la transcripción) queda conocido para
    // las siguientes («Ana Mora» a secas en el valor de un campo SAP). Mismo
    // valor ⇒ mismo marcador dentro de la llamada.
    for (const entity of this.entities) {
      for (const surface of entity.aliases.keys()) {
        if (entity.type === TYPES.PACIENTE_NOMBRE) {
          this.nameSeedSpans(text, entity, surface, spans);
        } else if (entity.type === TYPES.DOCUMENTO || entity.type === TYPES.TELEFONO || entity.type === TYPES.NUMERO) {
          this.digitSeedSpans(text, entity, surface, spans);
        } else {
          this.literalSeedSpans(text, entity, surface, spans);
        }
      }
    }
    return spans;
  }

  nameSeedSpans(text, entity, surface, spans) {
    const normalized = surface.split(/\s+/).map(normalizeToken).filter(Boolean);
    if (normalized.length === 0) return;
    // Frases: la completa y cualquier tramo contiguo de ≥2 palabras («Juan
    // David Pérez» cuando el registro dice «Juan David Pérez Gómez»), con
    // partículas incluidas e insensible a tildes y mayúsculas. Las más largas
    // primero: el solape se resuelve por longitud.
    for (let size = normalized.length; size >= 2; size -= 1) {
      for (let from = 0; from + size <= normalized.length; from += 1) {
        const window = normalized.slice(from, from + size);
        if (window.filter((token) => !PARTICLE_SET.has(token)).length < 2) continue;
        const phrase = new RegExp(
          `${NOT_WORD_BEFORE}${window.map(tokenToPattern).join('\\s+')}${NOT_WORD_AFTER}`,
          'giu'
        );
        let match;
        while ((match = phrase.exec(text)) !== null) {
          spans.push({ type: entity.type, start: match.index, end: match.index + match[0].length, value: match[0], entity, role: ROLES.PACIENTE });
        }
      }
    }
    // Tokens sueltos: «don José», «vino Jaramillo».
    for (const token of [...entity.tokens].sort((a, b) => b.length - a.length)) {
      const re = new RegExp(`${NOT_WORD_BEFORE}${tokenToPattern(token)}${NOT_WORD_AFTER}`, 'giu');
      let match;
      while ((match = re.exec(text)) !== null) {
        if (!this.acceptSingleToken(text, match.index, match[0], token)) continue;
        spans.push({ type: entity.type, start: match.index, end: match.index + match[0].length, value: match[0], entity, role: ROLES.PACIENTE });
      }
    }
  }

  acceptSingleToken(text, index, surface, token) {
    const before = text.slice(Math.max(0, index - 60), index);
    if (this.excludedTokens.has(token) && DOCTOR_ANCHOR_NEAR.test(before)) return false;
    const upper = startsUpper(surface);
    const anchored = PATIENT_ANCHOR_NEAR.test(before);
    if (isCommonWordName(token)) return upper && anchored;
    return upper || anchored;
  }

  digitSeedSpans(text, entity, surface, spans) {
    const patterns = [];
    if (/[^\d\s.\-]/.test(surface)) {
      // La forma literal con su sigla («CC 1.023.456.789») va primero: es más larga.
      patterns.push(`${NOT_WORD_BEFORE}${escapeRegExp(surface)}${NOT_WORD_AFTER}`);
    }
    const run = digitRunPattern(entity.key);
    if (run) patterns.push(run);
    for (const pattern of patterns) {
      const re = new RegExp(pattern, 'giu');
      let match;
      while ((match = re.exec(text)) !== null) {
        spans.push({ type: entity.type, start: match.index, end: match.index + match[0].length, value: match[0], entity, role: ROLES.PACIENTE });
      }
    }
  }

  literalSeedSpans(text, entity, surface, spans) {
    const normalized = normalizeToken(surface);
    const pattern = entity.type === TYPES.CORREO
      ? escapeRegExp(surface)
      : normalized.split(/\s+/).map(tokenToPattern).join('\\s+');
    const re = new RegExp(`${NOT_WORD_BEFORE}${pattern}${NOT_WORD_AFTER}`, 'giu');
    let match;
    while ((match = re.exec(text)) !== null) {
      spans.push({ type: entity.type, start: match.index, end: match.index + match[0].length, value: match[0], entity, role: ROLES.PACIENTE });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proteger y restaurar                                               */
  /* ---------------------------------------------------------------- */

  /** Tapa los identificadores de un texto y registra los marcadores emitidos. */
  protectText(text) {
    const input = `${text ?? ''}`;
    if (!input.trim()) return input;

    const seedSpans = this.seedSpans(input);
    const detected = detectAll(input);
    for (const span of detected) {
      if (span.role === ROLES.MEDICO) {
        nameTokens(span.value).forEach((token) => this.excludedTokens.add(token));
      }
    }
    const candidates = [
      ...seedSpans.map((span) => ({ ...span, priority: 0 })),
      ...detected.filter((span) => span.mask !== false).map((span) => ({ ...span, priority: 1 }))
    ].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start) || a.priority - b.priority);

    const spans = [];
    for (const span of candidates) {
      const last = spans[spans.length - 1];
      if (last && span.start < last.end) continue;
      spans.push(span);
    }
    if (spans.length === 0) return input;

    let out = '';
    let cursor = 0;
    for (const span of spans) {
      const entity = span.entity || this.entityFor(span.type, span.value, 'detected');
      const token = this.emitToken(entity, span.value);
      out += input.slice(cursor, span.start) + token;
      cursor = span.end;
      this.stats.occurrences += 1;
      this.stats.byType[span.type] = (this.stats.byType[span.type] || 0) + 1;
    }
    return out + input.slice(cursor);
  }

  /**
   * Devuelve los valores reales a un texto con marcadores. Solo los de
   * entidades que este mapa tapó en la llamada (regla 2); el resto se deja
   * visible y se cuenta.
   */
  restoreText(text, { json = false } = {}) {
    const normalized = normalizeIdentityAliases(`${text ?? ''}`);
    const result = replaceTokens(normalized, (token) => {
      const surface = this.wasEmitted(token.type, token.n)
        ? this.tokenIndex.get(formatToken(token.type, token.n, token.k))
        : undefined;
      if (surface === undefined) {
        this.stats.unknownTokens += 1;
        return undefined;
      }
      this.stats.restored += 1;
      return json ? JSON.stringify(surface).slice(1, -1) : surface;
    });
    // Un marcador que el modelo deformó sin corchetes no se adivina, pero se
    // cuenta: la rehidratación queda «incompleta» y la nota lo avisa.
    this.stats.unknownTokens += countDeformedTokens(result);
    return result;
  }

  /* ---------------------------------------------------------------- */
  /* Barrido anti-fuga                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Semillas que siguen visibles en un texto ya tapado. Solo formas con poca
   * ambigüedad: frases de ≥2 tokens y corridas de dígitos. Los tokens sueltos
   * de nombre no entran: «luz» o «cruz» en prosa serían fugas falsas.
   */
  leakScan(text) {
    const comparable = normalizeComparable(text);
    const leaks = [];
    for (const entity of this.entities) {
      if (entity.source !== 'seed') continue;
      for (const surface of entity.aliases.keys()) {
        if (entity.type === TYPES.PACIENTE_NOMBRE) {
          if (nameTokens(surface).length < 2) continue;
          if (comparable.includes(normalizeComparable(surface))) leaks.push({ type: entity.type, n: entity.n, surface });
        } else if (entity.type === TYPES.DOCUMENTO || entity.type === TYPES.TELEFONO || entity.type === TYPES.NUMERO) {
          const run = digitRunPattern(entity.key);
          if (run && new RegExp(run, 'u').test(text)) leaks.push({ type: entity.type, n: entity.n, surface });
        } else if (comparable.includes(normalizeComparable(surface))) {
          leaks.push({ type: entity.type, n: entity.n, surface });
        }
      }
    }
    return leaks;
  }

  /** Reemplazo literal de lo que el barrido encontró. */
  repair(text) {
    let out = `${text ?? ''}`;
    let repaired = 0;
    for (const leak of this.leakScan(out)) {
      const entity = this.entities.find((item) => item.type === leak.type && item.n === leak.n);
      if (!entity) continue;
      const spans = [];
      if (entity.type === TYPES.PACIENTE_NOMBRE) this.nameSeedSpans(out, entity, leak.surface, spans);
      else if (entity.type === TYPES.CORREO || entity.type === TYPES.DIRECCION) this.literalSeedSpans(out, entity, leak.surface, spans);
      else this.digitSeedSpans(out, entity, leak.surface, spans);
      // Sin solapes (la frase completa gana a sus tramos y a sus tokens
      // sueltos) y de atrás hacia adelante para que los índices sigan valiendo.
      spans.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
      const kept = [];
      for (const span of spans) {
        const last = kept[kept.length - 1];
        if (last && span.start < last.end) continue;
        kept.push(span);
      }
      for (const span of kept.reverse()) {
        out = out.slice(0, span.start) + this.emitToken(entity, span.value) + out.slice(span.end);
        repaired += 1;
      }
    }
    this.stats.leakRepaired += repaired;
    return { text: out, repaired };
  }

  hasTokens() {
    return this.stats.occurrences > 0;
  }

  summary() {
    return {
      entities: this.entities.length,
      seeded: this.stats.seeded,
      detected: this.stats.detected,
      occurrences: this.stats.occurrences,
      byType: { ...this.stats.byType },
      leakRepaired: this.stats.leakRepaired,
      restored: this.stats.restored,
      unknownTokens: this.stats.unknownTokens
    };
  }
}

ProtectionMap.entityKeyFor = entityKeyFor;

module.exports = ProtectionMap;
