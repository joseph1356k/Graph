// Verifica el corpus de guías clínicas del asistente:
//   - el JSON compilado (guidelines.corpus.json) está al día con los Markdown;
//   - cada guía trae sus metadatos, ids únicos y fragmentos acotados;
//   - ningún fragmento dispara el escudo de privacidad (0 marcadores): una
//     cifra de dosis o el nombre de un organismo nunca debe salir tapado hacia
//     el modelo como si fuera un dato de paciente;
//   - el mapa de sinónimos tiene forma válida.
//   node scripts/verify-guideline-corpus.js
const assert = require('assert');
const { promesa, cerrar } = require('./lib/promesas');
const fs = require('fs');
const corpusLib = require('./lib/guideline-corpus');
const ProtectionMap = require('../src/domain/privacy/ProtectionMap');

function main() {
  let passed = 0;
  const check = (name, fn) => {
    fn();
    passed += 1;
    console.log(`  ok ${passed}. ${name}`);
  };

  const files = corpusLib.listGuidelineFiles();
  const built = corpusLib.buildCorpus();
  const committed = corpusLib.readCorpusFile();

  check('hay guías Markdown en knowledge/guias-clinicas', () => {
    assert.ok(files.length >= 3, `solo ${files.length} guías`);
  });

  check('guidelines.corpus.json está al día con los Markdown (npm run build:corpus)', () => {
    assert.strictEqual(committed.version, corpusLib.CORPUS_VERSION);
    assert.strictEqual(
      committed.source_hash,
      built.source_hash,
      'el JSON compilado no coincide con los .md: ejecuta `npm run build:corpus` y commitea el resultado'
    );
    assert.deepStrictEqual(committed.guidelines, built.guidelines);
  });

  check('metadatos obligatorios, ids únicos y mínimo de secciones', () => {
    const ids = new Set();
    for (const guideline of built.guidelines) {
      for (const field of corpusLib.REQUIRED_FIELDS) {
        assert.ok(guideline[field] !== undefined && guideline[field] !== '', `${guideline.id}: falta ${field}`);
      }
      assert.ok(!ids.has(guideline.id), `id repetido ${guideline.id}`);
      ids.add(guideline.id);
      assert.ok(guideline.secciones.length >= corpusLib.MIN_SECTIONS, `${guideline.id}: pocas secciones`);
      assert.ok(guideline.nota, `${guideline.id}: falta la nota «resumen orientativo» (blockquote inicial)`);
      assert.ok(guideline.palabras_clave.length >= 3, `${guideline.id}: pon al menos 3 palabras clave`);
      for (const section of guideline.secciones) {
        assert.ok(section.texto.length <= corpusLib.MAX_CHUNK_CHARS, `${guideline.id} · ${section.titulo}: fragmento largo`);
        assert.ok(section.texto.length >= 120, `${guideline.id} · ${section.titulo}: fragmento demasiado corto para citarse`);
      }
    }
  });

  check('ningún fragmento dispara el escudo de privacidad', () => {
    const offenders = [];
    for (const guideline of built.guidelines) {
      for (const section of guideline.secciones) {
        const map = new ProtectionMap({ seeds: [], excludedNames: [] });
        const masked = map.protectText(`${section.titulo}\n${section.texto}`);
        if (map.hasTokens() || masked !== `${section.titulo}\n${section.texto}`) {
          const summary = map.summary();
          offenders.push(`${guideline.id} · ${section.titulo}: ${JSON.stringify(summary.byType)}`);
        }
      }
    }
    assert.deepStrictEqual(offenders, [], `fragmentos que el escudo taparía:\n${offenders.join('\n')}`);
  });

  check('sinonimos.json: claves y listas de texto', () => {
    const synonyms = corpusLib.readSynonyms();
    assert.ok(Object.keys(synonyms).length >= 20);
    for (const [key, values] of Object.entries(synonyms)) {
      assert.ok(key.trim(), 'clave vacía');
      assert.ok(Array.isArray(values) && values.length > 0, `${key}: la expansión debe ser una lista`);
      for (const value of values) assert.strictEqual(typeof value, 'string', `${key}: expansión no textual`);
    }
  });

  check('los documentos en MAYÚSCULAS de la carpeta no se compilan como guías', () => {
    const names = files.map((file) => file.split('/').pop());
    assert.ok(!names.includes('README.md'));
    assert.ok(!names.includes('PENDIENTES-REVISION.md'));
    assert.ok(fs.existsSync(`${corpusLib.CORPUS_DIR}/PENDIENTES-REVISION.md`), 'falta la lista de cifras pendientes de revisión médica');
  });

  check('el README de la carpeta explica el formato', () => {
    const readme = fs.readFileSync(`${corpusLib.CORPUS_DIR}/README.md`, 'utf8');
    assert.ok(readme.includes('build:corpus'));
    assert.ok(readme.includes('palabras_clave'));
  });

  const chunks = built.guidelines.reduce((sum, guideline) => sum + guideline.secciones.length, 0);
  console.log(`\n[verify-guideline-corpus] ${passed} verificaciones OK (${built.guidelines.length} guías, ${chunks} fragmentos)`);
}

// Juez de la promesa 601 de docs/specs/006-el-asistente-clinico-responde-con-respaldo.md.
promesa(601, 'Cada guía del corpus compilado coincide con su Markdown, declara fuente, año y población, y ningún fragmento activa el escudo de privacidad', () => main())
  .then(() => cerrar('verify-guideline-corpus'));
