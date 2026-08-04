// Grabador central de consumo de IA.
//
// Es el ÚNICO sitio que convierte «acabo de llamar a un proveedor» en una fila
// del ledger. Los servicios no arman el evento a mano: llaman a `measure()`,
// que envuelve la llamada, la cronometra y registra tanto el éxito como el
// fallo. Esa es la diferencia con la instrumentación anterior, que se invocaba
// a mano en ocho rutas y siempre con `status: 'ok'` cableado — las llamadas que
// fallaban después de gastar tokens no dejaban rastro.
//
// LO QUE COBRA AUNQUE FALLE. Un 500 del proveedor tras haber procesado el
// prompt sí se factura. Por eso `measure()` registra el evento también en el
// camino de error, con `status: 'error'` y el consumo que se haya podido leer.

const { buildUsageEvent } = require('../../domain/usage/UsageEvent');
const { currentContext } = require('../../infrastructure/usage/UsageContext');
const { resolveEnvironment, STATUSES } = require('../../domain/usage/vocabulary');

class AiUsageRecorder {
  constructor(options = {}) {
    this.store = options.store;
    this.logger = options.logger || console;
    this.environment = options.environment || resolveEnvironment();
    this.enabled = options.enabled !== false;
    // Escrituras en vuelo. `flush()` las espera; en Vercel eso evita que la
    // lambda se congele con el insert a medias.
    this.pending = new Set();
  }

  /**
   * Registra un evento de consumo. El contexto de atribución se toma del
   * AsyncLocalStorage vigente; `input` solo puede añadir datos técnicos de la
   * llamada (proveedor, modelo, tokens), nunca sobrescribir quién es el usuario
   * salvo que se pase un contexto explícito (colas, trabajos diferidos).
   */
  record(input = {}) {
    if (!this.enabled || !this.store) {
      return Promise.resolve({ ok: false, skipped: true });
    }
    let promise;
    try {
      const context = input.context || currentContext();
      const event = buildUsageEvent({
        ...input,
        userId: input.userId ?? context.userId,
        organizationId: input.organizationId ?? context.organizationId,
        actorType: input.actorType ?? context.actorType,
        attributionSource: input.attributionSource ?? context.attributionSource,
        app: input.app ?? context.app,
        feature: input.feature ?? context.feature,
        sessionId: input.sessionId ?? context.sessionId,
        workflowId: input.workflowId ?? context.workflowId,
        requestId: input.requestId ?? context.requestId
      }, { environment: this.environment });

      promise = this.store.append(event)
        .then((result) => ({ ...result, event }))
        .catch((error) => {
          this.logger.warn?.(`[Usage] No se pudo registrar el consumo: ${error.message}`);
          return { ok: false, error: error.message, event };
        });
    } catch (error) {
      // Un fallo construyendo el evento no puede propagarse al camino del
      // usuario: la telemetría es observación, no funcionalidad.
      this.logger.warn?.(`[Usage] Evento descartado por malformado: ${error.message}`);
      return Promise.resolve({ ok: false, error: error.message });
    }

    this.pending.add(promise);
    promise.finally(() => this.pending.delete(promise));
    return promise;
  }

  /**
   * Envuelve una llamada a un proveedor: cronometra, extrae el consumo de la
   * respuesta y registra el evento pase lo que pase.
   *
   * @param {object} descriptor  provider, apiFamily, model, feature, attempt...
   * @param {function} call      la llamada real; recibe nada y devuelve la respuesta cruda
   * @param {function} extract   (respuesta) => { inputTokens, outputTokens, ... }
   */
  async measure(descriptor, call, extract) {
    const startedAt = Date.now();
    const occurredAt = new Date().toISOString();
    try {
      const response = await call();
      const usage = typeof extract === 'function' ? (extract(response) || {}) : {};
      this.record({
        ...descriptor,
        ...usage,
        occurredAt,
        status: STATUSES.OK,
        latencyMs: Date.now() - startedAt
      });
      return response;
    } catch (error) {
      // El proveedor puede haber cobrado antes de fallar (timeout tras procesar
      // el prompt, corte de red a mitad de stream). Se registra lo que se sepa;
      // si no hay cifras, el evento queda `unpriced_no_usage`, que es
      // exactamente lo que ocurrió y no un cero inventado.
      const usage = typeof extract === 'function'
        ? (safeExtract(extract, error.response?.data) || {})
        : {};
      this.record({
        ...descriptor,
        ...usage,
        occurredAt,
        status: STATUSES.ERROR,
        errorCode: errorCodeOf(error),
        latencyMs: Date.now() - startedAt,
        metadata: {
          ...(descriptor.metadata || {}),
          httpStatus: error.response?.status || error.statusCode || 0
        }
      });
      throw error;
    }
  }

  /** Espera a que terminen las escrituras en vuelo. */
  async flush(timeoutMs = 3000) {
    if (!this.pending.size) return true;
    const inFlight = Array.from(this.pending);
    const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), timeoutMs));
    const settled = await Promise.race([Promise.allSettled(inFlight), timeout]);
    return settled !== 'timeout';
  }

  getStats() {
    return {
      enabled: this.enabled,
      environment: this.environment,
      pending: this.pending.size,
      store: this.store?.getStats?.() || null
    };
  }
}

function safeExtract(extract, payload) {
  if (!payload) return {};
  try {
    return extract(payload) || {};
  } catch (error) {
    return {};
  }
}

function errorCodeOf(error) {
  const status = error?.response?.status || error?.statusCode;
  if (status) return `http_${status}`;
  if (error?.code) return `${error.code}`.slice(0, 80);
  if (/timeout/i.test(error?.message || '')) return 'timeout';
  return 'provider_error';
}

module.exports = AiUsageRecorder;
