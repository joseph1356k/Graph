// Configuración del módulo "Computer-use consciente" y de la "Enseñanza por
// video", leída del entorno EN CADA LLAMADA (serverless-friendly: el redeploy
// de Vercel tras guardar la tarjeta trae los env nuevos y aquí no hay caché).
//
// Por qué no se usa LLMProvider('MIRACLE_CONSCIOUS') para el cerebro: el engine
// portado necesita las APIs NATIVAS (Responses de OpenAI con computer-use y
// generateContent de Gemini con function-calling + visión), no Chat Completions.
// Aun así se respeta la MISMA convención de env (MIRACLE_CONSCIOUS_LLM_*) para
// que la tarjeta de Provider Studio y este módulo lean exactamente las mismas
// variables. Fallback a las keys globales (OPENAI_API_KEY / GEMINI_API_KEY)
// para conservar el comportamiento del backend original cuando la tarjeta aún
// no se ha configurado.

function env(name) {
  return `${process.env[name] || ''}`.trim();
}

// El Provider Studio guarda 'google' (convención de las demás tarjetas); el
// protocolo de sesión del cerebro usa 'gemini' (paridad con el blob del backend
// viejo, para que sesiones en vuelo sobrevivan la migración).
function normalizeProvider(raw) {
  const value = `${raw || ''}`.trim().toLowerCase();
  if (value === 'google' || value === 'gemini') return 'gemini';
  if (value === 'openai') return 'openai';
  if (value === 'disabled') return 'disabled';
  return '';
}

function geminiFallbackKey() {
  return env('GEMINI_API_KEY') || env('GOOGLE_API_KEY');
}

/**
 * Config efectiva del cerebro consciente. `configured` es false cuando está
 * deshabilitado o no hay key: el handler degrada con el error controlado del
 * contrato (HTTP 500 + {error}), igual que assertConfigured() del backend viejo.
 */
function resolveConsciousConfig() {
  let provider = normalizeProvider(env('MIRACLE_CONSCIOUS_LLM_PROVIDER'));

  if (provider === 'disabled') {
    return {
      provider: 'disabled',
      apiKey: '',
      model: '',
      effort: '',
      configured: false,
      errorMessage: 'El cerebro consciente está deshabilitado (MIRACLE_CONSCIOUS_LLM_PROVIDER=disabled).'
    };
  }

  // Sin tarjeta configurada: mismo default del backend viejo (PROVIDER=gemini si
  // hay key de Gemini; si no, OpenAI si hay OPENAI_API_KEY).
  if (!provider) {
    provider = geminiFallbackKey() ? 'gemini' : (env('OPENAI_API_KEY') ? 'openai' : '');
  }

  const activeKey = env('MIRACLE_CONSCIOUS_LLM_API_KEY');
  const apiKey = provider === 'gemini'
    ? (activeKey || env('MIRACLE_CONSCIOUS_LLM_GOOGLE_API_KEY') || geminiFallbackKey())
    : (activeKey || env('MIRACLE_CONSCIOUS_LLM_OPENAI_API_KEY') || env('OPENAI_API_KEY'));

  const model = env('MIRACLE_CONSCIOUS_LLM_MODEL')
    || (provider === 'gemini'
      ? (env('GEMINI_MODEL') || 'gemini-3.5-flash')
      : (env('OPENAI_MODEL') || env('MODEL') || 'gpt-5.6'));

  // reasoning.effort de OpenAI; para computer-use se recomienda "low".
  const effort = env('MIRACLE_CONSCIOUS_EFFORT') || env('EFFORT') || 'low';

  const configured = Boolean(provider && apiKey);
  const errorMessage = configured
    ? ''
    : (provider === 'gemini'
      ? 'GEMINI_API_KEY no está configurada en el entorno.'
      : 'OPENAI_API_KEY no está configurada en el entorno.');

  return { provider, apiKey, model, effort, configured, errorMessage };
}

/**
 * Config efectiva de la enseñanza por video. SIEMPRE Gemini (es quien entiende
 * video), independientemente del provider del cerebro — mismo razonamiento que
 * el guard() del backend viejo. Fallback a GEMINI_API_KEY.
 */
function resolveTeachConfig() {
  const raw = normalizeProvider(env('MIRACLE_TEACH_LLM_PROVIDER'));

  if (raw === 'disabled') {
    return {
      provider: 'disabled',
      apiKey: '',
      model: '',
      configured: false,
      errorMessage: 'La enseñanza por video está deshabilitada (MIRACLE_TEACH_LLM_PROVIDER=disabled).'
    };
  }

  const apiKey = env('MIRACLE_TEACH_LLM_API_KEY')
    || env('MIRACLE_TEACH_LLM_GOOGLE_API_KEY')
    || geminiFallbackKey();
  const model = env('MIRACLE_TEACH_LLM_MODEL') || env('GEMINI_MODEL') || 'gemini-3.5-flash';

  const configured = Boolean(apiKey);
  return {
    provider: 'gemini',
    apiKey,
    model,
    configured,
    errorMessage: configured
      ? ''
      : 'GEMINI_API_KEY no está configurada en el entorno. La enseñanza por video usa Gemini '
        + 'aunque el cerebro corra con otro provider.'
  };
}

/** Bucket privado donde se archivan los mp4 de enseñanza (grabaciones clínicas). */
function teachVideoBucket() {
  return env('SUPABASE_VIDEO_BUCKET') || 'teach-videos';
}

module.exports = { resolveConsciousConfig, resolveTeachConfig, teachVideoBucket, normalizeProvider };
