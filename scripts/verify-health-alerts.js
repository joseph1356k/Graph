// Comprobaciones del vigilante del sistema: que detecte lo que debe detectar,
// que NO mande correo cuando no hay nada que contar, que no se caiga sin
// configuración y que el correo jamás lleve datos de pacientes.
//   node scripts/verify-health-alerts.js
const assert = require('assert');

const SystemHealthAlertService = require('../src/application/use-cases/SystemHealthAlertService');

// Cliente falso: devuelve tantas filas como diga el mapa, según la tabla y el
// filtro de estado que venga en la query.
function fakeRestClient(counts = {}) {
  return {
    async select(table, query) {
      for (const [clave, n] of Object.entries(counts)) {
        const [t, marca] = clave.split('|');
        if (table === t && (!marca || query.includes(marca))) {
          return Array.from({ length: n }, (_, i) => ({ id: `${clave}-${i}` }));
        }
      }
      return [];
    },
    async rpc() {
      return 0;
    },
  };
}

// async a propósito: con un try/finally síncrono, las variables se restauraban
// antes de que la promesa de `fn` terminara y el servicio leía el entorno ya
// limpio (el primer intento de estas pruebas falló justo por eso).
async function withEnv(vars, fn) {
  const previo = {};
  for (const [k, v] of Object.entries(vars)) {
    previo[k] = process.env[k];
    if (v === null) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(previo)) {
      if (typeof v === 'undefined') delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const ENV_LIMPIO = {
  RESEND_API_KEY: 'test-key',
  ALERT_EMAIL_TO: 'dev@itsmiracleai.com.co',
  CLINICAL_ADMIN_EMAILS: null,
  GRAPH_LLM_API_KEY: 'sk-test',
  OPENAI_API_KEY: null,
};

async function main() {
  let checks = 0;
  const check = async (name, fn) => { await fn(); checks += 1; console.log(`  ok ${checks}. ${name}`); };

  await check('sin incidencias no manda correo (un correo que siempre llega se deja de leer)', async () => {
    await withEnv(ENV_LIMPIO, async () => {
      let llamadas = 0;
      const svc = new SystemHealthAlertService({
        restClient: fakeRestClient({}),
        fetchImpl: async () => { llamadas += 1; return { ok: true }; },
      });
      const r = await svc.send();
      assert.strictEqual(r.sent, false);
      assert.strictEqual(r.reason, 'sin_novedades');
      assert.strictEqual(llamadas, 0, 'no debió llamar a Resend');
    });
  });

  await check('con force sí manda el reporte aunque esté todo bien', async () => {
    await withEnv(ENV_LIMPIO, async () => {
      let body = null;
      const svc = new SystemHealthAlertService({
        restClient: fakeRestClient({}),
        fetchImpl: async (_url, init) => { body = JSON.parse(init.body); return { ok: true }; },
      });
      const r = await svc.send({ force: true });
      assert.strictEqual(r.sent, true);
      assert.match(body.subject, /todo en orden/i);
    });
  });

  await check('detecta notas fallidas como crítico', async () => {
    await withEnv(ENV_LIMPIO, async () => {
      const svc = new SystemHealthAlertService({
        restClient: fakeRestClient({ 'clinical_encounters|status=eq.failed': 3 }),
        fetchImpl: async () => ({ ok: true }),
      });
      const findings = await svc.collectFindings();
      const f = findings.find((x) => /nota/i.test(x.title));
      assert.ok(f, 'no detectó las notas fallidas');
      assert.strictEqual(f.severity, 'critico');
      assert.match(f.title, /3 notas/);
    });
  });

  await check('detecta consultas atascadas como atención, no como crítico', async () => {
    await withEnv(ENV_LIMPIO, async () => {
      const svc = new SystemHealthAlertService({
        restClient: fakeRestClient({ 'clinical_encounters|status=in.(transcript_ready': 5 }),
        fetchImpl: async () => ({ ok: true }),
      });
      const findings = await svc.collectFindings();
      const f = findings.find((x) => /sin terminar/i.test(x.title));
      assert.ok(f);
      assert.strictEqual(f.severity, 'atencion');
      assert.match(f.detail, /no se borran solas/i, 'debe dejar claro que no se borran');
    });
  });

  await check('avisa si el proveedor de IA no está configurado', async () => {
    await withEnv({ ...ENV_LIMPIO, GRAPH_LLM_API_KEY: null, OPENAI_API_KEY: null }, async () => {
      const svc = new SystemHealthAlertService({ restClient: fakeRestClient({}) });
      const findings = await svc.collectFindings();
      const f = findings.find((x) => /proveedor de ia/i.test(x.title));
      assert.ok(f, 'no avisó de la IA sin configurar');
      assert.strictEqual(f.severity, 'critico');
    });
  });

  await check('detecta notas huérfanas: generadas pero fuera del historial del médico', async () => {
    await withEnv(ENV_LIMPIO, async () => {
      const svc = new SystemHealthAlertService({
        restClient: {
          async select(table, query) {
            if (table === 'clinical_encounters' && query.includes('status=eq.note_generated')) {
              return [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
            }
            // Solo una de las tres llegó al historial: quedan 2 huérfanas.
            if (table === 'consultations' && query.includes('id=in.')) {
              return [{ id: 'b' }];
            }
            return [];
          },
        },
      });
      const findings = await svc.collectFindings();
      const f = findings.find((x) => /historial/i.test(x.title));
      assert.ok(f, 'no detectó las huérfanas');
      assert.strictEqual(f.severity, 'critico');
      assert.match(f.title, /2 nota/);
    });
  });

  await check('sin notas generadas no inventa huérfanas', async () => {
    await withEnv(ENV_LIMPIO, async () => {
      const svc = new SystemHealthAlertService({ restClient: fakeRestClient({}) });
      assert.strictEqual(await svc.countOrphanNotes(), 0);
    });
  });

  await check('los críticos van primero en el correo', async () => {
    await withEnv(ENV_LIMPIO, async () => {
      const svc = new SystemHealthAlertService({
        restClient: fakeRestClient({
          'clinical_encounters|status=in.(transcript_ready': 2,
          'graph_note_exports|status=eq.failed': 1,
        }),
      });
      const findings = await svc.collectFindings();
      assert.ok(findings.length >= 2);
      assert.strictEqual(findings[0].severity, 'critico');
    });
  });

  await check('sin configurar no revienta: informa el motivo', async () => {
    await withEnv({ ...ENV_LIMPIO, RESEND_API_KEY: null }, async () => {
      const svc = new SystemHealthAlertService({
        restClient: fakeRestClient({ 'clinical_encounters|status=eq.failed': 1 }),
      });
      const r = await svc.send();
      assert.strictEqual(r.sent, false);
      assert.strictEqual(r.reason, 'alertas_no_configuradas');
      assert.strictEqual(r.findings.length >= 1, true, 'los hallazgos se devuelven igual');
    });
  });

  await check('sin destinatarios propios usa los administradores clínicos', async () => {
    await withEnv({ ...ENV_LIMPIO, ALERT_EMAIL_TO: null, CLINICAL_ADMIN_EMAILS: 'admin@hospital.com' }, async () => {
      const svc = new SystemHealthAlertService({ restClient: fakeRestClient({}) });
      assert.deepStrictEqual(svc.recipients(), ['admin@hospital.com']);
    });
  });

  await check('descarta destinatarios con formato inválido', async () => {
    await withEnv({ ...ENV_LIMPIO, ALERT_EMAIL_TO: 'bueno@x.com, no-es-correo, otro@y.co' }, async () => {
      const svc = new SystemHealthAlertService({ restClient: fakeRestClient({}) });
      assert.deepStrictEqual(svc.recipients(), ['bueno@x.com', 'otro@y.co']);
    });
  });

  await check('el correo no contiene PHI ni identificadores de paciente', async () => {
    await withEnv(ENV_LIMPIO, async () => {
      const svc = new SystemHealthAlertService({
        restClient: fakeRestClient({
          'clinical_encounters|status=eq.failed': 2,
          'graph_note_exports|status=eq.failed': 1,
        }),
      });
      const { html, subject } = svc.buildEmail(await svc.collectFindings());
      const prohibido = /paciente\s+[A-ZÁÉÍÓÚ][a-z]+|transcript|note_json|documento|cc\s*\d/i;
      assert.ok(!prohibido.test(html), 'el html no debe llevar datos clínicos');
      assert.ok(!prohibido.test(subject));
      assert.match(html, /no contiene datos de pacientes/i);
    });
  });

  await check('un fallo de Resend se propaga como error (no como éxito silencioso)', async () => {
    await withEnv(ENV_LIMPIO, async () => {
      const svc = new SystemHealthAlertService({
        restClient: fakeRestClient({ 'clinical_encounters|status=eq.failed': 1 }),
        fetchImpl: async () => ({ ok: false, status: 422, text: async () => 'dominio no verificado' }),
      });
      await assert.rejects(() => svc.send(), /422/);
    });
  });

  // --- Aviso inmediato -------------------------------------------------------

  const HALLAZGO = { severity: 'critico', title: 'Algo se rompió', detail: 'detalle' };

  function restConAlertLog({ lastSentAt = null } = {}) {
    const escrituras = [];
    return {
      escrituras,
      async select(table, query) {
        if (table === 'graph_alert_log' && query.includes('alert_key=eq.')) {
          return lastSentAt ? [{ last_sent_at: lastSentAt }] : [];
        }
        return [];
      },
      async insert(table, row) {
        escrituras.push({ table, row });
        return row;
      },
    };
  }

  await check('avisa en el momento cuando algo se rompe', async () => {
    await withEnv(ENV_LIMPIO, async () => {
      const rest = restConAlertLog();
      let enviado = null;
      const svc = new SystemHealthAlertService({
        restClient: rest,
        fetchImpl: async (_url, init) => { enviado = JSON.parse(init.body); return { ok: true }; },
      });
      const r = await svc.notifyNow('prueba', HALLAZGO);
      assert.strictEqual(r.sent, true);
      assert.match(enviado.subject, /atención/i);
      assert.ok(rest.escrituras.some((e) => e.table === 'graph_alert_log'), 'debe registrar el envío');
    });
  });

  await check('no repite la misma alerta dentro de la ventana de silencio', async () => {
    await withEnv(ENV_LIMPIO, async () => {
      const haceCincoMinutos = new Date(Date.now() - 5 * 60000).toISOString();
      let llamadas = 0;
      const svc = new SystemHealthAlertService({
        restClient: restConAlertLog({ lastSentAt: haceCincoMinutos }),
        fetchImpl: async () => { llamadas += 1; return { ok: true }; },
      });
      const r = await svc.notifyNow('prueba', HALLAZGO, { cooldownMinutes: 30 });
      assert.strictEqual(r.sent, false);
      assert.strictEqual(r.reason, 'en_ventana_de_silencio');
      assert.strictEqual(llamadas, 0, 'si el proveedor se cae, decenas de correos iguales serían ruido');
    });
  });

  await check('pasada la ventana, vuelve a avisar', async () => {
    await withEnv(ENV_LIMPIO, async () => {
      const haceUnaHora = new Date(Date.now() - 60 * 60000).toISOString();
      const svc = new SystemHealthAlertService({
        restClient: restConAlertLog({ lastSentAt: haceUnaHora }),
        fetchImpl: async () => ({ ok: true }),
      });
      const r = await svc.notifyNow('prueba', HALLAZGO, { cooldownMinutes: 30 });
      assert.strictEqual(r.sent, true);
    });
  });

  await check('el aviso inmediato NUNCA lanza hacia el flujo clínico', async () => {
    await withEnv(ENV_LIMPIO, async () => {
      const svc = new SystemHealthAlertService({
        restClient: { async select() { throw new Error('base caída'); }, async insert() {} },
        fetchImpl: async () => ({ ok: true }),
      });
      const r = await svc.notifyNow('prueba', HALLAZGO);
      assert.strictEqual(r.sent, false);
      assert.strictEqual(r.reason, 'error', 'devuelve el motivo en vez de romper la consulta del médico');
    });
  });

  await check('sin configurar, el aviso inmediato no intenta enviar', async () => {
    await withEnv({ ...ENV_LIMPIO, RESEND_API_KEY: null }, async () => {
      let llamadas = 0;
      const svc = new SystemHealthAlertService({
        restClient: restConAlertLog(),
        fetchImpl: async () => { llamadas += 1; return { ok: true }; },
      });
      const r = await svc.notifyNow('prueba', HALLAZGO);
      assert.strictEqual(r.sent, false);
      assert.strictEqual(r.reason, 'alertas_no_configuradas');
      assert.strictEqual(llamadas, 0);
    });
  });

  console.log(`\nverify-health-alerts: ${checks} verificaciones OK`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
