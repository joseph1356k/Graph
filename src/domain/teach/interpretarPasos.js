// LO QUE SE LE PREGUNTA A UN MODELO SOBRE UNA DEMOSTRACIÓN, escrito UNA sola vez.
//
// Hay dos caminos para hacer esta misma pregunta y por eso el texto vive aquí y no dentro de
// ninguno de los dos:
//
//   · CON VIDEO — GeminiVideoClient, pegado al prompt clínico, en la misma llamada que ya mira el
//     mp4. Es el mejor: el modelo ve la pantalla además de leer los pasos.
//   · SIN VIDEO — TeachStepsInterpreter, solo texto, por el proveedor del cerebro. Nació el
//     2026-09-03, cuando la cuenta de Gemini se quedó sin saldo («429: Your prepayment credits are
//     depleted») y con ella se cayó una interpretación que en realidad NO necesita ver la pantalla:
//     distinguir «nwp1 es cómo se llega» de «70 es el peso de este paciente» se hace con los pasos
//     y con lo que la persona iba diciendo.
//
// Dos copias de estas palabras se habrían separado en la primera corrección, y entonces la misma
// demo daría respuestas distintas según hubiera saldo — un fallo imposible de diagnosticar desde
// el lado del cliente, que solo ve el resultado.
//
// TRANSVERSAL A PROPÓSITO: ni una palabra de medicina. El cliente Windows sirve para cualquier
// programa y cualquier tarea, y lo único que cambia entre dominios son los prompts; este es el que
// tiene que valer para todos.
//
// OMITIR NO ES NEUTRAL, y esto lo destapó la PRIMERA llamada contra producción (2026-09-03): con
// dos pasos —«nwp1» en el campo de comandos y «70» en el peso— el modelo contestó por el peso y se
// saltó el de comandos, porque una versión anterior de estas reglas le decía «si dudas, déjalo
// fuera». Del otro lado, un campo ausente significa «no llegó a mirarlo» y el cliente conserva lo
// que dedujo su propia regla — que es justo la que marcaba «nwp1» como dato y rompía la skill. Un
// silencio que el lector interpreta ya no es un silencio: es una respuesta, y hay que pedirla
// explícita.
//
// QUÉ SE DELEGA Y QUÉ NO. Se delega EL CRITERIO —esto es un dato de la corrida, esto es parte de la
// tarea, esto significa aquello—. No se delega LA IDENTIDAD: la lista de campos es cerrada y el
// cliente descarta cualquier campo que no esté en ella antes de tocar la skill. Sin esa separación
// una alucinación escribiría un valor en un campo que nadie eligió, y eso no daría error: daría un
// número plausible en el sitio equivocado.

/** Los pasos, en el formato compacto que el modelo lee mejor que un JSON. */
function listaDePasos(steps) {
  return steps
    .map((s) => {
      const partes = [`${s.order}. campo: ${s.field}`];
      if (s.value) partes.push(`tecleó: "${s.value}"`);
      if (s.said) partes.push(`decía: "${s.said}"`);
      return `- ${partes.join(' | ')}`;
    })
    .join('\n');
}

/** El cuerpo de la pregunta. Lo comparten el camino con video y el camino sin él. */
function reglasDeInterpretacion(steps) {
  return `
Este es el registro exacto de lo que la persona tocó mientras grababa, tomado por el cliente (no por
ti):

${listaDePasos(steps)}

Para cada paso donde se TECLEÓ algo, decide si ese valor es:

  · UN DATO DE ESTA CORRIDA ("esDato": true) — cambia cada vez que se hace la tarea: el valor
    concreto de un formulario, un identificador, una medida, un texto que describe un caso. Al
    repetir la tarea con otros datos, este valor NO debe reproducirse.
  · PARTE FIJA DE LA TAREA ("esDato": false) — es igual siempre: un código de transacción, un
    término de búsqueda que forma parte del procedimiento, una opción de menú escrita a mano. Al
    repetir la tarea, este valor SÍ debe reproducirse tal cual, o la tarea no arranca.

Y para los elementos sobre los que te quede claro CÓMO SE USAN, devuelve un "recuerdo": una frase
corta que le sirva a quien opere después. Formato aceptado, restricción, qué se pone ahí, cuál de
dos campos parecidos es el bueno.

REGLAS, y son estrictas:
- "campos" lleva UNA entrada POR CADA PASO EN EL QUE SE TECLEÓ ALGO. Todos, sin excepción, también
  los que sean parte fija de la tarea — ésos con "esDato": false. OMITIR UN CAMPO NO ES NEUTRAL: el
  cliente lo interpreta como que no llegaste a mirarlo, y entonces se queda con lo que dedujo una
  regla suya mucho más tonta que tú. Si un paso tecleó algo, contesta por él.
- Si de verdad no puedes decidir sobre uno, pon "esDato": true. Es la opción prudente y sabemos por
  qué: dar por fijo un dato que en realidad cambia haría que se reescribiera el valor de otro caso
  encima de este; dar por variable algo que era fijo solo hace que la tarea se pare y lo diga.
- Usa EXACTAMENTE los identificadores de "campo" de la lista de arriba, copiados carácter a carácter.
  Un campo que no esté en esa lista se descarta y tu respuesta se pierde: no inventes ninguno.
- "significado" es CORTO: unas pocas palabras que nombran qué va ahí ("el peso en kilos", "el código
  de transacción"). Nunca una frase larga ni una transcripción de lo que se dijo.
- "recuerdos" sí es opcional y va solo donde tengas algo útil que decir sobre CÓMO se usa ese
  elemento. Un elemento que no entiendas, fuera.
- No metas en "significado" ni en "recuerdos" ningún valor concreto que aparezca en pantalla: los
  campos se describen por lo que SON, no por lo que tenían ese día.
`.trim();
}

/** La forma de la respuesta. La lee `LoQueElModeloInterpreta` en el cliente. */
const FORMA_DE_LA_RESPUESTA = `
"campos": [{"campo": "<identificador exacto>", "esDato": true, "significado": "..."}],
"recuerdos": [{"campo": "<identificador exacto>", "significado": "..."}]
`.trim();

/**
 * El bloque que se AÑADE al prompt del video: llega detrás del prompt clínico, así que pide sus dos
 * claves sobre el mismo objeto JSON en vez de definir uno nuevo.
 */
function promptParaElVideo(steps) {
  return `
ADEMÁS, interpreta la DEMOSTRACIÓN paso a paso.

${reglasDeInterpretacion(steps)}

Añade estas dos claves al MISMO objeto JSON de la respuesta:
${FORMA_DE_LA_RESPUESTA}
`.trim();
}

/**
 * El prompt COMPLETO del camino sin video: aquí no hay nada delante, así que se presenta el trabajo
 * y se pide el objeto entero.
 */
function promptSinVideo(steps, contexto = '') {
  const dondeEmpieza = `${contexto || ''}`.trim();
  return `
Una persona acaba de ENSEÑARLE a un asistente cómo se hace una tarea en un programa de escritorio:
la hizo entera mientras narraba en voz alta lo que iba haciendo. El asistente registró cada paso por
la identidad del elemento que se tocó. Tu trabajo es interpretar ese registro para que el asistente
pueda repetir la tarea después CON OTROS DATOS.

No has visto la pantalla, y no hace falta: lo que se te pregunta se decide con los pasos y con lo
que la persona iba diciendo. Si algo no se puede decidir con eso, déjalo fuera.
${dondeEmpieza ? `\nLa tarea empieza en: ${dondeEmpieza}\n` : ''}
${reglasDeInterpretacion(steps)}

Responde SOLO JSON, con este objeto y nada más:
{${FORMA_DE_LA_RESPUESTA}}
`.trim();
}

/**
 * Sanea lo que llega por la red. Un `field` que no sea cadena o una lista de diez mil pasos
 * convertirían el prompt en algo que nadie escribió.
 */
function saneaPasos(steps) {
  if (!Array.isArray(steps)) return [];
  return steps
    .slice(0, 200)
    .map((step, i) => ({
      order: Number(step?.order) || i + 1,
      field: `${step?.field ?? ''}`.trim().slice(0, 300),
      value: `${step?.value ?? ''}`.trim().slice(0, 300),
      said: `${step?.said ?? ''}`.trim().slice(0, 1000)
    }))
    .filter((step) => step.field.length > 0);
}

/**
 * La respuesta, con la forma que el cliente espera y sin nada más. No se filtra por identidad aquí:
 * eso lo hace la pieza pura del cliente, que ya está juzgada por su contrato — repetirlo sería un
 * segundo lector del mismo hecho, y dos lectores se desincronizan sin avisar.
 */
function respuesta(parsed) {
  return {
    campos: Array.isArray(parsed?.campos) ? parsed.campos : [],
    recuerdos: Array.isArray(parsed?.recuerdos) ? parsed.recuerdos : []
  };
}

module.exports = { promptParaElVideo, promptSinVideo, saneaPasos, respuesta };
