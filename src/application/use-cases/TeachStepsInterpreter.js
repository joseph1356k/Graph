// INTERPRETAR UNA DEMOSTRACIÓN SIN MIRAR EL VIDEO.
//
//   POST /api/v1/teach/interpret-steps → { interpretation: { campos, recuerdos } }
//
// POR QUÉ EXISTE, con fecha. El 2026-09-03 la cuenta de Gemini se quedó sin saldo —«429: Your
// prepayment credits are depleted», cuatro veces seguidas— y con ella se cayó la interpretación de
// las demostraciones. Mirándolo de cerca, el juicio que le estamos pidiendo NO NECESITA VER LA
// PANTALLA: distinguir «nwp1 es cómo se llega» de «70 es el peso de este paciente» se decide con
// los pasos que el cliente ya grabó y con lo que la persona iba narrando. El video MEJORA esa
// interpretación; no es de lo que depende.
//
// Así que hay tres peldaños, y cada uno solo se pisa si falló el anterior:
//
//   1. el video, que ve la pantalla       (process-video, Gemini)
//   2. el texto, que lee los pasos        (esta ruta, el proveedor del cerebro)
//   3. la regla del narrado, en el cliente, que es determinista y ya está en disco
//
// EL PROMPT NO VIVE AQUÍ (src/domain/teach/interpretarPasos.js): es EL MISMO que usa el camino con
// video. Dos copias se habrían separado en la primera corrección, y entonces la misma demo daría
// respuestas distintas según hubiera saldo — un fallo que desde el cliente es indistinguible de un
// modelo caprichoso.

const {
  promptSinVideo,
  saneaPasos,
  respuesta
} = require('../../domain/teach/interpretarPasos');

class TeachStepsInterpreter {
  /**
   * @param {object} deps
   * @param {object} deps.llmProvider proveedor de texto (LLMProvider). El mismo del cerebro.
   */
  constructor(deps = {}) {
    if (!deps.llmProvider) {
      throw new Error('TeachStepsInterpreter requiere llmProvider');
    }
    this.llmProvider = deps.llmProvider;
  }

  async interpret(body = {}) {
    const steps = saneaPasos(body.steps);
    if (steps.length === 0) {
      return { status: 400, json: { error: 'falta `steps` (los pasos de la demostración)' } };
    }

    const prompt = promptSinVideo(steps, body.startsAt);

    try {
      const content = await this.llmProvider.chatExpectingJson([
        { role: 'user', content: prompt }
      ]);
      return {
        status: 200,
        json: { interpretation: respuesta(this.llmProvider.parseJsonObject(content)) }
      };
    } catch (err) {
      // 502 Y NO 200 CON HUECOS. El cliente distingue «el modelo no opinó» de «el modelo dijo que
      // no hay nada», y esa distinción decide si se queda con lo que dedujo su propia regla o si
      // borra lo que la regla dedujo. Devolver una interpretación vacía con un 200 le estaría
      // diciendo lo segundo mientras pasa lo primero.
      return { status: 502, json: { error: `el modelo no pudo interpretar la demo: ${err.message}` } };
    }
  }
}

module.exports = TeachStepsInterpreter;
