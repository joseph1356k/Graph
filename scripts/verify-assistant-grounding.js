// Verifica las piezas que hacen confiable la respuesta del asistente sin
// llamar a ningún modelo:
//   - ClinicalAnswerVerifier: extrae cifras con unidad y las busca en las
//     fuentes (con equivalencias 1 g = 1000 mg, rangos, presión arterial);
//   - índice de guías: corrección de digitación, población del paciente,
//     preguntas de seguimiento y etiqueta de relevancia.
//   node scripts/verify-assistant-grounding.js
const assert = require('assert');
const { promesa, cerrar } = require('./lib/promesas');
const { extractFigures, verifyFigures, parseNumber } = require('../src/application/use-cases/ClinicalAnswerVerifier');
const {
  loadDefaultIndex,
  inferPopulations,
  populationsInText,
  buildRetrievalContext,
  lastUserQuestion,
  relevanceLabel
} = require('../src/application/knowledge/ClinicalGuidelineIndex');

function main() {
  let passed = 0;
  const check = (name, fn) => {
    fn();
    passed += 1;
    console.log(`  ok ${passed}. ${name}`);
  };

  check('extrae cifras con unidad: rangos, decimales con coma, miles con espacio, presión arterial', () => {
    const figures = extractFigures('Amoxicilina 80–90 mg/kg/día por 10 días; 1 g cada 8 h; PA ≥140/90 mmHg; 10 000 UI; 0,15 mg/kg; SatO2 <92 %.');
    const summary = figures.map((figure) => `${figure.family}:${figure.numbers.join('/')}`);
    assert.deepStrictEqual(summary, [
      'masa/kg/dia:80/90', 'dias:10', 'masa:1', 'horas:8', 'mmhg:140/90', 'ui:10000', 'masa/kg:0.15', '%:92'
    ]);
    assert.strictEqual(parseNumber('12,5'), 12.5);
    const [igiv] = extractFigures('inmunoglobulina 2 g/kg en 2 a 5 días');
    assert.strictEqual(`${igiv.family}:${igiv.numbers[0] * igiv.factor}`, 'masa/kg:2000', 'g/kg no se confunde con gramos');
    assert.deepStrictEqual(verifyFigures('2 000 mg/kg', ['2 g/kg']).unverified, []);
    assert.strictEqual(parseNumber(undefined), null);
  });

  check('no confunde referencias, códigos ni números sueltos con cifras clínicas', () => {
    assert.deepStrictEqual(extractFigures('Según [G1] y [F2], código I10 y E11.9, paso 3 del algoritmo.'), []);
  });

  check('una cifra presente en la fuente queda verificada, también con equivalencia de unidades', () => {
    const evidence = ['Adultos: 1 000 mg cada 8 horas durante 7 días. Niños: 80–90 mg/kg/día.'];
    const result = verifyFigures('Dar 1 g cada 8 h por 7 días; en niños 90 mg/kg/día.', evidence);
    assert.strictEqual(result.checked, 4);
    assert.deepStrictEqual(result.unverified, []);
  });

  check('una cifra ausente de las fuentes se marca, sin duplicados y con tope', () => {
    const result = verifyFigures('Meta <130/80 mmHg. Dar 7 días. Repetir 7 días.', ['Meta 120–129 mmHg.']);
    assert.deepStrictEqual(result.unverified, ['<130/80 mmHg', '7 días']);
    const many = verifyFigures(Array.from({ length: 20 }, (_, i) => `${i + 11} mg`).join(', '), []);
    assert.strictEqual(many.unverified.length, 8);
  });

  check('el dato de la consulta (edad, cifras de la nota) cuenta como respaldo', () => {
    const result = verifyFigures('Paciente de 67 años con PA 160/100 mmHg.', ['67 años', 'TA 160/100 mmHg al ingreso']);
    assert.deepStrictEqual(result.unverified, []);
  });

  const index = loadDefaultIndex({ force: true });

  check('corrige errores de digitación hacia términos del corpus, pero no inventa parecidos', () => {
    assert.strictEqual(index.closestTerm('amoxisilina'), 'amoxicilina');
    assert.strictEqual(index.closestTerm('preclampsia'), 'preeclampsia');
    assert.strictEqual(index.closestTerm('levotiroxna'), 'levotiroxina');
    assert.strictEqual(index.closestTerm('contrasena'), null);
    const results = index.search({ message: 'dosis de amoxisilina en otitis' });
    assert.ok(results.length > 0, 'la pregunta mal digitada sigue recuperando');
    assert.ok(['antibioticos-dosis-frecuentes', 'otitis-media-y-sinusitis-aguda'].includes(results[0].guideline_id));
  });

  check('población: la pregunta manda sobre el paciente; si no nombra ninguna, se deduce de edad y embarazo', () => {
    assert.deepStrictEqual(inferPopulations({ message: '¿y en niños?', patient: { edad: 40 } }), ['pediatria']);
    assert.deepStrictEqual(inferPopulations({ patient: { edad: 70 } }), ['adultos', 'adultos_mayores']);
    assert.deepStrictEqual(inferPopulations({ patient: { edad: 0 } }), ['pediatria', 'neonatos']);
    assert.deepStrictEqual(inferPopulations({ patient: { edad: 28, sexo: 'F' }, context: 'gestante de 32 semanas' }), ['adultos', 'gestantes']);
    assert.deepStrictEqual(inferPopulations({ patient: { edad: 30, sexo: 'F' }, codes: [{ codigo: 'O14.1' }] }), ['adultos', 'gestantes']);
    assert.deepStrictEqual(inferPopulations({ patient: { edad: 30, sexo: 'M' }, context: 'embarazo de la pareja' }), ['adultos']);
    assert.ok(populationsInText('Tratamiento en adultos mayores').has('adultos_mayores'));
    assert.ok(!populationsInText('Tratamiento en adultos mayores').has('adultos'));
  });

  check('población: la guía pediátrica sube con un niño en consulta y baja con un adulto', () => {
    const child = index.search({ message: 'fiebre y tos', populations: ['pediatria'] });
    const adult = index.search({ message: 'fiebre y tos', populations: ['adultos'] });
    const scoreOf = (list, id) => (list.find((item) => item.guideline_id === id) || { score: 0 }).score;
    assert.ok(
      scoreOf(child, 'infeccion-respiratoria-aguda-pediatrica') > scoreOf(adult, 'infeccion-respiratoria-aguda-pediatrica'),
      'la guía pediátrica puntúa más con un niño'
    );
  });

  check('seguimiento: la pregunta anterior del médico entra al contexto de búsqueda', () => {
    const history = [
      { role: 'user', content: 'dosis de amoxicilina en otitis media aguda' },
      { role: 'assistant', content: 'Respuesta…' }
    ];
    assert.strictEqual(lastUserQuestion(history), 'dosis de amoxicilina en otitis media aguda');
    const followUp = index.search({ message: '¿y en niños?', followUp: lastUserQuestion(history) });
    assert.strictEqual(buildRetrievalContext({ noteJson: null, codes: [] }), '');
    assert.ok(followUp.length > 0, 'la pregunta de seguimiento recupera');
    assert.ok(followUp.slice(0, 3).some((item) => /otitis|antibioticos/.test(item.guideline_id)));
  });

  check('relevancia: alta, media o baja según cobertura de la pregunta y distancia al mejor', () => {
    assert.strictEqual(relevanceLabel({ score: 10, top: 10, coverage: 1, headHit: true }), 'alta');
    assert.strictEqual(relevanceLabel({ score: 6, top: 10, coverage: 0.5, headHit: false }), 'media');
    assert.strictEqual(relevanceLabel({ score: 4, top: 10, coverage: 0.2, headHit: false }), 'baja');
    const results = index.search({ message: 'criterios CURB-65 para hospitalizar neumonía' });
    assert.ok(results.every((item) => ['alta', 'media', 'baja'].includes(item.relevance)));
    assert.strictEqual(results[0].relevance, 'alta');
  });

  check('saludos y charla no recuperan guías aunque traigan palabras como «días»', () => {
    for (const message of ['buenos días, ¿cómo va todo?', 'hola doctor', 'ok gracias', 'buenas tardes']) {
      assert.deepStrictEqual(index.search({ message }), [], message);
    }
  });

  console.log(`\n[verify-assistant-grounding] ${passed} verificaciones OK`);
}

// Juez de la promesa 603 de docs/specs/006-el-asistente-clinico-responde-con-respaldo.md.
promesa(603, 'Una cifra de la respuesta que no está en las fuentes citadas ni en la consulta se marca para el médico, y cada extracto declara su relevancia', () => main())
  .then(() => cerrar('verify-assistant-grounding'));
