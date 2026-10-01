// Plataforma del turno del agente: sobre qué dispositivo opera el cerebro.
//
// El cliente Windows (U.exe), la app Android y el cliente Mac consumen el MISMO
// POST /api/v1/agent/turn. Lo que cambia entre ellos no es el contrato JSON sino
// el mundo que el modelo tiene delante: una PC con UIA y teclado, un teléfono
// táctil con AccessibilityService o un Mac con sus controles de accesibilidad
// (AX). De la plataforma dependen el prompt y el catálogo MCP (y, opcionalmente,
// el modelo: ver conscious-brain/config.js).
//
// La app llega en X-Miracle-App y se normaliza igual que en
// UsageAttributionResolver.resolveApp: `android_app` es Android y `mac_app` es
// Mac. Todo lo demás —sin cabecera, windows_app, una app que no conocemos— es
// Windows, que es exactamente como se comportaba el turno antes de las otras dos.
const { APPS, normalizeApp } = require('../usage/vocabulary');

const PLATFORMS = Object.freeze({
  WINDOWS: 'windows',
  ANDROID: 'android',
  MAC: 'mac'
});

/** X-Miracle-App (crudo, tal como llega) → plataforma del primer turno. */
function platformFromApp(rawApp) {
  const app = normalizeApp(rawApp);
  if (app === APPS.ANDROID_APP) return PLATFORMS.ANDROID;
  if (app === APPS.MAC_APP) return PLATFORMS.MAC;
  return PLATFORMS.WINDOWS;
}

/**
 * Plataforma de una sesión ya emitida. Solo las sesiones de Android y de Mac
 * llevan el campo (ver session.js): la ausencia es Windows, y así las sesiones en
 * vuelo de antes de este cambio siguen su hilo sin notar nada.
 */
function platformOfSession(session) {
  const platform = session && session.platform;
  return platform === PLATFORMS.ANDROID || platform === PLATFORMS.MAC ? platform : PLATFORMS.WINDOWS;
}

module.exports = { PLATFORMS, platformFromApp, platformOfSession };
