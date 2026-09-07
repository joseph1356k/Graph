#!/usr/bin/env node
// POST /api/v1/pipeline: con plantilla, la nota sale del motor canónico
// (note_json validado); sin plantilla, del orquestador de voz, etiquetado como
// bloque provisional y con backend_status intacto.
//   node scripts/verify-public-pipeline.js
const { currentContext } = require('../src/infrastructure/usage/UsageContext');
const assert = require('assert');
const http = require('http');
const express = require('express');

const registerPublicApiRoutes = require('../web/api/registerPublicApiRoutes');
const ClinicalNoteGeneratorService = require('../src/application/use-cases/ClinicalNoteGeneratorService');
const ClinicalNotePromptBuilder = require('../src/application/use-cases/ClinicalNotePromptBuilder');
const ClinicalNoteValidationService = require('../src/application/use-cases/ClinicalNoteValidationService');

const TRANSCRIPT = 'Paciente consulta por cefalea de tres días de evolución. Niega fiebre. Se indica analgesia y control.';

function createFakeLlm() {
  return {
    calls: 0,
    hasApiKey: () => true,
    async chatExpectingJson(messages, format = { type: 'json_object' }, options = {}) {
      this.calls += 1;
      this.lastTemperature = options.temperature;
      this.lastFormat = format;
      this.lastMetadata = currentContext().metadata || null;
      const template = JSON.parse(ClinicalNotePromptBuilder.extractTagged(messages[1].content, 'plantilla'));
      return JSON.stringify({
        summary: 'Consulta por cefalea.',
        sections: template.sections.map((section) => ({
          key: section.key,
          label: section.label,
          content: `Contenido de ${section.key}.`,
          grounding: 'entailed',
          evidence: ['cefalea de tres días']
        })),
        warnings: [],
        missing_required_sections: []
      });
    },
    parseJsonObject: (raw) => JSON.parse(raw)
  };
}

async function main() {
  const llm = createFakeLlm();
  const runtimeCalls = [];
  const noteGeneratorService = new ClinicalNoteGeneratorService({
    llmProvider: llm,
    promptBuilder: new ClinicalNotePromptBuilder(),
    validationService: new ClinicalNoteValidationService()
  });

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  registerPublicApiRoutes(app, {
    callMiracleRuntime: async (req, path, options) => {
      runtimeCalls.push({ path, options });
      return { body: { resolved_note_content: '## Bloque de voz\nhola', backend_status: 'heuristic-fallback:503', usage: null } };
    },
    noteGeneratorService
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (body) => {
    const response = await fetch(`${base}/api/v1/pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  };

  let passed = 0;
  const check = (name, fn) => { fn(); passed += 1; console.log(`  ok - ${name}`); };

  try {
    const canonical = await post({
      transcript: TRANSCRIPT,
      template: {
        name: 'Consulta general',
        specialty: 'medicina_general',
        sections: [{ label: 'Motivo de consulta', required: true }, { label: 'Plan' }]
      }
    });
    check('con plantilla, la nota la produce el motor canónico', () => {
      assert.strictEqual(canonical.status, 200);
      assert.strictEqual(canonical.body.note.engine, 'canonical-note');
      assert.strictEqual(canonical.body.note.backend_status, 'canonical-note');
      assert.deepStrictEqual(canonical.body.note.note_json.sections.map((s) => s.key), ['motivo_de_consulta', 'plan']);
      assert.strictEqual(canonical.body.note.note_json.sections[0].grounding, 'entailed');
      assert.strictEqual(canonical.body.note.note_json.sections[0].confidence, 0.8);
      assert.ok(canonical.body.note.prompt_version.startsWith('clinical-note@'));
      assert.strictEqual(canonical.body.note.note_mode, 'interpretive');
      assert.strictEqual(llm.lastTemperature, 0.1);
    });
    check('el contenido Markdown se deriva de note_json y no se llama al orquestador', () => {
      assert.ok(canonical.body.note.content.includes('## Motivo de consulta'));
      assert.ok(canonical.body.note.content.includes('Contenido de motivo_de_consulta.'));
      assert.strictEqual(runtimeCalls.length, 0);
    });

    const literal = await post({
      transcript: TRANSCRIPT,
      template: { name: 'Biopsia', specialty: 'patologia', sections: ['Descripción macroscópica', 'Diagnóstico'] }
    });
    check('la plantilla inline respeta el modo por especialidad', () => {
      assert.strictEqual(literal.body.note.note_mode, 'verbatim');
      assert.strictEqual(llm.lastTemperature, 0);
    });

    // Mismo resolver que la ruta clínica: la plantilla explícita gana a la
    // especialidad, el modo por sección produce una nota mixta, y la
    // telemetría reporta el modo resuelto en los dos casos.
    const explicitInline = await post({
      transcript: TRANSCRIPT,
      template: { name: 'Patología conversacional', specialty: 'patologia', note_mode: 'interpretive', sections: ['Motivo de consulta', 'Plan'] }
    });
    const mixedInline = await post({
      transcript: TRANSCRIPT,
      template: { name: 'Control', specialty: 'medicina_general', sections: [{ label: 'Motivo de consulta' }, { label: 'Plan', mode: 'verbatim' }] }
    });
    check('el pipeline usa el mismo resolver: note_mode explícito gana a la especialidad y el modo por sección da mixta', () => {
      assert.strictEqual(explicitInline.status, 200, JSON.stringify(explicitInline.body));
      assert.strictEqual(explicitInline.body.note.note_mode, 'interpretive');
      assert.strictEqual(llm.lastFormat.type, 'json_schema', 'el pipeline también pide el schema estricto');
      assert.strictEqual(mixedInline.status, 200, JSON.stringify(mixedInline.body));
      assert.strictEqual(mixedInline.body.note.note_mode, 'mixed');
      assert.strictEqual(llm.lastMetadata.noteMode, 'mixed', 'la telemetría reporta el modo resuelto');
      assert.strictEqual(llm.lastMetadata.promptVersion, ClinicalNotePromptBuilder.PROMPT_VERSION);
    });

    const scratchpad = await post({ transcript: TRANSCRIPT });
    check('sin plantilla, el orquestador de voz responde etiquetado y con backend_status intacto', () => {
      assert.strictEqual(scratchpad.status, 200);
      assert.strictEqual(scratchpad.body.note.engine, 'voice-scratchpad');
      assert.strictEqual(scratchpad.body.note.backend_status, 'heuristic-fallback:503');
      assert.strictEqual(scratchpad.body.note.content, '## Bloque de voz\nhola');
      assert.strictEqual(runtimeCalls.length, 1);
      assert.strictEqual(runtimeCalls[0].path, '/api/voice/orchestrator/events');
    });

    const invalid = await post({ transcript: TRANSCRIPT, template: { name: 'X', specialty: 'x', sections: ['Solo una'] } });
    check('una plantilla con menos de 2 secciones es error del cliente (400)', () => {
      assert.strictEqual(invalid.status, 400);
      assert.ok(/secciones/i.test(invalid.body.error));
    });

    const autofill = await post({
      transcript: TRANSCRIPT,
      stages: { autofill: true },
      template: { name: 'Consulta', specialty: 'medicina_general', sections: ['Motivo de consulta', 'Plan'] },
      fields: [{ stepOrder: 1, actionType: 'input', label: 'Motivo' }]
    });
    check('la etapa autofill sigue recibiendo texto de la nota canónica', () => {
      // Sin noteFieldMatcher configurado en este arnés, la etapa se declara
      // no disponible: lo importante es que no se saltó por falta de contenido.
      assert.strictEqual(autofill.body.autofill.status, 'unavailable');
      assert.notStrictEqual(autofill.body.autofill.reason, 'no_note_content');
    });

    console.log(`\nverify-public-pipeline: ${passed} checks ok`);
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(`\n❌ ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});
