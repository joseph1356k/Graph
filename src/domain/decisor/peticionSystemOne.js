// El cuerpo que entiende TypeSafe (Jev) y la validación de lo que manda el teléfono.
//
// Puerto a JavaScript de PeticionASystemOne.cs (cliente Windows, spec 035). Aquí
// no hay red ni estado: cuerpo, límites, política de reintento y lectura de la
// respuesta, todo puro para poder juzgarlo sin TypeSafe.
//
// GRAPH ARMA SIEMPRE EL CUERPO. El teléfono manda tres cosas —paquete de la app,
// objetivo y puertas numeradas— y nada más se le acepta: ni `model`, ni
// `questions`, ni `instructions`. Un relé que reenviara un cuerpo arbitrario
// sería un oráculo de pago abierto a cualquier dispositivo autorizado.
//
// PRIVACIDAD. A TypeSafe salen el paquete, el objetivo (≤120) y las etiquetas de
// las puertas recortadas a ≤40 caracteres. Nunca el device_id ni las cabeceras
// del teléfono. Las etiquetas pueden nombrar personas o asuntos (contactos,
// títulos de chats, asuntos de correo) y el objetivo puede nombrar a alguien: el
// teléfono es quien excluye los campos de texto y las apps sensibles; Graph solo
// valida la forma y el tope de cada campo y no puede verificar el contenido.
// Es la excepción E11 de docs/privacy-egress-gateway.md.

// Límites estrictos: pasarse es 400, sin recortar en silencio. Lo único que se
// recorta es la etiqueta al SALIR hacia TypeSafe (defensa en profundidad: el
// teléfono ya las manda ≤40).
const LIMITES = Object.freeze({
  DEVICE_ID: 64,
  PANTALLA: 80,
  OBJETIVO: 120,
  PUERTAS: 64,
  PUERTA: 80,
  ETIQUETA_A_TYPESAFE: 40
});

// Lo que dura TODA la consulta a TypeSafe, contando intentos y esperas. El
// teléfono espera 3 s y de ahí hay que restar el salto por Vercel.
const PLAZO_MS = 1800;
// Cuántas veces se intenta en total, contando la primera (PoliticaDeReintento.cs).
const INTENTOS_MAXIMOS = 3;

const MODELO_POR_DEFECTO = 'jev-latest';

// Los ids de las tres preguntas: bajo esas claves vuelve la respuesta.
const ID_PUERTA = 'puerta';
const ID_CUMPLIDO = 'cumplido';
const ID_PELIGRO = 'peligro';

// 429 (cupo) y 529 (sobrecarga) pueden salir distinto más tarde; 401 (key mala) y
// 422 (cuerpo inválido) no: el mismo cuerpo con la misma key da el mismo resultado
// y gasta cupo. Cualquier otro código tampoco se insiste.
function seReintenta(codigoHttp) {
  return codigoHttp === 429 || codigoHttp === 529;
}

// Espera antes del reintento número `intento` (0 es el primero): 200 << n.
function esperaMs(intento) {
  const n = intento < 0 ? 0 : (intento > 5 ? 5 : intento);
  return 200 * (2 ** n);
}

// LISTAS BLANCAS DEL LOG. La línea de log solo puede escribir nombres de causa de estas listas y
// números; cualquier otra cosa sale como «otro» (ver lineaDeLog en la ruta). Así un valor crudo que
// se cuele en una traza —la key en el mensaje de un error de red, el objetivo en un motivo— no llega
// al log aunque otro código se equivoque.
const CODIGOS = Object.freeze([
  'ok', 'decisor_apagado', 'cuerpo_invalido', 'device_no_autorizado', 'autorizacion_no_disponible',
  'upstream_rechazo', 'upstream_saturado', 'upstream_timeout', 'upstream_inalcanzable', 'upstream_ilegible',
  'limite_de_uso', 'error_interno'
]);
const MOTIVOS = Object.freeze([
  // validarPeticion
  'cuerpo_sin_forma', 'device_id_ausente', 'device_id_largo', 'device_id_sin_forma',
  'pantalla_ausente', 'pantalla_larga', 'pantalla_sin_forma', 'objetivo_ausente', 'objetivo_largo', 'objetivo_sin_forma',
  'puertas_ausentes', 'puertas_demasiadas', 'puerta_larga', 'puerta_sin_forma',
  // normalizarRespuesta
  'sin_objeto', 'sin_eleccion', 'eleccion_fuera_de_lista', 'numero_invalido'
]);

const CONTROL = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;
const FORMA_DE_PUERTA = /^(\d{1,3})\) (.+) \(([A-Za-z0-9_.\-]{1,40})\)$/;
const FORMA_DE_DEVICE = /^[A-Za-z0-9_.:\-]+$/;

const esTexto = (valor) => typeof valor === 'string';

// El device_id tal como lo ven la validación, el autorizador (`trim()`) y el limitador de la ruta. Un
// solo trim para los tres: si el limitador contara el texto crudo, rellenar el id con espacios
// abriría una cuenta nueva por cada relleno y evadiría el tope.
function normalizarDeviceId(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

// Devuelve { ok: true, valor } o { ok: false, motivo }. El motivo es un nombre
// fijo: nunca lleva el valor recibido (podría traer lo que dijo una persona).
function validarPeticion(cuerpo) {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
    return { ok: false, motivo: 'cuerpo_sin_forma' };
  }
  const { device_id: deviceIdBruto, pantalla, objetivo, puertas } = cuerpo;

  const deviceId = normalizarDeviceId(deviceIdBruto);
  if (!deviceId) return { ok: false, motivo: 'device_id_ausente' };
  if (deviceId.length > LIMITES.DEVICE_ID) return { ok: false, motivo: 'device_id_largo' };
  if (!FORMA_DE_DEVICE.test(deviceId)) return { ok: false, motivo: 'device_id_sin_forma' };

  if (!esTexto(pantalla) || !pantalla.trim()) return { ok: false, motivo: 'pantalla_ausente' };
  const pantallaLimpia = pantalla.trim();
  if (pantallaLimpia.length > LIMITES.PANTALLA) return { ok: false, motivo: 'pantalla_larga' };
  if (CONTROL.test(pantallaLimpia)) return { ok: false, motivo: 'pantalla_sin_forma' };

  if (!esTexto(objetivo) || !objetivo.trim()) return { ok: false, motivo: 'objetivo_ausente' };
  const objetivoLimpio = objetivo.trim();
  if (objetivoLimpio.length > LIMITES.OBJETIVO) return { ok: false, motivo: 'objetivo_largo' };
  if (CONTROL.test(objetivoLimpio)) return { ok: false, motivo: 'objetivo_sin_forma' };

  if (!Array.isArray(puertas) || puertas.length === 0) return { ok: false, motivo: 'puertas_ausentes' };
  if (puertas.length > LIMITES.PUERTAS) return { ok: false, motivo: 'puertas_demasiadas' };
  const puertasLimpias = [];
  for (const puerta of puertas) {
    if (!esTexto(puerta)) return { ok: false, motivo: 'puerta_sin_forma' };
    const texto = puerta.trim();
    if (texto.length > LIMITES.PUERTA) return { ok: false, motivo: 'puerta_larga' };
    if (CONTROL.test(texto) || !FORMA_DE_PUERTA.test(texto)) return { ok: false, motivo: 'puerta_sin_forma' };
    puertasLimpias.push(texto);
  }

  return { ok: true, valor: { deviceId, pantalla: pantallaLimpia, objetivo: objetivoLimpio, puertas: puertasLimpias } };
}

// La puerta tal como sale a TypeSafe: «N) etiqueta (Tipo)» con la etiqueta a ≤40.
function idParaTypeSafe(puerta) {
  const m = FORMA_DE_PUERTA.exec(puerta);
  if (!m) return puerta;
  const etiqueta = m[2].length > LIMITES.ETIQUETA_A_TYPESAFE
    ? m[2].slice(0, LIMITES.ETIQUETA_A_TYPESAFE)
    : m[2];
  return `${m[1]}) ${etiqueta} (${m[3]})`;
}

function estadoDeLaPantalla(pantalla, objetivo, ids) {
  let texto = `Pantalla actual: ${pantalla}\n`;
  texto += `Lo que se quiere conseguir: ${objetivo}\n`;
  texto += 'Puertas accionables en esta pantalla, en orden de lectura:\n';
  for (const id of ids) texto += `  - ${id}\n`;
  return texto;
}

function instruccionesDeLaPuerta(objetivo) {
  return `¿Qué puerta de esta pantalla hay que accionar AHORA para avanzar hacia «${objetivo}»? `
    + 'Elige solo entre las puertas listadas. Si ninguna avanza hacia el objetivo, elige la que menos daño haga.';
}

// Arma el cuerpo de TypeSafe y el mapa para deshacer el recorte de etiquetas.
// Las claves de `criteria` van sin duplicados y en orden de lectura (una clave
// repetida es JSON inválido: 422).
function construirPeticion({ pantalla, objetivo, puertas, modelo }) {
  const visto = new Map(); // idTypeSafe → puerta original (la primera que lo produjo)
  for (const puerta of puertas) {
    const id = idParaTypeSafe(puerta);
    if (!visto.has(id)) visto.set(id, puerta);
  }
  const ids = [...visto.keys()];
  const criteriaPuerta = {};
  for (const id of ids) criteriaPuerta[id] = null;

  const cuerpo = {
    state: estadoDeLaPantalla(pantalla, objetivo, ids),
    model: modelo || MODELO_POR_DEFECTO,
    questions: {
      [ID_PUERTA]: {
        type: 'choice',
        instructions: instruccionesDeLaPuerta(objetivo),
        criteria: criteriaPuerta
      },
      [ID_CUMPLIDO]: {
        type: 'noul',
        instructions: '¿El objetivo descrito en el estado YA está cumplido en esta pantalla, sin accionar nada más?',
        criteria: {
          true: 'Lo que se quería conseguir ya se ve conseguido en esta pantalla',
          false: 'Todavía falta accionar algo para conseguirlo'
        }
      },
      [ID_PELIGRO]: {
        type: 'noul',
        instructions: '¿Accionar la puerta elegida sería irreversible o peligroso: guardar, enviar, eliminar, confirmar, pagar, cerrar sin guardar?',
        criteria: {
          true: 'Deja un efecto que no se puede deshacer o que afecta a otros',
          false: 'Navegar, abrir, seleccionar o mirar: se puede volver atrás'
        }
      }
    }
  };
  return { cuerpo, originales: visto };
}

const esProbabilidad = (valor) => typeof valor === 'number' && Number.isFinite(valor) && valor >= 0 && valor <= 1;

// Lee la respuesta de TypeSafe. Devuelve { ok: true, ... } con la elección YA
// traducida a las puertas originales del teléfono, o { ok: false, motivo }.
// Lo que promete otro se comprueba: la elegida tiene que ser una de las enviadas
// y todo número tiene que ser un número entre 0 y 1.
function normalizarRespuesta(json, peticion) {
  if (!json || typeof json !== 'object') return { ok: false, motivo: 'sin_objeto' };
  const respuestas = json.answers;
  const puerta = respuestas && respuestas[ID_PUERTA];
  if (!puerta || !esTexto(puerta.choice)) return { ok: false, motivo: 'sin_eleccion' };
  if (!peticion.originales.has(puerta.choice)) return { ok: false, motivo: 'eleccion_fuera_de_lista' };

  const cumplido = respuestas[ID_CUMPLIDO] && respuestas[ID_CUMPLIDO].noul;
  const peligro = respuestas[ID_PELIGRO] && respuestas[ID_PELIGRO].noul;
  const confianza = puerta.confidence;
  if (!esProbabilidad(confianza) || !esProbabilidad(cumplido) || !esProbabilidad(peligro)) {
    return { ok: false, motivo: 'numero_invalido' };
  }

  const probabilidades = {};
  const crudas = puerta.probabilities;
  if (crudas && typeof crudas === 'object' && !Array.isArray(crudas)) {
    for (const [id, valor] of Object.entries(crudas)) {
      if (!peticion.originales.has(id)) continue; // lo que no se ofreció no se reenvía
      if (!esProbabilidad(valor)) return { ok: false, motivo: 'numero_invalido' };
      probabilidades[peticion.originales.get(id)] = valor;
    }
  }

  const uso = json.usage && typeof json.usage === 'object' ? json.usage : {};
  const tokens = (valor) => (Number.isFinite(valor) && valor > 0 ? Math.trunc(valor) : 0);
  return {
    ok: true,
    modelo: esTexto(json.model) ? json.model.slice(0, 64) : '',
    eleccion: peticion.originales.get(puerta.choice),
    confianza,
    probabilidades,
    cumplido,
    peligro,
    tokensEntrada: tokens(uso.input_tokens),
    tokensSalida: tokens(uso.output_tokens)
  };
}

module.exports = {
  LIMITES,
  PLAZO_MS,
  INTENTOS_MAXIMOS,
  MODELO_POR_DEFECTO,
  CODIGOS,
  MOTIVOS,
  seReintenta,
  esperaMs,
  normalizarDeviceId,
  validarPeticion,
  construirPeticion,
  normalizarRespuesta
};
