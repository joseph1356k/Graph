const crypto = require('crypto');
const { isClinicalError } = require('../../src/application/use-cases/ClinicalErrors');

const MAX_NOTE_LENGTH = 20000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Clinical identity comes from requireClinicalAuth (Supabase Bearer token),
// exposed as req.clinicalUser — kept separate from the local/api auth (req.user)
// so the two auth surfaces never mix. Non-uuid ids (local dev) get a stable
// derived uuid so ownership still works in Postgres.
function stableUuidFromString(value) {
  const hash = crypto.createHash('sha256').update(`miracle-clinical-identity:${value}`).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32)
  ].join('-');
}

function resolveDoctorId(req) {
  const raw = `${req.clinicalUser?.id || ''}`.trim();
  if (!raw) {
    return null;
  }
  return UUID_PATTERN.test(raw) ? raw.toLowerCase() : stableUuidFromString(raw);
}

function canManageInstitutional(req) {
  return Boolean(req.clinicalUser?.canManageInstitutional);
}

function templateResponse(template) {
  return {
    id: template.id,
    name: template.name,
    specialty: template.specialty,
    description: template.description,
    owner_user_id: template.owner_user_id,
    scope: template.scope,
    is_default: template.is_default,
    status: template.status,
    sections_count: template.sections.length,
    sections: template.sections,
    created_at: template.created_at,
    updated_at: template.updated_at
  };
}

function encounterResponse(encounter) {
  return {
    id: encounter.id,
    patient_id: encounter.patient_id,
    doctor_id: encounter.doctor_id,
    consultation_type: encounter.consultation_type,
    consent: encounter.consent,
    template_id: encounter.template_id,
    template_snapshot: encounter.template_snapshot,
    status: encounter.status,
    transcript: encounter.transcript,
    note_json: encounter.note_json,
    created_at: encounter.created_at,
    updated_at: encounter.updated_at
  };
}

function respondClinicalError(res, error, logPrefix) {
  if (isClinicalError(error)) {
    return res.status(error.statusCode || 500).json({
      error: { code: error.code, message: error.message }
    });
  }
  console.error(`${logPrefix} ${error.message}`);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor.' }
  });
}

function registerClinicalRoutes(app, deps = {}) {
  const diagnosisSuggestionService = deps.diagnosisSuggestionService;
  const templateService = deps.templateService;
  const encounterService = deps.encounterService;
  const noteGeneratorService = deps.noteGeneratorService;
  const noteValidationService = deps.noteValidationService;

  if (!app || !diagnosisSuggestionService) {
    throw new Error('registerClinicalRoutes requires app and diagnosisSuggestionService');
  }

  // The template/encounter engine is optional as a group so legacy callers that
  // only exercise diagnosis-suggestions keep working; partial wiring is a bug.
  const engineDeps = [templateService, encounterService, noteGeneratorService, noteValidationService];
  const hasEngine = engineDeps.every(Boolean);
  if (!hasEngine && engineDeps.some(Boolean)) {
    throw new Error('registerClinicalRoutes requires templateService, encounterService, noteGeneratorService and noteValidationService together');
  }

  if (hasEngine) {
    registerClinicalEngineRoutes(app, {
      templateService,
      encounterService,
      noteGeneratorService,
      noteValidationService
    });
  }

  // ---- Sugerencias diagnósticas (endpoint previo, contrato sin cambios) ----

  app.post('/api/clinical/diagnosis-suggestions', async (req, res) => {
    const noteContent = typeof req.body?.noteContent === 'string'
      ? req.body.noteContent
      : '';

    if (!noteContent.trim()) {
      return res.status(400).json({ error: 'La nota clinica esta vacia.' });
    }
    if (noteContent.length > MAX_NOTE_LENGTH) {
      return res.status(413).json({ error: 'La nota clinica supera el limite de 20000 caracteres.' });
    }
    if (!diagnosisSuggestionService.hasLlm()) {
      return res.status(503).json({ error: 'El proveedor de IA no esta configurado.' });
    }

    try {
      const result = await diagnosisSuggestionService.suggest(noteContent);
      res.json(result);
    } catch (error) {
      console.error(`[Clinical Diagnosis Suggestions] Error: ${error.message}`);
      const status = error.code === 'LLM_NOT_CONFIGURED' ? 503 : 500;
      res.status(status).json({ error: status === 503 ? 'El proveedor de IA no esta configurado.' : 'No fue posible generar sugerencias diagnosticas.' });
    }
  });
}

function registerClinicalEngineRoutes(app, deps) {
  const { templateService, encounterService, noteGeneratorService, noteValidationService } = deps;

  // ---- Plantillas clínicas ----

  app.get('/api/clinical/templates', async (req, res) => {
    try {
      const templates = await templateService.list({
        specialty: `${req.query.specialty || ''}`,
        ownerUserId: resolveDoctorId(req)
      });
      res.json({ templates: templates.map(templateResponse) });
    } catch (error) {
      respondClinicalError(res, error, '[Clinical Templates] list:');
    }
  });

  app.post('/api/clinical/templates', async (req, res) => {
    try {
      const template = await templateService.create(req.body || {}, {
        ownerUserId: resolveDoctorId(req)
      });
      res.status(201).json({ template: templateResponse(template) });
    } catch (error) {
      respondClinicalError(res, error, '[Clinical Templates] create:');
    }
  });

  app.get('/api/clinical/templates/:templateId', async (req, res) => {
    try {
      const template = await templateService.getVisible(req.params.templateId, {
        ownerUserId: resolveDoctorId(req)
      });
      res.json({ template: templateResponse(template) });
    } catch (error) {
      respondClinicalError(res, error, '[Clinical Templates] get:');
    }
  });

  app.put('/api/clinical/templates/:templateId', async (req, res) => {
    try {
      const template = await templateService.update(req.params.templateId, req.body || {}, {
        ownerUserId: resolveDoctorId(req),
        canManageInstitutional: canManageInstitutional(req)
      });
      res.json({ template: templateResponse(template) });
    } catch (error) {
      respondClinicalError(res, error, '[Clinical Templates] update:');
    }
  });

  app.delete('/api/clinical/templates/:templateId', async (req, res) => {
    try {
      const template = await templateService.archive(req.params.templateId, {
        ownerUserId: resolveDoctorId(req),
        canManageInstitutional: canManageInstitutional(req)
      });
      res.json({ template: templateResponse(template) });
    } catch (error) {
      respondClinicalError(res, error, '[Clinical Templates] archive:');
    }
  });

  // ---- Encounters ----

  app.post('/api/clinical/encounters', async (req, res) => {
    try {
      const encounter = await encounterService.createEncounter(req.body || {}, {
        doctorId: resolveDoctorId(req)
      });
      res.status(201).json({
        encounter_id: encounter.id,
        status: encounter.status,
        template: encounter.template_snapshot
      });
    } catch (error) {
      respondClinicalError(res, error, '[Clinical Encounters] create:');
    }
  });

  app.get('/api/clinical/encounters/:encounterId', async (req, res) => {
    try {
      const encounter = await encounterService.getOwnedEncounter(req.params.encounterId, {
        doctorId: resolveDoctorId(req)
      });
      res.json({ encounter: encounterResponse(encounter) });
    } catch (error) {
      respondClinicalError(res, error, '[Clinical Encounters] get:');
    }
  });

  app.post('/api/clinical/encounters/:encounterId/transcript', async (req, res) => {
    try {
      const encounter = await encounterService.saveTranscript(
        req.params.encounterId,
        req.body?.transcript,
        { doctorId: resolveDoctorId(req) }
      );
      res.json({
        encounter_id: encounter.id,
        status: encounter.status,
        transcript_length: encounter.transcript.length
      });
    } catch (error) {
      respondClinicalError(res, error, '[Clinical Encounters] transcript:');
    }
  });

  app.post('/api/clinical/encounters/:encounterId/generate-note', async (req, res) => {
    try {
      const encounter = await noteGeneratorService.generate(req.params.encounterId, {
        doctorId: resolveDoctorId(req)
      });
      res.json({
        encounter_id: encounter.id,
        status: encounter.status,
        note_json: encounter.note_json
      });
    } catch (error) {
      respondClinicalError(res, error, '[Clinical Encounters] generate-note:');
    }
  });

  app.put('/api/clinical/encounters/:encounterId/note', async (req, res) => {
    try {
      const encounter = await encounterService.saveEditedNote(
        req.params.encounterId,
        req.body?.note_json,
        { doctorId: resolveDoctorId(req) },
        noteValidationService
      );
      res.json({
        encounter_id: encounter.id,
        status: encounter.status,
        note_json: encounter.note_json
      });
    } catch (error) {
      respondClinicalError(res, error, '[Clinical Encounters] save note:');
    }
  });
}

registerClinicalRoutes.MAX_NOTE_LENGTH = MAX_NOTE_LENGTH;
registerClinicalRoutes.resolveDoctorId = resolveDoctorId;
registerClinicalRoutes.stableUuidFromString = stableUuidFromString;

module.exports = registerClinicalRoutes;
