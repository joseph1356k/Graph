// El rescate de consultas que quedaron a medias.
//
// Lo que se protege aquí: que rescate lo que debe, que NO toque lo que el
// propietario pidió dejar quieto, que dos ejecuciones no peleen por el mismo
// trabajo, y que un fallo suyo no tumbe el resto del mantenimiento.
//   node scripts/verify-note-rescue.js
const assert = require('assert');

const NoteGenerationRescueService = require('../src/application/use-cases/NoteGenerationRescueService');

function encounter(overrides = {}) {
  return {
    id: overrides.id || 'enc-1',
    doctor_id: 'doc-1',
    status: 'transcript_ready',
    transcript: 'Paciente refiere dolor.',
    note_json: null,
    generation_attempts: 0,
    ...overrides,
  };
}

// Doble del cliente REST: simula la cola con una lista y registra las llamadas.
function fakeRest({ cola = [], releaseReturns = 'transcript_ready', failClaim = false } = {}) {
  const llamadas = [];
  return {
    llamadas,
    async rpc(fn, args) {
      llamadas.push({ fn, args });
      if (fn === 'claim_next_note_generation') {
        if (failClaim) throw new Error('base caída');
        const next = cola.shift();
        return next ? [next] : [];
      }
      if (fn === 'release_note_generation') {
        return releaseReturns;
      }
      return null;
    },
  };
}

function fakeGenerator({ failWith = null, onGenerate = null } = {}) {
  return {
    generados: [],
    async generate(id, opts) {
      this.generados.push({ id, doctorId: opts?.doctorId });
      if (onGenerate) onGenerate(id);
      if (failWith) {
        const error = new Error('falló');
        error.code = failWith;
        throw error;
      }
      return { id, status: 'note_generated' };
    },
  };
}

async function main() {
  let checks = 0;
  const check = async (name, fn) => { await fn(); checks += 1; console.log(`  ok ${checks}. ${name}`); };

  await check('rescata una consulta que quedó con transcripción y sin nota', async () => {
    const rest = fakeRest({ cola: [encounter()] });
    const gen = fakeGenerator();
    const svc = new NoteGenerationRescueService({ restClient: rest, noteGeneratorService: gen });
    const r = await svc.run();
    assert.strictEqual(r.rescued, 1);
    assert.strictEqual(r.claimed, 1);
    assert.strictEqual(gen.generados.length, 1);
  });

  await check('genera en nombre del médico dueño, no salta la verificación', async () => {
    const rest = fakeRest({ cola: [encounter({ doctor_id: 'doc-42' })] });
    const gen = fakeGenerator();
    const svc = new NoteGenerationRescueService({ restClient: rest, noteGeneratorService: gen });
    await svc.run();
    assert.strictEqual(gen.generados[0].doctorId, 'doc-42');
  });

  await check('cola vacía: no hace nada y no se queja', async () => {
    const rest = fakeRest({ cola: [] });
    const gen = fakeGenerator();
    const svc = new NoteGenerationRescueService({ restClient: rest, noteGeneratorService: gen });
    const r = await svc.run();
    assert.deepStrictEqual({ claimed: r.claimed, rescued: r.rescued }, { claimed: 0, rescued: 0 });
    assert.strictEqual(gen.generados.length, 0);
  });

  await check('respeta el tope por ejecución (no agota el tiempo de la función)', async () => {
    const muchas = Array.from({ length: 20 }, (_, i) => encounter({ id: `enc-${i}` }));
    const rest = fakeRest({ cola: muchas });
    const gen = fakeGenerator();
    const svc = new NoteGenerationRescueService({
      restClient: rest, noteGeneratorService: gen, options: { maxJobs: 5 },
    });
    const r = await svc.run();
    assert.strictEqual(r.claimed, 5, 'no debe procesar más de lo permitido');
    assert.strictEqual(muchas.length, 15, 'el resto queda en la cola para el siguiente ciclo');
  });

  await check('un intento fallido libera la reserva y se reintentará', async () => {
    const rest = fakeRest({ cola: [encounter()], releaseReturns: 'transcript_ready' });
    const gen = fakeGenerator({ failWith: 'LLM_TIMEOUT' });
    const svc = new NoteGenerationRescueService({ restClient: rest, noteGeneratorService: gen });
    const r = await svc.run();
    assert.strictEqual(r.failed, 1);
    assert.strictEqual(r.exhausted, 0);
    const release = rest.llamadas.find((l) => l.fn === 'release_note_generation');
    assert.ok(release, 'debe liberar la reserva');
    assert.strictEqual(release.args.p_error_code, 'LLM_TIMEOUT', 'guarda el código, no el mensaje');
  });

  await check('agotados los intentos: marca fallida y avisa de inmediato', async () => {
    const rest = fakeRest({ cola: [encounter()], releaseReturns: 'failed' });
    const gen = fakeGenerator({ failWith: 'NOTE_GENERATION_FAILED' });
    const avisos = [];
    const svc = new NoteGenerationRescueService({
      restClient: rest,
      noteGeneratorService: gen,
      healthAlertService: { async notifyNow(key, finding) { avisos.push({ key, finding }); } },
    });
    const r = await svc.run();
    assert.strictEqual(r.exhausted, 1);
    assert.strictEqual(avisos.length, 1);
    assert.strictEqual(avisos[0].key, 'note_generation_exhausted');
    assert.strictEqual(avisos[0].finding.severity, 'critico');
    assert.match(avisos[0].finding.detail, /NO se ha perdido/i, 'debe dejar claro que la transcripción sigue ahí');
  });

  await check('un fallo aislado NO despierta a nadie (solo el agotamiento avisa)', async () => {
    const rest = fakeRest({ cola: [encounter()], releaseReturns: 'transcript_ready' });
    const avisos = [];
    const svc = new NoteGenerationRescueService({
      restClient: rest,
      noteGeneratorService: fakeGenerator({ failWith: 'LLM_TIMEOUT' }),
      healthAlertService: { async notifyNow(key) { avisos.push(key); } },
    });
    await svc.run();
    assert.strictEqual(avisos.length, 0, 'el siguiente ciclo puede resolverlo: no es para alarmar');
  });

  await check('si la base falla al reclamar, no revienta: lo reporta y sigue', async () => {
    const rest = fakeRest({ failClaim: true });
    const svc = new NoteGenerationRescueService({
      restClient: rest, noteGeneratorService: fakeGenerator(),
    });
    const r = await svc.run();
    assert.strictEqual(r.errors.length, 1);
    assert.match(r.errors[0], /claim/);
    assert.strictEqual(r.rescued, 0);
  });

  await check('un fallo del aviso no impide seguir rescatando', async () => {
    const rest = fakeRest({ cola: [encounter({ id: 'a' }), encounter({ id: 'b' })], releaseReturns: 'failed' });
    const svc = new NoteGenerationRescueService({
      restClient: rest,
      noteGeneratorService: fakeGenerator({ failWith: 'X' }),
      healthAlertService: { async notifyNow() { throw new Error('correo caído'); } },
    });
    const r = await svc.run();
    assert.strictEqual(r.claimed, 2, 'debe haber procesado las dos pese al fallo del aviso');
  });

  await check('el claim pide el lease y el tope de intentos configurados', async () => {
    const rest = fakeRest({ cola: [] });
    const svc = new NoteGenerationRescueService({
      restClient: rest,
      noteGeneratorService: fakeGenerator(),
      options: { leaseSeconds: 120, maxAttempts: 2 },
    });
    await svc.run();
    const claim = rest.llamadas.find((l) => l.fn === 'claim_next_note_generation');
    assert.strictEqual(claim.args.p_lease_seconds, 120);
    assert.strictEqual(claim.args.p_max_attempts, 2);
  });

  console.log(`\nverify-note-rescue: ${checks} verificaciones OK`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
