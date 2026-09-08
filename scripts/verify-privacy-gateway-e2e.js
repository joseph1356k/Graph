// Verifica el escudo de privacidad POR EL CABLE: rutas reales de Express +
// Supabase falso + LLMProvider REAL apuntado por env a un proveedor HTTP falso
// que hace assert sobre el cuerpo que recibe (lo que habría llegado a OpenAI)
// y responde con marcadores. Lo que se comprueba es lo que promete el claim:
//   - ningún identificador del paciente sale en el cuerpo de la petición;
//   - la nota persistida, el espejo en el historial y los matches para SAP
//     vuelven con los datos reales y sin marcadores;
//   - el ledger anota la protección de cada envío, sin valores;
//   - dos consultas con el mismo nombre no se mezclan;
//   - el modo shadow manda el original; enforce falla cerrado.
//   node scripts/verify-privacy-gateway-e2e.js
const assert = require('assert');
const express = require('express');
const http = require('http');

const createFakeSupabase = require('./lib/fakeSupabase');
const createFakeChatCompletions = require('./lib/fakeChatCompletions');
const ClinicalNotePromptBuilder = require('../src/application/use-cases/ClinicalNotePromptBuilder');

// El generador de nota ya no manda un JSON plano: la plantilla y la
// transcripción viajan delimitadas (<plantilla>, <transcripcion>).
function noteRequestOf(body) {
  const content = body.messages[body.messages.length - 1].content;
  return {
    template: JSON.parse(ClinicalNotePromptBuilder.extractTagged(content, 'plantilla')),
    transcript: ClinicalNotePromptBuilder.extractTagged(content, 'transcripcion')
  };
}

const DOCTOR_ID = '7b8a4c8e-1d2f-4a5b-9c3d-2e1f0a9b8c7d';
const ORG_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const PATIENT_A = 'b1b2c3d4-0000-4000-8000-00000000000a';
const PATIENT_B = 'b1b2c3d4-0000-4000-8000-00000000000b';
const TEMPLATE_ID = 'e3b0c442-98fc-4c14-9af4-a11e00000001';

const TRANSCRIPT_A = 'Soy el doctor Carlos Ruiz. El paciente se llama Juan David Pérez, cédula 23-45-67-75-43, celular 3104567890, correo juan.perez@gmail.com, vive en la carrera 45 número 23-10 barrio Laureles. Bueno, don Juan, siga. Refiere cefalea de tres días que empeora con pantallas. Plaquetas 250.000, tensión 120/80.';
const TRANSCRIPT_B = 'La paciente se llama Juan David Pérez, cédula 1111111111. Refiere tos de dos semanas.';

const FORBIDDEN = ['juan david', 'perez', 'pérez', 'juan.perez@gmail.com', 'laureles', 'ana torres'];
const FORBIDDEN_DIGITS = ['2345677543', '3104567890', '1111111111'];

function normalize(text) {
  return `${text}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Afirma que un cuerpo saliente no lleva ningún identificador conocido. */
function assertNoIdentifiers(raw, label) {
  const flat = normalize(raw);
  for (const word of FORBIDDEN) {
    assert.ok(!flat.includes(word), `${label}: salió «${word}» hacia el proveedor`);
  }
  const digitsOnly = raw.replace(/[.\s-]/g, '');
  for (const digits of FORBIDDEN_DIGITS) {
    assert.ok(!digitsOnly.includes(digits), `${label}: salieron los dígitos ${digits} hacia el proveedor`);
  }
}

function firstToken(text, type, after = '') {
  const { findTokens } = require('../src/domain/privacy/tokens');
  const source = after ? text.slice(text.indexOf(after)) : text;
  const token = findTokens(source).find((t) => t.type === type);
  assert.ok(token, `no hay marcador ${type} en el texto saliente`);
  return token.raw;
}

async function main() {
  const provider = createFakeChatCompletions();
  const baseUrl = await provider.start();

  // El LLMProvider REAL, apuntado al proveedor falso: así se prueba
  // postChatCompletions y no un doble de prueba.
  process.env.GRAPH_LLM_PROVIDER = 'openai';
  process.env.GRAPH_LLM_API_KEY = 'test-key';
  process.env.GRAPH_LLM_BASE_URL = baseUrl;
  process.env.GRAPH_LLM_MODEL = 'fake-model';
  process.env.PRIVACY_SHIELD_MODE = 'enforce';
  delete process.env.PRIVACY_SHIELD_MODE_ASISTENTE;

  const LLMProvider = require('../src/infrastructure/LLMProvider');
  const AiUsageRecorder = require('../src/application/use-cases/AiUsageRecorder');
  const PrivacyShieldService = require('../src/application/use-cases/PrivacyShieldService');
  const SupabasePatientSeedRepository = require('../src/infrastructure/repositories/SupabasePatientSeedRepository');
  const SupabaseClinicalTemplateRepository = require('../src/infrastructure/repositories/SupabaseClinicalTemplateRepository');
  const SupabaseClinicalEncounterRepository = require('../src/infrastructure/repositories/SupabaseClinicalEncounterRepository');
  const ClinicalTemplateService = require('../src/application/use-cases/ClinicalTemplateService');
  const ClinicalEncounterService = require('../src/application/use-cases/ClinicalEncounterService');
  const ClinicalNotePromptBuilder = require('../src/application/use-cases/ClinicalNotePromptBuilder');
  const ClinicalNoteValidationService = require('../src/application/use-cases/ClinicalNoteValidationService');
  const ClinicalNoteGeneratorService = require('../src/application/use-cases/ClinicalNoteGeneratorService');
  const ConsultationMirrorService = require('../src/application/use-cases/ConsultationMirrorService');
  const ClinicalAssistantService = require('../src/application/use-cases/ClinicalAssistantService');
  const ClinicalAssistantPromptBuilder = require('../src/application/use-cases/ClinicalAssistantPromptBuilder');
  const ClinicalAssistantValidationService = require('../src/application/use-cases/ClinicalAssistantValidationService');
  const NoteFieldMatcher = require('../src/application/use-cases/NoteFieldMatcher');
  const DynamicValueResolver = require('../src/application/use-cases/DynamicValueResolver');
  const registerClinicalRoutes = require('../web/api/registerClinicalRoutes');
  const registerPublicApiRoutes = require('../web/api/registerPublicApiRoutes');
  const { findTokens } = require('../src/domain/privacy/tokens');

  const rest = createFakeSupabase();
  const now = new Date().toISOString();
  rest.table('profiles').push({ id: DOCTOR_ID, organization_id: ORG_ID, full_name: 'Carlos Ruiz', email: 'doc@test.local', role: 'medico' });
  rest.table('patients').push({ id: PATIENT_A, organization_id: ORG_ID, nombre: 'Juan David Pérez Gómez', documento: 'CC 2345677543', telefono: '3104567890' });
  rest.table('patients').push({ id: PATIENT_B, organization_id: ORG_ID, nombre: 'Juan David Pérez Gómez', documento: 'CC 1111111111', telefono: '' });
  rest.table('clinical_templates').push({
    id: TEMPLATE_ID, owner_id: null, name: 'Consulta inicial · Medicina general', description: 'Plantilla de prueba',
    specialty_code: 'medicina_general', specialty_name: 'Medicina general', scope: 'institutional', is_default: true, status: 'active',
    sections: ClinicalTemplateService.normalizeSections([
      { label: 'Identificación del paciente', order: 1, instruction: 'Escribe dos líneas: «Nombre: …» y «Documento: …».' },
      { label: 'Motivo de consulta', order: 2, required: true },
      { label: 'Plan', order: 3, required: true }
    ]),
    created_at: now, updated_at: now
  });

  const usageEvents = [];
  const usageRecorder = new AiUsageRecorder({ store: { append: async (event) => { usageEvents.push(event); return { ok: true }; } } });
  LLMProvider.setUsageRecorder(usageRecorder);
  const shield = new PrivacyShieldService({ seedRepository: new SupabasePatientSeedRepository(rest) });
  LLMProvider.setPrivacyShield(shield);
  const llm = new LLMProvider();
  assert.strictEqual(llm.provider, 'openai');

  const templateRepository = new SupabaseClinicalTemplateRepository(rest);
  const encounterRepository = new SupabaseClinicalEncounterRepository(rest);
  const templateService = new ClinicalTemplateService(templateRepository);
  const encounterService = new ClinicalEncounterService(encounterRepository, templateService);
  const noteValidationService = new ClinicalNoteValidationService();
  const noteGeneratorService = new ClinicalNoteGeneratorService({
    encounterService, encounterRepository, llmProvider: llm,
    promptBuilder: new ClinicalNotePromptBuilder(), validationService: noteValidationService,
    consultationMirrorService: new ConsultationMirrorService(rest)
  });
  const assistantService = new ClinicalAssistantService({
    encounterService, llmProvider: llm, promptBuilder: new ClinicalAssistantPromptBuilder(),
    validationService: new ClinicalAssistantValidationService(), noteValidationService
  });
  const noteFieldMatcher = new NoteFieldMatcher(llm);
  const dynamicValueResolver = new DynamicValueResolver(llm);

  const runtimeCalls = [];
  const callMiracleRuntime = async (req, targetPath, init = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : (init.body || {});
    runtimeCalls.push({ targetPath, body });
    assertNoIdentifiers(JSON.stringify(body), 'runtime Python');
    return {
      statusCode: 200,
      body: {
        resolved_note_content: `${body.note_content}\nORGANIZADO: ${body.segment.transcript}`,
        backend_status: 'ok',
        usage: { provider: 'openai', model: 'fake-python', input_tokens: 20, output_tokens: 10 }
      }
    };
  };

  const app = express();
  app.use(express.json({ limit: '16mb' }));
  app.use((req, res, next) => {
    req.clinicalUser = { id: DOCTOR_ID, email: 'doc@test.local', role: 'authenticated', canManageInstitutional: false };
    req.apiClient = { label: 'test' };
    next();
  });
  registerClinicalRoutes(app, {
    templateService, encounterService, noteGeneratorService, noteValidationService, assistantService, privacyShield: shield
  });
  registerPublicApiRoutes(app, { callMiracleRuntime, noteFieldMatcher, usageRecorder, privacyShield: shield });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const api = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const response = await fetch(`${api}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };

  let passed = 0;
  const check = async (name, fn) => { await fn(); passed += 1; console.log(`  ok ${passed}. ${name}`); };

  try {
    // ---- 1. Generar nota: sale tapado, vuelve real, se persiste real -----------
    const created = await call('POST', '/api/clinical/encounters', { patient_id: PATIENT_A, consultation_type: 'presencial', template_id: TEMPLATE_ID });
    assert.strictEqual(created.status, 201);
    const encounterId = created.body.encounter_id;
    assert.strictEqual((await call('POST', `/api/clinical/encounters/${encounterId}/transcript`, { transcript: TRANSCRIPT_A })).status, 200);

    provider.state.handler = (body, raw) => {
      assertNoIdentifiers(raw, 'generate-note');
      const request = noteRequestOf(body);
      assert.ok(body.messages[0].content.includes('PRIVACIDAD'), 'la regla de sistema viaja con los marcadores');
      const transcript = request.transcript;
      const nombre = firstToken(transcript, 'PACIENTE_NOMBRE');
      const documento = firstToken(transcript, 'DOCUMENTO');
      const telefono = firstToken(transcript, 'TELEFONO');
      const donJuan = firstToken(transcript, 'PACIENTE_NOMBRE', 'don ');
      const sections = request.template.sections.map((section) => {
        if (section.key === 'identificacion_del_paciente') {
          return { key: section.key, label: section.label, content: `Nombre: ${nombre}\nDocumento: ${documento}`, confidence: 0.95, evidence: `se llama ${nombre}` };
        }
        if (section.key === 'motivo_de_consulta') {
          return { key: section.key, label: section.label, content: `${donJuan} consulta por cefalea de tres días.`, confidence: 0.9, evidence: 'cefalea de tres días' };
        }
        return { key: section.key, label: section.label, content: `Control en 8 días; avisar al ${telefono}.`, confidence: 0.8, evidence: '' };
      });
      return { summary: `Consulta de ${nombre} por cefalea.`, sections, warnings: [], missing_required_sections: [] };
    };
    const generated = await call('POST', `/api/clinical/encounters/${encounterId}/generate-note`);
    await check('generate-note: el proveedor recibe marcadores y la regla, nunca el nombre ni la cédula', () => {
      assert.strictEqual(generated.status, 200, JSON.stringify(generated.body));
      assert.ok(provider.lastRequest(), 'hubo llamada al proveedor');
    });
    await check('la nota vuelve con los datos reales y sin marcadores', () => {
      const note = generated.body.note_json;
      const identidad = note.sections.find((s) => s.key === 'identificacion_del_paciente');
      assert.strictEqual(identidad.content, 'Nombre: Juan David Pérez Gómez\nDocumento: CC 2345677543');
      assert.strictEqual(identidad.evidence, 'se llama Juan David Pérez');
      const motivo = note.sections.find((s) => s.key === 'motivo_de_consulta');
      assert.strictEqual(motivo.content, 'Juan consulta por cefalea de tres días.');
      const plan = note.sections.find((s) => s.key === 'plan');
      assert.strictEqual(plan.content, 'Control en 8 días; avisar al 3104567890.');
      // El resumen usa el alias tal como se dictó («Juan David Pérez»); solo la
      // casilla de identificación se lleva a la forma registrada completa.
      assert.strictEqual(note.summary, 'Consulta de Juan David Pérez por cefalea.');
      assert.strictEqual(findTokens(JSON.stringify(note)).length, 0);
    });
    await check('la respuesta trae `privacy` con modo, conteos y resultado (sin valores)', () => {
      const privacy = generated.body.privacy;
      assert.strictEqual(privacy.mode, 'enforce');
      assert.strictEqual(privacy.shielded, true);
      assert.ok(privacy.tokens.PACIENTE_NOMBRE >= 2 && privacy.tokens.DOCUMENTO >= 1 && privacy.tokens.TELEFONO >= 1 && privacy.tokens.CORREO >= 1 && privacy.tokens.DIRECCION >= 1, JSON.stringify(privacy));
      assert.strictEqual(privacy.leak_scan, 'ok');
      assert.strictEqual(privacy.rehydration, 'complete');
      assert.strictEqual(privacy.posthoc_leak, false);
      assert.ok(!JSON.stringify(privacy).includes('Juan'));
    });
    await check('el taller y el historial persisten la nota real (note_json, note_json_ai, consultations)', () => {
      const row = rest.table('clinical_encounters').find((r) => r.id === encounterId);
      assert.strictEqual(findTokens(JSON.stringify(row.note_json)).length, 0);
      assert.strictEqual(findTokens(JSON.stringify(row.note_json_ai)).length, 0);
      assert.ok(JSON.stringify(row.note_json).includes('Juan David Pérez Gómez'));
      assert.strictEqual(row.transcript, TRANSCRIPT_A, 'la transcripción no se toca');
      const mirror = rest.table('consultations').find((r) => r.id === encounterId);
      assert.ok(mirror, 'el espejo publicó la fila');
      assert.ok(JSON.stringify(mirror.note).includes('CC 2345677543'));
      assert.strictEqual(findTokens(JSON.stringify(mirror)).length, 0);
    });
    await check('el ledger anota la protección del envío, sin ningún valor', () => {
      const event = usageEvents.find((e) => e.feature === 'note_generation');
      assert.ok(event, 'hay evento de consumo');
      assert.strictEqual(event.metadata.privacyMode, 'enforce');
      assert.ok(/PACIENTE_NOMBRE:\d+/.test(event.metadata.privacyTokens));
      assert.strictEqual(event.metadata.privacyLeakScan, 'ok');
      assert.strictEqual(event.metadata.privacyRehydration, 'complete');
      assert.strictEqual(event.metadata.privacyPosthoc, false);
      assert.strictEqual(event.sessionId, encounterId);
      assert.ok(!JSON.stringify(event).includes('Juan') && !JSON.stringify(event).includes('2345677543'));
    });

    // ---- 2. Asistente: mensaje e historial con datos reales ---------------------
    provider.state.handler = (body, raw) => {
      assertNoIdentifiers(raw, 'assistant chat');
      const user = JSON.parse(body.messages[body.messages.length - 1].content);
      const nombre = firstToken(user.pregunta, 'PACIENTE_NOMBRE');
      const documento = firstToken(user.transcripcion, 'DOCUMENTO');
      return `Para ${nombre} (documento ${documento}) sugiero acetaminofén y control.`;
    };
    const chat = await call('POST', '/api/clinical/assistant/chat', {
      message: '¿Qué le mando a Juan David Pérez para la cefalea?',
      encounter_id: encounterId,
      history: [{ role: 'user', content: 'El paciente Juan David Pérez tiene 40 años' }, { role: 'assistant', content: 'Entendido.' }]
    });
    await check('asistente: la pregunta y el historial salen tapados y la respuesta vuelve con el nombre real', () => {
      assert.strictEqual(chat.status, 200, JSON.stringify(chat.body));
      assert.ok(chat.body.answer.includes('Juan David Pérez'), chat.body.answer);
      assert.ok(chat.body.answer.includes('23-45-67-75-43') || chat.body.answer.includes('2345677543'), chat.body.answer);
      assert.strictEqual(findTokens(chat.body.answer).length, 0);
      assert.strictEqual(chat.body.privacy.shielded, true);
    });

    // ---- 3. Sugerencias diagnósticas: la evidencia literal sigue validando ------
    provider.state.handler = (body, raw) => {
      assertNoIdentifiers(raw, 'diagnostic-suggestions');
      const user = JSON.parse(body.messages[body.messages.length - 1].content);
      const donJuan = firstToken(user.transcripcion, 'PACIENTE_NOMBRE', 'don ');
      return {
        suggestions: [{
          title: 'Cefalea tensional probable', type: 'differential_or_working_impression', confidence: 0.7,
          rationale: 'Cefalea de tres días que empeora con pantallas.',
          supporting_evidence: ['cefalea de tres días', `don ${donJuan}, siga`],
          against_or_uncertain: [], red_flags_to_check: [], suggested_next_questions: []
        }]
      };
    };
    const suggestions = await call('POST', `/api/clinical/encounters/${encounterId}/diagnostic-suggestions`);
    await check('sugerencias: la evidencia citada con marcador se restaura y pasa la validación literal', () => {
      assert.strictEqual(suggestions.status, 200, JSON.stringify(suggestions.body));
      assert.strictEqual(suggestions.body.suggestions.length, 1, JSON.stringify(suggestions.body));
      assert.ok(suggestions.body.suggestions[0].supporting_evidence.includes('don Juan, siga'));
    });

    // ---- 4. Operations: pipeline note + autofill con consultation_id ------------
    rest.table('consultations').find((r) => r.id === encounterId).paciente_nombre = 'Juan David Pérez Gómez';
    rest.table('consultations').find((r) => r.id === encounterId).paciente_documento = '2345677543';
    rest.table('consultations').find((r) => r.id === encounterId).patient_id = PATIENT_A;
    const renderedNote = 'IDENTIFICACIÓN DEL PACIENTE:\nNombre: Juan David Pérez Gómez\nDocumento: CC 2345677543\n\nMOTIVO DE CONSULTA:\nCefalea de tres días.\n\nPLAN:\nControl en 8 días.';
    provider.state.handler = (body, raw) => {
      assertNoIdentifiers(raw, 'autofill');
      const user = JSON.parse(body.messages[body.messages.length - 1].content);
      const nombre = firstToken(user.noteContent, 'PACIENTE_NOMBRE');
      const documento = firstToken(user.noteContent, 'DOCUMENTO');
      assert.ok(user.fields.every((f) => f.selector.startsWith('sap:')), 'los selectores no se tocan');
      return {
        matches: [
          { stepOrder: 1, value: nombre, confidence: 0.9, evidence: `Nombre: ${nombre}` },
          { stepOrder: 2, value: documento, confidence: 0.9, evidence: '' },
          { stepOrder: 3, value: '[PACIENTE_NOMBRE_9]', confidence: 0.9, evidence: '' },
          { stepOrder: 4, value: 'Cefalea de tres días.', confidence: 0.9, evidence: '' }
        ],
        readyToSubmit: true, submitReason: ''
      };
    };
    const pipeline = await call('POST', '/api/v1/pipeline', {
      session_id: 'ses-1', transcript: 'Paciente Juan David Pérez Gómez, cédula 2345677543, refiere cefalea.',
      stages: { transcription: false, note: true, autofill: true },
      note: { title: 'Historia clínica', content: renderedNote },
      consultation_id: encounterId,
      fields: [
        { stepOrder: 1, actionType: 'input', label: 'Nombre del paciente', selector: 'sap:wnd[0]/usr/txtNOMBRE', controlType: 'GuiTextField', currentValue: 'Ana Torres' },
        { stepOrder: 2, actionType: 'input', label: 'Nº documento', selector: 'sap:wnd[0]/usr/txtDOC', controlType: 'GuiTextField', currentValue: '' },
        { stepOrder: 3, actionType: 'input', label: 'Acompañante', selector: 'sap:wnd[0]/usr/txtACOMP', controlType: 'GuiTextField', currentValue: '' },
        { stepOrder: 4, actionType: 'input', label: 'Motivo', selector: 'sap:wnd[0]/usr/txtMOTIVO', controlType: 'GuiTextField', currentValue: '' }
      ],
      page_url: 'sapgui://triage'
    });
    await check('pipeline: el runtime Python y el proveedor reciben la nota tapada (incluido «Ana Torres» del campo en pantalla)', () => {
      assert.strictEqual(pipeline.status, 200, JSON.stringify(pipeline.body));
      assert.strictEqual(runtimeCalls.length, 1);
      assert.ok(runtimeCalls[0].body.note_content.includes('[PACIENTE_NOMBRE_'));
    });
    await check('pipeline: la nota organizada vuelve real y los matches para SAP traen valores reales; el marcador desconocido se descarta', () => {
      assert.ok(pipeline.body.note.content.includes('Juan David Pérez Gómez'), pipeline.body.note.content);
      assert.strictEqual(findTokens(pipeline.body.note.content).length, 0);
      const matches = pipeline.body.autofill.matches;
      assert.deepStrictEqual(matches.map((m) => [m.stepOrder, m.value]), [[1, 'Juan David Pérez Gómez'], [2, 'CC 2345677543'], [4, 'Cefalea de tres días.']]);
      assert.strictEqual(matches[0].evidence, 'Nombre: Juan David Pérez Gómez');
      assert.strictEqual(pipeline.body.autofill.ready_to_submit, false);
      assert.ok(/descartado/.test(pipeline.body.autofill.submit_reason), pipeline.body.autofill.submit_reason);
      assert.strictEqual(pipeline.body.autofill.privacy.shielded, true);
    });

    // ---- 5. Valores dinámicos del plan de workflow --------------------------------
    provider.state.handler = (body, raw) => {
      assertNoIdentifiers(raw, 'dynamic values');
      const user = JSON.parse(body.messages[body.messages.length - 1].content);
      const nombre = firstToken(user.context, 'PACIENTE_NOMBRE');
      const documento = firstToken(user.context, 'DOCUMENTO');
      assert.ok(!user.fields.some((f) => f.formatExample === '70103027'), 'el valor grabado de otra ejecución también sale tapado');
      return { values: [{ stepOrder: 1, value: nombre, confidence: 0.9, evidence: 'x' }, { stepOrder: 2, value: documento, confidence: 0.9, evidence: 'x' }, { stepOrder: 3, value: '[DOCUMENTO_7]', confidence: 0.9, evidence: 'x' }] };
    };
    const resolved = await dynamicValueResolver.resolve({
      context: renderedNote, consultationId: encounterId,
      steps: [
        { stepOrder: 1, label: 'Nombre del paciente', controlType: 'GuiTextField', actionType: 'input', value: 'Cristian Felipe' },
        { stepOrder: 2, label: 'Nº documento', controlType: 'GuiTextField', actionType: 'input', value: '70103027' },
        { stepOrder: 3, label: 'Otro', controlType: 'GuiTextField', actionType: 'input', value: '' }
      ]
    });
    await check('valores dinámicos: el plan recibe los valores reales y nunca un marcador', () => {
      assert.deepStrictEqual(resolved.values, { 1: 'Juan David Pérez Gómez', 2: 'CC 2345677543' });
    });

    // ---- 6. Aislamiento entre dos consultas con el mismo nombre ----------------
    const createdB = await call('POST', '/api/clinical/encounters', { patient_id: PATIENT_B, consultation_type: 'presencial', template_id: TEMPLATE_ID });
    const encounterB = createdB.body.encounter_id;
    await call('POST', `/api/clinical/encounters/${encounterB}/transcript`, { transcript: TRANSCRIPT_B });
    provider.state.handler = (body, raw) => {
      assertNoIdentifiers(raw, 'generate-note B');
      const request = noteRequestOf(body);
      const nombre = firstToken(request.transcript, 'PACIENTE_NOMBRE');
      const documento = firstToken(request.transcript, 'DOCUMENTO');
      return {
        summary: 'Tos.',
        sections: request.template.sections.map((section) => ({
          key: section.key, label: section.label, confidence: 0.9, evidence: '',
          content: section.key === 'identificacion_del_paciente' ? `Nombre: ${nombre}\nDocumento: ${documento}` : 'Tos de dos semanas.'
        })),
        warnings: [], missing_required_sections: []
      };
    };
    const generatedB = await call('POST', `/api/clinical/encounters/${encounterB}/generate-note`);
    await check('dos consultas con el mismo nombre: cada una rehidrata su propia cédula', () => {
      assert.strictEqual(generatedB.status, 200, JSON.stringify(generatedB.body));
      const identidad = generatedB.body.note_json.sections.find((s) => s.key === 'identificacion_del_paciente');
      assert.strictEqual(identidad.content, 'Nombre: Juan David Pérez Gómez\nDocumento: CC 1111111111');
    });

    // ---- 7. Shadow por funcionalidad: sale el original ---------------------------
    process.env.PRIVACY_SHIELD_MODE_ASISTENTE = 'shadow';
    provider.state.handler = (body, raw) => {
      assert.ok(normalize(raw).includes('juan david'), 'en shadow el original sale tal cual');
      return 'Respuesta en sombra.';
    };
    const shadow = await call('POST', '/api/clinical/assistant/chat', { message: '¿Y a Juan David Pérez qué le mando?', encounter_id: encounterId });
    delete process.env.PRIVACY_SHIELD_MODE_ASISTENTE;
    await check('shadow: el proveedor recibe el original y el ledger lo dice', () => {
      assert.strictEqual(shadow.status, 200, JSON.stringify(shadow.body));
      assert.strictEqual(shadow.body.privacy.mode, 'shadow');
      assert.strictEqual(shadow.body.privacy.shielded, false);
      const event = usageEvents[usageEvents.length - 1];
      assert.strictEqual(event.metadata.privacyMode, 'shadow');
      assert.ok(/PACIENTE_NOMBRE:\d+/.test(event.metadata.privacyTokens), 'anota lo que habría tapado');
    });

    // ---- 8. Enforce falla cerrado ------------------------------------------------
    const before = usageEvents.length;
    await check('enforce: streaming se rechaza sin llamar al proveedor ni facturar', async () => {
      await assert.rejects(() => llm.postChatCompletions({ model: 'x', messages: [{ role: 'user', content: 'hola' }], stream: true }), (e) => e.code === 'PRIVACY_SHIELD_FAILED');
      assert.strictEqual(usageEvents.length, before);
    });
    const originalSeeds = shield.seedsForScope.bind(shield);
    shield.seedsForScope = async () => { throw new Error('base caída'); };
    const failed = await call('POST', `/api/clinical/encounters/${encounterId}/generate-note`);
    shield.seedsForScope = originalSeeds;
    await check('enforce: si el escudo no puede correr, la nota no se genera y la ruta responde 503 PRIVACY_SHIELD_FAILED', () => {
      assert.strictEqual(failed.status, 503, JSON.stringify(failed.body));
      assert.strictEqual(failed.body.error.code, 'PRIVACY_SHIELD_FAILED');
    });

    // ---- 9. Marcadores del cliente ------------------------------------------------
    provider.state.handler = () => 'Sobre [PACIENTE_NOMBRE_1] y [TELEFONO_1] y [CORREO_1].';
    const opaque = await call('POST', '/api/clinical/assistant/chat', { message: 'Dime quién es [PACIENTE_NOMBRE_1] y su [TELEFONO_1] y [CORREO_1]' });
    await check('chat general: un marcador que manda el cliente no se convierte en el dato de nadie', () => {
      assert.strictEqual(opaque.status, 200, JSON.stringify(opaque.body));
      assert.strictEqual(opaque.body.answer, 'Sobre [PACIENTE_NOMBRE_1] y [TELEFONO_1] y [CORREO_1].');
      assert.strictEqual(opaque.body.privacy.rehydration, 'incomplete');
    });

    // ---- 10. GET privacy -----------------------------------------------------------
    const { toDatabaseRow } = require('../src/domain/usage/UsageEvent');
    usageEvents.filter((e) => e.sessionId === encounterId).forEach((e, index) => {
      rest.table('ai_usage_events').push({ id: `evt-${index}`, ...toDatabaseRow(e) });
    });
    const PrivacyLedgerReader = require('../src/infrastructure/privacy/PrivacyLedgerReader');
    const app2 = express();
    app2.use(express.json());
    app2.use((req, res, next) => { req.clinicalUser = { id: DOCTOR_ID, email: 'doc@test.local', role: 'authenticated' }; next(); });
    registerClinicalRoutes(app2, {
      templateService, encounterService, noteGeneratorService, noteValidationService, assistantService,
      privacyShield: shield, privacyLedger: new PrivacyLedgerReader(rest)
    });
    const server2 = http.createServer(app2);
    await new Promise((resolve) => server2.listen(0, '127.0.0.1', resolve));
    const privacyView = await fetch(`http://127.0.0.1:${server2.address().port}/api/clinical/encounters/${encounterId}/privacy`).then((r) => r.json());
    server2.close();
    await check('GET /privacy: el médico ve cada envío con su protección, sin valores', () => {
      assert.strictEqual(privacyView.encounter_id, encounterId);
      assert.ok(privacyView.events.length >= 3, JSON.stringify(privacyView));
      const generation = privacyView.events.find((e) => e.feature === 'note_generation');
      assert.strictEqual(generation.privacy.mode, 'enforce');
      assert.ok(generation.privacy.tokens.PACIENTE_NOMBRE >= 1);
      assert.ok(!JSON.stringify(privacyView).includes('Juan'));
    });

    console.log(`\n✅ Gateway de privacidad por el cable: ${passed} comprobaciones OK.`);
  } finally {
    server.close();
    await provider.close();
  }
}

main().catch((error) => {
  console.error(`\n❌ ${error.stack || error.message}`);
  process.exit(1);
});
