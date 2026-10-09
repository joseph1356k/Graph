// Con quién habla Ü: un médico (con su especialidad), una persona que lo usa en
// su día a día, o nadie eligió todavía.
//
// El cliente lo manda como `profile: { kind, specialty, specialtyName }` en el
// primer turno de /api/v1/agent/turn y en la enseñanza (/teach/process-video,
// /teach/interpret-steps). Sin perfil, todo se porta como antes: así siguen
// igual las U.exe ya instaladas, el Mac y Android.
//
// LO QUE LLEGA A UN PROMPT SALE DEL CATÁLOGO, NUNCA DEL CLIENTE. `specialtyName`
// es texto libre que iría a parar a un system prompt; no se usa como texto. El
// código (o el nombre) se busca en el catálogo de especialidades de Graph
// (src/domain/clinical/specialtyNames.js, el mismo que tiene la web) y lo que
// no está en él se descarta: un médico sin especialidad conocida es «un médico».
const { SPECIALTY_NAMES, normalizeSpecialtyCode } = require('../clinical/specialtyNames');

const PROFILE_KINDS = Object.freeze({ MEDICO: 'medico', PERSONA: 'persona' });
const PROFILE_NONE = Object.freeze({ kind: '', specialty: '', specialtyName: '' });

// Nombre normalizado → código («Cardiología» y «cardiologia» llevan al mismo sitio).
const CODE_BY_NAME = Object.freeze(Object.fromEntries(
  Object.entries(SPECIALTY_NAMES).map(([code, name]) => [normalizeSpecialtyCode(name), code])
));

const plain = (value) => `${value ?? ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

/** Un código o un nombre de especialidad → código del catálogo, o '' si no está en él. */
function catalogCode(value) {
  const code = normalizeSpecialtyCode(`${value ?? ''}`.slice(0, 80));
  if (!code) return '';
  // hasOwn y no `SPECIALTY_NAMES[code]`: «constructor» o «toString» son claves
  // heredadas de Object y meterían «function Object() { [native code] }» en el prompt.
  if (Object.hasOwn(SPECIALTY_NAMES, code)) return code;
  return Object.hasOwn(CODE_BY_NAME, code) ? CODE_BY_NAME[code] : '';
}

/**
 * body.profile → { kind, specialty, specialtyName }. Acepta el objeto del cable o
 * solo el tipo ("medico" | "persona"). Lo desconocido es PROFILE_NONE.
 */
function normalizeProfile(raw) {
  const isObject = Boolean(raw) && typeof raw === 'object';
  const kind = plain(isObject ? raw.kind : raw);
  if (kind === PROFILE_KINDS.PERSONA) return { kind: PROFILE_KINDS.PERSONA, specialty: '', specialtyName: '' };
  if (kind !== PROFILE_KINDS.MEDICO) return { ...PROFILE_NONE };
  // El nombre del cliente solo sirve para BUSCAR en el catálogo, por si el código no vino.
  const code = isObject ? (catalogCode(raw.specialty) || catalogCode(raw.specialtyName)) : '';
  return { kind: PROFILE_KINDS.MEDICO, specialty: code, specialtyName: code ? SPECIALTY_NAMES[code] : '' };
}

/**
 * Lo que se guarda en la sesión firmada del primer turno (congelado, como la
 * plataforma). Sin perfil no se guarda nada: la sesión sale igual que antes.
 */
function profileForSession(profile) {
  if (!profile || !profile.kind) return null;
  return profile.specialty ? { kind: profile.kind, specialty: profile.specialty } : { kind: profile.kind };
}

/** El perfil de una sesión ya emitida (la ausencia es PROFILE_NONE). */
function profileOfSession(session) {
  return normalizeProfile(session && session.profile);
}

module.exports = { normalizeProfile, profileForSession, profileOfSession, PROFILE_KINDS, PROFILE_NONE };
