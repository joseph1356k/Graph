// Servicio del dashboard de consumo de IA.
//
// CAMBIO DE FONDO FRENTE A LA VERSIÓN ANTERIOR. Antes este archivo leía el
// JSONL entero en memoria y agregaba en Node con tres Map. Con el ledger en
// Postgres eso no escala y además obligaría a traerse todos los eventos al
// backend solo para sumarlos. Ahora agrega la base de datos (RPC security
// definer) y aquí solo se normalizan filtros y se da forma a la respuesta.
//
// AISLAMIENTO. Cuando la petición trae el JWT de un usuario del portal, la RPC
// se ejecuta CON ESE TOKEN: es Postgres quien decide qué filas ve, con la misma
// función de alcance que usa la política RLS. Este proceso no puede ampliar el
// alcance aunque quisiera. Solo el operador interno (sesión de administrador de
// Graph) consulta con service-role, y eso es explícito.

const { listRates, findRateByModel, PRICING_VERSION } = require('../../domain/usage/pricing');
const {
  APP_VALUES,
  FEATURE_VALUES,
  STATUS_VALUES,
  ENVIRONMENT_VALUES
} = require('../../domain/usage/vocabulary');

const RANGE_PRESETS = Object.freeze({
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '72h': 72 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000
});

const BREAKDOWN_DIMENSIONS = Object.freeze([
  'app', 'feature', 'provider', 'model', 'user', 'organization', 'status', 'environment',
  'actor_type', 'error_code'
]);

const HOUR_MS = 60 * 60 * 1000;

/**
 * Variación relativa entre dos periodos.
 *
 * El caso «antes 0, ahora algo» no tiene porcentaje: dividir por cero daría
 * Infinity y pintar «+∞ %» sería ruido. Se devuelve `null` y el panel lo dice
 * con palabras («sin consumo antes») en vez de con una cifra falsa.
 */
function deltaOf(current, previous) {
  const now = Number(current) || 0;
  const before = Number(previous) || 0;
  if (before === 0) {
    return { absolute: now, percent: null, basis: now === 0 ? 'both_zero' : 'no_baseline' };
  }
  return {
    absolute: now - before,
    percent: ((now - before) / before) * 100,
    basis: 'ok'
  };
}

function textList(value) {
  if (value === undefined || value === null || value === '') return null;
  const items = (Array.isArray(value) ? value : `${value}`.split(','))
    .map((entry) => `${entry ?? ''}`.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 40);
  return items.length ? items : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOrNull(value) {
  const candidate = `${value ?? ''}`.trim();
  return UUID_RE.test(candidate) ? candidate.toLowerCase() : null;
}

function isoOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

class UsageDashboardService {
  constructor(store, options = {}) {
    this.store = store;
    this.now = options.now || (() => new Date());
  }

  /**
   * Normaliza los filtros de la query. Todos son combinables; los que no vengan
   * simplemente no filtran. `range` es azúcar sobre from/to: si vienen fechas
   * explícitas, mandan ellas.
   */
  normalizeFilters(query = {}) {
    const now = this.now();
    let from = isoOrNull(query.from);
    let to = isoOrNull(query.to);

    if (!from && !to) {
      const rangeKey = `${query.range || '24h'}`.trim().toLowerCase();
      const windowMs = RANGE_PRESETS[rangeKey] || RANGE_PRESETS['24h'];
      from = new Date(now.getTime() - windowMs).toISOString();
      to = now.toISOString();
    } else if (from && !to) {
      to = now.toISOString();
    }

    return {
      from,
      to,
      organizationId: uuidOrNull(query.organizationId || query.organization_id),
      userId: uuidOrNull(query.userId || query.user_id),
      apps: textList(query.app || query.apps),
      features: textList(query.feature || query.features),
      providers: textList(query.provider || query.providers),
      models: textList(query.model || query.models),
      statuses: textList(query.status || query.statuses),
      environments: textList(query.environment || query.environments)
    };
  }

  toRpcParams(filters) {
    return {
      p_from: filters.from,
      p_to: filters.to,
      p_organization_id: filters.organizationId,
      p_user_id: filters.userId,
      p_apps: filters.apps,
      p_features: filters.features,
      p_providers: filters.providers,
      p_models: filters.models,
      p_statuses: filters.statuses,
      p_environments: filters.environments
    };
  }

  // `viewer` decide con qué credencial se consulta. Si trae accessToken, manda
  // el usuario y su alcance lo aplica Postgres. Si no, es el operador interno.
  async call(name, params, viewer = {}) {
    if (viewer.accessToken) {
      return this.store.callRpcAsUser(name, params, viewer.accessToken);
    }
    return this.store.callRpc(name, params);
  }

  /**
   * Elige el tamaño de cubo de la serie según el rango, para no devolver ni
   * cuatro puntos ni diez mil. Es la diferencia entre una gráfica legible y una
   * que hay que interpretar.
   */
  bucketFor(filters) {
    const from = new Date(filters.from).getTime();
    const to = new Date(filters.to).getTime();
    const spanMs = Math.max(to - from, 0);
    if (spanMs <= 3 * 60 * 60 * 1000) return 'minute';
    if (spanMs <= 4 * 24 * 60 * 60 * 1000) return 'hour';
    return 'day';
  }

  async getSummary(query = {}, viewer = {}) {
    const filters = this.normalizeFilters(query);
    const rows = await this.call('ai_usage_summary', this.toRpcParams(filters), viewer);
    const totals = Array.isArray(rows) && rows[0] ? rows[0] : {};
    return {
      filters,
      totals: {
        totalEvents: Number(totals.total_events || 0),
        okEvents: Number(totals.ok_events || 0),
        errorEvents: Number(totals.error_events || 0),
        inputTokens: Number(totals.input_tokens || 0),
        outputTokens: Number(totals.output_tokens || 0),
        cachedInputTokens: Number(totals.cached_input_tokens || 0),
        reasoningTokens: Number(totals.reasoning_tokens || 0),
        totalTokens: Number(totals.total_tokens || 0),
        audioSeconds: Number(totals.audio_seconds || 0),
        costUsd: Number(totals.cost_usd || 0),
        pricedEvents: Number(totals.priced_events || 0),
        unpricedEvents: Number(totals.unpriced_events || 0),
        activeUsers: Number(totals.active_users || 0),
        activeOrganizations: Number(totals.active_organizations || 0),
        avgTokensPerEvent: Number(totals.avg_tokens_per_event || 0),
        avgLatencyMs: Number(totals.avg_latency_ms || 0),
        errorRate: Number(totals.error_rate || 0),
        firstEventAt: totals.first_event_at || null,
        lastEventAt: totals.last_event_at || null
      }
    };
  }

  async getSeries(query = {}, viewer = {}) {
    const filters = this.normalizeFilters(query);
    const bucket = query.bucket || this.bucketFor(filters);
    const rows = await this.call(
      'ai_usage_series',
      { p_bucket: bucket, ...this.toRpcParams(filters) },
      viewer
    );
    return {
      bucket,
      filters,
      points: (Array.isArray(rows) ? rows : []).map((row) => ({
        at: row.bucket_at,
        events: Number(row.events || 0),
        inputTokens: Number(row.input_tokens || 0),
        outputTokens: Number(row.output_tokens || 0),
        totalTokens: Number(row.total_tokens || 0),
        costUsd: Number(row.cost_usd || 0),
        errorEvents: Number(row.error_events || 0)
      }))
    };
  }

  async getBreakdown(dimension, query = {}, viewer = {}) {
    const requested = `${dimension || ''}`.trim().toLowerCase();
    if (!BREAKDOWN_DIMENSIONS.includes(requested)) {
      const error = new Error(`Dimensión no soportada: ${dimension}`);
      error.statusCode = 400;
      throw error;
    }
    const filters = this.normalizeFilters(query);
    const rows = await this.call(
      'ai_usage_breakdown',
      {
        p_dimension: requested,
        ...this.toRpcParams(filters),
        p_limit: Math.min(Math.max(Number(query.limit) || 25, 1), 200)
      },
      viewer
    );
    return {
      dimension: requested,
      filters,
      rows: (Array.isArray(rows) ? rows : []).map((row) => ({
        key: row.dimension_key,
        id: row.dimension_id || null,
        // El nombre lo resuelve la base al leer, dentro del alcance de quien
        // consulta. Si no hay perfil que resolver, `display_name` ya viene con
        // un respaldo legible: aquí no se inventa nada.
        label: row.display_name || row.dimension_key,
        detail: row.display_detail || '',
        events: Number(row.events || 0),
        inputTokens: Number(row.input_tokens || 0),
        outputTokens: Number(row.output_tokens || 0),
        totalTokens: Number(row.total_tokens || 0),
        cachedInputTokens: Number(row.cached_input_tokens || 0),
        costUsd: Number(row.cost_usd || 0),
        errorEvents: Number(row.error_events || 0),
        avgLatencyMs: Number(row.avg_latency_ms || 0),
        // La media esconde las colas: si nueve llamadas van rápidas y una se
        // queda colgada, solo el p95 lo enseña.
        p50LatencyMs: Number(row.p50_latency_ms || 0),
        p95LatencyMs: Number(row.p95_latency_ms || 0),
        errorRate: Number(row.events) > 0
          ? (Number(row.error_events || 0) / Number(row.events)) * 100
          : 0
      }))
    };
  }

  /**
   * Personas y organizaciones elegibles en los filtros, con su nombre.
   *
   * Salen del consumo que quien consulta ya puede ver, no del directorio: un
   * desplegable poblado desde `profiles` sería una forma de enumerar la
   * plantilla de otra institución sin haber visto ni un evento suyo.
   */
  async getFacets(query = {}, viewer = {}) {
    const filters = this.normalizeFilters(query);
    const rows = await this.call(
      'ai_usage_facets',
      { p_from: filters.from, p_to: filters.to },
      viewer
    );
    const list = Array.isArray(rows) ? rows : [];
    const shape = (row) => ({
      id: row.id,
      label: row.label,
      detail: row.detail || '',
      events: Number(row.events || 0),
      totalTokens: Number(row.total_tokens || 0),
      costUsd: Number(row.cost_usd || 0)
    });
    return {
      users: list.filter((row) => row.kind === 'user').map(shape),
      organizations: list.filter((row) => row.kind === 'organization').map(shape)
    };
  }

  async getEvents(query = {}, viewer = {}) {
    const filters = this.normalizeFilters(query);
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const rows = await this.call(
      'ai_usage_events_page',
      { ...this.toRpcParams(filters), p_limit: limit, p_offset: offset },
      viewer
    );
    const list = Array.isArray(rows) ? rows : [];
    return {
      filters,
      limit,
      offset,
      total: list.length ? Number(list[0].total_count || 0) : 0,
      events: list.map((row) => ({
        id: row.id,
        occurredAt: row.occurred_at,
        organizationId: row.organization_id,
        userId: row.user_id,
        actorType: row.actor_type,
        attributionSource: row.attribution_source,
        userName: row.user_name || '',
        userEmail: row.user_email || '',
        organizationName: row.organization_name || '',
        app: row.app,
        feature: row.feature,
        provider: row.provider,
        requestedModel: row.requested_model,
        servedModel: row.served_model,
        inputTokens: Number(row.input_tokens || 0),
        outputTokens: Number(row.output_tokens || 0),
        cachedInputTokens: Number(row.cached_input_tokens || 0),
        totalTokens: Number(row.total_tokens || 0),
        audioSeconds: Number(row.audio_seconds || 0),
        // null se preserva: es «sin tarifa», no cero.
        costUsd: row.cost_usd === null || row.cost_usd === undefined
          ? null
          : Number(row.cost_usd),
        costStatus: row.cost_status,
        status: row.status,
        errorCode: row.error_code,
        latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
        streamed: Boolean(row.streamed),
        attempt: Number(row.attempt || 1),
        environment: row.environment
      }))
    };
  }

  async getMissingRates(query = {}, viewer = {}) {
    const filters = this.normalizeFilters(query);
    const rows = await this.call(
      'ai_usage_missing_rates',
      { p_from: filters.from, p_to: filters.to },
      viewer
    );
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      provider: row.provider,
      apiFamily: row.api_family,
      model: row.requested_model,
      events: Number(row.events || 0),
      totalTokens: Number(row.total_tokens || 0),
      lastSeenAt: row.last_seen_at
    }));
  }

  /**
   * El mismo resumen para la ventana INMEDIATAMENTE anterior, de igual duración.
   *
   * Sin esto el panel dice cuánto se gastó pero no si eso es mucho: la única
   * pregunta que de verdad se hace quien lo abre es «¿va subiendo?». La ventana
   * anterior se calcula desplazando el rango vigente por su propia duración,
   * así que compara 24 h contra las 24 h de antes, no contra un día natural.
   */
  async getPreviousSummary(query = {}, viewer = {}) {
    const filters = this.normalizeFilters(query);
    const from = new Date(filters.from).getTime();
    const to = new Date(filters.to).getTime();
    const span = to - from;
    if (!Number.isFinite(span) || span <= 0) return null;

    const previous = await this.getSummary(
      {
        ...query,
        range: undefined,
        from: new Date(from - span).toISOString(),
        to: new Date(from).toISOString()
      },
      viewer
    );
    return { window: previous.filters, totals: previous.totals };
  }

  /**
   * Ritmo de gasto y economía unitaria.
   *
   * PROYECCIÓN: se extrapola el costo por hora de la ventana observada. Es una
   * regla de tres, no un pronóstico: si el rango es una noche sin actividad,
   * proyectará de menos. Por eso se devuelve también en qué se basa (`basisHours`)
   * y el panel lo dice, para que nadie confunda una extrapolación con un dato.
   *
   * AHORRO POR CACHÉ: se calcula con la tarifa real de cada modelo —la
   * diferencia entre lo que habrían costado esos tokens a precio de entrada y
   * lo que costaron a precio de caché—, no con un porcentaje inventado. Los
   * modelos sin tarifa se cuentan aparte en vez de sumar cero en silencio.
   */
  economicsFrom(totals, filters, modelRows) {
    const from = new Date(filters.from).getTime();
    const to = new Date(filters.to).getTime();
    const hours = Number.isFinite(to - from) && to > from ? (to - from) / HOUR_MS : 0;
    const costPerHour = hours > 0 ? totals.costUsd / hours : 0;

    let cacheSavingsUsd = 0;
    let cachedTokensWithoutRate = 0;
    for (const row of modelRows || []) {
      const cached = Number(row.cachedInputTokens) || 0;
      if (cached <= 0) continue;
      // Por modelo solo: el desglose no trae el proveedor. La búsqueda se
      // niega a resolver nombres ambiguos, así que un modelo compartido por
      // dos proveedores cae en «sin tarifa» en vez de cobrarse al precio del
      // que no es.
      const rate = findRateByModel(row.key);
      if (!rate || rate.inputPerMTok === null || rate.cachedInputPerMTok === null) {
        cachedTokensWithoutRate += cached;
        continue;
      }
      cacheSavingsUsd += (cached / 1e6) * (rate.inputPerMTok - rate.cachedInputPerMTok);
    }

    return {
      basisHours: Math.round(hours * 100) / 100,
      costPerHour,
      projectedDailyUsd: costPerHour * 24,
      projectedMonthlyUsd: costPerHour * 24 * 30,
      // Solo cuentan las solicitudes que llegaron a facturarse: dividir el
      // costo entre TODAS incluiría los 429, que no gastan nada, y abarataría
      // artificialmente cada nota.
      costPerPricedRequest: totals.pricedEvents > 0 ? totals.costUsd / totals.pricedEvents : null,
      costPerActiveUser: totals.activeUsers > 0 ? totals.costUsd / totals.activeUsers : null,
      tokensPerPricedRequest: totals.pricedEvents > 0 ? totals.totalTokens / totals.pricedEvents : null,
      cacheHitRate: totals.inputTokens > 0
        ? (totals.cachedInputTokens / (totals.inputTokens + totals.cachedInputTokens)) * 100
        : 0,
      cacheSavingsUsd,
      cachedTokensWithoutRate
    };
  }

  /** Todo lo que el dashboard necesita para pintarse, en una sola ida y vuelta. */
  async getOverview(query = {}, viewer = {}) {
    const filters = this.normalizeFilters(query);
    const bucket = this.bucketFor(filters);

    // Se lanzan en paralelo: son consultas independientes contra la misma
    // ventana y encadenarlas multiplicaría la latencia por seis.
    const [
      summary, series, byApp, byFeature, byModel, byUser, byProvider,
      byOrganization, byActorType, byErrorCode, missingRates, facets, previous
    ] = await Promise.all([
      this.getSummary(query, viewer),
      this.getSeries({ ...query, bucket }, viewer),
      this.getBreakdown('app', query, viewer),
      this.getBreakdown('feature', query, viewer),
      this.getBreakdown('model', { ...query, limit: 10 }, viewer),
      this.getBreakdown('user', { ...query, limit: 10 }, viewer),
      this.getBreakdown('provider', query, viewer),
      this.getBreakdown('organization', { ...query, limit: 10 }, viewer),
      this.getBreakdown('actor_type', query, viewer),
      this.getBreakdown('error_code', { ...query, limit: 10 }, viewer),
      this.getMissingRates(query, viewer),
      this.getFacets(query, viewer),
      // Si la ventana anterior falla no se tumba el panel entero: la
      // comparación es un extra, el consumo de hoy es lo que se vino a ver.
      this.getPreviousSummary(query, viewer).catch(() => null)
    ]);

    return {
      generatedAt: this.now().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      pricingVersion: PRICING_VERSION,
      filters,
      totals: summary.totals,
      series,
      breakdowns: {
        app: byApp.rows,
        feature: byFeature.rows,
        model: byModel.rows,
        user: byUser.rows,
        provider: byProvider.rows,
        organization: byOrganization.rows,
        actorType: byActorType.rows,
        errorCode: byErrorCode.rows
      },
      // Comparación con la ventana anterior de igual duración.
      previous: previous ? {
        window: previous.window,
        totals: previous.totals,
        deltas: {
          totalTokens: deltaOf(summary.totals.totalTokens, previous.totals.totalTokens),
          costUsd: deltaOf(summary.totals.costUsd, previous.totals.costUsd),
          totalEvents: deltaOf(summary.totals.totalEvents, previous.totals.totalEvents),
          activeUsers: deltaOf(summary.totals.activeUsers, previous.totals.activeUsers),
          errorRate: deltaOf(summary.totals.errorRate, previous.totals.errorRate),
          avgLatencyMs: deltaOf(summary.totals.avgLatencyMs, previous.totals.avgLatencyMs)
        }
      } : null,
      economics: this.economicsFrom(summary.totals, summary.filters, byModel.rows),
      missingRates,
      // Las facetas se piden solo con la ventana temporal, NO con el resto de
      // filtros: si al elegir a una persona la lista se redujera a esa persona,
      // no habría forma de volver a cambiarla sin limpiar todo.
      facets,
      // El dashboard no inventa las opciones de los filtros: se las damos.
      vocabulary: {
        apps: APP_VALUES,
        features: FEATURE_VALUES,
        statuses: STATUS_VALUES,
        environments: ENVIRONMENT_VALUES
      }
    };
  }

  getPricingCatalog() {
    return listRates();
  }
}

module.exports = UsageDashboardService;
module.exports.RANGE_PRESETS = RANGE_PRESETS;
module.exports.BREAKDOWN_DIMENSIONS = BREAKDOWN_DIMENSIONS;
module.exports.deltaOf = deltaOf;
