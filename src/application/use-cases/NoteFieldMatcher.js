const { withFeature } = require('../../infrastructure/usage/UsageContext');
const { FEATURES } = require('../../domain/usage/vocabulary');
const { withPrivacyScope, lastPrivacyResult } = require('../../infrastructure/privacy/PrivacyContext');
const { containsToken } = require('../../domain/privacy/tokens');

const {
  buildNoteFieldMatchingPrompt,
  buildNoteFieldMatchingResponseFormat
} = require('./NoteFieldMatchingPolicy');

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

  normalizeResult(parsed = {}, usage = null) {
    const matches = Array.isArray(parsed.matches) ? parsed.matches : [];
    let withToken = 0;
    const clean = matches
      .map((m) => ({
        stepOrder: Number(m?.stepOrder),
        value: `${m?.value ?? ''}`,
        confidence: Number(m?.confidence) || 0,
        evidence: `${m?.evidence ?? ''}`.slice(0, 200)
      }))
      .filter((m) => Number.isFinite(m.stepOrder) && m.value !== '' && m.confidence >= 0.75)
      // GUARDA DE MARCADORES: un valor con `[PACIENTE_NOMBRE_1]` que no se
      // pudo rehidratar NUNCA se devuelve. El cliente Windows escribe lo que
      // recibe en SAP sin mirarlo (RellenadorSap.cs), lo relee no vacío y lo
      // reporta como éxito: el marcador acabaría en la historia clínica.
      .filter((m) => {
        if (containsToken(m.value)) {
          withToken += 1;
          return false;
        }
        return true;
      })
      .map((m) => (containsToken(m.evidence) ? { ...m, evidence: '' } : m));
    const submitReason = `${parsed.submitReason || ''}`.slice(0, 200);
    return {
      matches: clean,
      readyToSubmit: Boolean(parsed.readyToSubmit) && withToken === 0,
      submitReason: withToken > 0
        ? `${withToken} valor(es) descartado(s) por traer un marcador de privacidad sin resolver`
        : (containsToken(submitReason) ? '' : submitReason),
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
      // Ámbito de privacidad: con `consultationId` el escudo siembra desde
      // `consultations` y `patients`; sin él, desde las líneas de identidad
      // de la propia nota y los valores de los campos en pantalla.
      const scope = {
        consultationId: `${payload.consultationId || payload.exportId || ''}`.trim(),
        noteContent: `${payload.noteContent || ''}`
      };
      const { response, privacy } = await withPrivacyScope(scope, async () => {
        const raw = await withFeature(FEATURES.FIELD_MATCHING, () => this.llmProvider.chatExpectingJsonWithUsage(
          this.buildMessages(payload),
          buildNoteFieldMatchingResponseFormat()
        ));
        return { response: raw, privacy: lastPrivacyResult() };
      });
      const parsed = this.llmProvider.parseJsonObject(response.content || '{}');
      const usage = response.usage ? {
        provider: response.provider || this.llmProvider?.provider || '',
        apiFamily: 'chat_completions',
        model: response.model || this.llmProvider?.model || '',
        inputTokens: Number(response.usage?.prompt_tokens) || 0,
        outputTokens: Number(response.usage?.completion_tokens) || 0,
        totalTokens: Number(response.usage?.total_tokens) || 0
      } : null;
      return { ...this.normalizeResult(parsed, usage), privacy: privacy || null };
    } catch (error) {
      return {
        ...this.emptyResult(),
        submitReason: `note field matcher failed: ${error?.message || 'unknown error'}`
      };
    }
  }
}

module.exports = NoteFieldMatcher;
