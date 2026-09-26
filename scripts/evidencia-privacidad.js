// Informe de evidencia de privacidad para UNA consulta real: cada envío a un
// proveedor de IA con el resultado del escudo, y la comprobación de que lo
// persistido (taller, historial, exportación) no contiene marcadores.
//
// Es lo que se le enseña a un hospital. Necesita SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY (lee con service-role, igual que el resto de Graph).
//   node scripts/evidencia-privacidad.js <consultation_id>
require('dotenv').config({ quiet: true });
const SupabaseRestClient = require('../src/infrastructure/SupabaseRestClient');
const PrivacyLedgerReader = require('../src/infrastructure/privacy/PrivacyLedgerReader');
const { findTokens } = require('../src/domain/privacy/tokens');

function tokensIn(value) {
  return findTokens(JSON.stringify(value ?? '')).length;
}

// Envíos de AUDIO al proveedor de voz: no hay texto que tapar, así que nunca
// llevan resultado del escudo. Son la excepción declarada E8
// (docs/privacy-egress-gateway.md), no un envío «sin escudo». Antes se
// contaban como tales y el informe no podía pasar NUNCA en una consulta
// dictada: el portal registra sus minutos de voz con el mismo session_id.
const DECLARED_AUDIO_FEATURES = new Set(['live_transcription', 'transcription', 'audio_processing']);

function isDeclaredAudio(event) {
  return !event.privacy && DECLARED_AUDIO_FEATURES.has(`${event.feature || ''}`);
}

async function main() {
  const id = `${process.argv[2] || ''}`.trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    console.error('Uso: node scripts/evidencia-privacidad.js <consultation_id (uuid)>');
    process.exit(2);
  }
  const client = new SupabaseRestClient();
  if (!client.isConfigured()) {
    console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY: sin base de datos no hay evidencia que mostrar.');
    process.exit(2);
  }

  const ledger = new PrivacyLedgerReader(client);
  const [events, encounters, consultations, exportsRows] = await Promise.all([
    ledger.eventsForSession(id),
    client.select('clinical_encounters', `id=eq.${id}&select=id,status,note_json,note_json_ai,note_generated_at&limit=1`),
    client.select('consultations', `id=eq.${id}&select=id,estado,note,resumen,paciente_nombre,paciente_documento&limit=1`),
    client.select('graph_note_exports', `consultation_id=eq.${id}&select=id,status,payload,created_at&order=created_at.desc&limit=5`)
  ]);

  console.log(`\nEVIDENCIA DE PRIVACIDAD · consulta ${id}\n`);
  console.log(`Envíos a proveedores de IA registrados: ${events.length}`);
  console.log('  fecha                     funcionalidad        proveedor/modelo               modo     marcadores                          barrido   rehidratación  post-hoc');
  for (const event of events) {
    const p = event.privacy;
    const tokens = p ? Object.entries(p.tokens).map(([t, c]) => `${t}:${c}`).join(',') || '-' : '-';
    const mode = p ? p.mode : (isDeclaredAudio(event) ? 'audio E8' : 'sin escudo');
    console.log(`  ${`${event.at}`.slice(0, 24).padEnd(25)} ${`${event.feature}`.padEnd(20)} ${`${event.provider}/${event.model}`.slice(0, 30).padEnd(30)} ${mode.padEnd(8)} ${tokens.padEnd(35)} ${(p ? p.leak_scan : '-').padEnd(9)} ${(p ? p.rehydration : '-').padEnd(14)} ${p && p.posthoc_leak !== null ? (p.posthoc_leak ? 'FUGA' : 'ok') : '-'}`);
  }
  const audio = events.filter(isDeclaredAudio).length;
  const textEvents = events.filter((e) => !isDeclaredAudio(e));
  const enforced = textEvents.filter((e) => e.privacy?.mode === 'enforce').length;
  const leaks = textEvents.filter((e) => e.privacy?.posthoc_leak === true).length;
  const unshielded = textEvents.filter((e) => !e.privacy || e.privacy.mode === 'off').length;
  // Una nota con un marcador sin resolver se guardó con un aviso, pero el
  // médico pudo firmarla igual: el informe no puede darla por buena.
  const incomplete = textEvents.filter((e) => e.privacy?.rehydration === 'incomplete').length;

  console.log('\nLo persistido dentro de Miracle (datos reales, sin marcadores):');
  const encounter = encounters?.[0];
  const consultation = consultations?.[0];
  const rows = [
    ['clinical_encounters.note_json', encounter ? tokensIn(encounter.note_json) : null],
    ['clinical_encounters.note_json_ai', encounter ? tokensIn(encounter.note_json_ai) : null],
    ['consultations.note', consultation ? tokensIn(consultation.note) : null],
    ['consultations.resumen', consultation ? tokensIn(consultation.resumen) : null],
    ...(exportsRows || []).map((row) => [`graph_note_exports.payload (${row.status})`, row.payload ? tokensIn(row.payload) : 0])
  ];
  let persistedTokens = 0;
  for (const [label, count] of rows) {
    if (count === null) { console.log(`  ${label.padEnd(45)} (no existe)`); continue; }
    persistedTokens += count;
    console.log(`  ${label.padEnd(45)} ${count === 0 ? 'sin marcadores ✔' : `${count} marcador(es) ✘`}`);
  }
  if (consultation) {
    console.log(`  identidad en el historial: ${consultation.paciente_nombre ? 'nombre presente' : 'sin nombre'} · ${consultation.paciente_documento ? 'documento presente' : 'sin documento'}`);
  }

  console.log('\nVeredicto:');
  const verdict = [];
  if (textEvents.length === 0) verdict.push('no hay envíos de texto registrados para esta consulta');
  if (unshielded > 0) verdict.push(`${unshielded} envío(s) salieron sin escudo (modo off o anterior al escudo)`);
  if (textEvents.length > 0 && enforced < textEvents.length - unshielded) verdict.push(`${textEvents.length - unshielded - enforced} envío(s) en modo shadow (el original salió)`);
  if (leaks > 0) verdict.push(`${leaks} envío(s) con fuga post-hoc`);
  if (incomplete > 0) verdict.push(`${incomplete} envío(s) con marcadores que no se pudieron resolver`);
  if (persistedTokens > 0) verdict.push(`${persistedTokens} marcador(es) en lo persistido`);
  if (audio > 0) console.log(`  ℹ ${audio} envío(s) de audio al proveedor de voz: excepción declarada E8, fuera del escudo de texto.`);
  if (verdict.length === 0) {
    console.log('  ✅ Todos los envíos de texto salieron protegidos (enforce), sin fugas post-hoc ni marcadores sin resolver, y lo persistido tiene los datos reales.');
    process.exit(0);
  }
  for (const line of verdict) console.log(`  ⚠ ${line}`);
  process.exit(1);
}

main().catch((error) => {
  console.error(`\n❌ ${error.message}`);
  process.exit(1);
});
