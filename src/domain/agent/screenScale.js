// Escala imagen → pantalla de las acciones del turno Android.
//
// El modelo devuelve coordenadas en píxeles de la IMAGEN que recibió, y el
// contrato dice que las acciones vuelven en píxeles de PANTALLA. En Windows son lo
// mismo: U.exe captura a resolución real. La app Android achica la captura a
// 1080 px de ancho conservando la proporción (GraphAccessibilityService.screenshot),
// así que en una pantalla de 1440 px un toque sin reescalar cae corrido.
//
// DATOS. La pantalla llega en state.width/height (displayMetrics del teléfono) y
// el tamaño de la imagen se lee de su cabecera PNG o JPEG: no hace falta un campo
// nuevo en el contrato. El factor es UNO para los dos ejes, el mayor entre
// ancho/ancho y alto/alto: la captura conserva la proporción, y displayMetrics
// puede venir sin la barra de navegación (un lado más corto que la pantalla real),
// nunca más largo. Se acota dentro de esa pantalla real.
//
// Sin pantalla o sin imagen legible no hay escala (null) y las coordenadas pasan
// como siempre: redondeadas, sin acotar. Así un Android viejo no se rompe.
const { PLATFORMS } = require('./platform');

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function sized(width, height) {
  return positiveInt(width) && positiveInt(height) ? { width, height } : null;
}

// PNG: firma de 8 bytes y el primer chunk es IHDR (ancho y alto, 4 bytes big-endian cada uno).
function pngSize(bytes) {
  if (bytes.length < 24 || !PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) return null;
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
  return sized(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
}

// JPEG: se recorren los segmentos hasta el primer SOF (C0–CF salvo C4 DHT, C8 JPG y CC DAC).
function jpegSize(bytes) {
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i += 1; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return i + 9 <= bytes.length ? sized(bytes.readUInt16BE(i + 7), bytes.readUInt16BE(i + 5)) : null;
    }
    const length = bytes.readUInt16BE(i + 2);
    if (length < 2) return null;
    i += 2 + length;
  }
  return null;
}

/** {width, height} de una imagen PNG o JPEG en base64 (con o sin prefijo data-uri), o null. */
function imageSize(base64) {
  if (typeof base64 !== 'string' || !base64) return null;
  const data = base64.startsWith('data:') ? base64.slice(base64.indexOf(',') + 1) : base64;
  const head = Buffer.from(data.slice(0, 44), 'base64');
  if (head[0] === 0x89) return pngSize(head);
  if (head[0] === 0xff && head[1] === 0xd8) return jpegSize(Buffer.from(data, 'base64'));
  return null;
}

/**
 * Escala del turno, o null si no aplica: solo Android, y solo con pantalla e imagen.
 * `image` es la imagen que el modelo vio por última vez (la de este turno o la guardada en la sesión).
 */
function screenScale({ platform, state, image } = {}) {
  if (platform !== PLATFORMS.ANDROID) return null;
  const screenWidth = positiveInt(state && state.width);
  const screenHeight = positiveInt(state && state.height);
  const imageWidth = positiveInt(image && image.width);
  const imageHeight = positiveInt(image && image.height);
  if (!screenWidth || !screenHeight || !imageWidth || !imageHeight) return null;
  const factor = Math.max(screenWidth / imageWidth, screenHeight / imageHeight);
  return {
    factor,
    maxX: Math.max(screenWidth, Math.round(imageWidth * factor)) - 1,
    maxY: Math.max(screenHeight, Math.round(imageHeight * factor)) - 1
  };
}

/**
 * Coordenada del modelo → píxel de pantalla. `axis` es 'x' o 'y'. Lo que no es un número da -1,
 * el «inválido» de siempre, y no se acota: acotarlo lo convertiría en un toque real en el borde.
 */
function toScreen(raw, scale, axis) {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : NaN;
  if (!Number.isFinite(n)) return -1;
  if (!scale) return Math.round(n);
  const max = axis === 'y' ? scale.maxY : scale.maxX;
  return Math.min(Math.max(Math.round(n * scale.factor), 0), max);
}

module.exports = { imageSize, screenScale, toScreen };
