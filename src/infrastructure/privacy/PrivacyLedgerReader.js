// Lectura del ledger de consumo para responder «qué se protegió en cada envío
// de esta consulta». El escudo no tiene tabla propia: sus conteos viajan en
// `ai_usage_events.metadata` (claves `privacy*` de la allowlist), y
// `session_id` es el id del encounter. Aquí solo se leen columnas técnicas;
// el contenido clínico nunca estuvo en esa tabla.

const MAX_EVENTS = 100;

function privacyFromMetadata(metadata = {}) {
  const meta = metadata && typeof metadata === 'object' ? metadata : {};
  if (!meta.privacyMode) return null;
  const tokens = {};
  for (const pair of `${meta.privacyTokens || ''}`.split(',')) {
    const [type, count] = pair.split(':');
    if (type && type !== 'none') tokens[type] = Number(count) || 0;
  }
  return {
    mode: `${meta.privacyMode}`,
    shielded: meta.privacyMode === 'enforce',
    tokens,
    seeded: Number(meta.privacySeeded) || 0,
    detected: Number(meta.privacyDetected) || 0,
    leak_scan: `${meta.privacyLeakScan || 'n/a'}`,
    rehydration: `${meta.privacyRehydration || 'n/a'}`,
    posthoc_leak: typeof meta.privacyPosthoc === 'boolean' ? meta.privacyPosthoc : null,
    image_parts: Number(meta.privacyImageParts) || 0,
    payload_sha256: `${meta.privacyPayloadSha256 || ''}`,
    error: meta.privacyError ? `${meta.privacyError}` : null
  };
}

class PrivacyLedgerReader {
  constructor(restClient, { logger = console } = {}) {
    this.restClient = restClient || null;
    this.logger = logger;
  }

  isConfigured() {
    return Boolean(this.restClient && (typeof this.restClient.isConfigured !== 'function' || this.restClient.isConfigured()));
  }

  /** Envíos a proveedores de una sesión (= encounter), del más reciente al más antiguo. */
  async eventsForSession(sessionId) {
    const id = `${sessionId || ''}`.trim();
    if (!id || !this.isConfigured()) return [];
    try {
      const rows = await this.restClient.select(
        'ai_usage_events',
        `session_id=eq.${encodeURIComponent(id)}&select=occurred_at,feature,provider,requested_model,api_family,status,metadata&order=occurred_at.desc&limit=${MAX_EVENTS}`
      );
      return (Array.isArray(rows) ? rows : []).map((row) => ({
        at: row.occurred_at,
        feature: row.feature,
        provider: row.provider,
        model: row.requested_model,
        api_family: row.api_family,
        status: row.status,
        privacy: privacyFromMetadata(row.metadata)
      }));
    } catch (error) {
      this.logger.warn?.(`[Privacidad] No se pudo leer el ledger: ${error.message}`);
      return [];
    }
  }
}

PrivacyLedgerReader.privacyFromMetadata = privacyFromMetadata;

module.exports = PrivacyLedgerReader;
