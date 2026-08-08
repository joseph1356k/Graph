// Enseñanza activa por video: un médico graba su pantalla usando el sistema del
// hospital y narra en voz alta lo que hace; Gemini mira el video y extrae
// CONOCIMIENTO REUTILIZABLE sobre cómo se opera el sistema — no datos clínicos
// de un caso concreto (ver la regla de privacidad del prompt). Port de
// Android/backend/src/teach/geminiVideo.ts.
//
// REPARTO DE TRABAJO CON EL CLIENTE (y por qué):
//   El mp4 NO puede pasar por una función de Vercel: el límite de payload es
//   4.5 MB. Pero la key de Gemini tampoco debe vivir en el cliente (se
//   distribuye en el .exe y es extraíble). El protocolo de subida "resumable"
//   de Google resuelve justo esto:
//     1. `startUpload` — el backend reserva el archivo CON la key. Request chico.
//     2. El cliente sube los bytes directo a Google usando la URL devuelta, que
//        trae su propio token embebido y NO necesita la key.
//     3. `fileState` — el cliente pregunta si el video ya quedó ACTIVE.
//     4. `processVideo` — el backend hace el generateContent CON la key.
//   Resultado: el video nunca toca Vercel y la key nunca toca el cliente.

const LLMProvider = require('../LLMProvider');
const { fromGemini, toRecorderUsage } = require('../../domain/usage/providerUsage');
const { FEATURES, API_FAMILIES } = require('../../domain/usage/vocabulary');

const BASE = 'https://generativelanguage.googleapis.com';

/**
 * Consumo del vídeo de enseñanza.
 *
 * DURANTE UN TIEMPO ESTO ESTUVO DECLARADO COMO «NO MEDIBLE», con el argumento
 * de que el vídeo no reporta tokens de forma comparable al resto. Era falso, y
 * era una deducción, no una comprobación: `generateContent` devuelve el mismo
 * bloque `usageMetadata` que cualquier otra llamada a Gemini — los fotogramas
 * ya vienen contados dentro de `promptTokenCount`. El código simplemente tiraba
 * la respuesta entera salvo el texto.
 *
 * Se registra UN EVENTO POR INTENTO. `processVideo` reintenta hasta cinco veces
 * cuando Gemini responde que está saturado, y cada intento que llega a hablar
 * con el proveedor es consumo real aunque acabe fallando.
 */
/** El cuerpo puede no ser JSON (una página de error de un proxy, por ejemplo). */
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return {};
  }
}

function recordVideoUsage(input) {
  const recorder = LLMProvider.getUsageRecorder();
  if (!recorder) return;
  const ok = input.statusCode >= 200 && input.statusCode < 300;
  recorder.record({
    provider: 'google',
    apiFamily: API_FAMILIES.VIDEO,
    feature: FEATURES.TEACH_VIDEO,
    requestedModel: input.model,
    attempt: input.attempt,
    occurredAt: input.occurredAt,
    latencyMs: input.latencyMs,
    status: ok ? 'ok' : 'error',
    errorCode: ok ? '' : (input.errorCode || `http_${input.statusCode || 0}`),
    metadata: {
      httpStatus: input.statusCode || 0,
      attempt: input.attempt,
      usageSource: 'server_measured'
    },
    ...toRecorderUsage(fromGemini(input.body || {}))
  });
}

/** Paso 1 del resumable upload: reserva el archivo en Gemini y devuelve la URL de subida. */
async function startUpload(apiKey, displayName, contentLength) {
  const res = await fetch(`${BASE}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(contentLength),
      'X-Goog-Upload-Header-Content-Type': 'video/mp4',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ file: { display_name: displayName } })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`upload start HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const uploadUrl = res.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Gemini no devolvió X-Goog-Upload-URL');
  return uploadUrl;
}

/** Estado del archivo subido: PROCESSING | ACTIVE | FAILED. El cliente consulta esto en bucle. */
async function fileState(apiKey, fileUri) {
  // fileUri viene como https://generativelanguage.googleapis.com/v1beta/files/abc123
  const name = fileUri.replace(/^.*\/(v1beta\/files\/)/, '$1');
  const res = await fetch(`${BASE}/${name}`, {
    headers: { 'x-goog-api-key': apiKey }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`files.get HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const body = await res.json();
  return body.state ?? 'UNKNOWN';
}

const MEDICAL_TEACH_PROMPT = `
Eres Ü, un asistente que ayudará a operar el sistema informático de un hospital (HIS/EHR u otro
software clínico). Un MÉDICO acaba de grabar su pantalla mientras USA ese sistema, narrando en voz
alta lo que hace — te está ENSEÑANDO cómo se opera, para que después tú puedas ayudar a otros
usuarios con las mismas tareas.

Mira TODO el video (imagen + audio) y extrae CONOCIMIENTO SOBRE EL SISTEMA, organizado POR
APLICACIÓN/MÓDULO. Buscamos hechos operativos reutilizables, NO datos de un caso concreto. Ejemplos
del tipo de nota que sí sirve:
- "Para admitir un paciente se usa el botón 'Nuevo ingreso' en la pantalla principal, no el menú
  'Pacientes'."
- "El campo 'Diagnóstico principal' solo acepta códigos CIE-10; hay un buscador si se escribe texto."
- "Las órdenes de laboratorio se firman digitalmente desde la pestaña 'Pendientes', abajo a la
  derecha."

REGLA DE PRIVACIDAD, ABSOLUTA Y SIN EXCEPCIÓN:
NUNCA registres en una nota ningún dato que identifique o describa a una persona concreta: nombres
de pacientes, números de historia clínica o documento, fechas de nacimiento, diagnósticos
específicos de un caso, resultados de laboratorio, medicaciones recetadas, o cualquier dato clínico
ligado a un caso real que aparezca en pantalla durante la demostración. Si un ejemplo en el video
usa datos de un paciente (real o de prueba), IGNORA esos datos por completo y quédate solo con EL
PROCEDIMIENTO — cómo se navega, qué botón se pulsa, qué significa cada campo, en qué orden se hace
algo. Ante cualquier duda de si un dato es identificable, OMÍTELO.

REGLAS ESTRICTAS (calidad sobre cantidad):
- Cada nota: UNA frase, auto-contenida, sobre CÓMO FUNCIONA o CÓMO SE USA el sistema.
- Incluye SOLO lo que entiendas con certeza muy alta y tenga valor real para operar el sistema
  después. Ante la duda, fuera. No inventes procedimientos que no viste.
- "app": el nombre visible del sistema o módulo al que aplica la nota (p.ej. "HIS - Admisiones",
  "Laboratorio"). Si la nota es general y no pertenece a un módulo concreto, usa "".
- Si algo importante quedó ambiguo y conviene confirmarlo con el médico, agrégalo en "questions"
  (pregunta corta y natural). Máximo 3. Si no hace falta preguntar nada, deja la lista vacía.
- Si el video no contiene nada confiable que guardar (o todo lo mostrado es dato de paciente sin
  procedimiento reutilizable), devuelve items y questions vacíos.

Además, escribe un "summary": un resumen CORTO (1-3 frases), en primera persona y en tono
profesional, de lo que ENTENDISTE sobre cómo se usa el sistema — para mostrárselo al médico. Si no
aprendiste nada útil (o todo era dato clínico que debiste descartar), dilo con naturalidad.

Responde SOLO JSON:
{"summary": "...", "items": [{"app": "HIS - Admisiones", "note": "..."}], "questions": ["..."]}
`.trim();

/**
 * Gemini devuelve 429/5xx ("This model is currently overloaded") cuando está
 * saturado, y Google los documenta como temporales. Sin reintento, un bache de
 * demanda tira toda la enseñanza y el video que el médico ya grabó y subió se
 * pierde. Un 5xx significa que Gemini no llegó a generar nada, así que repetir
 * el mismo POST no duplica ningún efecto.
 */
function isTransient(status) {
  return status === 429 || status >= 500;
}

/** El video ya está ACTIVE: pídele a Gemini el conocimiento del sistema. */
async function processVideo(apiKey, fileUri, model) {
  const req = {
    contents: [
      {
        role: 'user',
        parts: [{ fileData: { mimeType: 'video/mp4', fileUri } }, { text: MEDICAL_TEACH_PROMPT }]
      }
    ],
    generationConfig: { responseMimeType: 'application/json' }
  };

  // Backoff exponencial 0.8s → 6.4s, igual que la versión Android (GeminiHttp.withRetry).
  let res = null;
  let bodyText = '';
  let body = {};
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** (attempt - 1)));

    const startedAt = Date.now();
    try {
      res = await fetch(`${BASE}/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(req)
      });
    } catch (error) {
      // Un fallo de red también se anota: puede haber gastado en el proveedor
      // aunque no llegara la respuesta, y un hueco silencioso en la serie se
      // confunde con «ese día no se enseñó nada».
      recordVideoUsage({
        model, attempt: attempt + 1, statusCode: 0, body: {},
        occurredAt: new Date(startedAt).toISOString(), latencyMs: Date.now() - startedAt,
        errorCode: 'network_error'
      });
      throw error;
    }

    // El cuerpo se lee UNA vez: `fetch` lo consume al leerlo, y hace falta tanto
    // para las cifras de consumo como para el texto que se devuelve arriba.
    bodyText = await res.text().catch(() => '');
    body = safeJson(bodyText);
    recordVideoUsage({
      model, attempt: attempt + 1, statusCode: res.status, body,
      occurredAt: new Date(startedAt).toISOString(), latencyMs: Date.now() - startedAt
    });

    if (res.ok) break;
    if (!isTransient(res.status)) {
      throw new Error(`generateContent HTTP ${res.status}: ${bodyText.slice(0, 200)}`);
    }
  }
  if (!res || !res.ok) {
    throw new Error(
      `generateContent HTTP ${res?.status} tras 5 intentos (sigue saturado): ${bodyText.slice(0, 200)}`
    );
  }

  const text = body.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === 'string')?.text;
  if (!text) throw new Error('Gemini no devolvió texto en la respuesta');

  const parsed = firstJsonObject(text);
  const notes = Array.isArray(parsed.items)
    ? parsed.items
      .map((item) => ({ app: `${item.app ?? ''}`.trim(), note: `${item.note ?? ''}`.trim() }))
      .filter((entry) => entry.note.length > 0)
    : [];
  const questions = Array.isArray(parsed.questions)
    ? parsed.questions.map((q) => String(q).trim()).filter((q) => q.length > 0)
    : [];
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';

  return { summary, notes, questions };
}

/** Tolera fences de markdown o texto extra alrededor del JSON (igual que la versión Android). */
function firstJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('respuesta sin JSON reconocible');
  return JSON.parse(text.slice(start, end + 1));
}

module.exports = { startUpload, fileState, processVideo };
