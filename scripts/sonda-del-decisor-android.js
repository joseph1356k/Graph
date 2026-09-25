#!/usr/bin/env node
// Sonda del decisor Jev con diez pantallas Android canónicas. La corre el Capitán
// con su key: NO forma parte de `npm test` y por defecto NO toca la red.
//
//   node scripts/sonda-del-decisor-android.js                      # (por defecto) --dry-run: enseña lo que mandaría
//   node --env-file=RUTA.env scripts/sonda-del-decisor-android.js --typesafe
//   node --env-file=RUTA.env scripts/sonda-del-decisor-android.js --endpoint https://HOST/api/v1/agent/decidir
//
// Modos:
//   --dry-run     (por defecto) imprime las diez consultas tal como saldrían a TypeSafe y no llama a nadie.
//   --typesafe    llama a TypeSafe DIRECTO con el mismo código que usa el endpoint (DecisorService:
//                 cuerpo, plazo de 1.800 ms, reintentos 429/529, lectura de la respuesta), sin Supabase
//                 ni whitelist. Lee TYPESAFE_API_KEY_ANDROID o, si no, TYPESAFE_API_KEY.
//   --endpoint U  llama al endpoint de Graph ya desplegado. Lee SONDA_GRAPH_API_KEY (la X-API-Key de
//                 Graph) y SONDA_DEVICE_ID (un device_id con realtime_allowed en graph_app_users).
//
// Las claves llegan por `--env-file` (o por el entorno): la sonda no lee ningún .env por su cuenta,
// no las imprime y no las manda a ningún sitio que no sea su propia cabecera de autorización.
// Costo: unos $0,0002-0,0004 las diez consultas a $0,042/M de entrada (--dry-run enseña el estimado).
//
// Lo que se mira, con los mismos umbrales que usa el teléfono (spec 012): la elegida tiene que ser una
// de las ofrecidas, `cumplido` ≥ 0,70 no toca, `peligro` ≥ 0,50 no toca, y la confianza tiene que
// llegar a 0,70. Cada pantalla lleva lo que Luna esperaría que pasara.

const UMBRAL_CONFIANZA = 0.70;
const UMBRAL_CUMPLIDO = 0.70;
const UMBRAL_PELIGRO = 0.50;
const PRECIO_POR_MILLON_ENTRADA = 0.042;

// espera: { decision: 'toca', puerta: N } | { decision: 'peligro' } | { decision: 'cumplido' }
const PANTALLAS = [
  { nombre: 'WhatsApp · chat nuevo', pantalla: 'com.whatsapp', objetivo: 'abrir el chat nuevo',
    puertas: ['1) Chats (Tab)', '2) Novedades (Tab)', '3) Comunidades (Tab)', '4) Llamadas (Tab)', '5) Nuevo chat (ImageButton)', '6) Buscar (ImageButton)', '7) Más opciones (ImageButton)'],
    espera: { decision: 'toca', puerta: 5 } },
  { nombre: 'Ajustes · wifi', pantalla: 'com.android.settings', objetivo: 'activar el wifi',
    puertas: ['1) Conexiones (Button)', '2) Wi-Fi (Button)', '3) Bluetooth (Button)', '4) Sonidos y vibración (Button)', '5) Notificaciones (Button)', '6) Pantalla (Button)'],
    espera: { decision: 'toca', puerta: 2 } },
  { nombre: 'Gmail · redactar', pantalla: 'com.google.android.gm', objetivo: 'redactar un correo nuevo',
    puertas: ['1) Menú (ImageButton)', '2) Buscar en el correo (Button)', '3) Redactar (Button)', '4) Principal (Tab)', '5) Social (Tab)'],
    espera: { decision: 'toca', puerta: 3 } },
  { nombre: 'Gmail · descartar borrador (peligro)', pantalla: 'com.google.android.gm', objetivo: 'descartar este borrador',
    puertas: ['1) Enviar (ImageButton)', '2) Adjuntar archivo (ImageButton)', '3) Más opciones (ImageButton)', '4) Descartar (Button)'],
    espera: { decision: 'peligro' } },
  { nombre: 'Chrome · pestaña nueva', pantalla: 'com.android.chrome', objetivo: 'abrir una pestaña nueva',
    puertas: ['1) Inicio (ImageButton)', '2) Pestañas abiertas (ImageButton)', '3) Más opciones (ImageButton)', '4) Pestaña nueva (Button)', '5) Marcadores (Button)'],
    espera: { decision: 'toca', puerta: 4 } },
  { nombre: 'Maps · cómo llegar', pantalla: 'com.google.android.apps.maps', objetivo: 'ver cómo llegar',
    puertas: ['1) Explorar (Tab)', '2) Ir (Tab)', '3) Guardado (Tab)', '4) Cómo llegar (Button)', '5) Iniciar (Button)'],
    espera: { decision: 'toca', puerta: 4 } },
  { nombre: 'Reloj · alarma nueva', pantalla: 'com.google.android.deskclock', objetivo: 'poner una alarma nueva',
    puertas: ['1) Alarma (Tab)', '2) Reloj mundial (Tab)', '3) Cronómetro (Tab)', '4) Temporizador (Tab)', '5) Añadir alarma (ImageButton)'],
    espera: { decision: 'toca', puerta: 5 } },
  { nombre: 'Cámara · sacar foto', pantalla: 'com.android.camera', objetivo: 'sacar una foto',
    puertas: ['1) Modo Foto (Tab)', '2) Modo Video (Tab)', '3) Flash (ImageButton)', '4) Cambiar cámara (ImageButton)', '5) Obturador (Button)'],
    espera: { decision: 'toca', puerta: 5 } },
  { nombre: 'Contactos · llamar a Ana', pantalla: 'com.google.android.contacts', objetivo: 'llamar a Ana',
    puertas: ['1) Ana Gómez (Button)', '2) Luis Pérez (Button)', '3) Teclado (ImageButton)', '4) Favoritos (Tab)', '5) Recientes (Tab)'],
    espera: { decision: 'toca', puerta: 1 } },
  { nombre: 'Ajustes · wifi ya activo (cumplido)', pantalla: 'com.android.settings', objetivo: 'activar el wifi',
    puertas: ['1) Wi-Fi activado (Switch)', '2) Redes guardadas (Button)', '3) Añadir red (Button)', '4) Preferencias de Wi-Fi (Button)'],
    espera: { decision: 'cumplido' } }
];

// ¿A dónde se puede mandar la X-API-Key? A cualquier https, o a http SOLO si el host es exactamente
// localhost, 127.0.0.1 o [::1]. Se analiza la URL (no se compara el comienzo del texto): así
// `http://localhost.evil.com/x` o `http://localhost@evil.com/` no pasan por parecerse a localhost, y
// una URL con usuario:clave dentro tampoco.
function endpointSeguro(texto) {
  let url;
  try { url = new URL(texto); } catch { return false; }
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return Boolean(url.hostname);
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

function argumentos(argv) {
  const a = { modo: 'dry-run', endpoint: '' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--typesafe') a.modo = 'typesafe';
    else if (argv[i] === '--dry-run') a.modo = 'dry-run';
    else if (argv[i] === '--endpoint') { a.modo = 'endpoint'; a.endpoint = argv[i + 1] || ''; i += 1; }
    else if (argv[i] === '--help' || argv[i] === '-h') a.ayuda = true;
    else { a.desconocido = argv[i]; }
  }
  return a;
}

// Lo mismo que juzga el teléfono, en el mismo orden.
function juzgar(respuesta, puertas) {
  if (!puertas.includes(respuesta.eleccion)) return { decision: 'fuera_de_lista' };
  if (respuesta.cumplido >= UMBRAL_CUMPLIDO) return { decision: 'cumplido' };
  if (respuesta.peligro >= UMBRAL_PELIGRO) return { decision: 'peligro' };
  if (respuesta.confianza < UMBRAL_CONFIANZA) return { decision: 'duda' };
  return { decision: 'toca', puerta: Number.parseInt(respuesta.eleccion, 10) };
}

const coincide = (espera, real) => espera.decision === real.decision && (espera.decision !== 'toca' || espera.puerta === real.puerta);

async function consultarTypeSafe() {
  const DecisorService = require('../src/application/use-cases/DecisorService');
  const servicio = new DecisorService({
    authorizer: { async requireAuthorizedDevice() { return {}; } },
    env: { ...process.env, ANDROID_DECISOR_ENABLED: '1' }
  });
  if (servicio.modo() !== 'real') {
    throw new Error('falta TYPESAFE_API_KEY_ANDROID o TYPESAFE_API_KEY en el entorno (usa --env-file)');
  }
  return async (p) => {
    const r = await servicio.decidir({ device_id: 'sonda-del-decisor', pantalla: p.pantalla, objetivo: p.objetivo, puertas: p.puertas });
    return { estado: r.status, json: r.json };
  };
}

async function consultarEndpoint(url) {
  const clave = `${process.env.SONDA_GRAPH_API_KEY || ''}`.trim();
  const deviceId = `${process.env.SONDA_DEVICE_ID || ''}`.trim();
  if (!clave || !deviceId) throw new Error('faltan SONDA_GRAPH_API_KEY y SONDA_DEVICE_ID en el entorno (usa --env-file)');
  if (!endpointSeguro(url)) throw new Error('--endpoint tiene que ser https (o http solo hacia localhost, 127.0.0.1 o [::1])');
  return async (p) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': clave, 'X-Miracle-App': 'android_app', 'X-Miracle-Feature': 'decisor' },
      body: JSON.stringify({ device_id: deviceId, pantalla: p.pantalla, objetivo: p.objetivo, puertas: p.puertas })
    });
    let json = null;
    try { json = await r.json(); } catch { /* sin JSON */ }
    return { estado: r.status, json };
  };
}

function mostrarDryRun() {
  const { construirPeticion } = require('../src/domain/decisor/peticionSystemOne');
  console.log('Modo --dry-run: no se llama a nadie. Así saldrían las diez consultas a TypeSafe:\n');
  let caracteres = 0;
  PANTALLAS.forEach((p, i) => {
    const { cuerpo } = construirPeticion({ pantalla: p.pantalla, objetivo: p.objetivo, puertas: p.puertas, modelo: 'jev-latest' });
    caracteres += JSON.stringify(cuerpo).length;
    console.log(`${String(i + 1).padStart(2)}. ${p.nombre} · objetivo «${p.objetivo}» · ${p.puertas.length} puertas · espera ${JSON.stringify(p.espera)}`);
  });
  const tokens = Math.round(caracteres / 3.5);
  console.log(`\nTamaño: ~${caracteres} caracteres ≈ ${tokens} tokens de entrada ≈ $${(tokens * PRECIO_POR_MILLON_ENTRADA / 1e6).toFixed(5)} (estimado).`);
  console.log('Para llamar de verdad: --typesafe o --endpoint URL (ver la cabecera de este archivo).');
}

async function main() {
  const a = argumentos(process.argv.slice(2));
  if (a.ayuda || a.desconocido) {
    if (a.desconocido) console.error(`argumento desconocido: ${a.desconocido}`);
    console.log('Uso: node [--env-file=RUTA] scripts/sonda-del-decisor-android.js [--dry-run | --typesafe | --endpoint URL]');
    process.exit(a.desconocido ? 2 : 0);
  }
  if (a.modo === 'dry-run') { mostrarDryRun(); return; }

  let consultar;
  try {
    consultar = a.modo === 'typesafe' ? await consultarTypeSafe() : await consultarEndpoint(a.endpoint);
  } catch (error) {
    console.error(`sonda: ${error.message}`);
    process.exit(2);
  }

  console.log(`Modo --${a.modo}: ${PANTALLAS.length} pantallas (una consulta cada una, en serie).\n`);
  let aciertos = 0;
  const tiempos = [];
  for (const [i, p] of PANTALLAS.entries()) {
    const inicio = Date.now();
    let linea;
    try {
      const { estado, json } = await consultar(p);
      const ms = Date.now() - inicio;
      tiempos.push(ms);
      if (estado !== 200 || !json || json.eleccion === undefined) {
        linea = `ERROR ${estado} ${json && json.code ? json.code : ''} (${ms} ms)`;
      } else {
        const real = juzgar(json, p.puertas);
        const bien = coincide(p.espera, real);
        if (bien) aciertos += 1;
        linea = `${bien ? 'OK ' : 'MAL'} → ${real.decision}${real.puerta ? ` puerta ${real.puerta}` : ''} · eligió «${json.eleccion}» · confianza ${json.confianza} · cumplido ${json.cumplido} · peligro ${json.peligro} · ${ms} ms (Graph: ${json.ms} ms)`;
      }
    } catch (error) {
      linea = `ERROR de red (${error.name})`;
    }
    console.log(`${String(i + 1).padStart(2)}. ${p.nombre}\n      esperaba ${JSON.stringify(p.espera)}\n      ${linea}`);
  }
  tiempos.sort((x, y) => x - y);
  const mediana = tiempos.length ? tiempos[Math.floor(tiempos.length / 2)] : 0;
  console.log(`\nAciertos: ${aciertos}/${PANTALLAS.length} · latencia mediana ${mediana} ms · máxima ${tiempos.length ? tiempos[tiempos.length - 1] : 0} ms`);
  console.log('Estos aciertos son una muestra de diez pantallas: sirven para ver si Jev entiende Android, no para calibrar umbrales.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`sonda: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { endpointSeguro };
