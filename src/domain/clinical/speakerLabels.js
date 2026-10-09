// Las etiquetas de hablante dentro de la transcripción (spec 070).
//
// Los clientes escriben una línea «[Hablante N] …» cada vez que Soniox oye
// otra voz. No hay columna aparte: la etiqueta viaja en el mismo texto que el
// médico ve y corrige, y que ya leen la nota, el espejo y las exportaciones.
// Este módulo es el único sitio de Graph que sabe leerla.

const LABEL = /(^|\n)\[Hablante (\d+)\][ \t]*/g;

/** Los números de hablante distintos que aparecen en el texto. */
function speakersIn(transcript = '') {
  const found = new Set();
  for (const match of `${transcript || ''}`.matchAll(LABEL)) found.add(match[2]);
  return found;
}

/**
 * Lo que el modelo tiene que leer. Con dos voces o más, el texto tal cual; con
 * una sola, sin la etiqueta: un dictado no es una conversación, y el modo
 * literal copiaría «[Hablante 1]» a la nota.
 */
function forModel(transcript = '') {
  const text = `${transcript || ''}`;
  const speakers = speakersIn(text).size;
  if (speakers !== 1) return { text, speakers };
  return { text: text.replace(LABEL, (_, lead) => (lead ? ' ' : '')).trim(), speakers };
}

module.exports = { speakersIn, forModel };
