const PRICING_SOURCE_URL = 'https://developers.openai.com/api/docs/pricing';
const PRICING_CAPTURED_AT = '2026-06-17';

const PRICING_CATALOG = [
  {
    provider: 'openai',
    apiFamily: 'transcription',
    model: 'gpt-4o-transcribe',
    inputPer1MUsd: 2.5,
    outputPer1MUsd: 10,
    minuteUsd: 0.006,
    sourceUrl: PRICING_SOURCE_URL,
    sourceCapturedAt: PRICING_CAPTURED_AT
  },
  {
    provider: 'openai',
    apiFamily: 'transcription',
    model: 'gpt-4o-mini-transcribe',
    inputPer1MUsd: 1.25,
    outputPer1MUsd: 5,
    minuteUsd: 0.003,
    sourceUrl: PRICING_SOURCE_URL,
    sourceCapturedAt: PRICING_CAPTURED_AT
  },
  {
    provider: 'openai',
    apiFamily: 'responses',
    model: 'gpt-4.1-mini',
    inputPer1MUsd: 0.4,
    cachedInputPer1MUsd: 0.1,
    outputPer1MUsd: 1.6,
    sourceUrl: PRICING_SOURCE_URL,
    sourceCapturedAt: PRICING_CAPTURED_AT
  },
  {
    provider: 'openai',
    apiFamily: 'responses',
    model: 'gpt-4o',
    inputPer1MUsd: 2.5,
    cachedInputPer1MUsd: 1.25,
    outputPer1MUsd: 10,
    sourceUrl: PRICING_SOURCE_URL,
    sourceCapturedAt: PRICING_CAPTURED_AT
  },
  {
    provider: 'openai',
    apiFamily: 'responses',
    model: 'gpt-4o-mini',
    inputPer1MUsd: 0.15,
    cachedInputPer1MUsd: 0.075,
    outputPer1MUsd: 0.6,
    sourceUrl: PRICING_SOURCE_URL,
    sourceCapturedAt: PRICING_CAPTURED_AT
  }
];

const MODEL_ALIASES = {};

function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 1000000) / 1000000;
}

function normalizeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeText(value) {
  return `${value || ''}`.trim();
}

class UsageDashboardService {
  constructor(store) {
    this.store = store;
  }

  getPricingCatalog() {
    return PRICING_CATALOG.map((entry) => ({ ...entry }));
  }

  recordEvent(input = {}) {
    const occurredAt = normalizeText(input.occurredAt) || new Date().toISOString();
    const provider = normalizeText(input.provider).toLowerCase() || 'internal';
    const apiFamily = normalizeText(input.apiFamily).toLowerCase();
    const model = MODEL_ALIASES[normalizeText(input.model)] || normalizeText(input.model);
    const event = {
      id: normalizeText(input.id) || `usage_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
      occurredAt,
      sourceRepo: normalizeText(input.sourceRepo).toLowerCase() || 'graph',
      eventType: normalizeText(input.eventType) || 'usage_event',
      provider,
      apiFamily,
      model,
      inputTokens: normalizeNumber(input.inputTokens),
      outputTokens: normalizeNumber(input.outputTokens),
      deepgramMinutes: normalizeNumber(input.deepgramMinutes),
      requestId: normalizeText(input.requestId),
      sessionId: normalizeText(input.sessionId),
      workflowId: normalizeText(input.workflowId),
      segmentId: normalizeText(input.segmentId),
      stepOrder: Number.isFinite(Number(input.stepOrder)) ? Number(input.stepOrder) : null,
      status: normalizeText(input.status),
      durationMs: Number.isFinite(Number(input.durationMs)) ? Number(input.durationMs) : null,
      feature: normalizeText(input.feature),
      metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {}
    };

    const pricing = this.findPricing(event);
    event.pricing = pricing ? {
      inputPer1MUsd: pricing.inputPer1MUsd ?? null,
      outputPer1MUsd: pricing.outputPer1MUsd ?? null,
      minuteUsd: pricing.minuteUsd ?? null,
      sourceUrl: pricing.sourceUrl,
      sourceCapturedAt: pricing.sourceCapturedAt
    } : null;
    event.estimatedCostUsd = this.estimateEventCost(event, pricing);

    return this.store.append(event);
  }

  listEvents(filters = {}) {
    const from = normalizeText(filters.from);
    const to = normalizeText(filters.to);
    const sourceRepo = normalizeText(filters.sourceRepo).toLowerCase();
    const provider = normalizeText(filters.provider).toLowerCase();
    const eventType = normalizeText(filters.eventType).toLowerCase();
    const model = normalizeText(filters.model);

    return this.store.readAll().filter((event) => {
      if (from && `${event.occurredAt || ''}` < from) return false;
      if (to && `${event.occurredAt || ''}` > to) return false;
      if (sourceRepo && `${event.sourceRepo || ''}`.toLowerCase() !== sourceRepo) return false;
      if (provider && `${event.provider || ''}`.toLowerCase() !== provider) return false;
      if (eventType && `${event.eventType || ''}`.toLowerCase() !== eventType) return false;
      if (model && `${event.model || ''}` !== model) return false;
      return true;
    });
  }

  buildSummary(filters = {}) {
    const events = this.listEvents(filters).sort((left, right) => `${right.occurredAt || ''}`.localeCompare(`${left.occurredAt || ''}`));
    const totals = {
      inputTokens: 0,
      outputTokens: 0,
      deepgramMinutes: 0,
      estimatedCostUsd: 0,
      eventCount: events.length,
      pricedEventCount: 0,
      unpricedEventCount: 0
    };
    const byDayMap = new Map();
    const byHourMap = new Map();
    const byModelMap = new Map();

    for (const event of events) {
      totals.inputTokens += normalizeNumber(event.inputTokens);
      totals.outputTokens += normalizeNumber(event.outputTokens);
      totals.deepgramMinutes += normalizeNumber(event.deepgramMinutes);

      const estimatedCost = normalizeNumber(event.estimatedCostUsd);
      totals.estimatedCostUsd += estimatedCost;
      if (estimatedCost > 0) {
        totals.pricedEventCount += 1;
      } else if ((event.inputTokens || event.outputTokens) && event.provider === 'openai') {
        totals.unpricedEventCount += 1;
      }

      const dayKey = `${event.occurredAt || ''}`.slice(0, 10) || 'unknown';
      const dayBucket = byDayMap.get(dayKey) || {
        date: dayKey,
        inputTokens: 0,
        outputTokens: 0,
        deepgramMinutes: 0,
        estimatedCostUsd: 0,
        eventCount: 0
      };
      dayBucket.inputTokens += normalizeNumber(event.inputTokens);
      dayBucket.outputTokens += normalizeNumber(event.outputTokens);
      dayBucket.deepgramMinutes += normalizeNumber(event.deepgramMinutes);
      dayBucket.estimatedCostUsd += estimatedCost;
      dayBucket.eventCount += 1;
      byDayMap.set(dayKey, dayBucket);

      const hourKey = `${event.occurredAt || ''}`.slice(0, 13) || 'unknown';
      const hourBucket = byHourMap.get(hourKey) || {
        hour: hourKey,
        inputTokens: 0,
        outputTokens: 0,
        deepgramMinutes: 0,
        estimatedCostUsd: 0,
        eventCount: 0
      };
      hourBucket.inputTokens += normalizeNumber(event.inputTokens);
      hourBucket.outputTokens += normalizeNumber(event.outputTokens);
      hourBucket.deepgramMinutes += normalizeNumber(event.deepgramMinutes);
      hourBucket.estimatedCostUsd += estimatedCost;
      hourBucket.eventCount += 1;
      byHourMap.set(hourKey, hourBucket);

      const modelKey = [
        event.sourceRepo || '',
        event.provider || '',
        event.apiFamily || '',
        event.model || '',
        event.eventType || ''
      ].join('|');
      const modelBucket = byModelMap.get(modelKey) || {
        sourceRepo: event.sourceRepo || '',
        provider: event.provider || '',
        apiFamily: event.apiFamily || '',
        model: event.model || '',
        eventType: event.eventType || '',
        inputTokens: 0,
        outputTokens: 0,
        deepgramMinutes: 0,
        estimatedCostUsd: 0,
        eventCount: 0
      };
      modelBucket.inputTokens += normalizeNumber(event.inputTokens);
      modelBucket.outputTokens += normalizeNumber(event.outputTokens);
      modelBucket.deepgramMinutes += normalizeNumber(event.deepgramMinutes);
      modelBucket.estimatedCostUsd += estimatedCost;
      modelBucket.eventCount += 1;
      byModelMap.set(modelKey, modelBucket);
    }

    return {
      totals: {
        ...totals,
        deepgramMinutes: roundCurrency(totals.deepgramMinutes),
        estimatedCostUsd: roundCurrency(totals.estimatedCostUsd)
      },
      byDay: Array.from(byDayMap.values())
        .map((bucket) => ({
          ...bucket,
          deepgramMinutes: roundCurrency(bucket.deepgramMinutes),
          estimatedCostUsd: roundCurrency(bucket.estimatedCostUsd)
        }))
        .sort((left, right) => `${right.date}`.localeCompare(`${left.date}`)),
      byHour: Array.from(byHourMap.values())
        .map((bucket) => ({
          ...bucket,
          deepgramMinutes: roundCurrency(bucket.deepgramMinutes),
          estimatedCostUsd: roundCurrency(bucket.estimatedCostUsd)
        }))
        .sort((left, right) => `${left.hour}`.localeCompare(`${right.hour}`)),
      byModel: Array.from(byModelMap.values())
        .map((bucket) => ({
          ...bucket,
          deepgramMinutes: roundCurrency(bucket.deepgramMinutes),
          estimatedCostUsd: roundCurrency(bucket.estimatedCostUsd)
        }))
        .sort((left, right) => right.eventCount - left.eventCount),
      recentEvents: events.slice(0, 200)
    };
  }

  findPricing(event = {}) {
    const model = normalizeText(event.model);
    const provider = normalizeText(event.provider).toLowerCase();
    const apiFamily = normalizeText(event.apiFamily).toLowerCase();
    if (!model || !provider) {
      return null;
    }

    const exact = PRICING_CATALOG.find((entry) =>
      entry.provider === provider
      && entry.model === model
      && (!apiFamily || entry.apiFamily === apiFamily)
    );
    if (exact) {
      return exact;
    }

    return PRICING_CATALOG.find((entry) => entry.provider === provider && entry.model === model) || null;
  }

  estimateEventCost(event = {}, pricing = null) {
    if (!pricing) {
      return 0;
    }

    const inputTokens = normalizeNumber(event.inputTokens);
    const outputTokens = normalizeNumber(event.outputTokens);
    const deepgramMinutes = normalizeNumber(event.deepgramMinutes);

    const inputCost = pricing.inputPer1MUsd ? (inputTokens / 1000000) * pricing.inputPer1MUsd : 0;
    const outputCost = pricing.outputPer1MUsd ? (outputTokens / 1000000) * pricing.outputPer1MUsd : 0;
    const minuteCost = pricing.minuteUsd ? deepgramMinutes * pricing.minuteUsd : 0;
    return roundCurrency(inputCost + outputCost + minuteCost);
  }
}

module.exports = UsageDashboardService;
