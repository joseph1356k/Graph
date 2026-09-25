// Jev (TypeSafe) como decisor de qué se toca en la app Android.
//
// El teléfono NO habla con TypeSafe: habla con POST /api/v1/agent/decidir y este
// servicio arma el cuerpo, pone la key, llama y devuelve solo la elección y
// números. «Jev decide, Luna habla»: si aquí algo falla, el teléfono cae a Luna;
// nada de esto acciona nada.
//
// TRES CAPAS ANTES DE GASTAR UN TOKEN
//   1. X-API-Key: la pone requireApiKey (server.js) sobre todo /api/v1.
//   2. Kill switch propio, ANDROID_DECISOR_ENABLED: ausente o `0` → apagado (503);
//      `1` → real (exige key); `simulado` → regla fija sin red ni key. Existe
//      aparte de la key porque TYPESAFE_API_KEY la comparte Windows (el
//      hospital): quitarla para apagar Android apagaría también a Windows.
//   3. Whitelist: graph_app_users.realtime_allowed, por LiveVoiceDeviceAuthorizer
//      (solo lectura, sin migración): `decidir` solo existe dentro de una sesión
//      de Live, y quien no tiene Live no llega.
//
// LA KEY va únicamente en la cabecera Authorization: ni en el cuerpo, ni en la
// respuesta, ni en el log. Se prefiere TYPESAFE_API_KEY_ANDROID si existe (para
// separar la cuota del hospital sin tocar código).
//
// QUÉ SE LOGUEA: la traza que devuelve este servicio solo lleva cifras y nombres
// de causa. Nunca el objetivo, las etiquetas, la elección, la key ni el cuerpo o
// el detalle de error de TypeSafe (un 422 podría devolver eco del cuerpo).

const {
  PLAZO_MS,
  INTENTOS_MAXIMOS,
  MODELO_POR_DEFECTO,
  seReintenta,
  esperaMs,
  validarPeticion,
  construirPeticion,
  normalizarRespuesta
} = require('../../domain/decisor/peticionSystemOne');
const { FEATURES } = require('../../domain/usage/vocabulary');
const { isOwnError: isAuthorizerOwnError } = require('./LiveVoiceDeviceAuthorizer');

// El único endpoint de TypeSafe: todos los modelos se sirven por aquí.
const URL_SYSTEMONE = 'https://api.typesafe.ai/v1/systemone';

const MODOS = Object.freeze({ APAGADO: 'apagado', REAL: 'real', SIMULADO: 'simulado' });

// Palabras que no dicen a qué puerta ir, para la regla del modo simulado.
const PALABRAS_VACIAS = new Set(['para', 'por', 'con', 'una', 'uno', 'unos', 'unas', 'del', 'los', 'las', 'que', 'quiero', 'hay', 'hacer', 'ahora', 'abrir', 'the', 'and']);
const PALABRAS_PELIGROSAS = ['guardar', 'enviar', 'eliminar', 'borrar', 'confirmar', 'pagar', 'cerrar', 'comprar', 'send', 'delete', 'save', 'pay'];

const MENSAJES = Object.freeze({
  decisor_apagado: 'El decisor no está disponible.',
  cuerpo_invalido: 'La petición no tiene la forma esperada',
  device_no_autorizado: 'Este dispositivo no está autorizado para el decisor.',
  autorizacion_no_disponible: 'No se pudo comprobar la autorización del dispositivo.',
  upstream_rechazo: 'El proveedor de decisión rechazó la consulta.',
  upstream_saturado: 'El proveedor de decisión está saturado.',
  upstream_timeout: 'El proveedor de decisión no contestó a tiempo.',
  upstream_inalcanzable: 'No se pudo llegar al proveedor de decisión.',
  upstream_ilegible: 'El proveedor de decisión contestó algo que no se puede leer.'
});

const ESTADOS = Object.freeze({
  decisor_apagado: 503,
  cuerpo_invalido: 400,
  device_no_autorizado: 403,
  autorizacion_no_disponible: 503,
  upstream_rechazo: 502,
  upstream_saturado: 503,
  upstream_timeout: 504,
  upstream_inalcanzable: 502,
  upstream_ilegible: 502
});

function sinAcentos(texto) {
  return `${texto}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function palabrasDe(texto) {
  return new Set(
    sinAcentos(texto).split(/[^a-z0-9]+/).filter((p) => p.length >= 3 && !PALABRAS_VACIAS.has(p))
  );
}

// La etiqueta de «N) etiqueta (Tipo)»: lo que la persona leería en pantalla.
function etiquetaDe(puerta) {
  const m = /^\d{1,3}\) (.+) \([^()]+\)$/.exec(puerta);
  return m ? m[1] : puerta;
}

class DecisorService {
  constructor(options = {}) {
    if (!options.authorizer) {
      throw new Error('DecisorService requires an authorizer (LiveVoiceDeviceAuthorizer)');
    }
    this.authorizer = options.authorizer;
    this.fetchImpl = options.fetchImpl || ((...args) => globalThis.fetch(...args));
    this.env = options.env || process.env;
    this.now = options.now || (() => Date.now());
    this.sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.plazoMs = Number.isFinite(options.plazoMs) && options.plazoMs > 0 ? options.plazoMs : PLAZO_MS;
    this.apiUrl = options.apiUrl || URL_SYSTEMONE;
    this.usageRecorder = options.usageRecorder || null;
  }

  // La key de TypeSafe: la de Android si existe; si no, la compartida con Windows.
  #clave() {
    const de = (nombre) => `${this.env[nombre] ?? ''}`.trim();
    return de('TYPESAFE_API_KEY_ANDROID') || de('TYPESAFE_API_KEY');
  }

  // Modo EFECTIVO: `1` sin key es apagado (no hay con qué llamar).
  modo() {
    const valor = `${this.env.ANDROID_DECISOR_ENABLED ?? ''}`.trim().toLowerCase();
    if (valor === 'simulado') return MODOS.SIMULADO;
    if (valor === '1' && this.#clave()) return MODOS.REAL;
    return MODOS.APAGADO;
  }

  // -> { status, json, headers?, traza }. `traza` solo lleva cifras y nombres de causa.
  async decidir(cuerpo) {
    const inicio = this.now();
    const salida = (status, json, traza = {}, headers) => ({
      status,
      json,
      headers,
      traza: { estado: status, ms: Math.max(0, this.now() - inicio), ...traza }
    });
    const falla = (code, traza = {}, detalle = '') => {
      const headers = code === 'upstream_saturado' ? { 'Retry-After': '1' } : undefined;
      return salida(
        ESTADOS[code],
        { error: `${MENSAJES[code]}${detalle}`, code },
        { code, ...traza },
        headers
      );
    };

    const modo = this.modo();
    if (modo === MODOS.APAGADO) return falla('decisor_apagado');

    const validada = validarPeticion(cuerpo);
    if (!validada.ok) {
      return falla('cuerpo_invalido', { motivo: validada.motivo }, ` (${validada.motivo}).`);
    }
    const { deviceId, pantalla, objetivo, puertas } = validada.valor;

    try {
      await this.authorizer.requireAuthorizedDevice(deviceId);
    } catch (error) {
      // Nunca se copia el mensaje del autorizador: puede repetir el device_id. Solo los errores PROPIOS
      // del autorizador (marcados por él) significan «no autorizado» o «id mal formado»; el statusCode
      // de un fallo de Supabase (403 de PostgREST, 400...) no cuenta: eso es «no pude comprobarlo».
      if (isAuthorizerOwnError(error) && error.statusCode === 403) return falla('device_no_autorizado', { puertas: puertas.length });
      if (isAuthorizerOwnError(error) && error.statusCode === 400) return falla('cuerpo_invalido', { motivo: 'device_id_ausente' }, ' (device_id_ausente).');
      return falla('autorizacion_no_disponible', { puertas: puertas.length });
    }

    const trazaBase = { puertas: puertas.length };
    if (modo === MODOS.SIMULADO) {
      const r = this.#simular(objetivo, puertas);
      return salida(200, this.#respuesta(r, Math.max(0, this.now() - inicio)), { code: 'ok', ...trazaBase, ...this.#cifras(r) });
    }

    const modelo = `${this.env.TYPESAFE_MODEL ?? ''}`.trim() || MODELO_POR_DEFECTO;
    const peticion = construirPeticion({ pantalla, objetivo, puertas, modelo });
    const consulta = await this.#consultar(this.#clave(), peticion, inicio);
    if (consulta.fallo) {
      return falla(consulta.fallo, { ...trazaBase, upstream: consulta.upstream });
    }
    const leida = normalizarRespuesta(consulta.json, peticion);
    if (!leida.ok) return falla('upstream_ilegible', { ...trazaBase, motivo: leida.motivo });

    const ms = Math.max(0, this.now() - inicio);
    this.#anotarConsumo(leida, modelo, ms);
    return salida(200, this.#respuesta(leida, ms), { code: 'ok', ...trazaBase, ...this.#cifras(leida) });
  }

  #cifras(r) {
    return { confianza: r.confianza, cumplido: r.cumplido, peligro: r.peligro };
  }

  // Solo lo prometido: nada del cuerpo de TypeSafe pasa tal cual.
  #respuesta(r, ms) {
    return {
      modelo: r.modelo,
      eleccion: r.eleccion,
      confianza: r.confianza,
      probabilidades: r.probabilidades,
      cumplido: r.cumplido,
      peligro: r.peligro,
      ms
    };
  }

  // Una consulta con plazo total (intentos + esperas) y reintento solo de 429/529.
  async #consultar(clave, peticion, inicio) {
    const limite = inicio + this.plazoMs;
    const cuerpo = JSON.stringify(peticion.cuerpo);
    let saturado = false;
    let ultimoEstado = 0;

    for (let intento = 0; intento < INTENTOS_MAXIMOS; intento += 1) {
      const restante = limite - this.now();
      if (restante <= 0) return { fallo: 'upstream_timeout' };

      const control = new AbortController();
      const temporizador = setTimeout(() => control.abort(), restante);
      let estado;
      let texto;
      try {
        const respuesta = await this.fetchImpl(this.apiUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
          body: cuerpo,
          signal: control.signal
        });
        estado = respuesta.status;
        texto = estado >= 200 && estado < 300 ? await respuesta.text() : '';
      } catch (error) {
        if (control.signal.aborted || (error && error.name === 'AbortError')) return { fallo: 'upstream_timeout' };
        return { fallo: 'upstream_inalcanzable' };
      } finally {
        clearTimeout(temporizador);
      }
      ultimoEstado = estado;

      if (estado >= 200 && estado < 300) {
        try {
          return { json: JSON.parse(texto), upstream: estado };
        } catch {
          return { fallo: 'upstream_ilegible', upstream: estado };
        }
      }
      if (seReintenta(estado)) {
        saturado = true;
        if (intento + 1 >= INTENTOS_MAXIMOS) break;
        const espera = esperaMs(intento);
        // Si la espera no cabe en lo que queda del plazo, se devuelve el turno.
        if (this.now() + espera >= limite) break;
        await this.sleep(espera);
        continue;
      }
      // 401/422 y cualquier otro código: insistir daría lo mismo y gasta cupo.
      return { fallo: estado >= 500 ? 'upstream_inalcanzable' : 'upstream_rechazo', upstream: estado };
    }
    return { fallo: saturado ? 'upstream_saturado' : 'upstream_inalcanzable', upstream: ultimoEstado };
  }

  // Mejor esfuerzo: el ledger caído no tumba una decisión ya tomada.
  #anotarConsumo(leida, modeloPedido, ms) {
    if (!this.usageRecorder) return;
    try {
      const pendiente = this.usageRecorder.record({
        provider: 'typesafe',
        apiFamily: 'systemone',
        feature: FEATURES.DECISOR,
        requestedModel: modeloPedido,
        servedModel: leida.modelo || modeloPedido,
        inputTokens: leida.tokensEntrada,
        outputTokens: leida.tokensSalida,
        totalTokens: leida.tokensEntrada + leida.tokensSalida,
        status: 'ok',
        latencyMs: ms
      });
      if (pendiente && typeof pendiente.catch === 'function') pendiente.catch(() => {});
    } catch {
      // Sin ledger no hay anotación; la decisión sigue.
    }
  }

  // Regla fija, sin red ni key: la puerta que comparte más palabras con el
  // objetivo. NO es Jev: sirve para probar el cableado de punta a punta sin
  // gastar y sin depender de TypeSafe.
  #simular(objetivo, puertas) {
    const buscadas = palabrasDe(objetivo);
    let mejor = 0;
    let mejorPuntos = -1;
    puertas.forEach((puerta, i) => {
      let puntos = 0;
      for (const palabra of palabrasDe(etiquetaDe(puerta))) if (buscadas.has(palabra)) puntos += 1;
      if (puntos > mejorPuntos) { mejor = i; mejorPuntos = puntos; }
    });
    const eleccion = puertas[mejor];
    const confianza = mejorPuntos >= 2 ? 0.9 : (mejorPuntos === 1 ? 0.75 : 0.3);
    const peligrosa = [...palabrasDe(etiquetaDe(eleccion))].some((p) => PALABRAS_PELIGROSAS.includes(p));
    const resto = puertas.length > 1 ? (1 - confianza) / (puertas.length - 1) : 0;
    const probabilidades = {};
    puertas.forEach((puerta, i) => { probabilidades[puerta] = i === mejor ? confianza : Number(resto.toFixed(4)); });
    return {
      modelo: 'simulado',
      eleccion,
      confianza,
      probabilidades,
      cumplido: 0.05,
      peligro: peligrosa ? 0.9 : 0.05
    };
  }
}

DecisorService.MODOS = MODOS;
DecisorService.ESTADOS = ESTADOS;
DecisorService.URL_SYSTEMONE = URL_SYSTEMONE;

module.exports = DecisorService;
