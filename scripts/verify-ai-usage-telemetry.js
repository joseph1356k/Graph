// GATE de la telemetría de consumo de IA.
//   node scripts/verify-ai-usage-telemetry.js
//
// Cubre lo que se puede comprobar sin base de datos: cálculo de costo,
// atribución, idempotencia, saneado de metadata, streaming, reintentos y
// fallback. El aislamiento entre organizaciones se prueba en SQL
// (tests/sql/03-ai-usage-rls.sql) porque lo aplica Postgres, no este proceso.
//
// La pregunta que contesta este archivo es la del enunciado: ¿el consumo real
// está siendo capturado, atribuido y calculado correctamente?

const assert = require('assert');

const { calculateCost, findRate, canonicalModelName } = require('../src/domain/usage/pricing');
const {
  buildUsageEvent,
  sanitizeMetadata,
  toDatabaseRow
} = require('../src/domain/usage/UsageEvent');
const {
  fromOpenAiCompatible,
  fromAnthropic,
  fromGemini,
  fromDeepgram,
  createStreamUsageAccumulator,
  toRecorderUsage
} = require('../src/domain/usage/providerUsage');
const { ACTOR_TYPES, ATTRIBUTION_SOURCES, APPS, FEATURES } = require('../src/domain/usage/vocabulary');
const AiUsageRecorder = require('../src/application/use-cases/AiUsageRecorder');
const UsageAttributionResolver = require('../src/application/use-cases/UsageAttributionResolver');
const UsageDashboardService = require('../src/application/use-cases/UsageDashboardService');
const { runWithContext, withFeature, runAsSystem, currentContext } =
  require('../src/infrastructure/usage/UsageContext');

let checks = 0;
let group = '';
function section(name) { group = name; console.log(`\n${name}`); }
function check(label, fn) {
  try {
    fn();
    checks += 1;
    console.log(`  ok  ${label}`);
  } catch (error) {
    console.error(`  FALLO  [${group}] ${label}`);
    throw error;
  }
}
async function checkAsync(label, fn) {
  try {
    await fn();
    checks += 1;
    console.log(`  ok  ${label}`);
  } catch (error) {
    console.error(`  FALLO  [${group}] ${label}`);
    throw error;
  }
}

// Almacén de mentira: guarda en memoria y respeta la idempotencia igual que el
// índice único de Postgres, para poder afirmar sobre duplicados sin base.
function fakeStore() {
  const rows = new Map();
  return {
    rows,
    async append(event) {
      if (rows.has(event.idempotencyKey)) {
        return { ok: true, duplicate: true, storage: 'memory' };
      }
      rows.set(event.idempotencyKey, event);
      return { ok: true, duplicate: false, storage: 'memory' };
    },
    getStats() { return { written: rows.size }; },
    list() { return Array.from(rows.values()); }
  };
}

(async function main() {
  console.log('Telemetría de consumo de IA — comprobaciones');

  // ==========================================================================
  section('1 · Cálculo de costo con tarifas versionadas');

  check('el costo de entrada y salida sale de la tarifa del modelo', () => {
    // gpt-4o-mini: 0.15 USD/MTok entrada, 0.60 USD/MTok salida.
    const result = calculateCost({
      provider: 'openai', model: 'gpt-4o-mini', apiFamily: 'chat_completions',
      inputTokens: 1_000_000, outputTokens: 1_000_000
    });
    assert.strictEqual(result.costStatus, 'priced');
    assert.strictEqual(result.costUsd, 0.75);
  });

  check('las cifras pequeñas no se redondean a cero', () => {
    // 50 tokens de entrada en gpt-4o-mini = 7.5e-6 USD. Con redondeo a 2 o 4
    // decimales esto desaparecería y el modelo barato parecería gratis.
    const result = calculateCost({
      provider: 'openai', model: 'gpt-4o-mini', inputTokens: 50, outputTokens: 0
    });
    assert.ok(result.costUsd > 0, 'un consumo real no puede costar 0');
    assert.strictEqual(result.costUsd, 0.0000075);
  });

  check('los tokens en caché usan su propia tarifa, más barata', () => {
    const conCache = calculateCost({
      provider: 'openai', model: 'gpt-4o', inputTokens: 0, cachedInputTokens: 1_000_000
    });
    const sinCache = calculateCost({
      provider: 'openai', model: 'gpt-4o', inputTokens: 1_000_000
    });
    assert.strictEqual(conCache.costUsd, 1.25);
    assert.strictEqual(sinCache.costUsd, 2.5);
    assert.ok(conCache.costUsd < sinCache.costUsd);
  });

  check('el audio se cobra por minuto, no por token', () => {
    const result = calculateCost({
      provider: 'deepgram', model: 'nova-3', apiFamily: 'transcription', audioSeconds: 600
    });
    // 10 minutos × 0.0043 USD/min
    assert.strictEqual(result.costStatus, 'priced');
    assert.strictEqual(result.costUsd, 0.043);
  });

  check('sin tarifa configurada el costo es null y se dice por qué', () => {
    const result = calculateCost({
      provider: 'openai', model: 'modelo-que-no-existe', inputTokens: 1000
    });
    assert.strictEqual(result.costUsd, null, 'nunca 0: un cero parecería gratis');
    assert.strictEqual(result.costStatus, 'unpriced_no_rate');
  });

  check('con tarifa pero sin consumo reportado se distingue del caso anterior', () => {
    const result = calculateCost({ provider: 'openai', model: 'gpt-4o-mini' });
    assert.strictEqual(result.costUsd, null);
    assert.strictEqual(result.costStatus, 'unpriced_no_usage',
      'son dos problemas distintos: falta precio vs. falta instrumentación');
  });

  check('el evento congela la tarifa aplicada para poder reconstruir el cálculo', () => {
    const result = calculateCost({
      provider: 'anthropic', model: 'claude-sonnet-4-6', apiFamily: 'messages',
      inputTokens: 1000, outputTokens: 1000
    });
    assert.strictEqual(result.pricingSnapshot.inputPerMTok, 3);
    assert.strictEqual(result.pricingSnapshot.outputPerMTok, 15);
    assert.ok(result.pricingVersion, 'debe quedar la versión de tarifa');
  });

  check('las variantes del mismo modelo resuelven a la misma tarifa', () => {
    assert.strictEqual(canonicalModelName('openai/gpt-4o'), 'gpt-4o');
    assert.strictEqual(canonicalModelName('gpt-4o-2024-08-06'), 'gpt-4o');
    assert.ok(findRate({ provider: 'openai', model: 'openai/gpt-4o' }),
      'un prefijo de OpenRouter no debe fabricar una tarifa faltante');
  });

  // ==========================================================================
  section('2 · Normalización de uso por proveedor');

  check('OpenAI: prompt/completion + caché + razonamiento', () => {
    const parsed = fromOpenAiCompatible({
      model: 'gpt-4.1-mini',
      id: 'chatcmpl-123',
      usage: {
        prompt_tokens: 100, completion_tokens: 40, total_tokens: 140,
        prompt_tokens_details: { cached_tokens: 30 },
        completion_tokens_details: { reasoning_tokens: 12 }
      }
    });
    assert.strictEqual(parsed.inputTokens, 100);
    assert.strictEqual(parsed.outputTokens, 40);
    assert.strictEqual(parsed.cachedInputTokens, 30);
    assert.strictEqual(parsed.reasoningTokens, 12);
    assert.strictEqual(parsed.servedModel, 'gpt-4.1-mini');
    assert.strictEqual(parsed.providerRequestId, 'chatcmpl-123');
  });

  check('Anthropic: la creación de caché cuenta como entrada, la lectura no', () => {
    const parsed = fromAnthropic({
      model: 'claude-sonnet-4-6',
      usage: {
        input_tokens: 100, output_tokens: 20,
        cache_creation_input_tokens: 50, cache_read_input_tokens: 200
      }
    });
    assert.strictEqual(parsed.inputTokens, 150, 'entrada + creación de caché');
    assert.strictEqual(parsed.cachedInputTokens, 200, 'la lectura se cobra aparte');
  });

  check('Gemini nativo: usageMetadata en camelCase', () => {
    const parsed = fromGemini({
      modelVersion: 'gemini-2.5-flash',
      usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 25, totalTokenCount: 105 }
    });
    assert.strictEqual(parsed.inputTokens, 80);
    assert.strictEqual(parsed.outputTokens, 25);
  });

  check('Deepgram: duración en segundos, sin tokens', () => {
    const parsed = fromDeepgram({ metadata: { duration: 42.5, request_id: 'dg-1' } });
    assert.strictEqual(parsed.audioSeconds, 42.5);
    assert.strictEqual(parsed.inputTokens, 0);
  });

  check('una respuesta SIN bloque usage no es un consumo de cero', () => {
    const parsed = fromOpenAiCompatible({ model: 'gpt-4o', choices: [] });
    assert.strictEqual(parsed.hasUsage, false,
      'debe quedar unpriced_no_usage, no un cero que parecería gratis');
    const recorderPayload = toRecorderUsage(parsed);
    assert.strictEqual(recorderPayload.inputTokens, 0);
  });

  check('streaming: se toma el último bloque usage, no la suma de los chunks', () => {
    const accumulator = createStreamUsageAccumulator(fromOpenAiCompatible);
    accumulator.push({ choices: [{ delta: { content: 'Hola' } }] });
    accumulator.push({ choices: [{ delta: { content: ' mundo' } }] });
    // El chunk final trae el acumulado del proveedor.
    accumulator.push({ model: 'gpt-4o', usage: { prompt_tokens: 90, completion_tokens: 30 } });
    const result = accumulator.result();
    assert.strictEqual(result.inputTokens, 90, 'sumar chunk a chunk contaría de más');
    assert.strictEqual(result.outputTokens, 30);
    assert.strictEqual(result.streamChunks, 3);
  });

  // ==========================================================================
  section('3 · Privacidad: nada clínico entra al ledger');

  check('metadata solo conserva claves técnicas de la allowlist', () => {
    const sanitized = sanitizeMetadata({
      fieldCount: 12,
      httpStatus: 200,
      // Todo lo de abajo debe desaparecer.
      prompt: 'Paciente Juan Pérez, 45 años, refiere dolor torácico',
      transcript: 'el paciente dice que...',
      noteContent: 'HISTORIA CLÍNICA...',
      patientName: 'Juan Pérez',
      documento: '1032456789',
      apiKey: 'sk-proj-abc123',
      authorization: 'Bearer eyJhbGci'
    });
    assert.deepStrictEqual(sanitized, { fieldCount: 12, httpStatus: 200 });
  });

  check('un objeto anidado dentro de una clave permitida también se descarta', () => {
    // Si se aceptaran objetos, la allowlist volvería a abrir la puerta que cierra.
    const sanitized = sanitizeMetadata({ fieldCount: { nested: 'Paciente Juan' } });
    assert.deepStrictEqual(sanitized, {});
  });

  check('el evento persistido no lleva ningún campo de contenido', () => {
    const event = buildUsageEvent({
      provider: 'openai', requestedModel: 'gpt-4o', inputTokens: 10, outputTokens: 5,
      metadata: { prompt: 'contenido clínico', fieldCount: 3 }
    });
    const row = toDatabaseRow(event);
    const serialized = JSON.stringify(row).toLowerCase();
    for (const forbidden of ['prompt', 'transcript', 'paciente', 'contenido clínico', 'bearer ']) {
      assert.ok(!serialized.includes(forbidden.toLowerCase()),
        `la fila no debe contener "${forbidden}"`);
    }
    assert.deepStrictEqual(row.metadata, { fieldCount: 3 });
  });

  // ==========================================================================
  section('4 · Atribución');

  check('actor_type=user exige un uuid real; si falta, queda sin atribuir', () => {
    const event = buildUsageEvent({
      provider: 'openai', requestedModel: 'gpt-4o',
      actorType: 'user', userId: 'no-es-un-uuid', inputTokens: 5
    });
    assert.strictEqual(event.userId, null);
    assert.strictEqual(event.actorType, ACTOR_TYPES.UNATTRIBUTED,
      'inventar un usuario sería peor que admitir que no se sabe');
  });

  check('un usuario válido conserva su uuid, organización y origen', () => {
    const event = buildUsageEvent({
      provider: 'openai', requestedModel: 'gpt-4o', inputTokens: 5,
      actorType: 'user',
      userId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      attributionSource: 'session'
    });
    assert.strictEqual(event.userId, '11111111-1111-4111-8111-111111111111');
    assert.strictEqual(event.organizationId, '22222222-2222-4222-8222-222222222222');
    assert.strictEqual(event.attributionSource, ATTRIBUTION_SOURCES.SESSION);
  });

  check('el contexto viaja por AsyncLocalStorage hasta la capa del proveedor', () => {
    runWithContext({
      userId: '33333333-3333-4333-8333-333333333333',
      organizationId: '44444444-4444-4444-8444-444444444444',
      actorType: ACTOR_TYPES.USER,
      app: APPS.WEB_APP,
      feature: FEATURES.ASISTENTE
    }, () => {
      const context = currentContext();
      assert.strictEqual(context.app, 'web_app');
      assert.strictEqual(context.feature, 'asistente');
      // withFeature acota el módulo sin tocar la identidad.
      withFeature(FEATURES.BIOPSIA, () => {
        const inner = currentContext();
        assert.strictEqual(inner.feature, 'biopsia');
        assert.strictEqual(inner.userId, '33333333-3333-4333-8333-333333333333',
          'cambiar de módulo no puede cambiar de usuario');
        assert.strictEqual(inner.app, 'web_app');
      });
      assert.strictEqual(currentContext().feature, 'asistente', 'el ámbito se restaura');
    });
  });

  check('el trabajo interno se marca system, no «sin atribuir»', () => {
    runAsSystem(FEATURES.NOTE_RESCUE, () => {
      const context = currentContext();
      assert.strictEqual(context.actorType, ACTOR_TYPES.SYSTEM);
      assert.strictEqual(context.app, APPS.SYSTEM);
      assert.strictEqual(context.attributionSource, ATTRIBUTION_SOURCES.INTERNAL);
    });
  });

  // -- Resolver contra la petición HTTP --------------------------------------
  const PERFILES = {
    '11111111-1111-4111-8111-111111111111': {
      id: '11111111-1111-4111-8111-111111111111',
      organization_id: 'aaaaaaaa-1111-4111-8111-111111111111',
      role: 'medico'
    }
  };
  const PERFILES_EMAIL = {
    'ana@hospital.co': {
      id: '55555555-5555-4555-8555-555555555555',
      organization_id: 'bbbbbbbb-2222-4222-8222-222222222222',
      role: 'medico'
    }
  };
  const supabaseFalso = {
    isConfigured: () => true,
    async request(path) {
      const idMatch = /\/profiles\?id=eq\.([^&]+)/.exec(path);
      if (idMatch) {
        const profile = PERFILES[decodeURIComponent(idMatch[1])];
        return profile ? [profile] : [];
      }
      const emailMatch = /\/profiles\?email=eq\.([^&]+)/.exec(path);
      if (emailMatch) {
        const profile = PERFILES_EMAIL[decodeURIComponent(emailMatch[1])];
        return profile ? [profile] : [];
      }
      return [];
    }
  };
  const resolver = new UsageAttributionResolver({ supabaseClient: supabaseFalso });

  function fakeReq(overrides = {}) {
    const headers = overrides.headers || {};
    return {
      get: (name) => headers[name.toLowerCase()] || '',
      headers,
      clinicalUser: overrides.clinicalUser,
      apiClient: overrides.apiClient,
      user: overrides.user,
      body: overrides.body || {}
    };
  }

  await checkAsync('sesión de Supabase → usuario, organización y app web_app', async () => {
    const context = await resolver.resolveFromRequest(fakeReq({
      clinicalUser: { id: '11111111-1111-4111-8111-111111111111' },
      headers: { 'x-miracle-feature': 'hoja_en_blanco' }
    }));
    assert.strictEqual(context.userId, '11111111-1111-4111-8111-111111111111');
    assert.strictEqual(context.organizationId, 'aaaaaaaa-1111-4111-8111-111111111111');
    assert.strictEqual(context.app, APPS.WEB_APP);
    assert.strictEqual(context.feature, 'hoja_en_blanco');
    assert.strictEqual(context.attributionSource, ATTRIBUTION_SOURCES.SESSION);
  });

  await checkAsync('una sesión de Supabase NO puede declararse app de Windows', async () => {
    const context = await resolver.resolveFromRequest(fakeReq({
      clinicalUser: { id: '11111111-1111-4111-8111-111111111111' },
      headers: { 'x-miracle-app': 'windows_app' }
    }));
    assert.strictEqual(context.app, APPS.WEB_APP,
      'la vía de autenticación manda sobre lo que declare la cabecera');
  });

  await checkAsync('API key + correo registrado → usuario y organización resueltos', async () => {
    const context = await resolver.resolveFromRequest(fakeReq({
      apiClient: { label: 'windows' },
      headers: {
        'x-miracle-app': 'windows_app',
        'x-miracle-user-email': 'ana@hospital.co',
        'x-miracle-feature': 'biopsia'
      }
    }));
    assert.strictEqual(context.userId, '55555555-5555-4555-8555-555555555555');
    assert.strictEqual(context.organizationId, 'bbbbbbbb-2222-4222-8222-222222222222');
    assert.strictEqual(context.app, APPS.WINDOWS_APP);
    assert.strictEqual(context.feature, 'biopsia');
    assert.strictEqual(context.attributionSource, ATTRIBUTION_SOURCES.API_KEY);
  });

  await checkAsync('un correo que NO está en profiles no atribuye a nadie', async () => {
    const context = await resolver.resolveFromRequest(fakeReq({
      apiClient: { label: 'windows' },
      headers: { 'x-miracle-user-email': 'intruso@example.com', 'x-miracle-device-id': 'win-9' }
    }));
    assert.strictEqual(context.userId, null,
      'el cliente no puede imputar consumo a un usuario inventado');
    assert.strictEqual(context.actorType, ACTOR_TYPES.UNATTRIBUTED);
    assert.strictEqual(context.attributionSource, ATTRIBUTION_SOURCES.DEVICE);
  });

  await checkAsync('un uuid falso en la cabecera tampoco atribuye', async () => {
    const context = await resolver.resolveFromRequest(fakeReq({
      apiClient: { label: 'web' },
      headers: { 'x-miracle-user-id': '99999999-9999-4999-8999-999999999999' }
    }));
    assert.strictEqual(context.userId, null);
  });

  await checkAsync('proceso interno sin petición → system', async () => {
    const context = await resolver.resolveFromRequest(fakeReq({
      user: { id: 'local-admin:root', role: 'local-admin' }
    }));
    assert.strictEqual(context.actorType, ACTOR_TYPES.SYSTEM);
    assert.strictEqual(context.organizationId, null);
  });

  // ==========================================================================
  section('5 · Idempotencia, reintentos y fallback');

  await checkAsync('el mismo evento escrito dos veces no se duplica', async () => {
    const store = fakeStore();
    const recorder = new AiUsageRecorder({ store });
    const payload = {
      occurredAt: '2026-08-04T10:00:00.000Z',
      provider: 'openai', requestedModel: 'gpt-4o',
      inputTokens: 100, outputTokens: 50, providerRequestId: 'req-abc'
    };
    const first = await recorder.record(payload);
    const second = await recorder.record(payload);
    assert.strictEqual(first.duplicate, false);
    assert.strictEqual(second.duplicate, true);
    assert.strictEqual(store.rows.size, 1);
  });

  await checkAsync('un REINTENTO real al proveedor sí cuenta como consumo aparte', async () => {
    const store = fakeStore();
    const recorder = new AiUsageRecorder({ store });
    const base = {
      occurredAt: '2026-08-04T10:00:00.000Z',
      provider: 'openai', requestedModel: 'gpt-4o',
      inputTokens: 100, outputTokens: 50, providerRequestId: 'req-abc'
    };
    await recorder.record({ ...base, attempt: 1 });
    await recorder.record({ ...base, attempt: 2 });
    assert.strictEqual(store.rows.size, 2,
      'los tokens del reintento se gastaron de verdad y deben contarse');
  });

  await checkAsync('el fallback entre modelos deja dos eventos con su modelo real', async () => {
    const store = fakeStore();
    const recorder = new AiUsageRecorder({ store });
    await recorder.record({
      provider: 'anthropic', requestedModel: 'claude-opus-5',
      inputTokens: 500, outputTokens: 0, status: 'error', errorCode: 'refusal', attempt: 1
    });
    await recorder.record({
      provider: 'anthropic', requestedModel: 'claude-sonnet-4-6',
      fallbackFromModel: 'claude-opus-5',
      inputTokens: 500, outputTokens: 200, status: 'ok', attempt: 2
    });
    const events = store.list();
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[1].fallbackFromModel, 'claude-opus-5');
    assert.ok(events[1].costUsd > 0, 'el modelo de respaldo cobra a SU tarifa');
  });

  await checkAsync('measure() registra también cuando el proveedor falla', async () => {
    const store = fakeStore();
    const recorder = new AiUsageRecorder({ store });
    const error = new Error('boom');
    error.response = { status: 500, data: { usage: { prompt_tokens: 120, completion_tokens: 0 } } };

    await assert.rejects(
      () => recorder.measure(
        { provider: 'openai', requestedModel: 'gpt-4o', feature: FEATURES.ASISTENTE },
        async () => { throw error; },
        (data) => toRecorderUsage(fromOpenAiCompatible(data))
      ),
      /boom/
    );
    await recorder.flush();

    const events = store.list();
    assert.strictEqual(events.length, 1, 'una llamada que gastó tokens y falló debe dejar rastro');
    assert.strictEqual(events[0].status, 'error');
    assert.strictEqual(events[0].errorCode, 'http_500');
    assert.strictEqual(events[0].inputTokens, 120,
      'el proveedor cobró el prompt aunque devolviera 500');
  });

  await checkAsync('measure() cronometra la llamada exitosa y anota latencia', async () => {
    const store = fakeStore();
    const recorder = new AiUsageRecorder({ store });
    await recorder.measure(
      { provider: 'openai', requestedModel: 'gpt-4o-mini' },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 12));
        return { model: 'gpt-4o-mini', usage: { prompt_tokens: 10, completion_tokens: 4 } };
      },
      (data) => toRecorderUsage(fromOpenAiCompatible(data))
    );
    await recorder.flush();
    const event = store.list()[0];
    assert.strictEqual(event.status, 'ok');
    assert.ok(event.latencyMs >= 10, `latencia esperada >=10ms, fue ${event.latencyMs}`);
  });

  await checkAsync('un fallo de la telemetría no rompe la llamada del usuario', async () => {
    const storeRoto = {
      async append() { throw new Error('supabase caído'); },
      getStats() { return {}; }
    };
    const recorder = new AiUsageRecorder({ store: storeRoto, logger: { warn() {} } });
    const respuesta = await recorder.measure(
      { provider: 'openai', requestedModel: 'gpt-4o' },
      async () => ({ model: 'gpt-4o', usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      (data) => toRecorderUsage(fromOpenAiCompatible(data))
    );
    assert.ok(respuesta, 'la respuesta del modelo debe llegar al usuario igualmente');
    await recorder.flush();
  });

  // ==========================================================================
  section('6 · Filtros combinados y alcance del dashboard');

  const llamadas = [];
  const storeConsulta = {
    async callRpc(name, params) { llamadas.push({ name, params, as: 'service_role' }); return []; },
    async callRpcAsUser(name, params, token) { llamadas.push({ name, params, as: token }); return []; }
  };
  const dashboard = new UsageDashboardService(storeConsulta, {
    now: () => new Date('2026-08-04T12:00:00.000Z')
  });

  check('el rango de 24 h se traduce a una ventana explícita', () => {
    const filters = dashboard.normalizeFilters({ range: '24h' });
    assert.strictEqual(filters.from, '2026-08-03T12:00:00.000Z');
    assert.strictEqual(filters.to, '2026-08-04T12:00:00.000Z');
  });

  check('los filtros se combinan todos a la vez', () => {
    const filters = dashboard.normalizeFilters({
      range: '72h',
      app: 'web_app,windows_app',
      feature: 'biopsia',
      provider: 'openai',
      status: 'ok',
      environment: 'production',
      organizationId: 'aaaaaaaa-1111-4111-8111-111111111111',
      userId: '11111111-1111-4111-8111-111111111111'
    });
    assert.deepStrictEqual(filters.apps, ['web_app', 'windows_app']);
    assert.deepStrictEqual(filters.features, ['biopsia']);
    assert.deepStrictEqual(filters.providers, ['openai']);
    assert.deepStrictEqual(filters.statuses, ['ok']);
    assert.deepStrictEqual(filters.environments, ['production']);
    assert.strictEqual(filters.organizationId, 'aaaaaaaa-1111-4111-8111-111111111111');
    assert.strictEqual(filters.userId, '11111111-1111-4111-8111-111111111111');
  });

  check('un uuid inválido en el filtro no llega a la base', () => {
    const filters = dashboard.normalizeFilters({ organizationId: "' or 1=1 --" });
    assert.strictEqual(filters.organizationId, null);
  });

  check('el tamaño del cubo se elige por la longitud del rango', () => {
    assert.strictEqual(dashboard.bucketFor(dashboard.normalizeFilters({ range: '1h' })), 'minute');
    assert.strictEqual(dashboard.bucketFor(dashboard.normalizeFilters({ range: '24h' })), 'hour');
    assert.strictEqual(dashboard.bucketFor(dashboard.normalizeFilters({ range: '30d' })), 'day');
  });

  await checkAsync('con JWT de usuario la RPC se ejecuta CON SU TOKEN', async () => {
    llamadas.length = 0;
    await dashboard.getSummary({ range: '24h' }, { accessToken: 'jwt-de-ana' });
    assert.strictEqual(llamadas[0].as, 'jwt-de-ana',
      'el aislamiento por organización lo aplica Postgres, no este proceso');
  });

  await checkAsync('el operador interno consulta con service-role', async () => {
    llamadas.length = 0;
    await dashboard.getSummary({ range: '24h' }, { kind: 'internal_operator' });
    assert.strictEqual(llamadas[0].as, 'service_role');
  });

  await checkAsync('una dimensión de desglose no permitida se rechaza', async () => {
    await assert.rejects(
      () => dashboard.getBreakdown('; drop table ai_usage_events', {}, {}),
      /no soportada/i
    );
  });

  // ==========================================================================
  section('7 · Escenario de validación controlada');

  await checkAsync('A(web) + B(windows) + proceso interno caen en su categoría', async () => {
    const store = fakeStore();
    const recorder = new AiUsageRecorder({ store });

    const ORG_A = 'aaaaaaaa-1111-4111-8111-111111111111';
    const USER_A = '11111111-1111-4111-8111-111111111111';
    const USER_B = '55555555-5555-4555-8555-555555555555';

    // 1. Usuario A, organización A, desde la Web App, módulo Hoja en blanco.
    await runWithContext({
      userId: USER_A, organizationId: ORG_A, actorType: ACTOR_TYPES.USER,
      attributionSource: ATTRIBUTION_SOURCES.SESSION,
      app: APPS.WEB_APP, feature: FEATURES.HOJA_EN_BLANCO
    }, () => recorder.record({
      provider: 'openai', requestedModel: 'gpt-4.1', inputTokens: 1200, outputTokens: 300
    }));

    // 2. Usuario B, misma organización, desde la Windows App, módulo Biopsia.
    await runWithContext({
      userId: USER_B, organizationId: ORG_A, actorType: ACTOR_TYPES.USER,
      attributionSource: ATTRIBUTION_SOURCES.API_KEY,
      app: APPS.WINDOWS_APP, feature: FEATURES.BIOPSIA
    }, () => recorder.record({
      provider: 'openai', requestedModel: 'gpt-4o', inputTokens: 800, outputTokens: 150
    }));

    // 3. Proceso interno sin usuario.
    await runAsSystem(FEATURES.NOTE_RESCUE, () => recorder.record({
      provider: 'openai', requestedModel: 'gpt-4o-mini', inputTokens: 400, outputTokens: 90
    }));

    await recorder.flush();
    const events = store.list();
    assert.strictEqual(events.length, 3);

    const a = events.find((e) => e.userId === USER_A);
    assert.strictEqual(a.app, 'web_app');
    assert.strictEqual(a.feature, 'hoja_en_blanco');
    assert.strictEqual(a.organizationId, ORG_A);
    assert.ok(a.costUsd > 0);

    const b = events.find((e) => e.userId === USER_B);
    assert.strictEqual(b.app, 'windows_app');
    assert.strictEqual(b.feature, 'biopsia');
    assert.strictEqual(b.organizationId, ORG_A);

    const sistema = events.find((e) => e.actorType === ACTOR_TYPES.SYSTEM);
    assert.strictEqual(sistema.userId, null);
    assert.strictEqual(sistema.organizationId, null);
    assert.strictEqual(sistema.app, 'system');
    assert.strictEqual(sistema.feature, 'note_rescue');

    // El total del panel es la suma de lo almacenado, por construcción.
    const totalTokens = events.reduce((acc, e) => acc + e.totalTokens, 0);
    assert.strictEqual(totalTokens, 1500 + 950 + 490);
  });

  // -------------------------------------------------------------------------
  section('8 · Comparación, proyección y economía unitaria');
  // -------------------------------------------------------------------------
  {
    const UsageDashboardService = require('../src/application/use-cases/UsageDashboardService');
    const service = new UsageDashboardService(null, { now: () => new Date('2026-08-06T12:00:00Z') });

    check('la ventana anterior es del mismo largo, pegada al inicio de la actual', () => {
      const filters = service.normalizeFilters({ range: '24h' });
      const from = new Date(filters.from).getTime();
      const to = new Date(filters.to).getTime();
      assert.strictEqual(to - from, 24 * 3600 * 1000);
      // getPreviousSummary desplaza [from-span, from); se comprueba la
      // aritmética sin tocar la base.
      const prevFrom = new Date(from - (to - from)).toISOString();
      assert.strictEqual(prevFrom, '2026-08-04T12:00:00.000Z');
    });

    check('crecer desde cero NO produce un porcentaje (nada de «+∞ %»)', () => {
      const { deltaOf } = require('../src/application/use-cases/UsageDashboardService');
      const delta = deltaOf(120, 0);
      assert.strictEqual(delta.percent, null);
      assert.strictEqual(delta.basis, 'no_baseline');
      assert.strictEqual(delta.absolute, 120);
    });

    check('cero contra cero se distingue de «no hay base»', () => {
      const { deltaOf } = require('../src/application/use-cases/UsageDashboardService');
      assert.strictEqual(deltaOf(0, 0).basis, 'both_zero');
    });

    check('una caída se reporta con signo negativo y su magnitud exacta', () => {
      const { deltaOf } = require('../src/application/use-cases/UsageDashboardService');
      const delta = deltaOf(75, 100);
      assert.strictEqual(delta.absolute, -25);
      assert.ok(Math.abs(delta.percent - -25) < 1e-9);
    });

    const totals = {
      costUsd: 12, totalTokens: 600000, totalEvents: 100, pricedEvents: 80,
      activeUsers: 4, inputTokens: 400000, cachedInputTokens: 100000
    };
    const filters = { from: '2026-08-05T12:00:00Z', to: '2026-08-06T12:00:00Z' };

    check('la proyección es una regla de tres sobre las horas observadas', () => {
      const eco = service.economicsFrom(totals, filters, []);
      assert.strictEqual(eco.basisHours, 24);
      assert.strictEqual(eco.costPerHour, 0.5);
      assert.strictEqual(eco.projectedDailyUsd, 12);
      assert.strictEqual(eco.projectedMonthlyUsd, 360);
    });

    check('el costo por solicitud usa las FACTURADAS, no todas', () => {
      const eco = service.economicsFrom(totals, filters, []);
      // 12 / 80, no 12 / 100: los fallos que no gastan abaratarían la cifra.
      assert.strictEqual(eco.costPerPricedRequest, 0.15);
      assert.strictEqual(eco.costPerActiveUser, 3);
    });

    check('el ahorro por caché sale de la tarifa real del modelo', () => {
      // gpt-4.1-mini: entrada 0,40 y caché 0,10 por millón ⇒ ahorro 0,30/M.
      const eco = service.economicsFrom(totals, filters, [
        { key: 'gpt-4.1-mini', cachedInputTokens: 1000000 }
      ]);
      assert.ok(Math.abs(eco.cacheSavingsUsd - 0.30) < 1e-9);
      assert.strictEqual(eco.cachedTokensWithoutRate, 0);
    });

    check('un modelo sin tarifa NO suma cero en silencio: se cuenta aparte', () => {
      const eco = service.economicsFrom(totals, filters, [
        { key: 'modelo-inventado-9000', cachedInputTokens: 500000 }
      ]);
      assert.strictEqual(eco.cacheSavingsUsd, 0);
      assert.strictEqual(eco.cachedTokensWithoutRate, 500000);
    });

    check('una ventana sin duración no divide por cero', () => {
      const eco = service.economicsFrom(totals, { from: filters.to, to: filters.to }, []);
      assert.strictEqual(eco.basisHours, 0);
      assert.strictEqual(eco.costPerHour, 0);
      assert.strictEqual(eco.projectedMonthlyUsd, 0);
    });

    check('error_code es una dimensión válida de desglose', () => {
      assert.ok(UsageDashboardService.BREAKDOWN_DIMENSIONS.includes('error_code'));
      assert.ok(UsageDashboardService.BREAKDOWN_DIMENSIONS.includes('actor_type'));
      assert.ok(UsageDashboardService.BREAKDOWN_DIMENSIONS.includes('organization'));
    });

    await checkAsync('una dimensión inventada se rechaza con 400, no se ignora', async () => {
      await assert.rejects(
        () => service.getBreakdown('lo-que-sea', {}, {}),
        (error) => error.statusCode === 400
      );
    });
  }

  // -------------------------------------------------------------------------
  section('9 · Consumo reportado por el cliente (voz en vivo)');
  // -------------------------------------------------------------------------
  {
    const { FEATURES, API_FAMILIES, normalizeFeature } =
      require('../src/domain/usage/vocabulary');

    check('existe un módulo para la voz en vivo y otro para la visión', () => {
      assert.strictEqual(FEATURES.LIVE_VOICE, 'live_voice');
      assert.strictEqual(FEATURES.LIVE_VISION, 'live_vision');
      assert.strictEqual(normalizeFeature('live_voice'), 'live_voice');
    });

    check('existe la familia de API de sesión bidireccional', () => {
      assert.strictEqual(API_FAMILIES.LIVE, 'live');
    });

    check('la procedencia de las cifras es un campo permitido de metadata', () => {
      const evento = buildUsageEvent({
        provider: 'google',
        requestedModel: 'gemini-2.5-flash',
        inputTokens: 100,
        outputTokens: 50,
        metadata: { usageSource: 'client_reported', liveSessionTurns: 7 }
      });
      assert.strictEqual(evento.metadata.usageSource, 'client_reported');
      assert.strictEqual(evento.metadata.liveSessionTurns, 7);
    });

    check('lo reportado por el cliente NO puede colar contenido de la conversación', () => {
      const evento = buildUsageEvent({
        provider: 'google',
        requestedModel: 'gemini-2.5-flash',
        inputTokens: 10,
        metadata: {
          usageSource: 'client_reported',
          transcript: 'el paciente Juan Pérez refiere dolor',
          audio: 'base64...'
        }
      });
      assert.strictEqual(evento.metadata.transcript, undefined);
      assert.strictEqual(evento.metadata.audio, undefined);
    });

    check('dos envíos de la MISMA sesión no se cuentan dos veces', () => {
      const base = {
        provider: 'google',
        apiFamily: 'live',
        requestedModel: 'gemini-2.5-flash',
        feature: 'live_voice',
        inputTokens: 900,
        outputTokens: 400,
        sessionId: 'sesion-viva-1',
        occurredAt: '2026-08-06T18:00:00.000Z'
      };
      const a = buildUsageEvent(base);
      const b = buildUsageEvent({ ...base });
      assert.strictEqual(a.idempotencyKey, b.idempotencyKey);
    });

    check('dos sesiones distintas SÍ son dos eventos', () => {
      const base = {
        provider: 'google',
        apiFamily: 'live',
        requestedModel: 'gemini-2.5-flash',
        feature: 'live_voice',
        inputTokens: 900,
        outputTokens: 400,
        occurredAt: '2026-08-06T18:00:00.000Z'
      };
      const a = buildUsageEvent({ ...base, sessionId: 'sesion-viva-1' });
      const b = buildUsageEvent({ ...base, sessionId: 'sesion-viva-2' });
      assert.notStrictEqual(a.idempotencyKey, b.idempotencyKey);
    });

    check('el vídeo de enseñanza normaliza el usageMetadata de Gemini', () => {
      const { fromGemini } = require('../src/domain/usage/providerUsage');
      const usage = fromGemini({
        usageMetadata: { promptTokenCount: 120000, candidatesTokenCount: 800, totalTokenCount: 120800 },
        modelVersion: 'gemini-2.5-flash'
      });
      // Los fotogramas ya vienen contados dentro de promptTokenCount: no hay
      // ninguna unidad especial que decidir, que era la excusa para no medirlo.
      assert.strictEqual(usage.hasUsage, true);
      assert.strictEqual(usage.inputTokens, 120000);
      assert.strictEqual(usage.totalTokens, 120800);
    });
  }

  console.log(`\n✅ Telemetría de consumo de IA: ${checks} comprobaciones OK.`);
})().catch((error) => {
  console.error(`\n❌ ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});
