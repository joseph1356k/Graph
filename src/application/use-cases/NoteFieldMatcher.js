const { withFeature } = require('../../infrastructure/usage/UsageContext');
const { FEATURES } = require('../../domain/usage/vocabulary');
const { withPrivacyScope, lastPrivacyResult } = require('../../infrastructure/privacy/PrivacyContext');
const { containsToken } = require('../../domain/privacy/tokens');

const {
  PROMPT_VERSION,
  buildNoteFieldMatchingPrompt,
  buildNoteFieldMatchingResponseFormat
} = require('./NoteFieldMatchingPolicy');
const grounding = require('../../domain/clinical/grounding');
const { isPrudentEmptyContent } = require('./ClinicalNoteValidationService');

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
  normalizeResult(parsed = {}, usage = null, fields = []) {
    const matches = Array.isArray(parsed.matches) ? parsed.matches : [];
    // Opciones permitidas por paso: un select puede tener de verdad una opción
    // «No referido», y esa sí es un valor.
    const optionsByStep = new Map((Array.isArray(fields) ? fields : []).map((field) => [
      Number(field?.stepOrder),
      new Set((Array.isArray(field?.allowedOptions) ? field.allowedOptions : [])
        .map((option) => `${option && typeof option === 'object' ? option.value ?? '' : option ?? ''}`))
    ]));
    const isAllowedOption = (m) => Boolean(optionsByStep.get(m.stepOrder)?.has(m.value));
    let withToken = 0;
    let prudent = 0;
    const clean = matches
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
      // Una frase prudente no es un valor: escribirla en SAP pondría «No
      // mencionado en la consulta.» en la historia clínica como si fuera el
      // dato. Salvo que sea, literalmente, una opción del select de ese paso.
      .filter((m) => {
        if (!Number.isFinite(m.stepOrder) || m.value === '' || !m.accepted) return false;
        if (isPrudentEmptyContent(m.value) && !isAllowedOption(m)) {
          prudent += 1;
          return false;
        }
        return true;
      })
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
      .map(({ accepted, ...m }) => (containsToken(m.evidence) ? { ...m, evidence: '' } : m));
    const submitReason = `${parsed.submitReason || ''}`.slice(0, 200);
    return {
      matches: clean,
      // El modelo contó como lleno lo que se acaba de descartar: si se quitó un
      // marcador o una frase prudente, el formulario ya no está listo para enviar.
      readyToSubmit: Boolean(parsed.readyToSubmit) && withToken === 0 && prudent === 0,
      submitReason: withToken > 0
        ? `${withToken} valor(es) descartado(s) por traer un marcador de privacidad sin resolver`
        : prudent > 0
          ? `${prudent} campo(s) sin dato en la nota: quedan vacíos para que el médico los llene`
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
        const raw = await withFeature(
          FEATURES.FIELD_MATCHING,
          () => this.llmProvider.chatExpectingJsonWithUsage(
            this.buildMessages(payload),
            buildNoteFieldMatchingResponseFormat(),
            { temperature: TEMPERATURE }
          ),
          { metadata: { promptVersion: PROMPT_VERSION, temperature: TEMPERATURE } }
        );
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
      return { ...this.normalizeResult(parsed, usage, payload.fields), privacy: privacy || null };
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
