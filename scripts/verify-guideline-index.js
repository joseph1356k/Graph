// Verifica el retrieval de guías clínicas del asistente (BM25 en memoria):
// consultas canónicas que deben recuperar la guía correcta, preguntas sin
// relación que deben devolver VACÍO, boosts por especialidad y CIE-10, topes
// y numeración de referencias.
//   node scripts/verify-guideline-index.js
const assert = require('assert');
const {
  ClinicalGuidelineIndex,
  loadDefaultIndex,
  isRagDisabled,
  tokenize,
  stem,
  extractCie10Codes,
  buildRetrievalContext,
  DEFAULT_CHAR_BUDGET
} = require('../src/application/knowledge/ClinicalGuidelineIndex');
const corpusLib = require('./lib/guideline-corpus');

// Pregunta del médico → guía (o guías aceptables) que debe estar entre las tres
// primeras. Cuando una guía nueva entra al corpus, se añade aquí su pregunta
// típica; la verificación final exige que ninguna guía quede sin consulta.
const CANONICAL = [
  ['dosis de amoxicilina en un niño con otitis media aguda', ['antibioticos-dosis-frecuentes', 'otitis-media-y-sinusitis-aguda']],
  ['Dosis de amoxicilina en adultos', 'antibioticos-dosis-frecuentes'],
  ['nitrofurantoína para cistitis, cuántos días', ['antibioticos-dosis-frecuentes', 'infeccion-urinaria-adultos']],
  ['penicilina benzatínica en faringitis estreptocócica', ['antibioticos-dosis-frecuentes', 'faringoamigdalitis-aguda']],
  ['metas de presión arterial en un paciente diabético', 'hipertension-arterial-adultos'],
  ['HTA', 'hipertension-arterial-adultos'],
  ['qué antihipertensivo iniciar en embarazo', ['hipertension-arterial-adultos', 'preeclampsia-trastornos-hipertensivos-embarazo']],
  ['crisis hipertensiva: urgencia o emergencia', 'hipertension-arterial-adultos'],
  ['¿Cuándo hospitalizar una neumonía adquirida en la comunidad (CURB-65)?', 'neumonia-adquirida-comunidad-adulto'],
  ['criterios de UCI en NAC grave', 'neumonia-adquirida-comunidad-adulto'],
  ['cuántos días de antibiótico en neumonía', 'neumonia-adquirida-comunidad-adulto'],
  ['metas de HbA1c y cuándo iniciar metformina', 'diabetes-mellitus-tipo-2'],
  ['crisis de asma, salbutamol y corticoide', 'asma-adultos-y-ninos'],
  ['exacerbación de EPOC, cuándo dar antibiótico', 'epoc'],
  ['pielonefritis aguda en mujer, tratamiento ambulatorio', 'infeccion-urinaria-adultos'],
  ['criterios de Centor para faringitis', 'faringoamigdalitis-aguda'],
  ['estatina de alta intensidad, metas de LDL', 'dislipidemia-riesgo-cardiovascular'],
  ['estadios KDIGO de enfermedad renal crónica', 'enfermedad-renal-cronica'],
  ['insuficiencia cardiaca con fracción de eyección reducida, cuatro pilares', 'insuficiencia-cardiaca'],
  ['anticoagulación en fibrilación auricular, CHA2DS2-VASc', 'fibrilacion-auricular-anticoagulacion'],
  ['dolor torácico, troponina y ECG en sospecha de SCA', 'dolor-toracico-sindrome-coronario-agudo'],
  ['sinusitis bacteriana aguda, cuándo dar antibiótico', 'otitis-media-y-sinusitis-aguda'],
  ['bronquiolitis en lactante: ¿sirve el salbutamol?', 'bronquiolitis'],
  ['clasificación AIEPI de la tos con respiración rápida', 'infeccion-respiratoria-aguda-pediatrica'],
  ['plan B de rehidratación oral, cuántos mL/kg', 'diarrea-aguda-y-deshidratacion-pediatrica'],
  ['lactante de 40 días con fiebre sin foco, qué estudios pido', 'fiebre-sin-foco-lactante'],
  ['dengue con signos de alarma, manejo de líquidos', 'dengue'],
  ['banderas rojas de cefalea SNOOP', 'cefalea-migrana-tensional'],
  ['profilaxis de migraña, qué fármaco inicio', 'cefalea-migrana-tensional'],
  ['lumbalgia aguda sin banderas rojas, ¿pido radiografía?', 'lumbalgia-aguda'],
  ['esquema de erradicación de Helicobacter pylori', 'dispepsia-erge-helicobacter'],
  ['dosis inicial de levotiroxina en hipotiroidismo', 'hipotiroidismo'],
  ['sulfato ferroso en anemia ferropénica, cuánto tiempo', 'anemia-ferropenica'],
  ['ISRS de primera línea para depresión moderada', 'depresion-adultos'],
  ['cómo evaluar riesgo suicida en consulta', ['ansiedad-y-riesgo-suicida', 'depresion-adultos']],
  ['crisis de pánico, uso de benzodiacepinas', 'ansiedad-y-riesgo-suicida'],
  ['paraclínicos del primer control prenatal', 'control-prenatal'],
  ['dosis de sulfato de magnesio en preeclampsia severa', 'preeclampsia-trastornos-hipertensivos-embarazo'],
  ['manejo inicial de sepsis, líquidos 30 mL/kg y norepinefrina', 'sepsis-adultos'],
  ['qSOFA', 'sepsis-adultos'],
  ['ventana para trombolisis en ACV isquémico', 'acv-isquemico-agudo'],
  ['escala de Wells para embolia pulmonar y dímero D', 'tromboembolia-venosa'],
  ['vareniclina para dejar de fumar, esquema', 'obesidad-y-tabaquismo'],
  ['semaglutida para obesidad, criterios', 'obesidad-y-tabaquismo'],
  ['¿Qué CIE-10 uso para cefalea tensional?', 'cie10-frecuente-atencion-primaria'],
  ['código para control prenatal normal', 'cie10-frecuente-atencion-primaria'],
  ['dosis de adrenalina intramuscular en anafilaxia', 'anafilaxia'],
  ['dosis de amiodarona en fibrilación ventricular durante el paro', 'paro-cardiorrespiratorio-rcp'],
  ['cetoacidosis diabética con potasio de 3,2, ¿inicio insulina?', 'crisis-hiperglucemicas-e-hipoglucemia'],
  ['hemorragia digestiva alta, puntaje de Glasgow-Blatchford', 'hemorragia-digestiva'],
  ['escala de Alvarado para apendicitis', 'dolor-abdominal-agudo-apendicitis'],
  ['regla canadiense de TAC de cráneo en trauma craneoencefálico leve', 'trauma-menor-reglas-de-decision'],
  ['celulitis no purulenta, qué antibiótico', 'infecciones-piel-tejidos-blandos'],
  ['tratamiento de gonorrea y clamidia', 'infecciones-transmision-sexual'],
  ['sífilis gestacional con prueba treponémica positiva', 'sifilis'],
  ['profilaxis posexposición al VIH después de un pinchazo', 'vih-tamizaje-y-profilaxis'],
  ['sintomático respiratorio con tos de más de 15 días, tuberculosis', 'tuberculosis'],
  ['malaria vivax no complicada, cloroquina y primaquina', 'malaria'],
  ['criterios de elegibilidad de la OMS para anticonceptivos combinados', 'anticoncepcion'],
  ['hemorragia posparto, ácido tranexámico y oxitocina', 'hemorragia-posparto'],
  ['infección urinaria febril en lactante de 6 meses', 'infeccion-urinaria-pediatrica'],
  ['ictericia neonatal, cuándo iniciar fototerapia', 'ictericia-neonatal'],
  ['desnutrición aguda severa en menor de 5 años, Resolución 2350', 'desnutricion-aguda-infantil'],
  ['estatus epiléptico, dosis de midazolam y levetiracetam', 'convulsiones-estatus-y-febril'],
  ['crisis de gota, colchicina y cuándo iniciar alopurinol', 'gota'],
  ['densitometría, T-score y alendronato en osteoporosis', 'osteoporosis'],
  ['rinitis alérgica persistente, corticoide intranasal', 'rinitis-alergica'],
  ['vértigo posicional paroxístico benigno, maniobra de Epley', 'vertigo-y-mareo'],
  ['síncope con signos de alto riesgo, hospitalizo?', 'sincope'],
  ['tamizaje AUDIT y abstinencia alcohólica', 'consumo-de-alcohol'],
  ['insomnio crónico, terapia cognitivo conductual e hipnóticos', 'insomnio'],
  ['delirium en adulto mayor hospitalizado', 'delirium-y-demencia'],
  ['equivalentes de morfina y naloxona en dolor crónico', 'dolor-cronico-y-opioides'],
  ['tamizaje de cáncer de cuello uterino con prueba de VPH', 'tamizaje-de-cancer'],
  ['manejo de ascitis en cirrosis: diuréticos, restricción de sodio y albúmina en paracentesis', 'cirrosis-y-complicaciones'],
  ['criterios de tratamiento hepatitis B cronica y profilaxis del recien nacido de madre HBsAg positiva', 'hepatitis-b-y-c'],
  ['manejo de hiponatremia grave sintomática con solución salina al 3 %', 'hiponatremia-e-hiperpotasemia'],
  ['criterios KDIGO de lesión renal aguda y manejo inicial', 'lesion-renal-aguda'],
  ['antibiótico empírico y dexametasona en meningitis bacteriana', 'meningitis-bacteriana'],
  ['pancreatitis aguda criterios de Atlanta gravedad y manejo de liquidos', 'pancreatitis-y-colecistitis']
];

// Nada clínico que recuperar: el índice debe devolver [] y el prompt dirá
// «no se recuperaron guías» en vez de dejar que el modelo invente una.
const OFF_TOPIC = [
  'hola',
  '¿cómo cambio mi contraseña?',
  'gracias, muy amable',
  'qué tratamiento le doy al paciente',
  'resume la consulta',
  'buenos días doctor'
];

function main() {
  let passed = 0;
  const check = (name, fn) => {
    fn();
    passed += 1;
    console.log(`  ok ${passed}. ${name}`);
  };

  const index = loadDefaultIndex({ force: true });
  const stats = index.stats();

  check('el índice carga el corpus commiteado', () => {
    assert.ok(stats.guidelines >= 3, `guías: ${stats.guidelines}`);
    assert.ok(stats.chunks >= stats.guidelines * 2, `fragmentos: ${stats.chunks}`);
  });

  check('tokenizador: acentos, mayúsculas, plurales y sinónimos', () => {
    assert.deepStrictEqual(tokenize('Cefaleas Agudas'), ['cefalea', 'aguda']);
    assert.strictEqual(stem('hipertensiones'), 'hipertension');
    assert.strictEqual(stem('65'), '65');
    const withSynonyms = tokenize('paciente con HTA', index.synonyms);
    assert.ok(withSynonyms.includes('hipertension'), `sinónimo HTA → hipertension: ${withSynonyms}`);
    assert.ok(!tokenize('el de la y que').length, 'las stopwords no sobreviven');
    assert.deepStrictEqual(extractCie10Codes('impresión: I10 y E11.9, control'), ['I10', 'E11.9']);
  });

  for (const [question, expected] of CANONICAL) {
    const accepted = Array.isArray(expected) ? expected : [expected];
    check(`«${question}» → ${accepted.join(' | ')}`, () => {
      const results = index.search({ message: question });
      assert.ok(results.length > 0, 'sin resultados');
      const top = results.slice(0, 3).map((item) => item.guideline_id);
      assert.ok(accepted.some((id) => top.includes(id)), `top-3 fue ${top.join(', ')}`);
    });
  }

  check('toda guía del corpus tiene al menos una consulta canónica', () => {
    const covered = new Set(CANONICAL.flatMap(([, expected]) => (Array.isArray(expected) ? expected : [expected])));
    const ids = [...new Set(index.chunks.map((chunk) => chunk.guideline_id))];
    const missing = ids.filter((id) => !covered.has(id));
    assert.deepStrictEqual(missing, [], `guías sin consulta canónica: ${missing.join(', ')}`);
  });

  for (const question of OFF_TOPIC) {
    check(`«${question}» no recupera ninguna guía`, () => {
      const results = index.search({ message: question });
      assert.deepStrictEqual(results.map((item) => item.guideline_id), []);
    });
  }

  check('una pregunta genérica se sostiene con el diagnóstico de la nota', () => {
    const context = buildRetrievalContext({
      noteJson: {
        summary: 'x',
        sections: [
          { key: 'motivo_consulta', label: 'Motivo de consulta', content: 'Control.' },
          { key: 'analisis_e_impresion_diagnostica', label: 'Análisis e impresión diagnóstica', content: 'Hipertensión arterial no controlada, con cifras de presión arterial 160/100.' }
        ]
      },
      codes: [{ sistema: 'CIE-10', codigo: 'I10', descripcion: 'Hipertensión esencial (primaria)', estado: 'aceptado' }]
    });
    assert.ok(context.includes('Hipertensión arterial no controlada'));
    assert.ok(context.includes('Hipertensión esencial'));
    const withContext = index.search({ message: '¿Qué dice la guía sobre el manejo de este caso?', context });
    assert.ok(withContext.length > 0, 'con contexto debe recuperar');
    assert.strictEqual(withContext[0].guideline_id, 'hipertension-arterial-adultos');
    const without = index.search({ message: '¿Qué dice la guía sobre el manejo de este caso?' });
    assert.deepStrictEqual(without, [], 'sin contexto ni término propio, nada');
  });

  check('la especialidad de la guía sube su puntuación', () => {
    const plain = index.search({ message: 'metas de presión arterial' })[0];
    const boosted = index.search({ message: 'metas de presión arterial', specialty: 'cardiologia' })[0];
    assert.strictEqual(boosted.guideline_id, plain.guideline_id);
    assert.ok(boosted.score > plain.score, `${boosted.score} > ${plain.score}`);
    const other = index.search({ message: 'metas de presión arterial', specialty: 'odontologia' })[0];
    assert.strictEqual(other.score, plain.score, 'una especialidad ajena no cambia nada');
  });

  check('un código CIE-10 de la consulta sube la guía que lo lista', () => {
    const plain = index.search({ message: 'manejo de la neumonia' })[0];
    const boosted = index.search({ message: 'manejo de la neumonia', cie10: ['J18.9'] })[0];
    assert.strictEqual(boosted.guideline_id, 'neumonia-adquirida-comunidad-adulto');
    assert.ok(boosted.score > plain.score);
    const fromText = index.search({ message: 'manejo de la neumonia J18.9' })[0];
    assert.ok(fromText.score > plain.score, 'el código escrito en la pregunta también cuenta');
  });

  check('referencias G1..Gn consecutivas, tope por guía y presupuesto de caracteres', () => {
    const results = index.search({ message: 'amoxicilina dosis otitis faringitis neumonía adulto niño' });
    results.forEach((item, position) => assert.strictEqual(item.ref, `G${position + 1}`));
    const perGuide = new Map();
    for (const item of results) perGuide.set(item.guideline_id, (perGuide.get(item.guideline_id) || 0) + 1);
    for (const [, count] of perGuide) assert.ok(count <= 3, `más de 3 fragmentos de una guía: ${count}`);
    const chars = results.reduce((sum, item) => sum + item.text.length, 0);
    assert.ok(chars <= DEFAULT_CHAR_BUDGET, `presupuesto excedido: ${chars}`);
    assert.ok(results.length <= 6);
    for (const item of results) {
      assert.ok(item.title && item.organism && item.year && item.section && item.source);
    }
  });

  check('cada resultado trae solo el fragmento citado, nunca la guía entera', () => {
    const results = index.search({ message: 'CURB-65' });
    const lengths = results.map((item) => item.text.length);
    for (const length of lengths) assert.ok(length <= corpusLib.MAX_CHUNK_CHARS);
  });

  check('un índice construido a mano respeta k y devuelve [] sin corpus', () => {
    const tiny = new ClinicalGuidelineIndex({
      corpus: {
        guidelines: [{
          id: 'demo', titulo: 'Demo asma', organismo: 'X', anio: 2024, fuente: 'x', especialidades: ['pediatria'],
          cie10: ['J45'], palabras_clave: ['asma', 'salbutamol'], secciones: [
            { titulo: 'Crisis de asma', texto: 'Salbutamol inhalado con cámara en crisis de asma leve.' },
            { titulo: 'Control', texto: 'Corticoide inhalado como controlador en asma persistente.' }
          ]
        }]
      },
      synonyms: {},
      topK: 1
    });
    assert.strictEqual(tiny.search({ message: 'salbutamol en crisis de asma' }).length, 1);
    const empty = new ClinicalGuidelineIndex({ corpus: { guidelines: [] } });
    assert.deepStrictEqual(empty.search({ message: 'asma' }), []);
  });

  check('MIRACLE_ASSISTANT_RAG_DISABLED=1 apaga el retrieval', () => {
    assert.strictEqual(isRagDisabled({}), false);
    assert.strictEqual(isRagDisabled({ MIRACLE_ASSISTANT_RAG_DISABLED: '1' }), true);
    assert.strictEqual(isRagDisabled({ MIRACLE_ASSISTANT_RAG_DISABLED: '0' }), false);
  });

  console.log(`\n[verify-guideline-index] ${passed} verificaciones OK (${stats.guidelines} guías, ${stats.chunks} fragmentos)`);
}

try {
  main();
} catch (error) {
  console.error(`\n[verify-guideline-index] FALLÓ: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
}
