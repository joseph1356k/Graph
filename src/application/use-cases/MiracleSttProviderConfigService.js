const VercelProjectEnvService = require('./VercelProjectEnvService');

// Soniox context has a ~10k char limit; cap the custom vocabulary well under it.
const MAX_CUSTOM_TERMS_CHARS = 9000;

class MiracleSttProviderConfigService {
  constructor(options = {}) {
    this.vercelEnvService = options.vercelEnvService || new VercelProjectEnvService(options);
  }

  // Medical specialty catalog for the vocabulary panel. Ids must match the
  // Python presets in integrations/soniox/context.py (SPECIALTY_PRESETS); the
  // actual term glossaries live there — this list only drives the UI dropdown.
  static get SPECIALTIES() {
    return [
      { id: 'general', label: 'Medicina General / Familiar' },
      { id: 'cardiologia', label: 'Cardiología' },
      { id: 'pediatria', label: 'Pediatría' },
      { id: 'ginecologia', label: 'Ginecología y Obstetricia' },
      { id: 'dermatologia', label: 'Dermatología' }
    ];
  }

  static get PROVIDERS() {
    return {
      deepgram: {
        id: 'deepgram',
        label: 'Deepgram Streaming',
        description: 'STT en streaming para el boton Grabar del asistente flotante y Miracle.',
        requiresApiKey: true,
        requiresModel: true,
        apiKeyEnv: 'DEEPGRAM_API_KEY',
        defaultModel: 'nova-3',
        modelOptions: ['nova-3', 'nova-2'],
        defaultLanguage: 'es',
        recommended: true
      },
      soniox: {
        id: 'soniox',
        label: 'Soniox Streaming',
        description: 'STT en streaming (Soniox stt-rt-v5) para el boton Grabar del asistente flotante y Miracle.',
        requiresApiKey: true,
        requiresModel: true,
        apiKeyEnv: 'SONIOX_API_KEY',
        defaultModel: 'stt-rt-v5',
        modelOptions: ['stt-rt-v5'],
        defaultLanguage: 'es',
        recommended: false
      },
      disabled: {
        id: 'disabled',
        label: 'Deshabilitado',
        description: 'Apaga por completo el STT en streaming.',
        requiresApiKey: false,
        requiresModel: false,
        apiKeyEnv: null,
        defaultModel: '',
        modelOptions: [],
        defaultLanguage: 'es',
        recommended: false
      }
    };
  }

  static defaultProviderId() {
    if (process.env.MIRACLE_STT_PROVIDER) {
      return `${process.env.MIRACLE_STT_PROVIDER}`.trim().toLowerCase();
    }
    if (`${process.env.DEEPGRAM_API_KEY || ''}`.trim()) {
      return 'deepgram';
    }
    if (`${process.env.SONIOX_API_KEY || ''}`.trim()) {
      return 'soniox';
    }
    return 'disabled';
  }

  status() {
    const providerId = MiracleSttProviderConfigService.defaultProviderId();
    const spec = MiracleSttProviderConfigService.PROVIDERS[providerId] || MiracleSttProviderConfigService.PROVIDERS.disabled;
    const model = `${process.env.MIRACLE_STT_MODEL || spec.defaultModel || ''}`.trim();
    const language = `${process.env.MIRACLE_STT_LANGUAGE || spec.defaultLanguage || 'es'}`.trim();
    const configured = spec.id === 'disabled'
      ? true
      : Boolean(spec.apiKeyEnv && `${process.env[spec.apiKeyEnv] || ''}`.trim());

    return {
      providers: Object.values(MiracleSttProviderConfigService.PROVIDERS).map((provider) => ({
        id: provider.id,
        label: provider.label,
        description: provider.description,
        requires_api_key: provider.requiresApiKey,
        requires_model: provider.requiresModel,
        default_model: provider.defaultModel,
        model_options: provider.modelOptions || [],
        default_language: provider.defaultLanguage,
        recommended: provider.recommended,
        stored_api_key: provider.apiKeyEnv ? `${process.env[provider.apiKeyEnv] || ''}`.trim() : ''
      })),
      current_setup: {
        provider: spec.id,
        label: spec.label,
        model,
        language,
        configured
      },
      status: {
        provider: spec.id,
        model,
        language,
        configured,
        storage: 'vercel-env',
        redeploy_required: false
      },
      medical: MiracleSttProviderConfigService.readMedicalConfig(),
      vercel: this.vercelEnvService.status()
    };
  }

  // The medical vocabulary panel applies to Soniox only (the `context` field is
  // Soniox-specific; Deepgram ignores it).
  static readMedicalConfig() {
    const specialties = MiracleSttProviderConfigService.SPECIALTIES;
    const rawSpecialty = `${process.env.MIRACLE_STT_SPECIALTY || 'general'}`.trim().toLowerCase();
    const specialty = specialties.some((item) => item.id === rawSpecialty) ? rawSpecialty : 'general';
    const domain = `${process.env.MIRACLE_STT_DOMAIN || 'general'}`.trim().toLowerCase() === 'medical'
      ? 'medical'
      : 'general';
    return {
      applies_to: ['soniox'],
      domain,
      enabled: domain === 'medical',
      specialty,
      specialties,
      custom_terms: `${process.env.MIRACLE_STT_CUSTOM_TERMS || ''}`
    };
  }

  async configure(payload = {}) {
    const providerId = `${payload.provider || ''}`.trim().toLowerCase();
    const spec = MiracleSttProviderConfigService.PROVIDERS[providerId];
    if (!spec) {
      const error = new Error('Provider de STT no soportado.');
      error.statusCode = 400;
      throw error;
    }

    this.vercelEnvService.assertWritable();

    const requestedApiKey = `${payload.api_key || ''}`.trim();
    const requestedModel = `${payload.model || ''}`.trim();
    const requestedLanguage = `${payload.language || ''}`.trim();

    const existingApiKey = spec.apiKeyEnv ? `${process.env[spec.apiKeyEnv] || ''}`.trim() : '';
    const apiKey = requestedApiKey || existingApiKey;
    const model = requestedModel || `${process.env.MIRACLE_STT_MODEL || ''}`.trim() || spec.defaultModel || '';
    const language = requestedLanguage || `${process.env.MIRACLE_STT_LANGUAGE || ''}`.trim() || spec.defaultLanguage || 'es';

    if (spec.requiresApiKey && !apiKey) {
      const error = new Error(`La API key de ${spec.label} es obligatoria para habilitar el STT.`);
      error.statusCode = 400;
      throw error;
    }

    const envWrites = [
      this.vercelEnvService.upsertProjectEnv('MIRACLE_STT_PROVIDER', providerId, { secret: false }),
      this.vercelEnvService.upsertProjectEnv('MIRACLE_STT_MODEL', providerId === 'disabled' ? '' : model, { secret: false }),
      this.vercelEnvService.upsertProjectEnv('MIRACLE_STT_LANGUAGE', language, { secret: false })
    ];

    if (spec.requiresApiKey && spec.apiKeyEnv && apiKey) {
      envWrites.push(this.vercelEnvService.upsertProjectEnv(spec.apiKeyEnv, apiKey, { secret: true }));
    }

    await Promise.all(envWrites);
    const deployment = await this.vercelEnvService.triggerRedeploy();

    return {
      ok: true,
      provider: providerId,
      summary: {
        provider: providerId,
        model: providerId === 'disabled' ? null : model,
        language
      },
      deployment
    };
  }

  static normalizeCustomTerms(raw = '') {
    const seen = new Set();
    const terms = [];
    for (const line of `${raw || ''}`.replace(/\r/g, '\n').split('\n')) {
      for (const chunk of line.split(',')) {
        const term = chunk.trim();
        if (!term) continue;
        const key = term.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        terms.push(term);
      }
    }
    // Cap to Soniox's context budget, dropping whole terms from the end.
    const kept = [];
    let used = 0;
    for (const term of terms) {
      const cost = term.length + 1;
      if (used + cost > MAX_CUSTOM_TERMS_CHARS) break;
      kept.push(term);
      used += cost;
    }
    return { text: kept.join('\n'), count: kept.length, dropped: terms.length - kept.length };
  }

  // Persists the medical specialization (Soniox `context`). Independent of the
  // provider/API-key form so vocabulary can be tuned without re-entering keys.
  async configureMedical(payload = {}) {
    this.vercelEnvService.assertWritable();

    const requestedDomain = `${payload.domain || (payload.enabled ? 'medical' : 'general')}`.trim().toLowerCase();
    const domain = requestedDomain === 'medical' ? 'medical' : 'general';

    const requestedSpecialty = `${payload.specialty || 'general'}`.trim().toLowerCase();
    const specialty = MiracleSttProviderConfigService.SPECIALTIES.some((item) => item.id === requestedSpecialty)
      ? requestedSpecialty
      : 'general';

    const normalized = MiracleSttProviderConfigService.normalizeCustomTerms(payload.custom_terms);

    await Promise.all([
      this.vercelEnvService.upsertProjectEnv('MIRACLE_STT_DOMAIN', domain, { secret: false }),
      this.vercelEnvService.upsertProjectEnv('MIRACLE_STT_SPECIALTY', specialty, { secret: false }),
      this.vercelEnvService.upsertProjectEnv('MIRACLE_STT_CUSTOM_TERMS', normalized.text, { secret: false })
    ]);
    const deployment = await this.vercelEnvService.triggerRedeploy();

    return {
      ok: true,
      summary: {
        domain,
        enabled: domain === 'medical',
        specialty,
        custom_terms_count: normalized.count,
        custom_terms_dropped: normalized.dropped
      },
      deployment
    };
  }
}

module.exports = MiracleSttProviderConfigService;
