class WorkflowExecutionGuideBuilder {
  constructor(llmProvider = null) {
    this.llmProvider = llmProvider;
  }

  normalizeText(value = '') {
    return `${value || ''}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  collectAlternativeTargets(step = {}) {
    const rawTargets = Array.isArray(step?.surfaceHints?.alternativeTargets)
      ? step.surfaceHints.alternativeTargets
      : [];

    const unique = [];
    const seen = new Set();

    rawTargets
      .map((value) => `${value || ''}`.trim())
      .filter(Boolean)
      .forEach((value) => {
        const normalized = this.normalizeText(value);
        if (!normalized || seen.has(normalized)) {
          return;
        }
        seen.add(normalized);
        unique.push(value);
      });

    return unique.slice(0, 8);
  }

  buildDraft(description = '', steps = []) {
    const clickTargets = (Array.isArray(steps) ? steps : [])
      .filter((step) => `${step?.actionType || ''}`.trim().toLowerCase() === 'click')
      .map((step) => ({
        stepOrder: step.stepOrder,
        semanticTarget: `${step.semanticTarget || step.label || ''}`.trim(),
        selector: `${step.selector || ''}`.trim(),
        alternatives: this.collectAlternativeTargets(step)
      }))
      .filter((entry) => entry.semanticTarget || entry.alternatives.length > 0);

    const freeTextSteps = (Array.isArray(steps) ? steps : [])
      .filter((step) => `${step?.actionType || ''}`.trim().toLowerCase() === 'input')
      .map((step) => ({
        stepOrder: step.stepOrder,
        label: `${step.label || step.selector || ''}`.trim()
      }))
      .filter((entry) => entry.label);

    const lines = [
      '# workflow-execution-guide.md',
      '',
      '## Goal',
      `- ${description || 'Complete the learned workflow reliably.'}`,
      '',
      '## Stable Path',
      ...((Array.isArray(steps) ? steps : []).map((step) => {
        const stepTarget = step.selector || step.url || step.label || '(no target)';
        return `- Step ${step.stepOrder}: ${step.actionType} -> ${stepTarget}`;
      })),
      ''
    ];

    if (clickTargets.length > 0) {
      lines.push('## Transversal Opportunities');
      clickTargets.forEach((entry) => {
        lines.push(`- Step ${entry.stepOrder} is a visible-entity selection point.`);
        if (entry.semanticTarget) {
          lines.push(`- Learned visible target: ${entry.semanticTarget}.`);
        }
        if (entry.alternatives.length > 0) {
          lines.push(`- Similar visible alternatives seen during learning: ${entry.alternatives.join('; ')}.`);
        }
        lines.push(`- If the user requests another similar visible entity on the same surface, map that request to \`target_${entry.stepOrder}\`.`);
      });
      lines.push('');
    }

    if (clickTargets.length > 0) {
      lines.push('## Runtime Intelligence Triggers');
      clickTargets.forEach((entry) => {
        lines.push(`- After Step ${entry.stepOrder}, runtime intelligence may briefly reinterpret the next controls if a transversal target changed the entity page.`);
      });
      lines.push('- Use runtime intelligence only to patch current/upcoming step values, skip controls that are not applicable on the current surface, ask for help, or abort safely.');
      lines.push('- Return to the stable learned path as soon as the current runtime uncertainty is resolved.');
      lines.push('');
    }

    if (freeTextSteps.length > 0) {
      lines.push('## Free Text Boundaries');
      freeTextSteps.forEach((entry) => {
        lines.push(`- Step ${entry.stepOrder} writes into "${entry.label}". Use it only for true free text requested by the user.`);
      });
      if (clickTargets.length > 0) {
        lines.push('- Do not place a catalog entity, product name, service name, or card title into a free-text field when it semantically belongs to a visible selection step.');
      }
      lines.push('');
    }

    lines.push('## Guardrails');
    lines.push('- Apply transversal substitutions only when the page pattern is still the same and the requested option is visibly present or strongly implied by the learned surface.');
    lines.push('- If the requested alternative is ambiguous, ask one short clarification instead of guessing.');
    lines.push('');

    return lines.join('\n').trim();
  }

  async buildGuide(workflow = {}) {
    const draft = this.buildDraft(workflow.description || workflow.summary || '', workflow.steps || []);
    if (!this.llmProvider || typeof this.llmProvider.hasApiKey !== 'function' || !this.llmProvider.hasApiKey()) {
      return draft;
    }

    try {
      const content = await this.llmProvider.chat([
        {
          role: 'system',
          content: [
            'You write markdown execution guides for learned UI workflows.',
            'Keep exact step numbers and any variable names you mention.',
            'Highlight where transversal substitutions are allowed and where they are not.',
            'Do not invent fields or steps.',
            // La UI del propio asistente (la app "Ü", proceso "U", origin uia://U.exe: botones Enseñar/
            // Detener, la carita, el panel Backend…) NUNCA es parte de un workflow: el usuario la usa
            // para controlar la grabación, no para la tarea. El grabador ya la excluye; esto es refuerzo.
            'Ignore any step that targets the assistant\'s own UI (the "Ü" app / process "U" / origin uia://U.exe). It is never part of the workflow.',
            'Return markdown only.'
          ].join(' ')
        },
        {
          role: 'user',
          content: JSON.stringify({
            workflow: {
              id: workflow.id || '',
              description: workflow.description || '',
              summary: workflow.summary || '',
              steps: workflow.steps || []
            },
            draft
          })
        }
      ]);

      return `${content || ''}`.trim() || draft;
    } catch (error) {
      return draft;
    }
  }

  // Clasifica CÓMO debe coincidir el valor de cada step al reejecutar (los 3 escenarios). Devuelve
  // [{stepOrder, valueMode, bindTo}] solo para steps input/select/click. Fail-safe: ante cualquier duda
  // o error → [] (el default 'fixed' del Step mantiene el comportamiento de siempre, sin regresión).
  async classifyValueModes(workflow = {}) {
    const steps = (Array.isArray(workflow.steps) ? workflow.steps : [])
      .map((s) => ({
        stepOrder: s.stepOrder,
        actionType: `${s.actionType || ''}`.trim().toLowerCase(),
        label: `${s.label || ''}`.trim(),
        value: `${s.value || s.selectedLabel || s.semanticTarget || ''}`.trim()
      }));
    const classifiable = steps.filter((s) => ['input', 'select', 'click'].includes(s.actionType));
    if (!classifiable.length || !this.llmProvider || typeof this.llmProvider.hasApiKey !== 'function' || !this.llmProvider.hasApiKey()) {
      return [];
    }

    try {
      const content = await this.llmProvider.chat([
        {
          role: 'system',
          content: [
            'You classify how each step of a learned UI workflow must match its value when REPLAYED, so the workflow generalizes correctly across runs and apps.',
            'For each input/select/click step pick exactly one valueMode:',
            '- "fixed": always reuse the exact taught value (e.g. a specific document or patient the user explicitly wants every time).',
            '- "dynamic": the value changes per run (comes from the user/context). Set "bindTo" to another step variable ("input_<stepOrder>" or "target_<stepOrder>") ONLY when the value must equal a previous step (e.g. "same patient as step 4").',
            '- "flexible": the exact value does not matter (e.g. selecting "the new tab", opening "a new blank note", picking any item). On replay it is best-effort and skippable.',
            'Use the description, summary, context notes (what the user SAID while teaching) and the step sequence as signals. A selection of a just-created item (a tab/note created by a preceding "add/new" click) is almost always "flexible". When genuinely unsure, choose "fixed" (safest).',
            'Return ONLY a JSON array, no prose: [{"stepOrder":N,"valueMode":"fixed|dynamic|flexible","bindTo":""}].'
          ].join(' ')
        },
        {
          role: 'user',
          content: JSON.stringify({
            description: workflow.description || '',
            summary: workflow.summary || '',
            contextNotes: Array.isArray(workflow.contextNotes) ? workflow.contextNotes : [],
            steps
          })
        }
      ]);
      return this.parseValueModes(content, classifiable);
    } catch (error) {
      return [];
    }
  }

  parseValueModes(content, classifiable) {
    const allowedOrders = new Set(classifiable.map((c) => Number(c.stepOrder)));
    const modes = ['fixed', 'dynamic', 'flexible'];
    let arr;
    try {
      const match = `${content || ''}`.match(/\[[\s\S]*\]/); // tolera texto alrededor del JSON
      arr = JSON.parse(match ? match[0] : `${content}`);
    } catch (error) {
      return [];
    }
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && allowedOrders.has(Number(x.stepOrder)))
      .map((x) => ({
        stepOrder: Number(x.stepOrder),
        valueMode: modes.includes(`${x.valueMode || ''}`.trim().toLowerCase()) ? `${x.valueMode}`.trim().toLowerCase() : 'fixed',
        bindTo: `${x.bindTo || ''}`.trim()
      }))
      .filter((x) => x.valueMode !== 'fixed' || x.bindTo); // fixed sin bindTo es el default: no hace falta persistir
  }
}

module.exports = WorkflowExecutionGuideBuilder;
