// El puente encounter → historial, ahora del lado servidor.
//
// Lo que se protege aquí es la regla que costó 24 consultas huérfanas: publicar
// no puede depender del navegador, y publicar tampoco puede pisar el trabajo
// del médico (estado, firma, paciente).
//   node scripts/verify-consultation-mirror.js
const assert = require('assert');

const ConsultationMirrorService = require('../src/application/use-cases/ConsultationMirrorService');
const ClinicalNoteGeneratorService = require('../src/application/use-cases/ClinicalNoteGeneratorService');

const ENCOUNTER = {
  id: '11111111-2222-4333-8444-555555555555',
  doctor_id: '67530d77-1739-4e30-ade1-e42485e8b5af',
  consultation_type: 'presencial',
  created_at: '2026-08-01T10:00:00.000Z',
  transcript: 'Paciente refiere dolor abdominal de tres días.',
  template_snapshot: {
    name: 'Histopatología · Macro / Micro / Diagnóstico',
    specialty: 'patologia',
    sections: [],
  },
};

const NOTE = {
  summary: 'Consulta por dolor abdominal.',
  sections: [
    { key: 'motivo_consulta', label: 'Motivo de consulta', content: 'Dolor abdominal de tres días.' },
    { key: 'diagnostico', label: 'Diagnóstico', content: 'Pendiente de estudio.' },
  ],
  warnings: [],
  missing_required_sections: [],
};

// Cliente falso con memoria: registra qué se leyó y qué se escribió.
function fakeRest({ consultationExists = false, organizationId = 'org-1', failInsert = null } = {}) {
  const escrituras = [];
  return {
    escrituras,
    async select(table, query) {
      if (table === 'consultations' && query.includes('id=eq.')) {
        return consultationExists ? [{ id: ENCOUNTER.id }] : [];
      }
      if (table === 'profiles') {
        return organizationId ? [{ organization_id: organizationId }] : [{ organization_id: null }];
      }
      return [];
    },
    async insert(table, row, query) {
      if (failInsert === table) {
        throw new Error(`fallo simulado en ${table}`);
      }
      escrituras.push({ table, row, query });
      return row;
    },
  };
}

async function main() {
  let checks = 0;
  const check = async (name, fn) => { await fn(); checks += 1; console.log(`  ok ${checks}. ${name}`); };

  await check('publica la consulta cuando no existe en el historial', async () => {
    const rest = fakeRest();
    const svc = new ConsultationMirrorService(rest);
    const r = await svc.publish(ENCOUNTER, NOTE);
    assert.strictEqual(r.published, true);
    const fila = rest.escrituras.find((e) => e.table === 'consultations');
    assert.ok(fila, 'no escribió en consultations');
    assert.strictEqual(fila.row.id, ENCOUNTER.id, 'el id debe ser el MISMO del encounter (puente 1:1)');
    assert.strictEqual(fila.row.organization_id, 'org-1');
    assert.strictEqual(fila.row.medico_id, ENCOUNTER.doctor_id);
  });

  await check('NO toca una consulta que ya existe (no degrada una nota firmada)', async () => {
    const rest = fakeRest({ consultationExists: true });
    const svc = new ConsultationMirrorService(rest);
    const r = await svc.publish(ENCOUNTER, NOTE);
    assert.strictEqual(r.published, false);
    assert.strictEqual(r.reason, 'ya_existe');
    assert.strictEqual(rest.escrituras.length, 0, 'no debió escribir nada');
  });

  await check('sin organización no escribe una fila que nadie podría leer', async () => {
    const rest = fakeRest({ organizationId: null });
    const svc = new ConsultationMirrorService(rest);
    const r = await svc.publish(ENCOUNTER, NOTE);
    assert.strictEqual(r.published, false);
    assert.strictEqual(r.reason, 'medico_sin_organizacion');
    assert.strictEqual(rest.escrituras.length, 0);
  });

  await check('la fila nace en borrador y sin firma: el estado es de la web', async () => {
    const fila = ConsultationMirrorService.buildRow(ENCOUNTER, NOTE, { organizationId: 'org-1' });
    assert.strictEqual(fila.estado, 'borrador');
    assert.strictEqual('firma' in fila, false, 'el servidor jamás escribe la firma');
    assert.strictEqual(fila.patient_id, null, 'el paciente lo asocia la web');
    assert.deepStrictEqual(fila.codigos, []);
  });

  await check('la nota se convierte al formato de secciones que lee la web', async () => {
    const fila = ConsultationMirrorService.buildRow(ENCOUNTER, NOTE, { organizationId: 'org-1' });
    assert.strictEqual(fila.note.length, 2);
    assert.deepStrictEqual(fila.note[0], {
      id: 'motivo_consulta',
      titulo: 'Motivo de consulta',
      kind: 'texto',
      texto: 'Dolor abdominal de tres días.',
    });
  });

  await check('la especialidad queda legible, no en snake_case', async () => {
    const fila = ConsultationMirrorService.buildRow(ENCOUNTER, NOTE, { organizationId: 'org-1' });
    assert.strictEqual(fila.especialidad, 'Patología');
  });

  await check('el motivo sale de la sección "motivo", no del resumen', async () => {
    assert.strictEqual(ConsultationMirrorService.deriveMotivo(NOTE), 'Dolor abdominal de tres días.');
    const sinMotivo = { summary: 'Resumen breve.', sections: [{ key: 'x', label: 'X', content: 'y' }] };
    assert.strictEqual(ConsultationMirrorService.deriveMotivo(sinMotivo), 'Resumen breve.');
  });

  await check('un motivo larguísimo se recorta sin romper la columna', async () => {
    const largo = { summary: 'a'.repeat(400), sections: [] };
    const motivo = ConsultationMirrorService.deriveMotivo(largo);
    assert.strictEqual(motivo.length, 140);
    assert.ok(motivo.endsWith('…'));
  });

  await check('la transcripción vacía no fabrica un turno falso', async () => {
    assert.deepStrictEqual(ConsultationMirrorService.transcriptTextToTurns(''), []);
    assert.deepStrictEqual(ConsultationMirrorService.transcriptTextToTurns('   '), []);
    assert.deepStrictEqual(ConsultationMirrorService.transcriptTextToTurns('hola'), [{ t: '', texto: 'hola' }]);
  });

  await check('un fallo de auditoría no impide publicar la nota', async () => {
    const rest = fakeRest({ failInsert: 'audit_events' });
    const svc = new ConsultationMirrorService(rest);
    const r = await svc.publish(ENCOUNTER, NOTE);
    assert.strictEqual(r.published, true, 'la nota en el historial vale más que su auditoría');
  });

  await check('generar la nota NO falla si el espejo revienta', async () => {
    let guardado = null;
    const generator = new ClinicalNoteGeneratorService({
      encounterService: { async getOwnedEncounter() { return { ...ENCOUNTER, template_snapshot: { ...ENCOUNTER.template_snapshot, sections: [{ key: 'a', label: 'A', order: 1, instruction: 'x' }] } }; } },
      encounterRepository: {
        async update(id, patch) { guardado = patch; return { id, ...patch }; },
      },
      llmProvider: {
        hasApiKey: () => true,
        async chatExpectingJson() { return JSON.stringify({ summary: 's', sections: [{ key: 'a', label: 'A', content: 'c', confidence: 1, evidence: '' }], warnings: [], missing_required_sections: [] }); },
        parseJsonObject: (raw) => JSON.parse(raw),
      },
      promptBuilder: { build: () => [] },
      validationService: {
        validateAndRepair: (parsed) => ({ summary: parsed.summary, sections: parsed.sections, warnings: [], missing_required_sections: [] }),
      },
      consultationMirrorService: {
        async publish() { throw new Error('base caída'); },
      },
    });

    const resultado = await generator.generate(ENCOUNTER.id, { doctorId: ENCOUNTER.doctor_id });
    assert.ok(resultado, 'la generación debe completarse igual');
    assert.strictEqual(guardado.status, 'note_generated');
    assert.ok(guardado.note_json_ai, 'la versión IA se guarda igual');
  });

  await check('generar sin espejo configurado sigue funcionando (arneses de prueba)', async () => {
    const generator = new ClinicalNoteGeneratorService({
      encounterService: { async getOwnedEncounter() { return { ...ENCOUNTER, template_snapshot: { ...ENCOUNTER.template_snapshot, sections: [{ key: 'a', label: 'A', order: 1, instruction: 'x' }] } }; } },
      encounterRepository: { async update(id, patch) { return { id, ...patch }; } },
      llmProvider: {
        hasApiKey: () => true,
        async chatExpectingJson() { return JSON.stringify({ summary: 's', sections: [], warnings: [], missing_required_sections: [] }); },
        parseJsonObject: (raw) => JSON.parse(raw),
      },
      promptBuilder: { build: () => [] },
      validationService: { validateAndRepair: () => ({ summary: 's', sections: [], warnings: [], missing_required_sections: [] }) },
    });
    const resultado = await generator.generate(ENCOUNTER.id, { doctorId: ENCOUNTER.doctor_id });
    assert.ok(resultado);
  });

  console.log(`\nverify-consultation-mirror: ${checks} verificaciones OK`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
