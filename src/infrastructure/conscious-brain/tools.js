// Herramientas propias de Ü (las que no vienen del MCP), declaradas UNA vez.
//
// Antes cada cerebro (OpenAI, Gemini) redactaba por su cuenta la descripción de
// ask_user / speak / list_apps, y las dos versiones ya habían divergido: la
// descripción de una herramienta es instrucción de comportamiento tanto como
// el prompt, así que vive junto a él y se declara desde aquí en ambos. Dice lo
// mismo que OBEDECE (application/prompts/ConstitucionDeU.js): cambiarla sube la
// versión del prompt (conscious-brain/prompt.js).
const ASSISTANT_TOOLS = Object.freeze([
  Object.freeze({
    name: 'ask_user',
    description: 'Pregúntale a la persona y espera su respuesta, solo en tres casos: falta un dato que solo ella sabe y que cambia el resultado (a quién, cuánto, qué fecha); vas a hacer una acción irreversible que nadie te pidió; o lo que te pidieron choca con lo que tienes delante (un nombre o una cifra que no cuadra) y la decisión es suya. No sirve para pedir permiso para lo que ya te pidieron. Una pregunta, corta; la persona contesta con texto o voz.',
    params: Object.freeze([{ name: 'question', description: 'La pregunta, corta: un solo dato o una sola decisión, con la razón delante cuando no es obvia.' }])
  }),
  Object.freeze({
    name: 'speak',
    description: 'Dile algo en voz alta a la persona mientras trabajas, sin esperar respuesta: solo un aviso que no la necesita (algo va a tardar). Lo que no cuadra o un dato que te falta va con ask_user. No narres cada paso: el resultado va en tu respuesta final.',
    params: Object.freeze([{ name: 'text', description: 'Lo que dices, en una frase.' }])
  }),
  Object.freeze({
    name: 'list_apps',
    description: 'Lista las aplicaciones instaladas para elegir cuál abrir.',
    params: Object.freeze([])
  })
]);

const ASSISTANT_TOOL_NAMES = Object.freeze(ASSISTANT_TOOLS.map((tool) => tool.name));

module.exports = { ASSISTANT_TOOLS, ASSISTANT_TOOL_NAMES };
