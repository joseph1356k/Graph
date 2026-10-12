// Precarga las fichas técnicas (CIMA-AEMPS) de los medicamentos del
// diccionario en knowledge/fichas-tecnicas/fichas.snapshot.json, para que el
// asistente responda dosis sin depender de la red en cada pregunta.
//
// Necesita salida a https://cima.aemps.es (no corre en entornos sin red).
// Va despacio a propósito (una petición a la vez, con pausa) para no cargar
// el servicio público. Commitea el JSON resultante.
//   npm run build:drug-labels                # todo el diccionario
//   node scripts/build-drug-label-snapshot.js amoxicilina ibuprofeno
const fs = require('fs');
const path = require('path');
const { DrugLabelService } = require('../src/application/knowledge/DrugLabelService');

const SNAPSHOT_FILE = path.join(__dirname, '..', 'knowledge', 'fichas-tecnicas', 'fichas.snapshot.json');
const SECTIONS = ['4.2', '4.3', '4.5', '4.6'];
const PAUSE_MS = 400;
const PER_DRUG_TIMEOUT_MS = 20000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const only = new Set(process.argv.slice(2).map((name) => name.toLowerCase()));
  const service = new DrugLabelService({ snapshot: { labels: [] }, timeoutMs: PER_DRUG_TIMEOUT_MS });
  if (!service.live) throw new Error('este Node no tiene fetch; usa Node 18 o superior');
  const entries = service.entries.filter((entry) => !only.size || only.has(entry.practiv));
  const previous = fs.existsSync(SNAPSHOT_FILE) ? JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8')) : { labels: [] };
  const keep = (previous.labels || []).filter((label) => only.size && !only.has(label.practiv));
  const labels = [...keep];
  let ok = 0;
  let missing = 0;
  let failed = 0;
  for (const entry of entries) {
    try {
      const sections = await service.fetchSections(entry, SECTIONS, Date.now() + PER_DRUG_TIMEOUT_MS);
      if (sections.length) {
        labels.push(...sections);
        ok += 1;
        console.log(`  ✓ ${entry.nombre}: ${sections.map((item) => item.section).join(', ')} (${sections[0].product})`);
      } else {
        missing += 1;
        console.log(`  · ${entry.nombre}: sin producto comercializado con ficha segmentada`);
      }
    } catch (error) {
      failed += 1;
      console.log(`  ✗ ${entry.nombre}: ${error.message}`);
    }
    await sleep(PAUSE_MS);
  }
  labels.sort((a, b) => `${a.practiv}|${a.vtm}|${a.section}`.localeCompare(`${b.practiv}|${b.vtm}|${b.section}`));
  const snapshot = {
    _comentario: 'Fichas técnicas precargadas (npm run build:drug-labels, requiere red hacia cima.aemps.es). Vacío = el servicio consulta CIMA en vivo con timeout y cortacircuitos.',
    version: 1,
    generated_at: new Date().toISOString(),
    fuente: 'CIMA, Agencia Española de Medicamentos y Productos Sanitarios (AEMPS)',
    labels
  };
  fs.writeFileSync(SNAPSHOT_FILE, `${JSON.stringify(snapshot, null, 1)}\n`);
  console.log(`\n[build-drug-label-snapshot] ${ok} medicamentos con ficha, ${missing} sin ficha, ${failed} con error → ${labels.length} secciones en ${path.relative(process.cwd(), SNAPSHOT_FILE)}`);
  if (failed && !ok) process.exit(1);
}

main().catch((error) => {
  console.error(`[build-drug-label-snapshot] FALLÓ: ${error.message}`);
  process.exit(1);
});
