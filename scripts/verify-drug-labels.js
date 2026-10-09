// Verifica el servicio de fichas técnicas (DrugLabelService) con un CIMA falso
// que responde con la forma documentada de la API (/medicamentos y
// /docSegmentado/contenido/1). Sin red.
//   node scripts/verify-drug-labels.js
const assert = require('assert');
const { promesa, cerrar } = require('./lib/promesas');
const {
  DrugLabelService,
  isDrugLabelsDisabled,
  htmlToText,
  excerpt,
  sectionForQuestion,
  BREAKER_THRESHOLD
} = require('../src/application/knowledge/DrugLabelService');

const SEARCH_AMOXICILINA = {
  totalFilas: 3,
  pagina: 1,
  tamanioPagina: 200,
  resultados: [
    {
      nregistro: '70001',
      nombre: 'AMOXICILINA/ACIDO CLAVULANICO MARCA 875 mg/125 mg COMPRIMIDOS',
      labtitular: 'Laboratorio Uno',
      comerc: true,
      docs: [{ tipo: 1, secc: true, fecha: Date.UTC(2025, 2, 1) }],
      vtm: { id: 1, nombre: 'amoxicilina y ácido clavulánico' },
      dosis: '875 mg/125 mg',
      formaFarmaceuticaSimplificada: { id: 1, nombre: 'Comprimido' }
    },
    {
      nregistro: '60002',
      nombre: 'AMOXICILINA MARCA 500 mg CAPSULAS DURAS',
      labtitular: 'Laboratorio Dos',
      comerc: true,
      docs: [{ tipo: 1, secc: true, fecha: Date.UTC(2024, 5, 1) }, { tipo: 2, secc: true, fecha: Date.UTC(2024, 5, 1) }],
      vtm: { id: 2, nombre: 'amoxicilina' },
      dosis: '500 mg',
      formaFarmaceuticaSimplificada: { id: 2, nombre: 'Cápsula' }
    },
    {
      nregistro: '60003',
      nombre: 'AMOXICILINA OTRA 1 g COMPRIMIDOS',
      labtitular: 'Laboratorio Tres',
      comerc: true,
      docs: [{ tipo: 1, secc: false, fecha: Date.UTC(2026, 0, 1) }],
      vtm: { id: 2, nombre: 'amoxicilina' },
      dosis: '1 g',
      formaFarmaceuticaSimplificada: { id: 3, nombre: 'Comprimido' }
    }
  ]
};

const SECTION_42 = [{
  seccion: '4.2',
  titulo: '4.2. Posología y forma de administración',
  orden: 1,
  contenido: [
    '<h2 id="4.2">4.2. Posolog&#237;a y forma de administraci&#243;n</h2>',
    '<p class="MsoNormal"><b>Adultos y ni&ntilde;os &ge; 40 kg</b>: 250 mg a 500 mg tres veces al d&iacute;a, o 750 mg a 1 g cada 12 horas.</p>',
    '<p>Ni&ntilde;os &lt; 40 kg: 20 a 90 mg/kg/d&iacute;a en dosis divididas.</p>',
    '<table><tr><td>Aclaramiento de creatinina</td><td>Dosis</td></tr><tr><td>10-30 ml/min</td><td>m&aacute;ximo 500 mg dos veces al d&iacute;a</td></tr></table>',
    `<p>${'Texto de relleno sobre la duración del tratamiento y la forma de administración con alimentos. '.repeat(30)}</p>`,
    '<p>Insuficiencia renal: en pacientes con aclaramiento de creatinina menor de 30 ml/min se debe ajustar la dosis.</p>'
  ].join('')
}];

function fakeCima({ hang = false, fail = false, search = SEARCH_AMOXICILINA, sections = SECTION_42 } = {}) {
  const calls = [];
  const fetchImpl = (url, options = {}) => {
    calls.push(url);
    if (hang) {
      return new Promise((resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    if (fail) return Promise.resolve({ ok: false, status: 503, json: async () => ({}) });
    const body = url.includes('/medicamentos?') ? search : sections;
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  };
  return { calls, fetchImpl };
}

const quietLogger = { warn() {} };

async function main() {
  let passed = 0;
  const check = async (name, fn) => {
    await fn();
    passed += 1;
    console.log(`  ok ${passed}. ${name}`);
  };

  await check('detecta preguntas de medicamento y los medicamentos del diccionario (alias colombianos, combinación primero)', () => {
    const service = new DrugLabelService({ fetchImpl: null, logger: quietLogger });
    assert.ok(service.stats().medicamentos >= 250);
    assert.ok(service.isDrugQuestion('¿Cuál es la dosis de amoxicilina en niños?'));
    assert.ok(service.isDrugQuestion('¿se puede dar ibuprofeno en el embarazo?'));
    assert.ok(!service.isDrugQuestion('¿qué es la amoxicilina?'));
    assert.ok(!service.isDrugQuestion('hola, buenos días'));
    const combo = service.detectDrugs('dosis de amoxicilina clavulanato para otitis');
    assert.deepStrictEqual(combo.map((entry) => entry.nombre), ['Amoxicilina/ácido clavulánico']);
    const two = service.detectDrugs('acetaminofén o dipirona, dosis máxima');
    assert.deepStrictEqual(two.map((entry) => entry.practiv), ['paracetamol', 'metamizol']);
    assert.deepStrictEqual(service.detectDrugs('qué hago con la fiebre'), []);
  });

  await check('diccionario: nombres colombianos, combinaciones y siglas sin choques', () => {
    const service = new DrugLabelService({ fetchImpl: null, logger: quietLogger });
    const nombres = (text) => service.detectDrugs(text).map((entry) => entry.nombre);
    assert.deepStrictEqual(nombres('dosis de metimazol en hipertiroidismo'), ['Tiamazol (metimazol)']);
    assert.deepStrictEqual(nombres('succinilcolina en secuencia rápida'), ['Suxametonio (succinilcolina)']);
    assert.deepStrictEqual(nombres('tenofovir alafenamida en falla renal'), ['Tenofovir alafenamida'], 'TAF no se confunde con TDF');
    assert.deepStrictEqual(nombres('ajuste del tenofovir por depuración'), ['Tenofovir disoproxilo']);
    assert.deepStrictEqual(nombres('budesonida formoterol como rescate'), ['Budesonida/formoterol'], 'la combinación gana');
    assert.deepStrictEqual(nombres('gluconato de calcio con K de 6,8'), ['Gluconato de calcio']);
    assert.deepStrictEqual(nombres('hierro intravenoso en la gestante'), ['Hierro sacarosa (hierro intravenoso)'], 'no es el sulfato ferroso');
    assert.deepStrictEqual(nombres('NAC con CURB-65 de 2'), [], 'NAC es neumonía, no acetilcisteína');
    assert.deepStrictEqual(nombres('calcio sérico de 8 y potasio de 3'), [], 'un laboratorio no es un medicamento');
    const entries = require('../knowledge/fichas-tecnicas/medicamentos.json').medicamentos;
    assert.strictEqual(new Set(entries.map((entry) => entry.nombre)).size, entries.length, 'nombres únicos');
    for (const entry of entries) assert.doesNotThrow(() => new RegExp(entry.vtm), `vtm válida: ${entry.nombre}`);
  });

  await check('la sección se elige por la intención de la pregunta', () => {
    assert.strictEqual(sectionForQuestion('dosis de amoxicilina'), '4.2');
    assert.strictEqual(sectionForQuestion('contraindicaciones del ibuprofeno'), '4.3');
    assert.strictEqual(sectionForQuestion('interaccion de warfarina con fluconazol'), '4.5');
    assert.strictEqual(sectionForQuestion('puedo dar sertralina en lactancia'), '4.6');
    assert.strictEqual(sectionForQuestion('efectos adversos de la metformina'), '4.8');
  });

  await check('HTML de ficha a texto: entidades, tablas y párrafos', () => {
    const text = htmlToText(SECTION_42[0].contenido);
    assert.ok(text.includes('Posología y forma de administración'));
    assert.ok(text.includes('Adultos y niños ≥ 40 kg: 250 mg a 500 mg tres veces al día'));
    assert.ok(text.includes('Niños < 40 kg: 20 a 90 mg/kg/día'));
    assert.ok(text.includes('10-30 ml/min · máximo 500 mg dos veces al día'));
    assert.ok(!/<\/?[a-z][^>]*>|&#\d+;|&[a-z]+;/i.test(text), 'sin restos de HTML');
  });

  await check('el extracto respeta el presupuesto y prioriza lo que pregunta el médico (falla renal)', () => {
    const text = htmlToText(SECTION_42[0].contenido);
    assert.ok(text.length > 1800);
    const renal = excerpt(text, 'dosis de amoxicilina en falla renal', 1800);
    assert.ok(renal.length <= 1800);
    assert.ok(renal.includes('Insuficiencia renal'), 'trae el párrafo renal');
    assert.ok(renal.startsWith('4.2. Posología'), 'conserva el orden y el primer párrafo');
  });

  await check('consulta CIMA: monofármaco con ficha segmentada, sección 4.2, sin marca en el título', async () => {
    const cima = fakeCima();
    const service = new DrugLabelService({ fetchImpl: cima.fetchImpl, logger: quietLogger, snapshot: { labels: [] } });
    const labels = await service.lookup({ message: '¿Cuál es la dosis de amoxicilina en adultos?' });
    assert.strictEqual(labels.length, 1);
    const [label] = labels;
    assert.strictEqual(label.ref, 'F1');
    assert.strictEqual(label.kind, 'ficha_tecnica');
    assert.strictEqual(label.guideline_id, 'cima-60002', 'elige la amoxicilina sola con ficha segmentada, no la combinación ni la sin secc');
    assert.strictEqual(label.title, 'Ficha técnica: Amoxicilina 500 mg Cápsula');
    assert.ok(!/MARCA|Laboratorio/.test(label.title), 'sin marca ni laboratorio');
    assert.strictEqual(label.section, '4.2 Posología y forma de administración');
    assert.strictEqual(label.year, 2024);
    assert.ok(label.url.endsWith('/60002/FT_60002.html'));
    assert.ok(label.text.includes('250 mg a 500 mg tres veces al día'));
    assert.deepStrictEqual(cima.calls, [
      'https://cima.aemps.es/cima/rest/medicamentos?practiv1=amoxicilina&comerc=1',
      'https://cima.aemps.es/cima/rest/docSegmentado/contenido/1?nregistro=60002&seccion=4.2'
    ]);
  });

  await check('privacidad: a CIMA solo sale el principio activo del diccionario, nunca el texto del médico', async () => {
    const cima = fakeCima();
    const service = new DrugLabelService({ fetchImpl: cima.fetchImpl, logger: quietLogger, snapshot: { labels: [] } });
    await service.lookup({ message: 'Paciente Juan Pérez Gómez, CC 1020304050, dosis de amoxicilina clavulanato por favor' });
    assert.ok(cima.calls.length >= 1);
    for (const url of cima.calls) {
      assert.ok(!/juan|perez|gomez|1020304050|paciente|favor/i.test(url), `URL con texto del médico: ${url}`);
    }
  });

  await check('pregunta de seguimiento: toma el medicamento de la pregunta anterior', async () => {
    const cima = fakeCima();
    const service = new DrugLabelService({ fetchImpl: cima.fetchImpl, logger: quietLogger, snapshot: { labels: [] } });
    const labels = await service.lookup({ message: '¿y en falla renal?', previousQuestion: 'dosis de amoxicilina en adultos' });
    assert.strictEqual(labels.length, 1);
    assert.ok(labels[0].text.includes('Insuficiencia renal'));
  });

  await check('caché: la segunda pregunta por el mismo medicamento no vuelve a salir a CIMA', async () => {
    const cima = fakeCima();
    const service = new DrugLabelService({ fetchImpl: cima.fetchImpl, logger: quietLogger, snapshot: { labels: [] } });
    await service.lookup({ message: 'dosis de amoxicilina' });
    const before = cima.calls.length;
    await service.lookup({ message: 'dosis de amoxicilina en niños' });
    assert.strictEqual(cima.calls.length, before);
  });

  await check('plazo: si CIMA no responde, la búsqueda termina a tiempo y devuelve []', async () => {
    const cima = fakeCima({ hang: true });
    const service = new DrugLabelService({ fetchImpl: cima.fetchImpl, timeoutMs: 60, logger: quietLogger, snapshot: { labels: [] } });
    const started = Date.now();
    const labels = await service.lookup({ message: 'dosis de ibuprofeno' });
    assert.deepStrictEqual(labels, []);
    assert.ok(Date.now() - started < 1000, 'no espera más que el plazo');
  });

  await check(`cortacircuitos: tras ${BREAKER_THRESHOLD} fallos seguidos deja de consultar CIMA`, async () => {
    const cima = fakeCima({ fail: true });
    const service = new DrugLabelService({ fetchImpl: cima.fetchImpl, logger: quietLogger, snapshot: { labels: [] } });
    for (const drug of ['ibuprofeno', 'naproxeno', 'diclofenaco']) {
      await service.lookup({ message: `dosis de ${drug}` });
    }
    const before = cima.calls.length;
    const labels = await service.lookup({ message: 'dosis de ketorolaco' });
    assert.deepStrictEqual(labels, []);
    assert.strictEqual(cima.calls.length, before, 'con el cortacircuitos abierto no hay llamadas');
  });

  await check('instantánea precargada: responde sin red', async () => {
    const service = new DrugLabelService({
      fetchImpl: null,
      logger: quietLogger,
      snapshot: {
        labels: [{
          practiv: 'ibuprofeno', vtm: '^ibuprofeno$', section: '4.2', nregistro: '50005',
          product: 'Ibuprofeno 400 mg Comprimido', year: 2023,
          text: 'Adultos: 400 mg cada 6 a 8 horas. Dosis máxima 2 400 mg al día.'
        }]
      }
    });
    assert.strictEqual(service.stats().live, false);
    const labels = await service.lookup({ message: 'dosis máxima de ibuprofeno' });
    assert.strictEqual(labels.length, 1);
    assert.strictEqual(labels[0].guideline_id, 'cima-50005');
    assert.ok(labels[0].text.includes('2 400 mg'));
  });

  await check('sin medicamento reconocido o sin pregunta de dosis no se consulta nada', async () => {
    const cima = fakeCima();
    const service = new DrugLabelService({ fetchImpl: cima.fetchImpl, logger: quietLogger, snapshot: { labels: [] } });
    assert.deepStrictEqual(await service.lookup({ message: 'dosis del medicamento que le mandaron' }), []);
    assert.deepStrictEqual(await service.lookup({ message: 'la amoxicilina es un betalactámico' }), []);
    assert.strictEqual(cima.calls.length, 0);
  });

  await check('MIRACLE_ASSISTANT_DRUG_LABELS=off apaga el servicio', () => {
    assert.strictEqual(isDrugLabelsDisabled({}), false);
    assert.strictEqual(isDrugLabelsDisabled({ MIRACLE_ASSISTANT_DRUG_LABELS: 'off' }), true);
    assert.strictEqual(isDrugLabelsDisabled({ MIRACLE_ASSISTANT_DRUG_LABELS: 'live' }), false);
  });

  console.log(`\n[verify-drug-labels] ${passed} verificaciones OK`);
}

// Juez de la promesa 604 de docs/specs/006-el-asistente-clinico-responde-con-respaldo.md.
promesa(604, 'Una pregunta de dosis trae la ficha técnica del medicamento del diccionario cerrado, y a CIMA solo sale el principio activo', () => main())
  .then(() => cerrar('verify-drug-labels'));
