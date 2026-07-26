// @ts-check
class SurfaceProfileService {
  constructor(repository, llmProvider) {
    this.repository = repository;
    this.llmProvider = llmProvider;
    this.languageMatrix = {
      es: {
        languageName: 'neutral Latin American Spanish',
        workflowPrefixHome: 'Flujo principal para',
        workflowPrefixPage: 'Flujo para',
        assistantStyle: 'asistente web de ejecucion rapida',
        goals: [
          'Prioriza la ejecucion inmediata cuando la solicitud ya sea clara.',
          'Pregunta solo lo minimo indispensable para ejecutar un workflow.',
          'Evita cuestionarios largos o conversaciones exploratorias.'
        ],
        welcomeMessage: 'Puedo ayudarte en esta pagina. Dime que necesitas y lo hago.'
      },
      en: {
        languageName: 'natural English',
        workflowPrefixHome: 'Main workflow for',
        workflowPrefixPage: 'Workflow for',
        assistantStyle: 'fast execution web assistant',
        goals: [
          'Prioritize immediate execution once the request is clear.',
          'Ask only for the minimum information required to run a workflow.',
          'Avoid long questionnaires or exploratory conversation.'
        ],
        welcomeMessage: 'I can help you on this page. Tell me what you need and I will do it.'
      },
      pt: {
        languageName: 'natural Brazilian Portuguese',
        workflowPrefixHome: 'Fluxo principal para',
        workflowPrefixPage: 'Fluxo para',
        assistantStyle: 'assistente web de execucao rapida',
        goals: [
          'Priorize a execucao imediata quando o pedido estiver claro.',
          'Pergunte apenas o minimo indispensavel para executar um workflow.',
          'Evite questionarios longos ou conversa exploratoria.'
        ],
        welcomeMessage: 'Posso ajudar voce nesta pagina. Diga o que precisa e eu resolvo.'
      },
      fr: {
        languageName: 'natural French',
        workflowPrefixHome: 'Flux principal pour',
        workflowPrefixPage: 'Flux pour',
        assistantStyle: 'assistant web a execution rapide',
        goals: [
          'Priorise l execution immediate quand la demande est claire.',
          'Pose seulement le minimum de questions necessaires pour executer un workflow.',
          'Evite les longs questionnaires ou les conversations exploratoires.'
        ],
        welcomeMessage: 'Je peux vous aider sur cette page. Dites moi ce dont vous avez besoin et je m en charge.'
      },
      de: {
        languageName: 'natural German',
        workflowPrefixHome: 'Hauptablauf fur',
        workflowPrefixPage: 'Ablauf fur',
        assistantStyle: 'schneller web-assistent',
        goals: [
          'Priorisiere die sofortige Ausfuhrung, sobald die Anfrage klar ist.',
          'Stelle nur die minimal notwendigen Fragen, um einen Workflow auszufuhren.',
          'Vermeide lange Fragebogen oder explorative Gesprache.'
        ],
        welcomeMessage: 'Ich kann dir auf dieser Seite helfen. Sag mir, was du brauchst, und ich erledige es.'
      },
      it: {
        languageName: 'natural Italian',
        workflowPrefixHome: 'Flusso principale per',
        workflowPrefixPage: 'Flusso per',
        assistantStyle: 'assistente web a esecuzione rapida',
        goals: [
          'Dai priorita all esecuzione immediata quando la richiesta e chiara.',
          'Fai solo le domande minime necessarie per eseguire un workflow.',
          'Evita questionari lunghi o conversazioni esplorative.'
        ],
        welcomeMessage: 'Posso aiutarti in questa pagina. Dimmi cosa ti serve e lo faccio.'
      }
    };
  }

  normalizePathname(value = '') {
    let pathname = `${value || ''}`.trim();
    if (!pathname) {
      return '/';
    }

    pathname = pathname
      .replace(/^https?:\/\/[^/]+/i, '')
      .replace(/[?#].*$/, '')
      .replace(/\/{2,}/g, '/');

    if (!pathname.startsWith('/')) {
      pathname = `/${pathname}`;
    }

    if (pathname.toLowerCase().endsWith('/index.html')) {
      pathname = pathname.slice(0, -'/index.html'.length) || '/';
    }

    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    return pathname || '/';
  }

  buildNormalizedContext(context = {}) {
    const browserLocale = `${context.browserLocale || context.browserLanguage || ''}`.trim();
    const languageCode = this.normalizeLanguageCode(browserLocale);
    return {
      appId: `${context.appId || ''}`.trim(),
      sourceUrl: `${context.sourceUrl || ''}`.trim(),
      sourceOrigin: `${context.sourceOrigin || ''}`.trim(),
      sourcePathname: this.normalizePathname(context.sourcePathname || ''),
      sourceTitle: `${context.sourceTitle || ''}`.trim(),
      scope: `${context.scope || 'global'}`.trim() || 'global',
      ownerId: `${context.ownerId || ''}`.trim(),
      browserLocale,
      languageCode
    };
  }

  isVolatileSurface(context = {}) {
    const origin = `${context.sourceOrigin || ''}`.trim().toLowerCase();
    const pathname = this.normalizePathname(context.sourcePathname || '');

    // Google search results can render very different product experiences
    // under the same /search route, so reusing a persisted profile there
    // causes cross-contamination between searches like "translate" and "hola".
    return origin === 'https://www.google.com' && pathname === '/search';
  }

  normalizeLanguageCode(value = '') {
    const normalized = `${value || ''}`.trim().toLowerCase();
    if (!normalized) {
      return 'es';
    }
    const primary = normalized.split(/[-_]/)[0];
    return primary || 'es';
  }

  resolveLanguageConfig(languageCode = '') {
    return this.languageMatrix[languageCode] || this.languageMatrix.en;
  }

  buildFallbackProfile(context = {}, pageSnapshot = {}) {
    const pageLabel = context.sourceTitle || pageSnapshot.pageTitle || context.appId || 'esta pagina';
    const normalizedPath = `${context.sourcePathname || '/'}`.trim() || '/';
    const languageConfig = this.resolveLanguageConfig(context.languageCode);
    const descriptionBase = normalizedPath === '/'
      ? `${languageConfig.workflowPrefixHome} ${pageLabel}`
      : `${languageConfig.workflowPrefixPage} ${pageLabel} ${normalizedPath}`;

    return {
      appId: context.appId || '',
      sourceOrigin: context.sourceOrigin || '',
      sourcePathname: context.sourcePathname || '/',
      sourceTitle: context.sourceTitle || pageSnapshot.pageTitle || '',
      scope: context.scope || 'global',
      ownerId: context.ownerId || '',
      browserLocale: context.browserLocale || '',
      languageCode: context.languageCode || 'es',
      workflowDescription: descriptionBase,
      assistantProfile: {
        tone: 'direct, concise, action-oriented',
        style: languageConfig.assistantStyle,
        goals: [
          ...languageConfig.goals,
          `Stay grounded in the current page context: ${pageLabel}.`
        ]
      },
      assistantRuntime: {
        name: 'Graph',
        accentColor: '#0f5f8c',
        idleMessage: languageConfig.welcomeMessage
      },
      welcomeMessage: languageConfig.welcomeMessage,
      systemPromptAddendum: [
        'Always prioritize fast execution over extended conversation.',
        'If a workflow can be run safely with the information available, run it.',
        'Ask follow-up questions only when a missing value truly blocks execution.',
        `All user-facing messages must be written in ${languageConfig.languageName}.`
      ].join(' '),
      pageSummary: `${pageLabel}. Path: ${context.sourcePathname || '/'}.`
    };
  }

  looksWrongLanguage(text = '', languageCode = '') {
    const normalized = `${text || ''}`.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    if (languageCode === 'en') {
      return false;
    }

    return [
      'welcome',
      "let's",
      'lets',
      'find you',
      'perfect',
      'swiftly',
      'workflow for',
      'main workflow for',
      'help you with this page'
    ].some((token) => normalized.includes(token));
  }

  sanitizeGeneratedProfile(context = {}, generated = {}, fallback = {}) {
    const fallbackProfile = fallback || this.buildFallbackProfile(context, {});
    const assistantProfile = generated?.assistantProfile && typeof generated.assistantProfile === 'object'
      ? generated.assistantProfile
      : fallbackProfile.assistantProfile;
    const goals = Array.isArray(assistantProfile.goals)
      ? assistantProfile.goals.filter(Boolean)
      : [];

    const generatedWorkflowDescription = `${generated?.workflowDescription || fallbackProfile.workflowDescription}`.trim() || fallbackProfile.workflowDescription;
    const generatedWelcomeMessage = `${generated?.welcomeMessage || generated?.assistantRuntime?.idleMessage || fallbackProfile.welcomeMessage}`.trim() || fallbackProfile.welcomeMessage;
    const generatedIdleMessage = `${generated?.assistantRuntime?.idleMessage || generatedWelcomeMessage || fallbackProfile.assistantRuntime.idleMessage}`.trim() || fallbackProfile.assistantRuntime.idleMessage;
    const languageCode = `${generated?.languageCode || context.languageCode || fallbackProfile.languageCode || 'es'}`.trim() || 'es';

    return {
      ...fallbackProfile,
      browserLocale: `${generated?.browserLocale || context.browserLocale || fallbackProfile.browserLocale || ''}`.trim(),
      languageCode,
      workflowDescription: this.looksWrongLanguage(generatedWorkflowDescription, languageCode)
        ? fallbackProfile.workflowDescription
        : generatedWorkflowDescription,
      assistantProfile: {
        tone: `${assistantProfile.tone || fallbackProfile.assistantProfile.tone}`.trim() || fallbackProfile.assistantProfile.tone,
        style: `${assistantProfile.style || fallbackProfile.assistantProfile.style}`.trim() || fallbackProfile.assistantProfile.style,
        goals: [
          ...goals,
          'Prioritize immediate execution once the request is clear.',
          'Ask only for the minimum missing information required to run a workflow.'
        ].filter((goal, index, items) => goal && items.indexOf(goal) === index)
      },
      assistantRuntime: {
        ...fallbackProfile.assistantRuntime,
        ...(generated?.assistantRuntime && typeof generated.assistantRuntime === 'object'
          ? generated.assistantRuntime
          : {}),
        idleMessage: this.looksWrongLanguage(generatedIdleMessage, languageCode)
          ? fallbackProfile.assistantRuntime.idleMessage
          : generatedIdleMessage
      },
      welcomeMessage: this.looksWrongLanguage(generatedWelcomeMessage, languageCode)
        ? fallbackProfile.welcomeMessage
        : generatedWelcomeMessage,
      systemPromptAddendum: `${generated?.systemPromptAddendum || fallbackProfile.systemPromptAddendum}`.trim() || fallbackProfile.systemPromptAddendum,
      pageSummary: `${generated?.pageSummary || fallbackProfile.pageSummary}`.trim() || fallbackProfile.pageSummary
    };
  }

  async generateProfile(context = {}, pageSnapshot = {}) {
    const fallback = this.buildFallbackProfile(context, pageSnapshot);
    if (!this.llmProvider?.hasApiKey?.()) {
      return fallback;
    }

    const messages = [
      {
        role: 'system',
        content: [
          'You generate global page-assistant profiles for browser workflow automation.',
          'Return JSON only.',
          'Required top-level keys: workflowDescription, assistantProfile, assistantRuntime, welcomeMessage, systemPromptAddendum, pageSummary.',
          'assistantProfile must be an object with keys tone, style, goals.',
          'assistantRuntime must be an object with keys name, accentColor, idleMessage.',
          'The assistant must always prioritize rapid execution over long conversations.',
          'Never produce a profile that encourages excessive questioning.',
          'Assume the profile will be shared globally by all users visiting the same page.',
          `All user-facing text must be written in ${this.resolveLanguageConfig(context.languageCode).languageName}.`
        ].join(' ')
      },
      {
        role: 'user',
        content: JSON.stringify({
          context,
          pageSnapshot,
          constraints: {
            executionPriority: 'high',
            minimumQuestioning: true,
            sharedForAllUsersOnThisPage: true,
            targetLanguage: this.resolveLanguageConfig(context.languageCode).languageName,
            browserLocale: context.browserLocale || '',
            languageCode: context.languageCode || 'es'
          }
        })
      }
    ];

    try {
      const content = await this.llmProvider.chatExpectingJson(messages, { type: 'json_object' });
      const parsed = this.llmProvider.parseJsonObject(content);
      return this.sanitizeGeneratedProfile(context, parsed, fallback);
    } catch (error) {
      console.warn(`[SurfaceProfileService] LLM fallback: ${error.message}`);
      return fallback;
    }
  }

  async ensureGlobalProfile(rawContext = {}, pageSnapshot = {}) {
    const context = this.buildNormalizedContext(rawContext);
    const fallback = this.buildFallbackProfile(context, pageSnapshot);
    if (this.isVolatileSurface(context)) {
      const generatedProfile = await this.generateProfile(context, pageSnapshot);
      return {
        surfaceProfile: generatedProfile,
        generated: true,
        volatile: true
      };
    }

    const existing = await this.repository.getSurfaceProfile(
      context.appId,
      context.sourceOrigin,
      context.sourcePathname,
      context.scope,
      context.ownerId,
      context.languageCode
    );

    if (existing) {
      const sanitizedExisting = this.sanitizeGeneratedProfile(context, existing, fallback);
      const existingNeedsRefresh = JSON.stringify({
        workflowDescription: existing.workflowDescription || '',
        welcomeMessage: existing.welcomeMessage || '',
        assistantRuntime: existing.assistantRuntime || {}
      }) !== JSON.stringify({
        workflowDescription: sanitizedExisting.workflowDescription || '',
        welcomeMessage: sanitizedExisting.welcomeMessage || '',
        assistantRuntime: sanitizedExisting.assistantRuntime || {}
      });

      if (existingNeedsRefresh) {
        const refreshed = await this.repository.upsertSurfaceProfile({
          ...existing,
          ...sanitizedExisting,
          id: existing.id
        });
        return {
          surfaceProfile: refreshed,
          generated: false
        };
      }

      await this.repository.touchSurfaceProfile(existing.id);
      return {
        surfaceProfile: existing,
        generated: false
      };
    }

    const generatedProfile = await this.generateProfile(context, pageSnapshot);
    const saved = await this.repository.upsertSurfaceProfile(generatedProfile);
    return {
      surfaceProfile: saved,
      generated: true
    };
  }
}

module.exports = SurfaceProfileService;
