#!/usr/bin/env node
// Simulador del ejecutor de Operations — CLIENTE DE REFERENCIA del contrato.
//
// Habla exactamente el mismo contrato que hablará el cliente Windows real:
//
//   POST /api/v1/operations/exports/claim         {device}
//        → 204 (no hay trabajo) | 200 {export:{id,workflow_id,attempts,lease_expires_at}, payload, plan}
//   POST /api/v1/operations/exports/:id/result    {device, outcome, folio?, unresolved_fields?, error_code?, detail_code?}
//        → 200 {acknowledged, status, consultation_exported, ...}
//
// Por eso es reemplazable por construcción: cuando el ejecutor real (o un
// conector API del HIS) hable este mismo carril, no hay que rehacer NADA del
// frontend ni de Graph. Mientras tanto sirve para (a) demostrar el flujo
// completo sin SAP, (b) que el equipo web pruebe toda su UI, y (c) darle al
// equipo de Operations una especificación EJECUTABLE del contrato.
//
// NO automatiza Windows ni toca SAP: imprime lo que escribiría y reporta.
//
// Uso:
//   node scripts/simulate-operations-executor.js --once
//   node scripts/simulate-operations-executor.js --outcome error --error-code HIS_LOGIN_FAILED
//   node scripts/simulate-operations-executor.js --outcome needs_doctor --unresolved "Servicio,Fecha de egreso"
//   node scripts/simulate-operations-executor.js --watch --interval 5
//
// Variables de entorno:
//   GRAPH_BASE_URL   (default http://127.0.0.1:3000)
//   MIRACLE_API_KEY  API key de cliente (X-API-Key) — obligatoria salvo --dry-run

function parseArgs(argv) {
  const options = {
    baseUrl: `${process.env.GRAPH_BASE_URL || 'http://127.0.0.1:3000'}`.replace(/\/+$/, ''),
    apiKey: `${process.env.MIRACLE_API_KEY || ''}`.trim(),
    device: `${process.env.GRAPH_EXECUTOR_DEVICE || 'simulador-operations'}`.trim(),
    outcome: 'ok',
    folio: '',
    errorCode: '',
    detailCode: '',
    unresolved: [],
    workSeconds: 1,
    intervalSeconds: 5,
    watch: false,
    once: false,
    quiet: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--base-url': options.baseUrl = `${next()}`.replace(/\/+$/, ''); break;
      case '--api-key': options.apiKey = `${next()}`.trim(); break;
      case '--device': options.device = `${next()}`.trim(); break;
      case '--outcome': options.outcome = `${next()}`.trim(); break;
      case '--folio': options.folio = `${next()}`.trim(); break;
      case '--error-code': options.errorCode = `${next()}`.trim(); break;
      case '--detail-code': options.detailCode = `${next()}`.trim(); break;
      case '--unresolved':
        options.unresolved = `${next()}`.split(',').map((v) => v.trim()).filter(Boolean);
        break;
      case '--work-seconds': options.workSeconds = Number(next()) || 0; break;
      case '--interval': options.intervalSeconds = Number(next()) || 5; break;
      case '--watch': options.watch = true; break;
      case '--once': options.once = true; break;
      case '--quiet': options.quiet = true; break;
      case '--help':
      case '-h':
        console.log(require('fs').readFileSync(__filename, 'utf8')
          .split('\n').filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
        process.exit(0);
        break;
      default:
        console.error(`Argumento desconocido: ${arg}`);
        process.exit(2);
    }
  }

  if (!['ok', 'needs_doctor', 'error'].includes(options.outcome)) {
    console.error(`--outcome inválido: ${options.outcome} (usa ok | needs_doctor | error)`);
    process.exit(2);
  }
  return options;
}

const options = parseArgs(process.argv);

function log(...args) {
  if (!options.quiet) console.log(...args);
}

function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, seconds) * 1000));
}

function headers(extra = {}) {
  const base = { 'Content-Type': 'application/json', ...extra };
  if (options.apiKey) base['X-API-Key'] = options.apiKey;
  return base;
}

async function claimNext() {
  const response = await fetch(`${options.baseUrl}/api/v1/operations/exports/claim`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ device: options.device })
  });

  if (response.status === 204) return null;
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }

  if (!response.ok) {
    const message = body?.error?.message || body?.error || text || `HTTP ${response.status}`;
    throw new Error(`claim falló (${response.status}): ${message}`);
  }
  return body;
}

/**
 * Aquí es donde el ejecutor REAL abriría el HIS, navegaría a la historia del
 * paciente y llenaría el formulario siguiendo `plan.steps`. El simulador solo
 * muestra lo que escribiría.
 *
 * `outcome: 'ok'` significa, en el cliente real: la acción de guardado se
 * ejecutó Y se verificó la señal de éxito del HIS (diálogo/folio). No basta con
 * "no lanzó excepción" — de eso depende que la consulta quede exportada.
 */
async function executeInHis(job) {
  const payload = job.payload || {};
  const rendered = `${payload.rendered_text || ''}`;

  log(`\n▶ Trabajo ${job.export.id}`);
  log(`  workflow: ${job.export.workflow_id || '(sin configurar)'} · intento ${job.export.attempts} · lease hasta ${job.export.lease_expires_at}`);
  log(`  firmada por: ${payload.firma?.por || '(desconocido)'} · ${payload.firma?.fecha || ''}`);
  log(`  paciente (referencia): ${payload.patient_ref || '(sin paciente asociado)'}`);
  if (job.plan) {
    log(`  plan recibido de Graph: ${Array.isArray(job.plan.steps) ? job.plan.steps.length : 0} paso(s)`);
  } else {
    log('  sin plan server-side: el ejecutor resolvería el suyo');
  }
  log('  ── texto que se escribiría en la historia clínica ──');
  for (const line of (rendered ? rendered.split('\n') : ['(vacío)'])) log(`  │ ${line}`);
  log('  ───────────────────────────────────────────────────');

  if (options.workSeconds > 0) {
    log(`  … simulando ${options.workSeconds}s de trabajo en el HIS`);
    await sleep(options.workSeconds);
  }

  const folio = options.outcome === 'ok'
    ? (options.folio || `SIM-${Date.now().toString(36).toUpperCase()}`)
    : '';
  return {
    outcome: options.outcome,
    folio,
    unresolved_fields: options.outcome === 'needs_doctor'
      ? (options.unresolved.length ? options.unresolved : ['Campo sin resolver'])
      : [],
    error_code: options.outcome === 'error' ? (options.errorCode || 'SIMULATED_FAILURE') : '',
    detail_code: options.detailCode || ''
  };
}

/**
 * Reporta el resultado con reintentos. Esto NO es best-effort: si el resultado
 * no llega, Graph no puede saber que el HIS ya se escribió y la consulta se
 * quedaría sin exportar (o peor, se reintentaría y se duplicaría). El cliente
 * real debe hacer exactamente esto: reintentar hasta recibir ack.
 */
async function reportResult(exportId, result, { attempts = 5 } = {}) {
  const body = JSON.stringify({
    device: options.device,
    outcome: result.outcome,
    ...(result.folio ? { folio: result.folio } : {}),
    ...(result.unresolved_fields?.length ? { unresolved_fields: result.unresolved_fields } : {}),
    ...(result.error_code ? { error_code: result.error_code } : {}),
    ...(result.detail_code ? { detail_code: result.detail_code } : {})
  });

  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${options.baseUrl}/api/v1/operations/exports/${exportId}/result`, {
        method: 'POST',
        headers: headers(),
        body
      });
      const text = await response.text();
      let parsed = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

      if (response.ok) return parsed;

      // 4xx de contrato (lease vencido, no eres el dueño): reintentar no ayuda.
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`el servidor rechazó el resultado (${response.status}): ${parsed?.error?.message || text}`);
      }
      lastError = new Error(`HTTP ${response.status}: ${parsed?.error?.message || text}`);
    } catch (error) {
      if (/rechazó el resultado/.test(error.message)) throw error;
      lastError = error;
    }
    const backoff = Math.min(2 ** (attempt - 1), 8);
    log(`  ⚠ no se pudo reportar (intento ${attempt}/${attempts}): ${lastError.message} — reintentando en ${backoff}s`);
    await sleep(backoff);
  }
  throw lastError || new Error('no se pudo reportar el resultado');
}

async function processOne() {
  const job = await claimNext();
  if (!job) {
    log('· Sin trabajos en la cola.');
    return false;
  }
  const result = await executeInHis(job);
  const ack = await reportResult(job.export.id, result);

  const marker = ack?.consultation_exported ? '✅' : (result.outcome === 'ok' ? '⚠' : '↩');
  log(`  ${marker} reportado: outcome=${result.outcome} → status=${ack?.status}` +
      `${result.folio ? ` · folio ${result.folio}` : ''}` +
      `${ack?.idempotent ? ' · (ack idempotente)' : ''}`);
  if (result.outcome === 'ok' && !ack?.consultation_exported) {
    log('    (la consulta no cambió a exportada: ya lo estaba o dejó de estar aprobada)');
  }
  return true;
}

async function main() {
  if (!options.apiKey) {
    console.error('Falta la API key del ejecutor: define MIRACLE_API_KEY o pasa --api-key.');
    process.exit(2);
  }
  log(`Simulador de ejecutor Operations → ${options.baseUrl}`);
  log(`  device=${options.device} · outcome=${options.outcome}`);

  if (options.watch) {
    log(`  modo watch: consultando cada ${options.intervalSeconds}s (Ctrl+C para salir)\n`);
    for (;;) {
      try {
        const didWork = await processOne();
        if (!didWork) await sleep(options.intervalSeconds);
      } catch (error) {
        console.error(`✗ ${error.message}`);
        await sleep(options.intervalSeconds);
      }
    }
  }

  const didWork = await processOne();
  if (!didWork && !options.once) {
    log('  (usa --watch para quedarse esperando trabajos)');
  }
  process.exit(didWork ? 0 : 3);
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
