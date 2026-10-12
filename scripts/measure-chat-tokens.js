#!/usr/bin/env node
/**
 * Tokens de entrada del chat del asistente con consultas típicas.
 *
 * Corre el servicio real (contexto, retrieval de guías, prompt del chat) con un
 * modelo falso que solo captura los mensajes, sobre tres perfiles de consulta
 * de scripts/fixtures/token-budget.json (transcripción, nota en pantalla,
 * códigos, paciente e historial de chat). Cuando la pregunta es de medicamento
 * se simula una ficha técnica del tamaño máximo (1 800 caracteres), así que la
 * medida es conservadora. Los tokens se estiman por caracteres
 * (`estimador.caracteres_por_token`).
 *
 *   node scripts/measure-chat-tokens.js [--verbose]
 */
const assert = require('assert');
const fixture = require('./fixtures/token-budget.json');
const LLMProvider = require('../src/infrastructure/LLMProvider');
const ClinicalAssistantService = require('../src/application/use-cases/ClinicalAssistantService');
const ClinicalAssistantPromptBuilder = require('../src/application/use-cases/ClinicalAssistantPromptBuilder');
const ClinicalAssistantValidationService = require('../src/application/use-cases/ClinicalAssistantValidationService');
const ClinicalNoteValidationService = require('../src/application/use-cases/ClinicalNoteValidationService');
const { loadDefaultIndex } = require('../src/application/knowledge/ClinicalGuidelineIndex');
const { DrugLabelService } = require('../src/application/knowledge/DrugLabelService');

const THRESHOLDS = Object.freeze({
  minCases: 20,
  medianInputTokens: 6000
});

const verbose = process.argv.includes('--verbose');
const DOCTOR_ID = '00000000-0000-4000-8000-000000000001';
const ENCOUNTER_ID = '00000000-0000-4000-8000-0000000000e2';
const CHARS_PER_TOKEN = Number(fixture.estimador?.caracteres_por_token) || 3.5;
const LABEL_EXCERPT_CHARS = 1800;

const captured = { messages: null };
const fakeLlm = {
  provider: 'medicion',
  model: 'medicion',
  hasApiKey: () => true,
  async chatExpectingJsonWithUsage(messages) {
    captured.messages = messages;
    const content = JSON.stringify({ respuesta: 'Medición de tokens.', respaldo: 'general', fuentes: [], faltantes: [], alertas: [], propuesta_nota: null, seguimientos: [] });
    return { content, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, model: 'medicion', provider: 'medicion' };
  },
  parseJsonObject(content) {
    return LLMProvider.prototype.parseJsonObject.call(null, content);
  }
};

// Ficha técnica simulada del tamaño máximo para las preguntas de medicamento,
// con la misma detección (diccionario cerrado) que el servicio real.
const detector = new DrugLabelService({ fetchImpl: null, logger: { info() {}, warn() {}, error() {} } });
const fakeDrugLabels = {
  async lookup({ message }) {
    if (!detector.isDrugQuestion(message)) return [];
    return detector.detectDrugs(message).slice(0, 1).map((entry, i) => ({
      ref: `F${i + 1}`,
      kind: 'ficha_tecnica',
      guideline_id: `cima-medicion-${i + 1}`,
      title: `Ficha técnica: ${entry.nombre}`,
      organism: 'AEMPS',
      year: 2024,
      section: '4.2 Posología y forma de administración',
      text: 'Posología. '.padEnd(LABEL_EXCERPT_CHARS, 'Dosis habitual en adultos y niños según peso y función renal. '),
      url: 'https://cima.aemps.es/cima/dochtml/ft/0/FT_0.html'
    }));
  }
};

const state = { encounter: null };
const encounterService = new Proxy({}, {
  get(target, prop) {
    if (prop === 'getOwnedEncounter') return async () => JSON.parse(JSON.stringify(state.encounter));
    if (prop === 'then') return undefined;
    return () => null;
  }
});

const service = new ClinicalAssistantService({
  encounterService,
  llmProvider: fakeLlm,
  promptBuilder: new ClinicalAssistantPromptBuilder(),
  validationService: new ClinicalAssistantValidationService(),
  noteValidationService: new ClinicalNoteValidationService(),
  guidelineIndex: loadDefaultIndex(),
  drugLabelService: fakeDrugLabels
});

function transcriptFor(profile) {
  const lines = [];
  let length = 0;
  for (let i = 0; length < profile.longitud_transcripcion; i += 1) {
    const line = profile.frases[i % profile.frases.length];
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join('\n').slice(0, profile.longitud_transcripcion);
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const tokensOf = (chars) => Math.ceil(chars / CHARS_PER_TOKEN);

async function main() {
  const rows = [];
  for (const profile of fixture.perfiles) {
    state.encounter = {
      id: ENCOUNTER_ID,
      doctor_id: DOCTOR_ID,
      status: 'draft',
      transcript: transcriptFor(profile),
      template_snapshot: {
        specialty: profile.especialidad,
        name: 'Consulta',
        sections: profile.nota.sections.map((section, order) => ({ key: section.key, label: section.label, order, required: false, mode: 'inherit', verbatim: false }))
      },
      note_json: { ...profile.nota, warnings: [], missing_required_sections: [] }
    };
    for (const question of profile.preguntas) {
      captured.messages = null;
      await service.chat({
        message: question,
        encounterId: ENCOUNTER_ID,
        specialty: profile.especialidad,
        history: fixture.historial,
        noteDraft: profile.nota,
        codes: profile.codigos,
        patientContext: profile.paciente
      }, { doctorId: DOCTOR_ID });
      assert.ok(Array.isArray(captured.messages), 'el servicio llamó al modelo una vez');
      const byRole = { system: 0, user: 0, assistant: 0 };
      for (const message of captured.messages) byRole[message.role] = (byRole[message.role] || 0) + `${message.content || ''}`.length;
      const chars = Object.values(byRole).reduce((sum, value) => sum + value, 0);
      rows.push({ profile: profile.id, question, chars, tokens: tokensOf(chars), byRole });
    }
  }

  const tokens = rows.map((row) => row.tokens);
  const median = percentile(tokens, 50);
  const p95 = percentile(tokens, 95);
  const systemTokens = tokensOf(rows[0].byRole.system);
  console.log(`[measure-chat-tokens] ${rows.length} preguntas en ${fixture.perfiles.length} consultas típicas · ${CHARS_PER_TOKEN} caracteres por token`);
  for (const profile of fixture.perfiles) {
    const own = rows.filter((row) => row.profile === profile.id).map((row) => row.tokens);
    console.log(`  ${profile.id.padEnd(18)} transcripción ${String(profile.longitud_transcripcion).padStart(5)} car. · mediana ${percentile(own, 50)} · máx ${Math.max(...own)} tokens`);
  }
  console.log(`  global             mediana ${median} · p95 ${p95} · máx ${Math.max(...tokens)} tokens (system prompt ≈ ${systemTokens})`);
  if (verbose) for (const row of rows) console.log(`   ${String(row.tokens).padStart(5)}  ${row.profile} · ${row.question}`);

  const below = [];
  if (rows.length < THRESHOLDS.minCases) below.push(`preguntas medidas ${rows.length} < ${THRESHOLDS.minCases}`);
  if (median > THRESHOLDS.medianInputTokens) below.push(`mediana de tokens de entrada ${median} > ${THRESHOLDS.medianInputTokens}`);
  if (below.length) {
    console.error(`[measure-chat-tokens] FALLA: ${below.join('; ')}`);
    process.exit(1);
  }
  console.log('[measure-chat-tokens] umbrales OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
