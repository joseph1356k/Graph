// Verifica el flujo clínico completo: plantillas -> encounter -> transcript ->
// generate-note -> nota editada. Corre contra un Supabase fake en memoria y un
// LLM fake, levantando las rutas reales de Express.
//   node scripts/verify-clinical-workflow.js
const assert = require('assert');
const crypto = require('crypto');
const express = require('express');
const http = require('http');

const SupabaseClinicalTemplateRepository = require('../src/infrastructure/repositories/SupabaseClinicalTemplateRepository');
const SupabaseClinicalEncounterRepository = require('../src/infrastructure/repositories/SupabaseClinicalEncounterRepository');
const ClinicalTemplateService = require('../src/application/use-cases/ClinicalTemplateService');
const ClinicalEncounterService = require('../src/application/use-cases/ClinicalEncounterService');
const ClinicalNotePromptBuilder = require('../src/application/use-cases/ClinicalNotePromptBuilder');
const ClinicalNoteValidationService = require('../src/application/use-cases/ClinicalNoteValidationService');
const ClinicalNoteGeneratorService = require('../src/application/use-cases/ClinicalNoteGeneratorService');
const registerClinicalRoutes = require('../web/api/registerClinicalRoutes');

const DOCTOR_ID = '7b8a4c8e-1d2f-4a5b-9c3d-2e1f0a9b8c7d';
const OTHER_DOCTOR_ID = '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';

const CLINICAL_TRANSCRIPT = 'Paciente consulta por cefalea de tres días de evolución. Refiere que el dolor es intermitente, empeora con exposición a pantallas y mejora con reposo. Presenta náuseas leves. Niega fiebre, vómito y alteraciones visuales. No refiere antecedentes relevantes durante la consulta. Se recomienda higiene del sueño, hidratación, pausas de pantalla y control si aparecen signos de alarma.';

// ---------------------------------------------------------------------------
// Fake Supabase REST client (targeted PostgREST subset used by the repos).
// ---------------------------------------------------------------------------
function createFakeSupabaseRestClient() {
  const tables = {
    clinical_templates: [],
    clinical_encounters: []
  };

  function parseParams(query) {
    return `${query || ''}`.split('&').filter(Boolean).map((pair) => {
      const eq = pair.indexOf('=');
      return [pair.slice(0, eq), decodeURIComponent(pair.slice(eq + 1))];
    });
  }

  function applyFilters(rows, params) {
    let result = rows.slice();
    for (const [name, value] of params) {
      if (name === 'select' || name === 'order' || name === 'limit') continue;
      if (name === 'or') {
        const ownerMatch = value.match(/and\(owner_id\.eq\.([^,]+),status\.eq\.active\)/);
        const wantsInstitutional = value.includes('and(scope.eq.institutional,status.eq.active)');
        result = result.filter((row) => {
          const institutional = wantsInstitutional && row.scope === 'institutional' && row.status === 'active';
          const own = ownerMatch && row.owner_id === ownerMatch[1] && row.status === 'active';
          return institutional || own;
        });
        continue;
      }
      const match = value.match(/^eq\.(.*)$/);
      if (!match) throw new Error(`Fake Supabase: filtro no soportado ${name}=${value}`);
      const column = name;
      if (column === 'id' && !/^[0-9a-f-]{36}$/i.test(match[1])) {
        const error = new Error('invalid input syntax for type uuid');
        error.statusCode = 400;
        throw error;
      }
      result = result.filter((row) => `${row[column]}` === match[1]);
    }
    const orderParam = params.find(([name]) => name === 'order');
    if (orderParam && orderParam[1] === 'is_default.desc,name.asc') {
      result.sort((a, b) => (Number(b.is_default) - Number(a.is_default)) || `${a.name}`.localeCompare(`${b.name}`));
    }
    const limitParam = params.find(([name]) => name === 'limit');
    if (limitParam) result = result.slice(0, Number(limitParam[1]));
    return result;
  }

  return {
    tables,
    isConfigured: () => true,
    async select(table, query) {
      return applyFilters(tables[table], parseParams(query)).map((row) => ({ ...row }));
    },
    async insert(table, row) {
      const now = new Date().toISOString();
      const stored = { id: crypto.randomUUID(), created_at: now, updated_at: now, ...row };
      tables[table].push(stored);
      return { ...stored };
    },
    async update(table, query, patch) {
      const params = parseParams(query.split('&select=')[0]);
      const rows = applyFilters(tables[table], params);
      if (rows.length === 0) return null;
      const target = tables[table].find((row) => row.id === rows[0].id);
      Object.assign(target, patch, { updated_at: new Date().toISOString() });
      return { ...target };
    }
  };
}

const INSTITUTIONAL_SEEDS = [
  {
    id: 'e3b0c442-98fc-4c14-9af4-a11e00000001',
    name: 'Consulta inicial · Medicina general',
    sectionLabels: ['Identificación', 'Motivo de consulta', 'Antecedentes relevantes', 'Enfermedad actual y tamizajes preventivos', 'Examen físico dirigido', 'Impresión diagnóstica', 'Plan y recomendaciones'],
    requiredLabels: ['Motivo de consulta', 'Enfermedad actual y tamizajes preventivos', 'Impresión diagnóstica', 'Plan y recomendaciones']
  },
  {
    id: 'e3b0c442-98fc-4c14-9af4-a11e00000002',
    name: 'Control y seguimiento · Medicina general',
    sectionLabels: ['Identificación', 'Motivo de consulta', 'Evolución desde la última consulta', 'Adherencia y respuesta al tratamiento', 'Hallazgos relevantes', 'Plan y recomendaciones'],
    requiredLabels: ['Motivo de consulta', 'Evolución desde la última consulta', 'Plan y recomendaciones']
  },
  {
    id: 'e3b0c442-98fc-4c14-9af4-a11e00000003',
    name: 'Atención integral y remisión · Medicina general',
    sectionLabels: ['Identificación', 'Motivo de consulta', 'Enfermedad actual', 'Hallazgos relevantes', 'Impresión diagnóstica', 'Conducta, remisión y recomendaciones'],
    requiredLabels: ['Motivo de consulta', 'Enfermedad actual', 'Impresión diagnóstica', 'Conducta, remisión y recomendaciones']
  }
];

function seedInstitutionalTemplates(restClient) {
  const now = new Date().toISOString();
  for (const seed of INSTITUTIONAL_SEEDS) {
    const sections = ClinicalTemplateService.normalizeSections(seed.sectionLabels.map((label, index) => ({
      label,
      order: index + 1,
      required: seed.requiredLabels.includes(label)
    })));
    restClient.tables.clinical_templates.push({
      id: seed.id,
      owner_id: null,
      name: seed.name,
      description: 'Plantilla institucional de prueba.',
      specialty_code: 'medicina_general',
      specialty_name: 'Medicina general',
      sections,
      scope: 'institutional',
      is_default: true,
      status: 'active',
      created_at: now,
      updated_at: now
    });
  }
}

// ---------------------------------------------------------------------------
// Fake LLM provider.
// ---------------------------------------------------------------------------
function createFakeLlm() {
  const state = { calls: 0, transform: null };
  return {
    state,
    hasApiKey: () => true,
    async chatExpectingJson(messages) {
      state.calls += 1;
      const request = JSON.parse(messages[1].content);
      const sections = request.template.sections.map((section) => ({
        key: section.key,
        label: section.label,
        content: `Contenido generado para ${section.key}.`,
        confidence: 0.9,
        evidence: 'cefalea de tres días'
      }));
      const note = {
        summary: 'Consulta por cefalea de tres días sin signos de alarma referidos.',
        sections,
        warnings: [],
        missing_required_sections: []
      };
      return JSON.stringify(state.transform ? state.transform(note, request) : note);
    },
    parseJsonObject(content) {
      return JSON.parse(content);
    }
  };
}

// ---------------------------------------------------------------------------
// HTTP harness: rutas reales + auth fake.
// ---------------------------------------------------------------------------
async function startTestServer({ restClient, llm }) {
  const templateRepository = new SupabaseClinicalTemplateRepository(restClient);
  const encounterRepository = new SupabaseClinicalEncounterRepository(restClient);
  const templateService = new ClinicalTemplateService(templateRepository);
  const encounterService = new ClinicalEncounterService(encounterRepository, templateService);
  const noteValidationService = new ClinicalNoteValidationService();
  const noteGeneratorService = new ClinicalNoteGeneratorService({
    encounterService,
    encounterRepository,
    llmProvider: llm,
    promptBuilder: new ClinicalNotePromptBuilder(),
    validationService: noteValidationService
  });

  const app = express();
  app.use(express.json({ limit: '16mb' }));
  // Stand in for requireClinicalAuth (Supabase Bearer -> req.clinicalUser).
  app.use((req, res, next) => {
    req.clinicalUser = {
      id: req.get('x-test-user') || DOCTOR_ID,
      email: 'doc@test.local',
      role: 'authenticated',
      canManageInstitutional: false
    };
    next();
  });
  registerClinicalRoutes(app, {
    diagnosisSuggestionService: { hasLlm: () => false, suggest: async () => ({ suggestions: [] }) },
    templateService,
    encounterService,
    noteGeneratorService,
    noteValidationService
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, body, headers = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'undefined' ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  return { server, call };
}

async function main() {
  const restClient = createFakeSupabaseRestClient();
  seedInstitutionalTemplates(restClient);
  const llm = createFakeLlm();
  const { server, call } = await startTestServer({ restClient, llm });
  let passed = 0;
  const check = (name, fn) => Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ok ${passed}. ${name}`);
  });

  try {
    // 1. Normaliza plantilla desde strings.
    const fromStrings = await call('POST', '/api/clinical/templates', {
      name: 'Control de hipertensión',
      specialty: 'medicina_general',
      description: 'Plantilla para controles',
      sections: ['Identificación', 'Motivo de consulta', 'Impresión Diagnóstica']
    });
    await check('normaliza plantilla desde strings', () => {
      assert.strictEqual(fromStrings.status, 201);
      const sections = fromStrings.body.template.sections;
      assert.strictEqual(sections.length, 3);
      assert.deepStrictEqual(sections.map((s) => s.key), ['identificacion', 'motivo_de_consulta', 'impresion_diagnostica']);
      sections.forEach((section, index) => {
        assert.strictEqual(section.order, index + 1);
        assert.strictEqual(typeof section.instruction, 'string');
        assert.ok(section.instruction.length > 10);
        assert.strictEqual(section.required, false);
      });
    });

    // 2. Normaliza plantilla desde objetos.
    const fromObjects = await call('POST', '/api/clinical/templates', {
      name: 'Control de diabetes',
      specialty: 'Medicina General',
      sections: [
        { label: 'Identificación', order: 5 },
        { label: 'Motivo de consulta', order: 1, required: true, instruction: 'Resume el motivo principal.' }
      ]
    });
    await check('normaliza plantilla desde objetos (orden + specialty normalizada)', () => {
      assert.strictEqual(fromObjects.status, 201);
      const template = fromObjects.body.template;
      assert.strictEqual(template.specialty, 'medicina_general');
      assert.deepStrictEqual(template.sections.map((s) => s.key), ['motivo_de_consulta', 'identificacion']);
      assert.strictEqual(template.sections[0].required, true);
      assert.strictEqual(template.sections[0].instruction, 'Resume el motivo principal.');
      assert.strictEqual(template.sections[0].order, 1);
      assert.strictEqual(template.sections[1].order, 2);
    });

    // 3. Rechaza plantilla sin nombre.
    const noName = await call('POST', '/api/clinical/templates', {
      specialty: 'medicina_general',
      sections: ['A', 'B']
    });
    await check('rechaza plantilla sin nombre', () => {
      assert.strictEqual(noName.status, 400);
      assert.strictEqual(noName.body.error.code, 'TEMPLATE_INVALID');
    });

    // 4. Rechaza plantilla con menos de 2 secciones.
    const oneSection = await call('POST', '/api/clinical/templates', {
      name: 'Plantilla corta',
      specialty: 'medicina_general',
      sections: ['Única sección']
    });
    await check('rechaza plantilla con menos de 2 secciones', () => {
      assert.strictEqual(oneSection.status, 400);
      assert.strictEqual(oneSection.body.error.code, 'TEMPLATE_INVALID');
    });

    // 5. Rechaza keys duplicadas.
    const duplicated = await call('POST', '/api/clinical/templates', {
      name: 'Plantilla duplicada',
      specialty: 'medicina_general',
      sections: ['Motivo de consulta', 'Motivo de Consulta']
    });
    await check('rechaza keys duplicadas', () => {
      assert.strictEqual(duplicated.status, 400);
      assert.strictEqual(duplicated.body.error.code, 'TEMPLATE_INVALID');
      assert.match(duplicated.body.error.message, /duplicad/i);
    });

    // 6. Lista seeds institucionales.
    const listed = await call('GET', '/api/clinical/templates?specialty=medicina_general');
    await check('lista seeds institucionales', () => {
      assert.strictEqual(listed.status, 200);
      const institutional = listed.body.templates.filter((t) => t.scope === 'institutional');
      assert.strictEqual(institutional.length, 3);
      institutional.forEach((template) => {
        assert.strictEqual(template.is_default, true);
        assert.strictEqual(template.status, 'active');
        assert.strictEqual(template.sections_count, template.sections.length);
        assert.ok(template.sections_count >= 6);
      });
    });

    // 7. Crea plantilla personal (visible para su dueño, invisible para otros).
    await check('crea plantilla personal con owner correcto', async () => {
      const template = fromStrings.body.template;
      assert.strictEqual(template.scope, 'personal');
      assert.strictEqual(template.owner_user_id, DOCTOR_ID);
      const asOther = await call('GET', `/api/clinical/templates/${template.id}`, undefined, { 'x-test-user': OTHER_DOCTOR_ID });
      assert.strictEqual(asOther.status, 404);
      assert.strictEqual(asOther.body.error.code, 'TEMPLATE_NOT_FOUND');
    });

    // 8. Crea encounter con template_id.
    const initialTemplateId = INSTITUTIONAL_SEEDS[0].id;
    const encounterCreated = await call('POST', '/api/clinical/encounters', {
      patient_id: null,
      consultation_type: 'presencial',
      template_id: initialTemplateId
    });
    const encounterId = encounterCreated.body?.encounter_id;
    await check('crea encounter con template_id', () => {
      assert.strictEqual(encounterCreated.status, 201);
      assert.ok(encounterId);
      assert.strictEqual(encounterCreated.body.status, 'created');
      assert.strictEqual(encounterCreated.body.template.template_id, initialTemplateId);
    });

    // 9. Inicia consultas sin un paso de consentimiento.
    const secondEncounter = await call('POST', '/api/clinical/encounters', {
      consultation_type: 'presencial',
      template_id: initialTemplateId
    });
    await check('inicia otra consulta sin consentimiento', () => {
      assert.strictEqual(secondEncounter.status, 201);
      assert.ok(secondEncounter.body.encounter_id);
    });

    // 10. Guarda template_snapshot al crear encounter.
    const storedEncounter = await call('GET', `/api/clinical/encounters/${encounterId}`);
    const snapshotSections = storedEncounter.body.encounter.template_snapshot.sections;
    await check('guarda template_snapshot dentro del encounter', () => {
      assert.strictEqual(storedEncounter.status, 200);
      assert.strictEqual(snapshotSections.length, 7);
      assert.deepStrictEqual(snapshotSections.map((s) => s.order), [1, 2, 3, 4, 5, 6, 7]);
      snapshotSections.forEach((section) => {
        assert.ok(section.key && section.label && section.instruction);
      });
    });

    // 11. Guarda transcript.
    const transcriptSaved = await call('POST', `/api/clinical/encounters/${encounterId}/transcript`, {
      transcript: CLINICAL_TRANSCRIPT
    });
    await check('guarda transcript y pasa a transcript_ready', () => {
      assert.strictEqual(transcriptSaved.status, 200);
      assert.strictEqual(transcriptSaved.body.status, 'transcript_ready');
      assert.strictEqual(transcriptSaved.body.transcript_length, CLINICAL_TRANSCRIPT.length);
    });

    // 12. Rechaza transcript vacío.
    const emptyTranscript = await call('POST', `/api/clinical/encounters/${encounterId}/transcript`, {
      transcript: '   '
    });
    await check('rechaza transcript vacío', () => {
      assert.strictEqual(emptyTranscript.status, 400);
      assert.strictEqual(emptyTranscript.body.error.code, 'TRANSCRIPT_REQUIRED');
    });

    // 13. Generate-note usa template_snapshot (no la plantilla actual).
    // Editamos la plantilla institucional en el store para simular cambios
    // posteriores; la nota debe seguir el snapshot original.
    const templateRow = restClient.tables.clinical_templates.find((row) => row.id === initialTemplateId);
    const originalSections = templateRow.sections;
    templateRow.sections = ClinicalTemplateService.normalizeSections(['Sección nueva A', 'Sección nueva B']);
    let promptTemplateKeys = null;
    llm.state.transform = (note, request) => {
      promptTemplateKeys = request.template.sections.map((s) => s.key);
      return note;
    };
    const generated = await call('POST', `/api/clinical/encounters/${encounterId}/generate-note`, {});
    templateRow.sections = originalSections;
    await check('generate-note usa template_snapshot', () => {
      assert.strictEqual(generated.status, 200);
      assert.strictEqual(generated.body.status, 'note_generated');
      assert.deepStrictEqual(promptTemplateKeys, snapshotSections.map((s) => s.key));
      assert.deepStrictEqual(
        generated.body.note_json.sections.map((s) => s.key),
        snapshotSections.map((s) => s.key)
      );
    });

    // 14. note_json.sections conserva el orden aunque el LLM lo desordene.
    llm.state.transform = (note) => ({ ...note, sections: note.sections.slice().reverse() });
    const reordered = await call('POST', `/api/clinical/encounters/${encounterId}/generate-note`, {});
    await check('note_json conserva el orden de la plantilla', () => {
      assert.strictEqual(reordered.status, 200);
      assert.deepStrictEqual(
        reordered.body.note_json.sections.map((s) => s.key),
        snapshotSections.map((s) => s.key)
      );
    });

    // 15. Repara una sección omitida por el LLM.
    llm.state.transform = (note) => ({ ...note, sections: note.sections.filter((s) => s.key !== 'examen_fisico_dirigido') });
    const repaired = await call('POST', `/api/clinical/encounters/${encounterId}/generate-note`, {});
    await check('repara sección omitida por el LLM', () => {
      assert.strictEqual(repaired.status, 200);
      const section = repaired.body.note_json.sections.find((s) => s.key === 'examen_fisico_dirigido');
      assert.ok(section, 'la sección omitida debe existir en la nota');
      assert.strictEqual(section.content, 'No mencionado en la consulta.');
      assert.strictEqual(section.confidence, 0);
      assert.strictEqual(section.evidence, '');
      assert.ok(repaired.body.note_json.warnings.some((w) => /omiti/i.test(w)));
    });

    // 16. Ignora sección extra generada por el LLM.
    llm.state.transform = (note) => ({
      ...note,
      sections: [...note.sections, { key: 'seccion_inventada', label: 'Inventada', content: 'X', confidence: 1, evidence: '' }]
    });
    const withExtra = await call('POST', `/api/clinical/encounters/${encounterId}/generate-note`, {});
    await check('ignora sección extra generada por el LLM', () => {
      assert.strictEqual(withExtra.status, 200);
      assert.strictEqual(withExtra.body.note_json.sections.length, snapshotSections.length);
      assert.ok(!withExtra.body.note_json.sections.some((s) => s.key === 'seccion_inventada'));
    });

    // 17. Guarda nota editada sin llamar al LLM.
    const callsBeforeEdit = llm.state.calls;
    const editedNote = {
      ...withExtra.body.note_json,
      sections: withExtra.body.note_json.sections.map((section) => (
        section.key === 'motivo_de_consulta'
          ? { ...section, content: 'Cefalea de 3 días de evolución (editado por el médico).' }
          : section
      ))
    };
    const savedNote = await call('PUT', `/api/clinical/encounters/${encounterId}/note`, { note_json: editedNote });
    await check('guarda nota editada sin llamar al LLM', () => {
      assert.strictEqual(savedNote.status, 200);
      assert.strictEqual(savedNote.body.status, 'completed');
      assert.strictEqual(llm.state.calls, callsBeforeEdit);
      const motivo = savedNote.body.note_json.sections.find((s) => s.key === 'motivo_de_consulta');
      assert.match(motivo.content, /editado por el médico/);
    });

    // Extras de seguridad del contrato.
    const foreignEncounter = await call('GET', `/api/clinical/encounters/${encounterId}`, undefined, { 'x-test-user': OTHER_DOCTOR_ID });
    await check('extra: encounter ajeno responde 404', () => {
      assert.strictEqual(foreignEncounter.status, 404);
      assert.strictEqual(foreignEncounter.body.error.code, 'ENCOUNTER_NOT_FOUND');
    });

    const invalidNote = await call('PUT', `/api/clinical/encounters/${encounterId}/note`, {
      note_json: { summary: 'x', sections: [{ key: 'no_existe', content: 'y' }] }
    });
    await check('extra: nota editada con key ajena responde NOTE_JSON_INVALID', () => {
      assert.strictEqual(invalidNote.status, 400);
      assert.strictEqual(invalidNote.body.error.code, 'NOTE_JSON_INVALID');
    });

    console.log(`\n[verify-clinical-workflow] ${passed} verificaciones OK`);
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(`\n[verify-clinical-workflow] FALLÓ: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});
