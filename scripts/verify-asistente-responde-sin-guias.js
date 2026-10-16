#!/usr/bin/env node
// Juez de las promesas de docs/specs/008-el-asistente-responde-aunque-no-haya-guia.md.
//
//   node scripts/verify-asistente-responde-sin-guias.js
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { promesa, cerrar } = require('./lib/promesas');
const ClinicalAssistantService = require('../src/application/use-cases/ClinicalAssistantService');
const ClinicalAssistantPromptBuilder = require('../src/application/use-cases/ClinicalAssistantPromptBuilder');
const { parseAssistantReply, TRUNCATED_FALLBACK } = require('../src/application/use-cases/ClinicalAssistantResponseParser');

async function main() {
  const corrida = spawnSync(process.execPath, [path.join(__dirname, 'eval-assistant-abstention.js')], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    encoding: 'utf8'
  });
  const salida = `${corrida.stdout || ''}${corrida.stderr || ''}`;
  for (const linea of salida.split(/\r?\n/).filter((texto) => /^\s+(global|caso|sin_guia|con_guia|cifra)/.test(texto))) {
    console.log(`  ${linea.trim()}`);
  }
  console.log();

  await promesa(801, 'Sobre al menos 40 preguntas reales de consulta (casos con la consulta cargada, temas sin guía, preguntas con guía y cifras difíciles), con las respuestas grabadas del prompt vigente, el asistente dice «no sé» en el 5 % o menos, devuelve JSON válido en el 100 % y su razonamiento interno nunca llega al médico', () => {
    if (corrida.status === 0) return;
    const cola = salida.trimEnd().split(/\r?\n/).slice(-3).join(' · ');
    throw new Error(`eval-assistant-abstention.js salió con ${corrida.status ?? corrida.signal}: ${cola}`);
  });

  await promesa(802, 'Una pregunta de caso («¿qué hago con este paciente?») o una pregunta clínica sin guía va en modo razonado (protocolo de caso, razonamiento previo, 3 500 tokens de salida); una pregunta con guía, la charla y las preguntas de la app van en modo directo', () => {
    const depth = ClinicalAssistantService.answerDepth;
    const guia = [{ guideline_id: 'x' }];
    assert.strictEqual(depth({ message: '¿Qué hago con este paciente?', guidelines: guia }), 'razonado');
    assert.strictEqual(depth({ message: 'que le doy a esta señora', guidelines: guia }), 'razonado');
    assert.strictEqual(depth({ message: '¿cómo lo manejo?', guidelines: guia }), 'razonado');
    assert.strictEqual(depth({ message: 'tratamiento de la hidradenitis supurativa', guidelines: [], retrievalMode: 'veto' }), 'razonado');
    assert.strictEqual(depth({ message: 'manejo de la queratosis seborreica', guidelines: [], retrievalMode: 'lexico' }), 'razonado');
    assert.strictEqual(depth({ message: 'dosis de amoxicilina en otitis media', guidelines: guia, retrievalMode: 'lexico' }), 'directo');
    assert.strictEqual(depth({ message: 'hola, buenos días', guidelines: [], retrievalMode: 'lexico' }), 'directo');
    assert.strictEqual(depth({ message: 'cómo exporto la nota a pdf', guidelines: [], retrievalMode: 'lexico' }), 'directo');
    const builder = new ClinicalAssistantPromptBuilder();
    const razonado = builder.buildChatSystemPrompt({ depth: 'razonado' });
    const directo = builder.buildChatSystemPrompt({ depth: 'directo' });
    assert.ok(razonado.includes('MODO RAZONADO') && razonado.includes('{"razonamiento":"string","respuesta"'));
    assert.ok(!directo.includes('MODO RAZONADO') && !directo.includes('"razonamiento"'));
    assert.strictEqual(ClinicalAssistantService.MAX_CHAT_OUTPUT_TOKENS_REASONED, 3500);
  });

  await promesa(803, 'Sin guías recuperadas el prompt pide responder con la consulta y el conocimiento general marcado, y «insuficiente» queda solo para cuando no hay nada clínico que aportar', () => {
    const builder = new ClinicalAssistantPromptBuilder();
    const system = builder.buildChatSystemPrompt({});
    assert.ok(system.includes('Sin guía también respondes'), 'la regla de responder sin guía está');
    assert.ok(system.includes('No empieces por «no puedo»'), 'una cifra sin respaldo no convierte la respuesta en un «no sé»');
    assert.ok(system.includes('"insuficiente" solo si no puedes aportar nada clínico'));
    const [, user] = builder.buildChatMessages({ clinicalContext: { guidelines: [] }, message: 'manejo de la fisura anal' }).slice(-2);
    assert.ok(JSON.parse(user.content).guias_clinicas.includes('responde igual con la consulta y tu conocimiento médico general'));
  });

  await promesa(804, 'El razonamiento interno no llega al médico ni cuando la respuesta del modelo llega cortada: se rescata el texto de "respuesta" o se avisa que llegó incompleta', () => {
    const reply = parseAssistantReply(JSON.stringify({ razonamiento: 'BORRADOR: datos del caso', respuesta: 'Plan: X.', respaldo: 'consulta' }), { guidelines: [] });
    assert.strictEqual(reply.answer, 'Plan: X.');
    assert.ok(!JSON.stringify(reply).includes('BORRADOR'));
    const cortada = parseAssistantReply('{"razonamiento":"BORRADOR: datos del caso","respuesta":"Plan: primero confirmar adh', { guidelines: [] });
    assert.strictEqual(cortada.answer, 'Plan: primero confirmar adh');
    const soloRazonamiento = parseAssistantReply('{"razonamiento":"BORRADOR: datos del caso y se cort', { guidelines: [] });
    assert.strictEqual(soloRazonamiento.answer, TRUNCATED_FALLBACK);
    assert.ok(!JSON.stringify(soloRazonamiento).includes('BORRADOR'));
    const texto = parseAssistantReply('Respuesta en texto plano.', { guidelines: [] });
    assert.strictEqual(texto.answer, 'Respuesta en texto plano.');
  });

  await promesa(805, 'Una cita agrupada («[G1; G3]») cuenta como las citas que agrupa: sus fuentes se declaran y las inventadas se borran', () => {
    const guidelines = [1, 2, 3].map((n) => ({ ref: `G${n}`, guideline_id: `g${n}`, title: `Guía ${n}`, organism: 'X', year: 2024, section: 'S', text: 't' }));
    const reply = parseAssistantReply(JSON.stringify({ respuesta: 'Descartar sangrado [G1; G3]. Otra cosa [G2, G9].', respaldo: 'guia', fuentes: [] }), { guidelines });
    assert.deepStrictEqual(reply.sources.map((source) => source.ref), ['G1', 'G2', 'G3']);
    assert.strictEqual(reply.answer, 'Descartar sangrado [G1] [G3]. Otra cosa [G2].');
  });

  cerrar('verify-asistente-responde-sin-guias');
}

main();
