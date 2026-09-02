// Herramientas propias de Ü (las que no vienen del MCP), declaradas UNA vez.
//
// Antes cada cerebro (OpenAI, Gemini) redactaba por su cuenta la descripción de
// ask_user / speak / list_apps, y las dos versiones ya habían divergido: la
// descripción de una herramienta es instrucción de comportamiento tanto como
// el prompt, así que vive junto a él y se declara desde aquí en ambos.
const ASSISTANT_TOOLS = Object.freeze([
  Object.freeze({
    name: 'ask_user',
    description: 'Pregunta al usuario cuando tengas una duda real e importante, y SIEMPRE antes de cualquier acción irreversible. Responde con texto o voz.',
    params: Object.freeze([{ name: 'question', description: 'La pregunta, corta y natural.' }])
  }),
  Object.freeze({
    name: 'speak',
    description: 'Di algo en voz alta con tu personalidad. Solo para lo importante; no narres cada paso.',
    params: Object.freeze([{ name: 'text', description: 'Lo que dices.' }])
  }),
  Object.freeze({
    name: 'list_apps',
    description: 'Lista las aplicaciones instaladas para elegir cuál abrir.',
    params: Object.freeze([])
  })
]);

const ASSISTANT_TOOL_NAMES = Object.freeze(ASSISTANT_TOOLS.map((tool) => tool.name));

module.exports = { ASSISTANT_TOOLS, ASSISTANT_TOOL_NAMES };
