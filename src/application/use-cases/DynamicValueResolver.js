// Resuelve los valores POR-EJECUCIÓN de los steps dynamic de un workflow a partir del `context`
// que manda el agente ("paciente Juan Pérez, documento 12345678"). Es la pieza que faltaba del
// modelo de coincidencia (fixed/dynamic/flexible, ver doc coincidencia-superficie-estado): la
// clasificación existía y se persistía, pero nadie convertía el contexto en valores.
//
// Mismo patrón que NoteFieldMatcher (el otro caso texto->campos del repo): LLM con salida JSON
// estructurada, umbral de confianza, y si no hay LLM el caller decide — aquí NUNCA se degrada en
// silencio a los valores grabados, porque "crear al paciente grabado" es peor que fallar.

const CONFIDENCE_THRESHOLD = 0.7;

function buildPrompt() {
  return [
    'Eres el resolvedor de valores dinámicos de workflows de UI.',
    'Recibes el CONTEXTO de una ejecución concreta (lo que pidió el usuario, p.ej. datos de un paciente)',
    'y la lista de campos marcados como dinámicos, con su etiqueta, tipo y opciones permitidas.',
    '',
    'Devuelve el valor de cada campo que el contexto realmente contenga. Reglas:',
    '- NO inventes datos: si el contexto no trae el dato de un campo, omite ese campo.',
    '- `formatExample` es un ejemplo del FORMATO grabado (dígitos, mayúsculas…), de OTRA ejecución.',
    '  NUNCA copies su contenido; úsalo solo para dar formato al dato que sí está en el contexto.',
    '- En campos con `allowedOptions`, `value` debe ser el `value` EXACTO de la opción cuyo significado',
    '  coincide con el contexto (no el texto visible).',
    '- `confidence` entre 0 y 1: qué tan seguro estás de que el contexto contiene ese dato.',
    '- `evidence`: el fragmento literal del contexto del que sacaste el valor.'
  ].join('\n');
}

function buildResponseFormat() {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'dynamic_values',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          values: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                stepOrder: { type: 'number' },
                value: { type: 'string' },
                confidence: { type: 'number' },
                evidence: { type: 'string' }
              },
              required: ['stepOrder', 'value', 'confidence', 'evidence']
            }
          }
        },
        required: ['values']
      }
    }
  };
}

class DynamicValueResolver {
  constructor(llmProvider = null) {
    this.llmProvider = llmProvider;
  }

  hasLlm() {
    return Boolean(this.llmProvider?.hasApiKey?.());
  }

  buildMessages({ context = '', steps = [] } = {}) {
    const fields = steps.slice(0, 60).map((step) => ({
      stepOrder: Number(step?.stepOrder),
      label: `${step?.label || ''}`,
      controlType: `${step?.controlType || ''}`,
      bindTo: `${step?.bindTo || ''}`,
      // El valor grabado como pista de FORMATO, jamás de contenido (la instrucción vive en el prompt).
      formatExample: `${(step?.actionType === 'select' ? step?.selectedValue : step?.value) || ''}`,
      allowedOptions: Array.isArray(step?.allowedOptions)
        ? step.allowedOptions.slice(0, 80).map((o) => ({ value: `${o?.value || ''}`, label: `${o?.label || o?.text || ''}` }))
        : []
    }));

    return [
      { role: 'system', content: buildPrompt() },
      { role: 'user', content: JSON.stringify({ context: `${context}`, fields }) }
    ];
  }

  /// Devuelve { values: { [stepOrder]: string }, usage } con solo los valores que superan el umbral.
  async resolve({ context = '', steps = [] } = {}) {
    if (!this.hasLlm()) {
      throw new Error(
        'El workflow tiene campos dinámicos y llegó contexto, pero no hay LLM configurado ' +
        'para resolverlos (variables GRAPH_LLM_*).'
      );
    }

    const response = await this.llmProvider.chatExpectingJsonWithUsage(
      this.buildMessages({ context, steps }),
      buildResponseFormat()
    );
    const parsed = this.llmProvider.parseJsonObject(response.content || '{}') || {};
    const rows = Array.isArray(parsed.values) ? parsed.values : [];

    const values = {};
    for (const row of rows) {
      const stepOrder = Number(row?.stepOrder);
      const value = `${row?.value ?? ''}`;
      const confidence = Number(row?.confidence) || 0;
      if (!Number.isFinite(stepOrder) || value === '' || confidence < CONFIDENCE_THRESHOLD) continue;
      values[stepOrder] = value;
    }

    return { values, usage: response.usage || null };
  }
}

module.exports = DynamicValueResolver;
