function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseAllowedOptions(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue;
  }
  if (!rawValue || typeof rawValue !== 'string') {
    return [];
  }
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function parseJsonObject(rawValue) {
  if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    return rawValue;
  }
  if (!rawValue || typeof rawValue !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

class Step {
  constructor(data = {}) {
    this.actionType = normalizeText(data.actionType) || 'unknown';
    this.selector = normalizeText(data.selector);
    this.value = typeof data.value === 'string' ? data.value : '';
    this.url = normalizeText(data.url);
    this.explanation = normalizeText(data.explanation);
    this.label = normalizeText(data.label);
    this.controlType = normalizeText(data.controlType);
    this.selectedValue = typeof data.selectedValue === 'string' ? data.selectedValue : '';
    this.selectedLabel = normalizeText(data.selectedLabel);
    this.semanticTarget = normalizeText(data.semanticTarget);
    this.surfaceSection = normalizeText(data.surfaceSection);
    this.surfaceHints = parseJsonObject(data.surfaceHints) || null;
    
    this.allowedOptions = parseAllowedOptions(data.allowedOptions)
      .map((option) => ({
          value: typeof option?.value === 'string' ? option.value : '',
          label: normalizeText(option?.label),
          text: normalizeText(option?.text)
        }))

    // Elasticidad de coincidencia por step (los 3 escenarios, ver doc "coincidencia-superficie-estado"):
    //   fixed    → usa el valor exacto enseñado (default; comportamiento de siempre).
    //   dynamic  → valor por-ejecución (del contexto); bindTo lo ata a otra variable (consistencia).
    //   flexible → el valor exacto no importa; si no resuelve, el ejecutor salta el step sin fallar.
    // Lo fija el LLM organizador al terminar la grabación (WorkflowLearner). Retrocompatible: sin él, 'fixed'.
    this.valueMode = ['fixed', 'dynamic', 'flexible'].includes(normalizeText(data.valueMode))
      ? normalizeText(data.valueMode)
      : 'fixed';
    this.bindTo = normalizeText(data.bindTo);

    this.stepOrder = Number.isFinite(data.stepOrder) ? data.stepOrder : Number(data.stepOrder);
  }
}

module.exports = Step;
