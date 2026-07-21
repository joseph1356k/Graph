// Punto de entrada del cerebro consciente: despacha el turno al adaptador del
// proveedor indicado en la sesión. Port de Android/backend/src/brain/provider.ts.
//
// Cada adaptador recibe el mismo input y devuelve {session, turn}. La forma del
// hilo (previous_id de OpenAI vs historial acarreado de Gemini) vive dentro de
// la sesión y la maneja cada adaptador. Cambiar de proveedor es una tarjeta de
// Provider Studio (MIRACLE_CONSCIOUS_LLM_PROVIDER) sin tocar el cliente Windows.

const { runOpenAiTurn } = require('./openaiBrain');
const { runGeminiTurn } = require('./geminiBrain');

/** Despacha al adaptador del proveedor indicado en la sesión. */
function runProviderTurn(inp) {
  switch (inp.session.provider) {
    case 'gemini':
      return runGeminiTurn(inp);
    case 'openai':
    default:
      return runOpenAiTurn(inp);
  }
}

module.exports = { runProviderTurn };
