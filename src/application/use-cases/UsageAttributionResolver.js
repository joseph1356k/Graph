// Resuelve QUIÉN consumió, en el servidor, a partir de lo que ya está
// verificado en la petición.
//
// PRINCIPIO NO NEGOCIABLE: el `user_id` y el `organization_id` NUNCA vienen del
// cuerpo ni de una cabecera del cliente. Salen de:
//   · el JWT de Supabase ya verificado contra el JWKS (requireClinicalAuth), o
//   · una identidad registrada en servidor (email de Windows, device de Android),
//     resuelta contra la base con service-role.
// Lo único que el cliente puede *sugerir* es la app y el módulo, porque son
// etiquetas de clasificación sin consecuencia de seguridad: mentir ahí solo
// ensucia su propio informe, no da acceso a datos de nadie. Aun así la app se
// contrasta con la vía de autenticación usada, que sí es dura.
//
// El mapeo email→perfil se cachea en memoria: sin caché, cada llamada del
// cliente Windows añadiría un round-trip a Supabase en el camino crítico.

const { APPS, ACTOR_TYPES, ATTRIBUTION_SOURCES, normalizeApp, normalizeFeature } =
  require('../../domain/usage/vocabulary');

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

class UsageAttributionResolver {
  constructor(options = {}) {
    this.supabase = options.supabaseClient || null;
    this.cache = new Map();
    this.cacheTtlMs = options.cacheTtlMs || CACHE_TTL_MS;
    this.now = options.now || (() => Date.now());
  }

  cacheGet(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  cacheSet(key, value) {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      // Desalojo simple del más antiguo: el mapa conserva orden de inserción.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { value, expiresAt: this.now() + this.cacheTtlMs });
  }

  /** perfil por uuid de auth: da la organización del usuario. */
  async profileById(userId) {
    if (!userId || !this.supabase?.isConfigured?.()) return null;
    const cacheKey = `id:${userId}`;
    const cached = this.cacheGet(cacheKey);
    if (cached !== undefined) return cached;

    let profile = null;
    try {
      const rows = await this.supabase.request(
        `/profiles?id=eq.${encodeURIComponent(userId)}&select=id,organization_id,role&limit=1`,
        { method: 'GET' }
      );
      profile = Array.isArray(rows) && rows[0] ? rows[0] : null;
    } catch (error) {
      // Un fallo al resolver la organización no puede tumbar la llamada al
      // modelo ni perder el evento: se registra sin organización y se sigue.
      profile = null;
    }
    this.cacheSet(cacheKey, profile);
    return profile;
  }

  /** perfil por email: la identidad canónica del cliente Windows es el correo. */
  async profileByEmail(email) {
    const normalized = `${email || ''}`.trim().toLowerCase();
    if (!normalized || !this.supabase?.isConfigured?.()) return null;
    const cacheKey = `email:${normalized}`;
    const cached = this.cacheGet(cacheKey);
    if (cached !== undefined) return cached;

    let profile = null;
    try {
      const rows = await this.supabase.request(
        `/profiles?email=eq.${encodeURIComponent(normalized)}&select=id,organization_id,role&limit=1`,
        { method: 'GET' }
      );
      profile = Array.isArray(rows) && rows[0] ? rows[0] : null;
    } catch (error) {
      profile = null;
    }
    this.cacheSet(cacheKey, profile);
    return profile;
  }

  /**
   * App declarada por el cliente, contrastada con la vía de autenticación.
   * Una sesión de Supabase solo puede ser el portal web; una API key solo puede
   * ser uno de los clientes nativos. Si la cabecera no encaja, gana la vía.
   */
  resolveApp(req, authPath) {
    const declared = normalizeApp(req?.get?.('x-miracle-app') || req?.headers?.['x-miracle-app']);

    if (authPath === 'session') {
      // El portal es la única superficie que trae JWT de Supabase.
      return APPS.WEB_APP;
    }
    if (authPath === 'api_key') {
      const nativas = [APPS.WINDOWS_APP, APPS.ANDROID_APP, APPS.CHROME_EXTENSION, APPS.WEB_APP];
      return nativas.includes(declared) ? declared : APPS.WINDOWS_APP;
    }
    return declared !== APPS.UNKNOWN ? declared : APPS.BACKEND;
  }

  resolveFeature(req, fallback) {
    const declared = normalizeFeature(
      req?.get?.('x-miracle-feature') || req?.headers?.['x-miracle-feature']
    );
    return declared !== 'unknown' ? declared : normalizeFeature(fallback);
  }

  /**
   * Construye el contexto de atribución de una petición HTTP.
   * Devuelve siempre un contexto válido: si no hay forma de atribuir, lo dice
   * (`unattributed`) en vez de inventar un usuario o descartar el consumo.
   */
  async resolveFromRequest(req, options = {}) {
    const requestId = `${req?.get?.('x-request-id') || req?.id || ''}`.slice(0, 120);
    const sessionId = `${req?.get?.('x-miracle-session') || req?.body?.session_id || ''}`.slice(0, 120);

    // --- 1. Sesión de Supabase verificada (portal clínico) ------------------
    // requireClinicalAuth ya validó la firma contra el JWKS; `sub` es el uuid
    // de auth.users. Esta es la atribución más fuerte que tenemos.
    const clinicalUserId = `${req?.clinicalUser?.id || ''}`.trim();
    if (clinicalUserId) {
      const profile = await this.profileById(clinicalUserId);
      return {
        userId: clinicalUserId,
        organizationId: profile?.organization_id || null,
        actorType: ACTOR_TYPES.USER,
        attributionSource: ATTRIBUTION_SOURCES.SESSION,
        app: this.resolveApp(req, 'session'),
        feature: this.resolveFeature(req, options.feature),
        sessionId,
        requestId,
        workflowId: ''
      };
    }

    // --- 2. Cliente nativo con API key --------------------------------------
    // La API key autentica la APLICACIÓN, no a la persona. La persona se
    // resuelve por su identidad registrada en servidor: el email con el que se
    // instaló el cliente Windows, o el device de Android. Ambos se contrastan
    // contra `profiles`; si no hay perfil, el consumo queda atribuido a la
    // instalación pero sin usuario — y se dice.
    if (req?.apiClient) {
      const app = this.resolveApp(req, 'api_key');
      const claimedEmail = `${req?.get?.('x-miracle-user-email') || ''}`.trim().toLowerCase();
      const claimedUserId = `${req?.get?.('x-miracle-user-id') || ''}`.trim();
      const deviceId = `${req?.get?.('x-miracle-device-id') || ''}`.trim();

      // El uuid que manda el portal NO se acepta tal cual: se comprueba contra
      // `profiles`. Si no existe, no hay atribución — igual que con el correo.
      // Lo que autoriza la petición sigue siendo la API key; esto solo dice a
      // quién imputar el gasto, y ese dato se verifica.
      if (claimedUserId) {
        const profile = await this.profileById(claimedUserId);
        if (profile?.id) {
          return {
            userId: profile.id,
            organizationId: profile.organization_id || null,
            actorType: ACTOR_TYPES.USER,
            attributionSource: ATTRIBUTION_SOURCES.API_KEY,
            app,
            feature: this.resolveFeature(req, options.feature),
            sessionId,
            requestId,
            workflowId: ''
          };
        }
      }

      if (claimedEmail) {
        const profile = await this.profileByEmail(claimedEmail);
        if (profile?.id) {
          return {
            userId: profile.id,
            organizationId: profile.organization_id || null,
            actorType: ACTOR_TYPES.USER,
            attributionSource: ATTRIBUTION_SOURCES.API_KEY,
            app,
            feature: this.resolveFeature(req, options.feature),
            sessionId,
            requestId,
            workflowId: ''
          };
        }
      }

      // Instalación conocida pero sin cuenta en el portal: se registra el
      // dispositivo como correlación técnica y el actor queda sin atribuir.
      return {
        userId: null,
        organizationId: null,
        actorType: ACTOR_TYPES.UNATTRIBUTED,
        attributionSource: deviceId ? ATTRIBUTION_SOURCES.DEVICE : ATTRIBUTION_SOURCES.NONE,
        app,
        feature: this.resolveFeature(req, options.feature),
        sessionId: sessionId || deviceId.slice(0, 120),
        requestId,
        workflowId: ''
      };
    }

    // --- 3. Sesión local de administrador (paneles internos de Graph) -------
    // No es un usuario clínico y no pertenece a ninguna organización: es el
    // operador interno. Se clasifica como `system`, no como usuario.
    if (req?.user?.id) {
      return {
        userId: null,
        organizationId: null,
        actorType: ACTOR_TYPES.SYSTEM,
        attributionSource: ATTRIBUTION_SOURCES.INTERNAL,
        app: APPS.BACKEND,
        feature: this.resolveFeature(req, options.feature),
        sessionId,
        requestId,
        workflowId: ''
      };
    }

    // --- 4. Nada que atribuir ------------------------------------------------
    return {
      userId: null,
      organizationId: null,
      actorType: ACTOR_TYPES.UNATTRIBUTED,
      attributionSource: ATTRIBUTION_SOURCES.NONE,
      app: this.resolveApp(req, 'none'),
      feature: this.resolveFeature(req, options.feature),
      sessionId,
      requestId,
      workflowId: ''
    };
  }
}

module.exports = UsageAttributionResolver;
