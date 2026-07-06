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
    
    this.stepOrder = Number.isFinite(data.stepOrder) ? data.stepOrder : Number(data.stepOrder);
  }
}

module.exports = Step;
