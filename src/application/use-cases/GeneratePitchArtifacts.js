const fs = require('fs');
const path = require('path');

class GeneratePitchArtifacts {
  constructor(catalogService, llmProvider, outputRoot) {
    this.catalogService = catalogService;
    this.llmProvider = llmProvider;
    this.outputRoot = outputRoot;
  }

  slugify(value, fallback = 'page') {
    const normalized = `${value || ''}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return normalized || fallback;
  }

  normalizePathname(value = '') {
    let pathname = `${value || ''}`.trim();
    if (!pathname) {
      return '';
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

  filterWorkflowsForContext(workflows, context = {}) {
    const appId = `${context.appId || ''}`.trim();
    const sourcePathname = this.normalizePathname(context.sourcePathname || '');

    return (workflows || []).filter((workflow) => {
      if (appId && `${workflow.appId || ''}`.trim() !== appId) {
        return false;
      }

      if (sourcePathname && this.normalizePathname(workflow.sourcePathname || '') !== sourcePathname) {
        return false;
      }

      return true;
    });
  }

  buildOutputDirectory(context = {}) {
    const appSlug = this.slugify(context.appId || 'shared-app', 'shared-app');
    const pathSlug = this.slugify(this.normalizePathname(context.sourcePathname || '').replace(/\//g, '-'), 'page');
    return path.join(this.outputRoot, appSlug, pathSlug);
  }

  buildWorkflowDigest(workflows) {
    return workflows.slice(0, 12).map((workflow) => ({
      id: workflow.id,
      description: workflow.description,
      summary: workflow.summary,
      totalSteps: workflow.totalSteps || (workflow.steps || []).length,
      steps: (workflow.steps || []).slice(0, 18).map((step) => ({
        stepOrder: step.stepOrder,
        actionType: step.actionType,
        selector: step.selector,
        label: step.label,
        controlType: step.controlType,
        selectedValue: step.selectedValue,
        selectedLabel: step.selectedLabel
      }))
    }));
  }

  buildFallbackPitchMarkdown(context = {}, workflows = []) {
    const pageTitle = context.sourceTitle || context.workflowDescription || 'Current page';
    const assistantProfile = context.assistantProfile || {};

    return [
      '# pitchpersonality.md',
      '',
      '## Purpose',
      `This file defines the sales pitch personality for the workflow segment on "${pageTitle}".`,
      'The assistant should advance partial workflow segments autonomously while sounding personal, natural, and commercially sharp.',
      '',
      '## Page Context',
      `- appId: ${context.appId || 'unknown'}`,
      `- sourcePathname: ${context.sourcePathname || 'unknown'}`,
      `- workflows analyzed: ${workflows.length}`,
      '',
      '## Global Pitch Rules',
      `- Tone: ${assistantProfile.tone || 'close, sincere, direct, human'}`,
      `- Style: ${assistantProfile.style || 'helpful advisor'}`,
      '- Never sound like a scripted questionnaire even when repeating the same structure.',
      '- Ask only for the next missing data that unlocks the next workflow segment.',
      '- Confirm useful details naturally and use them to make the pitch feel personalized.',
      '- Keep the conversation moving toward the next concrete page action.',
      '',
      '## Segment 1: Opening And Qualification',
      '- Goal: understand the trip, timing, and broad customer intent.',
      '- Ask for the context of the trip before asking for detailed form fields.',
      '- Sound consultative, as if helping narrow the best next step.',
      '',
      '## Segment 2: Vehicle Fit And Selection',
      '- Goal: connect the trip details with capacity, route, luggage, and comfort needs.',
      '- Recommend a vehicle style based on use case, not only price.',
      '- Use concise comparisons so the customer feels guided, not pressured.',
      '',
      '## Segment 3: Commitment And Data Capture',
      '- Goal: gather the exact information needed to complete the current page smoothly.',
      '- Transition into data capture by explaining why each missing detail matters.',
      '- Keep the pitch warm while becoming more operational and precise.',
      '',
      '## Segment 4: Closing Confidence',
      '- Goal: reduce hesitation and reinforce trust before the final submission or next action.',
      '- Reassure on clarity, convenience, and fit for the customer plan.',
      '- End with a direct next-step invitation.',
      '',
      '## Notes From Observed Workflows',
      ...(workflows.slice(0, 5).map((workflow) => `- ${workflow.id}: ${workflow.summary || workflow.description || 'No summary available.'}`))
    ].join('\n');
  }

  buildFutureImprovementMarkdown(context = {}) {
    return [
      '# future-improvement.md',
      '',
      '## Future Implementation Backlog',
      'This file tracks the capabilities intentionally left out of the first floating-assistant release.',
      '',
      '## Phase 2: Real-Time Conversation Core',
      '- Add real-time voice output so the floating assistant can narrate tours and explain actions while workflows run.',
      '- Add real-time speech input so the assistant can ask for missing information and listen naturally.',
      '- Add assistant-driven function calling in real time, letting the conversation itself decide when to query memory, trigger workflows, or request clarification.',
      '',
      '## Phase 3: User Memory And Experience Timeline',
      '- Capture user answers, hesitation points, repeated questions, and accepted recommendations as structured memory.',
      '- Maintain a page-level and user-level interaction timeline that improves future decisions.',
      '- Distinguish between ephemeral session facts and durable profile facts before storing them long term.',
      '- Track business pain points, objections, and missed expectations expressed during assistant conversations.',
      '- Track opportunity signals such as high purchase intent, urgency, upsell cues, trust triggers, and unanswered commercial interest.',
      '',
      '## Phase 3.5: Real-Time Voice Business Intelligence',
      '- Let the real-time assistant talk with users through voice while they navigate the page.',
      '- Extract valuable business insight in real time from those voice conversations without breaking the natural flow.',
      '- Separate pain-point evidence from opportunity evidence so the system can highlight both what blocks conversion and what accelerates it.',
      '- Tie each insight to page sections, workflow moments, and conversation turns so future recommendations are grounded in real interaction evidence.',
      '',
      '## Phase 4: Omnichannel CRM Sync',
      '- Continuously sync high-value user data and conversation outcomes into HubSpot or another CRM.',
      '- Track consent, source attribution, and field ownership before writing commercial profile data.',
      '- Use CRM updates to personalize future on-site conversations and off-site follow-up.',
      '',
      '## Phase 5: Learning And Content Generation',
      '- Regenerate `pitchpersonality.md` from real behavioral evidence, not only recorded workflows.',
      '- Detect friction patterns and produce page-improvement recommendations tied to real selectors and page sections.',
      '- Add smarter journey segmentation so the assistant can decide between sales, onboarding, support, and recovery modes.',
      '',
      '## Planned Input Sources',
      '- Real assistant conversations with users',
      '- Real-time voice conversations between the assistant and page visitors',
      '- Field completion patterns across the page',
      '- Repeated hesitation points, drop-offs, and recovery paths',
      '- Sections where users need too many clarifications before continuing',
      '- Commercial objections, intent cues, and opportunity signals discovered during the conversation',
      '',
      '## Planned Result',
      'The system will regenerate and refine `pitchpersonality.md` from real behavioral evidence, so each workflow segment learns how to ask for the right information at the right moment with less friction.',
      'The same evidence will also feed future page-improvement suggestions based on real user pain points and real opportunity signals, not only internal heuristics.',
      '',
      '## Continuous Improvement Vision',
      'This will be the start of a continuous improvement system to solve web page design issues based on real user behavior.',
      'The long-term goal is not only to improve the assistant pitch, but also to reveal where the page structure, copy, field order, or interaction model should change.',
      '',
      '## Current Context',
      `- appId: ${context.appId || 'unknown'}`,
      `- sourcePathname: ${context.sourcePathname || 'unknown'}`,
      `- generatedAt: ${new Date().toISOString()}`
    ].join('\n');
  }

  buildImprovementSuggestions(context = {}, workflows = []) {
    const steps = workflows.flatMap((workflow) => workflow.steps || []);
    const formSteps = steps.filter((step) => ['input', 'select'].includes(step?.actionType));
    const selectSteps = steps.filter((step) => step?.actionType === 'select');
    const clickSteps = steps.filter((step) => step?.actionType === 'click');
    const uniqueSelectors = new Set(steps.map((step) => step?.selector).filter(Boolean));
    const titles = workflows
      .map((workflow) => workflow.description || workflow.summary || '')
      .filter(Boolean)
      .slice(0, 3);

    const pageLabel = context.sourceTitle || context.workflowDescription || 'esta pagina';
    const evidenceLabel = titles.length ? titles.join(' | ') : 'workflows grabados en esta pagina';

    const suggestions = [
      {
        id: 'reduce-form-friction',
        priority: 'high',
        title: 'Reducir la friccion del formulario principal',
        summary: 'Divide la captura en bloques mas claros y explica antes de pedir datos para que el usuario no sienta un cuestionario frio.',
        evidence: `Se detectaron ${formSteps.length || 0} pasos de captura dentro de ${workflows.length || 0} workflow(s) observados en ${pageLabel}.`,
        opportunity: 'Una entrada mas guiada puede mejorar conversion y calidad de los datos capturados.',
        source: 'Heuristicas del plugin basadas en workflows grabados; luego se alimentara con conversaciones reales del asistente.'
      },
      {
        id: 'clarify-user-intent-earlier',
        priority: 'medium',
        title: 'Aclarar intencion y contexto antes de pedir detalle operativo',
        summary: 'Muestra microcopy o ayudas breves para entender objetivo, urgencia y uso antes de entrar a toda la captura operacional.',
        evidence: `Los recorridos actuales muestran acciones sobre ${uniqueSelectors.size || 0} elementos distintos, lo que sugiere que la pagina pide varias decisiones seguidas.`,
        opportunity: 'Si el usuario declara contexto primero, el asistente y la pagina pueden personalizar mejor la experiencia comercial.',
        source: `Basado en ${evidenceLabel}.`
      }
    ];

    if (selectSteps.length > 0) {
      suggestions.push({
        id: 'make-selects-more-explanatory',
        priority: 'medium',
        title: 'Hacer mas explicitas las decisiones en selects y ubicaciones',
        summary: 'Agrega texto de ayuda, valores sugeridos o contexto visual cerca de los selects para reducir dudas antes de elegir.',
        evidence: `Se registraron ${selectSteps.length} interacciones de seleccion en los workflows de esta pagina.`,
        opportunity: 'Menos incertidumbre en elecciones clave reduce abandono y acelera el avance hacia la conversion.',
        source: 'Deteccion automatica del plugin sobre pasos de tipo select.'
      });
    }

    if (clickSteps.length > 0) {
      suggestions.push({
        id: 'reinforce-next-action-confidence',
        priority: 'low',
        title: 'Reforzar confianza antes del siguiente clic importante',
        summary: 'Coloca mensajes de confianza, tiempos de respuesta o beneficios justo antes del CTA que confirma el avance.',
        evidence: `Se observaron ${clickSteps.length} pasos de clic como parte del recorrido aprendido.`,
        opportunity: 'Reducir la duda justo antes del CTA puede mejorar la tasa de avance y la disposicion a compartir datos.',
        source: 'Heuristica de conversion del plugin; mas adelante se priorizara con evidencia de voz y objeciones reales.'
      });
    }

    return suggestions.slice(0, 4);
  }

  buildImprovementTour(context = {}, workflows = []) {
    const seenSelectors = new Set();
    const stops = [];

    for (const workflow of workflows) {
      const actionableSteps = (workflow.steps || []).filter((step) => {
        if (!step || !step.selector || step.actionType === 'navigation') {
          return false;
        }
        if (seenSelectors.has(step.selector)) {
          return false;
        }
        seenSelectors.add(step.selector);
        return true;
      });

      actionableSteps.slice(0, 6).forEach((step) => {
        stops.push({
          workflowId: workflow.id,
          selector: step.selector,
          title: step.label || step.selector,
          message: step.explanation
            || `Aqui ${context.appId || 'el asistente'} aprendio a ${step.actionType} "${step.label || step.selector}".`,
          actionType: step.actionType,
          stepOrder: step.stepOrder
        });
      });

      if (stops.length >= 8) {
        break;
      }
    }

    return {
      title: `Recorrido de mejoras en ${context.sourceTitle || context.sourcePathname || 'esta pagina'}`,
      appId: context.appId || '',
      sourcePathname: context.sourcePathname || '',
      stops: stops.slice(0, 8)
    };
  }

  async generatePitchMarkdownWithLLM(context = {}, workflows = []) {
    if (!this.llmProvider || !this.llmProvider.hasApiKey()) {
      return this.buildFallbackPitchMarkdown(context, workflows);
    }

    const assistantProfile = context.assistantProfile || null;
    const workflowDigest = this.buildWorkflowDigest(workflows);

    const messages = [
      {
        role: 'system',
        content: [
          'You create markdown files that define sales pitch behavior for workflow automation assistants.',
          'Return markdown only.',
          'The file must be named conceptually as pitchpersonality.md.',
          'Organize the page into partial workflow segments.',
          'For each segment, explain the sales intention, what information must be extracted, how to sound personalized even when repeating a reliable sales pattern, and what kind of next action the assistant should unlock.',
          'The writing should feel operational and reusable by a salesperson assistant.',
          'Do not mention implementation details like APIs, JSON, or databases.'
        ].join(' ')
      },
      {
        role: 'user',
        content: JSON.stringify({
          context: {
            appId: context.appId || '',
            sourcePathname: context.sourcePathname || '',
            sourceTitle: context.sourceTitle || '',
            workflowDescription: context.workflowDescription || '',
            assistantProfile
          },
          workflows: workflowDigest
        })
      }
    ];

    return this.llmProvider.chat(messages);
  }

  async execute(context = {}, access = null) {
    const workflows = this.filterWorkflowsForContext(await this.catalogService.getCatalog(access), context);
    const outputDir = this.buildOutputDirectory(context);
    fs.mkdirSync(outputDir, { recursive: true });

    const pitchPath = path.join(outputDir, 'pitchpersonality.md');
    const futurePath = path.join(outputDir, 'future-improvement.md');
    const tourPath = path.join(outputDir, 'improvement-tour.json');
    const suggestionsPath = path.join(outputDir, 'improvement-suggestions.json');

    const pitchMarkdown = await this.generatePitchMarkdownWithLLM(context, workflows);
    const futureMarkdown = this.buildFutureImprovementMarkdown(context);
    const tour = this.buildImprovementTour(context, workflows);
    const suggestions = this.buildImprovementSuggestions(context, workflows);

    fs.writeFileSync(pitchPath, pitchMarkdown, 'utf8');
    fs.writeFileSync(futurePath, futureMarkdown, 'utf8');
    fs.writeFileSync(tourPath, JSON.stringify(tour, null, 2), 'utf8');
    fs.writeFileSync(suggestionsPath, JSON.stringify(suggestions, null, 2), 'utf8');

    return {
      outputDir,
      files: [
        { name: 'pitchpersonality.md', path: pitchPath },
        { name: 'future-improvement.md', path: futurePath },
        { name: 'improvement-tour.json', path: tourPath },
        { name: 'improvement-suggestions.json', path: suggestionsPath }
      ],
      workflowCount: workflows.length,
      tour,
      suggestions
    };
  }

  async previewImprovements(context = {}, access = null) {
    const workflows = this.filterWorkflowsForContext(await this.catalogService.getCatalog(access), context);
    return {
      workflowCount: workflows.length,
      suggestions: this.buildImprovementSuggestions(context, workflows),
      futureNarrative: this.buildFutureImprovementMarkdown(context)
    };
  }
}

module.exports = GeneratePitchArtifacts;
