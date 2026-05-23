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
}

module.exports = WorkflowExecutionGuideBuilder;
