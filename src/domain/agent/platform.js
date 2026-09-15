// Plataforma del turno del agente: sobre qué dispositivo opera el cerebro.
//
// El cliente Windows (U.exe) y la app Android consumen el MISMO
// POST /api/v1/agent/turn. Lo que cambia entre ellos no es el contrato JSON sino
// el mundo que el modelo tiene delante: una PC con UIA y teclado, o un teléfono
// táctil con AccessibilityService. De la plataforma dependen el prompt y el
// catálogo MCP (y, opcionalmente, el modelo: ver conscious-brain/config.js).
//
// La app llega en X-Miracle-App y se normaliza igual que en
// UsageAttributionResolver.resolveApp: lo único que es Android es `android_app`.
// Todo lo demás —sin cabecera, windows_app, una app que no conocemos— es Windows,
// que es exactamente como se comportaba el turno antes de que existiera Android.
const { APPS, normalizeApp } = require('../usage/vocabulary');

const PLATFORMS = Object.freeze({
  WINDOWS: 'windows',
  ANDROID: 'android'
});

/** X-Miracle-App (crudo, tal como llega) → plataforma del primer turno. */
function platformFromApp(rawApp) {
  return normalizeApp(rawApp) === APPS.ANDROID_APP ? PLATFORMS.ANDROID : PLATFORMS.WINDOWS;
}

/**
 * Plataforma de una sesión ya emitida. Solo las sesiones de Android llevan el
 * campo (ver session.js): la ausencia es Windows, y así las sesiones en vuelo
 * de antes de este cambio siguen su hilo sin notar nada.
 */
function platformOfSession(session) {
  return session && session.platform === PLATFORMS.ANDROID ? PLATFORMS.ANDROID : PLATFORMS.WINDOWS;
}

module.exports = { PLATFORMS, platformFromApp, platformOfSession };
