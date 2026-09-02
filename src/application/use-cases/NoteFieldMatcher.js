const { withFeature } = require('../../infrastructure/usage/UsageContext');
const { FEATURES } = require('../../domain/usage/vocabulary');

const {
  PROMPT_VERSION,
  buildNoteFieldMatchingPrompt,
  buildNoteFieldMatchingResponseFormat
} = require('./NoteFieldMatchingPolicy');
const grounding = require('../../domain/clinical/grounding');

// Umbral heredado para salidas sin `grounding` (proveedores que ignoran el
// json_schema y devuelven el contrato antiguo con `confidence`).
const LEGACY_CONFIDENCE_THRESHOLD = 0.75;
const TEMPERATURE = 0;

class NoteFieldMatcher {
  constructor(llmProvider = null) {
    this.llmProvider = llmProvider;
  }

  hasLlm() {
    return Boolean(this.llmProvider?.hasApiKey?.());
  }

  emptyResult() {
    return { matches: [], readyToSubmit: false, submitReason: '', usage: null };
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
      { role: 'system', content: buildNoteFieldMatchingPrompt() },
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

  // `confidence` numérico sigue en el contrato público; se deriva del
  // grounding cuando el modelo lo devuelve y se acepta el legado si no.
  normalizeResult(parsed = {}, usage = null) {
    const matches = Array.isArray(parsed.matches) ? parsed.matches : [];
    return {
      matches: matches
        .map((m) => {
          const level = grounding.normalizeGrounding(m?.grounding);
          const confidence = level
            ? grounding.confidenceFromGrounding(level)
            : Number(m?.confidence) || 0;
          return {
            stepOrder: Number(m?.stepOrder),
            value: `${m?.value ?? ''}`,
            grounding: level || grounding.groundingFromConfidence(confidence) || 'absent',
            confidence,
            evidence: `${m?.evidence ?? ''}`.slice(0, 200),
            accepted: level ? grounding.isGroundedForAutofill(level) : confidence >= LEGACY_CONFIDENCE_THRESHOLD
          };
        })
        .filter((m) => Number.isFinite(m.stepOrder) && m.value !== '' && m.accepted)
        .map(({ accepted, ...m }) => m),
      readyToSubmit: Boolean(parsed.readyToSubmit),
      submitReason: `${parsed.submitReason || ''}`.slice(0, 200),
      usage
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
      const response = await withFeature(
        FEATURES.FIELD_MATCHING,
        () => this.llmProvider.chatExpectingJsonWithUsage(
          this.buildMessages(payload),
          buildNoteFieldMatchingResponseFormat(),
          { temperature: TEMPERATURE }
        ),
        { metadata: { promptVersion: PROMPT_VERSION, temperature: TEMPERATURE } }
      );
      const parsed = this.llmProvider.parseJsonObject(response.content || '{}');
      const usage = response.usage ? {
        provider: response.provider || this.llmProvider?.provider || '',
        apiFamily: 'chat_completions',
        model: response.model || this.llmProvider?.model || '',
        inputTokens: Number(response.usage?.prompt_tokens) || 0,
        outputTokens: Number(response.usage?.completion_tokens) || 0,
        totalTokens: Number(response.usage?.total_tokens) || 0
      } : null;
      return this.normalizeResult(parsed, usage);
    } catch (error) {
      return {
        ...this.emptyResult(),
        submitReason: `note field matcher failed: ${error?.message || 'unknown error'}`
      };
    }
  }
}

NoteFieldMatcher.LEGACY_CONFIDENCE_THRESHOLD = LEGACY_CONFIDENCE_THRESHOLD;

module.exports = NoteFieldMatcher;
