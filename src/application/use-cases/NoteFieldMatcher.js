const policy = require('./NoteFieldMatchingPolicy');

class NoteFieldMatcher {
  constructor(llmProvider = null) {
    this.llmProvider = llmProvider;
  }

  hasLlm() {
    return Boolean(this.llmProvider?.hasApiKey?.());
  }

  emptyResult() {
    return { matches: [], readyToSubmit: false, submitReason: '' };
  }

  buildMessages(payload = {}) {
    const fields = (Array.isArray(payload.fields) ? payload.fields : []).slice(0, 60).map((field) => ({
      stepOrder: Number(field?.stepOrder),
      actionType: `${field?.actionType || ''}`,
      label: `${field?.label || ''}`,
      selector: `${field?.selector || ''}`,
      controlType: `${field?.controlType || ''}`,
      allowedOptions: Array.isArray(field?.allowedOptions) ? field.allowedOptions.slice(0, 80) : [],
      currentValue: `${field?.currentValue || ''}`
    }));

    return [
      { role: 'system', content: policy.buildNoteFieldMatchingPrompt() },
      {
        role: 'user',
        content: JSON.stringify({
          noteContent: `${payload.noteContent || ''}`,
          fields,
          alreadyFulfilled: Array.isArray(payload.alreadyFulfilled) ? payload.alreadyFulfilled : [],
          pageUrl: `${payload.pageUrl || ''}`
        })
      }
    ];
  }

  normalizeResult(parsed = {}) {
    const matches = Array.isArray(parsed.matches) ? parsed.matches : [];
    return {
      matches: matches
        .map((m) => ({
          stepOrder: Number(m?.stepOrder),
          value: `${m?.value ?? ''}`,
          confidence: Number(m?.confidence) || 0,
          evidence: `${m?.evidence ?? ''}`.slice(0, 200)
        }))
        .filter((m) => Number.isFinite(m.stepOrder) && m.value !== '' && m.confidence >= 0.75),
      readyToSubmit: Boolean(parsed.readyToSubmit),
      submitReason: `${parsed.submitReason || ''}`.slice(0, 200)
    };
  }

  async match(payload = {}) {
    if (!this.hasLlm()) {
      return this.emptyResult();
    }
    if (!`${payload.noteContent || ''}`.trim()) {
      return this.emptyResult();
    }
    if (!Array.isArray(payload.fields) || payload.fields.length === 0) {
      return this.emptyResult();
    }

    try {
      const content = await this.llmProvider.chatExpectingJson(
        this.buildMessages(payload),
        { type: 'json_object' }
      );
      const parsed = this.llmProvider.parseJsonObject(content || '{}');
      return this.normalizeResult(parsed);
    } catch (error) {
      return {
        ...this.emptyResult(),
        submitReason: `note field matcher failed: ${error?.message || 'unknown error'}`
      };
    }
  }
}

module.exports = NoteFieldMatcher;
