// Archivo de los videos de enseñanza en Supabase Storage (bucket privado
// `teach-videos`), para que el equipo pueda verlos desde el dashboard. Port de
// Android/backend/src/teach/videoStorage.ts, reutilizando la configuración del
// SupabaseRestClient de Graph (misma URL y service_role key del proyecto).
//
// MISMO PATRÓN QUE GEMINI (ver GeminiVideoClient.js): el backend FIRMA una URL
// de subida con la service_role key y se la entrega al cliente; el cliente sube
// el mp4 directo a Supabase. Ni el video pasa por Vercel (límite de 4.5 MB) ni
// la service_role key llega al cliente. La URL firmada vale 2 horas y solo
// sirve para escribir en esa ruta concreta.
//
// EL BUCKET ES PRIVADO a propósito, a diferencia de otros buckets del proyecto:
// son grabaciones de pantalla de sistemas clínicos y pueden tener datos de
// pacientes visibles. Nadie con el link puede verlos.

/** Rutas de Storage: sin barras ni caracteres raros que rompan el path o escapen de la carpeta. */
function sanitize(value) {
  return (`${value || ''}` || 'anon').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'anon';
}

/**
 * Firma una URL de subida para un mp4 nuevo. Devuelve null si el archivo no
 * está configurado (faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY): archivar
 * es deseable, no imprescindible — la enseñanza sigue funcionando sin archivo.
 *
 * @param {import('../SupabaseRestClient')} supabaseRestClient cliente ya cableado (URL + service key)
 */
async function signVideoUpload(supabaseRestClient, bucket, userId, recordedAtIso) {
  if (!supabaseRestClient || !supabaseRestClient.isConfigured()) return null;

  const supabaseUrl = supabaseRestClient.supabaseUrl;
  const serviceKey = supabaseRestClient.serviceRoleKey;
  const path = `${sanitize(userId)}/${sanitize(recordedAtIso)}.mp4`;
  // La API de Storage no pasa por /rest/v1 (PostgREST), así que no podemos usar
  // supabaseRestClient.request(); llamamos /storage/v1 directo con las mismas credenciales.
  const endpoint = `${supabaseUrl}/storage/v1/object/upload/sign/${bucket}/${path}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase sign upload HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  // Responde { url: "/object/upload/sign/<bucket>/<path>?token=..." } — relativa a /storage/v1.
  const body = await res.json();
  if (!body.url) throw new Error('Supabase no devolvió la url firmada');

  return { uploadUrl: `${supabaseUrl}/storage/v1${body.url}`, path };
}

module.exports = { signVideoUpload };
