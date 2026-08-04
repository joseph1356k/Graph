// @ts-check
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

    // Paso de árbol SAP (ver CONTRATO-PASO-ARBOL, acordado con el cliente Windows). Los nodos de un
    // GuiTree no viven en el selector (que apunta al árbol entero): se accionan por CLAVE y su
    // identidad estable es la RUTA jerárquica — la etiqueta no sirve para resolver ("Órdenes
    // Clínicas" aparece 17 veces en el árbol real del hospital). actionType sigue siendo 'click';
    // la presencia de nodeKey es lo que activa la rama de árbol en el ejecutor del cliente.
    //   nodeKey    -> clave del nodo (p.ej. "vw00073"); cómo se acciona (selectNode/doubleClickNode).
    //   nodePath   -> ruta GetNodePathByKey (p.ej. "1\2\7"); cómo se re-resuelve si la clave cambió.
    //   nodeAction -> select | double | expand | collapse; vacío = el ejecutor asume double.
    this.nodeKey = normalizeText(data.nodeKey);
    this.nodePath = normalizeText(data.nodePath);
    this.nodeAction = ['select', 'double', 'expand', 'collapse'].includes(normalizeText(data.nodeAction))
      ? normalizeText(data.nodeAction)
      : '';
    
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
    // ¿El modo vino EXPLÍCITO en el origen (autoría manual, o ya persistido en la base)? Regla
    // "el que autora manda": solo los steps SIN modo explícito quedan sin propiedad en Neo4j,
    // y el clasificador LLM del finish rellena únicamente esos (coalesce en setStepValueModes).
    // Transitorio: no se persiste como propiedad propia.
    this.valueModeExplicit = ['fixed', 'dynamic', 'flexible'].includes(normalizeText(data.valueMode));

    this.stepOrder = Number.isFinite(data.stepOrder) ? data.stepOrder : Number(data.stepOrder);
  }
}

module.exports = Step;
