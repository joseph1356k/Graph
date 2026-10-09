// LO QUE SE LE PREGUNTA A UN MODELO SOBRE UNA DEMOSTRACIÓN, escrito UNA sola vez.
//
// Hay dos caminos para hacer esta misma pregunta y por eso el texto vive aquí y no dentro de
// ninguno de los dos:
//
//   · CON VIDEO — GeminiVideoClient, pegado al prompt clínico, en la misma llamada que ya mira el
//     mp4. Es el mejor: el modelo ve la pantalla además de leer los pasos.
//   · SIN VIDEO — TeachStepsInterpreter, solo texto, por el proveedor de texto de Graph
//     (GRAPH_LLM_*, el LLMProvider por defecto; no el del cerebro consciente). Nació el
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
//
// VERSIÓN. Estas reglas viajan dentro de dos prompts (TEACH-VIDEO y TEACH-STEPS) y los dos la
// reportan al ledger de uso: cambiar este archivo sube INTERPRETACION_VERSION.
//
// 2026-10-01.2. El recuerdo viaja en una clave que también se llama "significado" (así lo lee el
// cliente, y el formato no se toca), y la regla de "unas pocas palabras" no decía que era solo de
// "campos": un modelo obediente la aplicaba al recuerdo y guardaba el nombre del campo, que no le
// sirve a nadie. Y la prohibición de valores estaba atada a «lo que aparezca en pantalla», que en el
// camino sin video no existe: se leía como permiso para poner lo tecleado de ejemplo. Los ejemplos
// de esas dos reglas tampoco dicen más de lo que se dijo o se vio: un ejemplo pesa más que su regla,
// y «no por el nombre» o un formato sacado del valor tecleado acababan en la memoria.
const INTERPRETACION_VERSION = '2026-10-01.2';

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

// Solo para el camino sin video. Sin pantalla, «formato aceptado» o «restricción» solo se pueden
// adivinar de UN valor tecleado («38.5» → «en °C con un decimal»), y ese recuerdo inventado se
// guardaría como si se hubiera visto.
const SIN_PANTALLA = `- Como no ves la pantalla, ni un "significado" ni un recuerdo dicen más que el nombre del campo y lo
  que la persona DIJO: no deduzcas formatos, unidades ni restricciones del valor que tecleó (de "38.5"
  no sale "va en grados Celsius con un decimal").`;

/**
 * El cuerpo de la pregunta. Lo comparten el camino con video y el camino sin él; `reglaExtra` es la
 * que solo vale para uno de los dos.
 */
function reglasDeInterpretacion(steps, reglaExtra = '') {
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
corta que le sirva a quien opere después (formato aceptado, restricción, cuál de dos campos
parecidos es el bueno).

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
- En "campos", "significado" es CORTO: unas pocas palabras que nombran qué va ahí ("el número de
  documento", "el código de transacción"). Nunca una frase larga ni una transcripción de lo que se
  dijo.
- En "recuerdos", "significado" es el recuerdo mismo: UNA frase sobre CÓMO se usa el elemento ("a la
  persona se la busca por su número de documento"). Si solo repetiría lo que ya dice el "significado"
  de "campos", ese recuerdo sobra.
- "recuerdos" sí es opcional y va solo donde tengas algo útil que decir sobre CÓMO se usa ese
  elemento. Un elemento que no entiendas, fuera (solo en "recuerdos"; en "campos" no se omite ningún
  paso tecleado).
- En "significado" y en "recuerdos" no va ningún valor que sea dato de esta corrida (los que marcas
  con "esDato": true), venga de lo que se tecleó, de lo que se dijo o de la pantalla, y tampoco como
  ejemplo de formato. Van el formato y la regla que la persona dijo o que se vio, no el dato: "el
  documento va sin puntos" si así lo dijo, nunca el número de esta demostración. Un valor fijo de la
  tarea ("esDato": false, como un código de transacción) sí se puede nombrar: "se entra siempre por
  la transacción VA01".
${reglaExtra}
`.trim();
}

/** La forma de la respuesta. La lee `LoQueElModeloInterpreta` en el cliente. */
const FORMA_DE_LA_RESPUESTA = `
"campos": [{"campo": "<identificador exacto>", "esDato": true, "significado": "..."}],
"recuerdos": [{"campo": "<identificador exacto>", "significado": "..."}]
`.trim();

/**
 * El bloque que se AÑADE al pedido del video: llega detrás del prompt de enseñanza, que ya dice cuál
 * es la forma de la respuesta (un schema). Aquí solo se nombran las dos claves que el schema añade
 * cuando hay pasos: un solo contrato de salida, no dos.
 */
function promptParaElVideo(steps) {
  return `
ADEMÁS, interpreta la DEMOSTRACIÓN paso a paso.

${reglasDeInterpretacion(steps)}

El esquema de esta respuesta incluye además "campos" y "recuerdos":
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
que la persona iba diciendo. Si un paso no se puede decidir con eso, sigue la regla de abajo: se
contesta igual, con "esDato": true.
${dondeEmpieza ? `\nLa tarea empieza en: ${dondeEmpieza}\n` : ''}
${reglasDeInterpretacion(steps, SIN_PANTALLA)}

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

module.exports = { promptParaElVideo, promptSinVideo, saneaPasos, respuesta, INTERPRETACION_VERSION };
