#!/usr/bin/env node
// Una credencial por instalación de Ü para Windows, sin red ni base de verdad.
//   node scripts/verify-windows-devices.js
//
// EL HECHO QUE LO PROVOCA (2026-09-30). El repo es público, así que el instalador
// se descarga sin credenciales, y lleva embebida UNA API key de Graph que
// comparten todas las instalaciones. Con ella, /api/v1/agent/claves entregaba las
// claves crudas de OpenAI y TypeSafe, y todo /api/v1 quedaba abierto. Ver la spec
// 004 de Graph y la 076 de apps/windows.
//
// Lo que se juzga aquí (promesas 401-410 de la spec 004), con Express de verdad y un Supabase falso debajo
// del servicio REAL (WindowsDeviceService):
//  401  presentarse da una credencial que se ve una sola vez: en la base queda su
//      huella, no ella;
//  402  una instalación nueva nace pendiente: ni el correo ni presentarse otra vez
//      la aprueban;
//  403  con la compuerta apagada, que es como nace, nada cambia;
//  404  con la compuerta puesta a una etiqueta, esa clave sola solo sirve para
//      presentarse y para preguntar su estado; lo demás contesta 403 con su código;
//  405  una instalación aprobada entra, y revocarla la deja fuera sin tocar a las demás;
//  406  las claves de otras etiquetas no pasan por la compuerta;
//  407  si no se puede comprobar la instalación, la compuerta se cierra: 503;
//  408  ni la credencial ni su huella salen en el log, ni en la lista del panel;
//  409  presentarse tiene tope por IP;
//  410 aprobar y revocar exige ser administrador del panel;
//  411  cada instalación guarda con qué clave se presentó, y el panel lo dice junto
//      al estado de la compuerta;
//  412  un administrador enciende y apaga la compuerta desde el panel: queda escrita
//      en Vercel, se redespliega y esta instancia la obedece ya;
//  413  la compuerta no se enciende para una etiqueta que no existe, ni para una sin
//      ninguna instalación aprobada salvo que se pida a sabiendas;
//  414  con la compuerta puesta, las claves de terceros solo se entregan a una
//      instalación aprobada o a una etiqueta nombrada aparte.
// Los sabotajes (cada G con su rojo) se aplican de a uno desde fuera de este
// archivo: quedan anotados en la spec 076 de apps/windows.
const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const express = require('express');

const { promesa, pendiente, cerrar } = require('./lib/promesas');

const WindowsDeviceService = require('../src/application/use-cases/WindowsDeviceService');
const registerWindowsDeviceRoutes = require('../web/api/registerWindowsDeviceRoutes');

const { createDeviceGate } = registerWindowsDeviceRoutes;

// La ruta que entrega las claves de terceros, la de verdad. Null mientras no exista como pieza aparte:
// la promesa que la necesita se declara pendiente.
function cargarLaRutaDeLasClaves() {
  try {
    return require('../web/api/registerAgentKeysRoute');
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') return null;
    throw error;
  }
}

const ETIQUETA_DEL_INSTALADOR = 'windows-instalador';
const ETIQUETA_DEL_PORTAL = 'portal-web';
const CLAVES = new Map([
  ['clave-del-instalador', ETIQUETA_DEL_INSTALADOR],
  ['clave-del-portal', ETIQUETA_DEL_PORTAL]
]);

// ---- fakes ----------------------------------------------------------------

// Supabase falso: una sola tabla en memoria, con los tres verbos que usa el
// servicio. Entiende los filtros `col=eq.valor` y nada más: si el servicio
// pidiera otra cosa, la prueba lo dice en vez de devolver vacío en silencio.
function supabaseFalso() {
  const filas = [];
  const llamadas = [];
  let caido = false;
  const filtros = (query) => {
    const condiciones = [];
    for (const parte of `${query || ''}`.split('&')) {
      const m = /^([a-z_]+)=eq\.(.*)$/.exec(parte);
      if (m) condiciones.push([m[1], decodeURIComponent(m[2])]);
      else if (parte && !/^(select|order|limit)=/.test(parte)) throw new Error(`supabase falso: no entiendo «${parte}»`);
    }
    return (fila) => condiciones.every(([col, valor]) => `${fila[col]}` === valor);
  };
  const puerta = (verbo, table) => {
    llamadas.push({ verbo, table });
    if (table !== 'graph_windows_devices') throw new Error(`supabase falso: tabla inesperada «${table}»`);
    if (caido) throw Object.assign(new Error('PostgREST caído con texto propio'), { statusCode: 503 });
  };
  return {
    filas,
    llamadas,
    caer(valor) { caido = valor; },
    async select(table, query) {
      puerta('select', table);
      // SOLO LAS COLUMNAS PEDIDAS, como PostgREST. Devolver la fila entera dejaba pasar una lista
      // del panel que no pedía `api_label` (sabotaje del 2026-10-01: verde): contra la base de
      // verdad esa columna no llegaría y el botón de la compuerta no tendría qué ofrecer.
      const pedidas = /(?:^|&)select=([^&]*)/.exec(`${query || ''}`);
      const columnas = pedidas && pedidas[1] !== '*' ? decodeURIComponent(pedidas[1]).split(',') : null;
      return filas.filter(filtros(query)).map((f) => (columnas
        ? Object.fromEntries(columnas.filter((c) => c in f).map((c) => [c, f[c]]))
        : { ...f }));
    },
    async insert(table, row) {
      puerta('insert', table);
      filas.push({ status: 'pendiente', ...row });
      return { ...filas[filas.length - 1] };
    },
    async update(table, query, patch) {
      puerta('update', table);
      const fila = filas.find(filtros(query));
      if (!fila) return undefined;
      Object.assign(fila, patch);
      return { ...fila };
    }
  };
}

// Vercel falso: lo que usa el panel para escribir una variable de SU proyecto y
// redesplegar (VercelProjectEnvService). Apunta lo que se le pide y nada más.
function vercelFalso({ escribible = true } = {}) {
  const escrituras = [];
  const estado = { redespliegues: 0 };
  return {
    escrituras,
    estado,
    status() { return { write_enabled: escribible }; },
    assertWritable() {
      if (!escribible) throw Object.assign(new Error('Falta configurar GRAPH_VERCEL_API_TOKEN con su valor secreto'), { statusCode: 503 });
    },
    async upsertProjectEnv(key, value, options) {
      escrituras.push({ key, value, secret: Boolean(options && options.secret) });
    },
    async triggerRedeploy() {
      estado.redespliegues += 1;
      return { triggered: true, strategy: 'de-mentira' };
    }
  };
}

function relojFalso() {
  const reloj = { t: 1_800_000_000_000 };
  reloj.now = () => reloj.t;
  return reloj;
}

// Levanta una app express con: la autenticación por API key (calcada de
// requireApiKey: deja la etiqueta en req.apiClient), la compuerta, las rutas de
// las instalaciones y tres rutas «de las de siempre» detrás, para ver qué entra.
async function levantar(opciones = {}) {
  const { limitePorIp, admin = true } = opciones;
  // Un entorno PROPIO por servidor: el panel escribe en él al encender la compuerta, y uno compartido
  // entre promesas dejaría a la siguiente con la compuerta de la anterior.
  const env = { OPENAI_API_KEY: 'sk-de-mentira', ...(opciones.env || {}) };
  const supabase = opciones.supabase || supabaseFalso();
  const vercel = opciones.vercel || vercelFalso();
  const reloj = relojFalso();
  const lineas = [];
  const logger = { log: (l) => lineas.push(`${l}`), warn: (l) => lineas.push(`${l}`), error: (l) => lineas.push(`${l}`) };
  const servicio = new WindowsDeviceService(supabase, { now: reloj.now, logger });

  const app = express();
  app.use(express.json());
  app.use('/api/v1', (req, res, next) => {
    const etiqueta = CLAVES.get(`${req.get('x-api-key') || ''}`);
    if (!etiqueta) return res.status(401).json({ error: 'API key invalida o ausente.' });
    req.apiClient = { label: etiqueta };
    return next();
  });
  app.use('/api/v1', createDeviceGate({ windowsDeviceService: servicio, env, logger }));
  // El panel: en server.js lo adjunta requireAccountAuth + attachWorkflowAccess.
  app.use('/api/windows', (req, res, next) => {
    req.workflowAccess = { canManageGlobalWorkflows: admin };
    req.user = { email: 'admin@miracle.test' };
    next();
  });
  registerWindowsDeviceRoutes(app, {
    windowsDeviceService: servicio,
    logger,
    limitePorIp,
    env,
    vercelEnvService: vercel,
    etiquetasConocidas: () => [...new Set(CLAVES.values())]
  });
  const registerAgentKeysRoute = cargarLaRutaDeLasClaves();
  if (registerAgentKeysRoute) registerAgentKeysRoute(app, { env, logger });
  else app.get('/api/v1/agent/claves', (req, res) => res.json({ openai: 'sk-de-mentira' }));
  app.post('/api/v1/agent/turn', (req, res) => res.json({ ok: true, device: req.windowsDevice ? req.windowsDevice.deviceId : null }));
  app.post('/api/v1/operations/exports/claim', (req, res) => res.json({ nota: 'una nota clínica' }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const pedir = async (metodo, ruta, { clave = 'clave-del-instalador', credencial, cuerpo } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (clave) headers['X-API-Key'] = clave;
    if (credencial) headers['X-Device-Token'] = credencial;
    const r = await fetch(`${base}${ruta}`, { method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    const texto = await r.text();
    let json = null;
    try { json = JSON.parse(texto); } catch (_) { /* no era JSON */ }
    return { status: r.status, json, texto };
  };
  const presentarse = (extra = {}, opcionesDePedir = {}) => pedir('POST', '/api/v1/agent/enroll', {
    cuerpo: { email: 'medico@hospital.test', display_name: 'Dra. Prueba', install_id: 'inst-1', machine_name: 'PC-TRIAGE', app_version: '1.4.0', ...extra },
    ...opcionesDePedir
  });
  const decidir = (deviceId, status) => pedir('POST', `/api/windows/devices/${deviceId}/status`, { clave: null, cuerpo: { status } });

  const compuerta = (etiquetas, extra = {}) => pedir('POST', '/api/windows/devices/gate', { clave: null, cuerpo: { etiquetas, ...extra } });

  return { pedir, presentarse, decidir, compuerta, supabase, vercel, servicio, reloj, lineas, env, cerrar: () => new Promise((resolve) => server.close(resolve)) };
}

async function con(opciones, fn) {
  const h = await levantar(opciones);
  try { await fn(h); } finally { await h.cerrar(); }
}

const COMPUERTA = { WINDOWS_DEVICE_GATE_LABELS: ETIQUETA_DEL_INSTALADOR };
const huella = (credencial) => crypto.createHash('sha256').update(credencial).digest('hex');

// ---- las promesas ----------------------------------------------------------

async function main() {

  await promesa(401, 'presentarse da una credencial que se ve una sola vez: en la base queda su huella, no ella', async () => {
    await con({}, async (h) => {
      const r = await h.presentarse();
      assert.strictEqual(r.status, 200, `presentarse contesta 200 (contestó ${r.status}: ${r.texto})`);
      const { token, device_id: deviceId, estado, codigo } = r.json;
      assert.ok(typeof token === 'string' && token.length >= 40, 'la credencial tiene que ser larga: es lo único que la protege');
      assert.ok(/^[0-9a-f-]{36}$/.test(deviceId), `device_id con forma de uuid (${deviceId})`);
      assert.strictEqual(estado, 'pendiente');
      assert.ok(/^[0-9A-F]{4}-[0-9A-F]{4}$/.test(codigo), `un código corto para que el administrador la reconozca (${codigo})`);

      assert.strictEqual(h.supabase.filas.length, 1);
      const fila = h.supabase.filas[0];
      assert.strictEqual(fila.token_hash, huella(token), 'en la base queda el SHA-256 de la credencial');
      assert.ok(!JSON.stringify(fila).includes(token), 'la credencial en claro no se guarda en ninguna columna');
      assert.strictEqual(fila.email, 'medico@hospital.test');
      assert.strictEqual(fila.machine_name, 'PC-TRIAGE');

      const otra = await h.presentarse({ install_id: 'inst-2' });
      assert.notStrictEqual(otra.json.token, token, 'dos instalaciones, dos credenciales');
      const estadoDespues = await h.pedir('GET', '/api/v1/agent/enroll', { credencial: token });
      assert.strictEqual(estadoDespues.status, 200);
      assert.ok(!('token' in estadoDespues.json), 'preguntar el estado no vuelve a enseñar la credencial');
    });
  });

  await promesa(402, 'una instalación nueva nace pendiente: ni el correo ni presentarse otra vez la aprueban', async () => {
    await con({ env: COMPUERTA }, async (h) => {
      const primera = await h.presentarse({ email: 'jefe@itsmiracleai.com', status: 'aprobada', estado: 'aprobada' });
      assert.strictEqual(primera.json.estado, 'pendiente', 'un «status» en el cuerpo no se obedece');
      assert.strictEqual(h.supabase.filas[0].status, 'pendiente');
      await h.decidir(primera.json.device_id, 'aprobada');

      // La misma persona, la misma máquina y el mismo install_id, otra vez: NO hereda la aprobación.
      // El install_id lo dice el cliente; si bastara repetirlo, quien lo conozca se aprobaría solo.
      const segunda = await h.presentarse({ email: 'jefe@itsmiracleai.com' });
      assert.strictEqual(segunda.json.estado, 'pendiente', 'presentarse otra vez no hereda la aprobación de antes');
      const entra = await h.pedir('GET', '/api/v1/agent/claves', { credencial: segunda.json.token });
      assert.strictEqual(entra.status, 403);
      assert.strictEqual(entra.json.code, 'instalacion_pendiente');

      const sinCorreo = await h.presentarse({ email: 'no-es-un-correo' });
      assert.strictEqual(sinCorreo.status, 400, 'sin un correo con forma de correo no hay alta');
      assert.strictEqual(sinCorreo.json.code, 'cuerpo_invalido');
    });
  });

  await promesa(403, 'con la compuerta apagada, que es como nace, nada cambia: la clave embebida entra como hoy', async () => {
    for (const env of [{}, { WINDOWS_DEVICE_GATE_LABELS: '' }, { WINDOWS_DEVICE_GATE_LABELS: '  ,  ' }]) {
      await con({ env }, async (h) => {
        const claves = await h.pedir('GET', '/api/v1/agent/claves');
        assert.strictEqual(claves.status, 200, `sin compuerta, la clave sola entra (${JSON.stringify(env)} → ${claves.status})`);
        const turno = await h.pedir('POST', '/api/v1/agent/turn', { cuerpo: {} });
        assert.strictEqual(turno.status, 200);
        assert.strictEqual(h.supabase.llamadas.length, 0, 'y apagada no consulta la base ni una vez: no añade un viaje a cada petición');
      });
    }
  });

  await promesa(404, 'con la compuerta puesta, la clave del instalador sola solo sirve para presentarse y preguntar su estado', async () => {
    await con({ env: COMPUERTA }, async (h) => {
      for (const [metodo, ruta] of [['GET', '/api/v1/agent/claves'], ['POST', '/api/v1/agent/turn'], ['POST', '/api/v1/operations/exports/claim']]) {
        const r = await h.pedir(metodo, ruta, { cuerpo: metodo === 'POST' ? {} : undefined });
        assert.strictEqual(r.status, 403, `${ruta} sin credencial: 403 (contestó ${r.status})`);
        assert.strictEqual(r.json.code, 'instalacion_sin_credencial', `${ruta}: el código dice por qué`);
        assert.ok(!r.texto.includes('sk-de-mentira') && !r.texto.includes('nota clínica'), `${ruta}: y no deja escapar lo que guarda`);
      }

      const inventada = await h.pedir('GET', '/api/v1/agent/claves', { credencial: 'udev_una-credencial-que-nadie-emitio-0123456789abcdef' });
      assert.strictEqual(inventada.status, 403);
      assert.strictEqual(inventada.json.code, 'instalacion_desconocida');

      const alta = await h.presentarse();
      assert.strictEqual(alta.status, 200, 'presentarse SÍ entra con la clave sola: para eso queda');
      const pendiente = await h.pedir('GET', '/api/v1/agent/claves', { credencial: alta.json.token });
      assert.strictEqual(pendiente.status, 403);
      assert.strictEqual(pendiente.json.code, 'instalacion_pendiente');
      assert.strictEqual(pendiente.json.codigo, alta.json.codigo, 'y devuelve el código, para que la persona pueda decírselo al administrador');

      const estado = await h.pedir('GET', '/api/v1/agent/enroll', { credencial: alta.json.token });
      assert.strictEqual(estado.status, 200, 'preguntar el estado propio entra estando pendiente');
      assert.strictEqual(estado.json.estado, 'pendiente');

      const desconocida = await h.pedir('GET', '/api/v1/agent/enroll', { credencial: 'udev_otra-que-nadie-emitio-0123456789abcdef0123456789' });
      assert.strictEqual(desconocida.status, 404, 'preguntar por una credencial que no existe: 404, para que el cliente sepa que toca presentarse otra vez');
      assert.strictEqual(desconocida.json.code, 'instalacion_desconocida');

      // Una ruta que solo se PARECE a la de presentarse no se cuela por la excepción.
      const parecida = await h.pedir('POST', '/api/v1/agent/enroll/../turn', { cuerpo: {} });
      assert.notStrictEqual(parecida.status, 200, 'la excepción es la ruta exacta, no un prefijo');
    });
  });

  await promesa(405, 'una instalación aprobada entra, y revocarla la deja fuera sin tocar a las demás', async () => {
    await con({ env: COMPUERTA }, async (h) => {
      const a = (await h.presentarse({ install_id: 'inst-a' })).json;
      const b = (await h.presentarse({ install_id: 'inst-b', machine_name: 'PC-CONSULTA-2' })).json;
      assert.strictEqual((await h.decidir(a.device_id, 'aprobada')).status, 200);
      assert.strictEqual((await h.decidir(b.device_id, 'aprobada')).status, 200);

      const turnoA = await h.pedir('POST', '/api/v1/agent/turn', { credencial: a.token, cuerpo: {} });
      assert.strictEqual(turnoA.status, 200, `aprobada, entra (contestó ${turnoA.status}: ${turnoA.texto})`);
      assert.strictEqual(turnoA.json.device, a.device_id, 'y la ruta sabe QUÉ instalación es: req.windowsDevice');
      assert.strictEqual((await h.pedir('GET', '/api/v1/agent/claves', { credencial: b.token })).status, 200);

      assert.strictEqual((await h.decidir(a.device_id, 'revocada')).status, 200);
      const trasRevocar = await h.pedir('POST', '/api/v1/agent/turn', { credencial: a.token, cuerpo: {} });
      assert.strictEqual(trasRevocar.status, 403, 'revocada, fuera — en la misma instancia sin esperar a que caduque nada');
      assert.strictEqual(trasRevocar.json.code, 'instalacion_revocada');
      assert.strictEqual((await h.pedir('GET', '/api/v1/agent/claves', { credencial: b.token })).status, 200, 'y la otra sigue entrando');

      // OTRA instancia del servidor (Vercel tiene varias): lo que tenía en memoria caduca solo.
      const otraInstancia = new WindowsDeviceService(h.supabase, { now: h.reloj.now });
      assert.strictEqual((await otraInstancia.authorize(b.token)).status, 'aprobada');
      await h.servicio.setStatus(b.device_id, 'revocada', 'admin@miracle.test');
      assert.strictEqual((await otraInstancia.authorize(b.token)).status, 'aprobada', 'dentro del minuto, la otra instancia aún no se enteró: es el coste de no ir a la base en cada petición');
      h.reloj.t += 61_000;
      assert.strictEqual((await otraInstancia.authorize(b.token)).status, 'revocada', 'pasado el minuto, se entera sola');
    });
  });

  await promesa(406, 'las claves de otras etiquetas no pasan por la compuerta', async () => {
    await con({ env: COMPUERTA }, async (h) => {
      const r = await h.pedir('POST', '/api/v1/agent/turn', { clave: 'clave-del-portal', cuerpo: {} });
      assert.strictEqual(r.status, 200, 'el portal, la extensión y el ejecutor siguen entrando con su clave');
      assert.strictEqual(h.supabase.llamadas.length, 0, 'y sin consultar la base');
      const sinClave = await h.pedir('POST', '/api/v1/agent/turn', { clave: null, cuerpo: {} });
      assert.strictEqual(sinClave.status, 401, 'sin API key sigue siendo 401: la compuerta no sustituye a la clave');
    });
    await con({ env: { WINDOWS_DEVICE_GATE_LABELS: ` ${ETIQUETA_DEL_PORTAL} , ${ETIQUETA_DEL_INSTALADOR} ` } }, async (h) => {
      const r = await h.pedir('POST', '/api/v1/agent/turn', { clave: 'clave-del-portal', cuerpo: {} });
      assert.strictEqual(r.status, 403, 'la lista admite varias etiquetas, con espacios');
    });
  });

  await promesa(407, 'si no se puede comprobar la instalación, la compuerta se cierra: 503, no se deja pasar', async () => {
    await con({ env: COMPUERTA }, async (h) => {
      const alta = (await h.presentarse()).json;
      await h.decidir(alta.device_id, 'aprobada');
      h.supabase.caer(true);
      const r = await h.pedir('GET', '/api/v1/agent/claves', { credencial: alta.token });
      assert.strictEqual(r.status, 503, `base caída: 503 (contestó ${r.status})`);
      assert.strictEqual(r.json.code, 'autorizacion_no_disponible');
      assert.ok(!r.texto.includes('PostgREST caído'), 'sin filtrar el mensaje interno');
      assert.ok(!r.texto.includes('sk-de-mentira'));

      const altaConBaseCaida = await h.presentarse({ install_id: 'inst-9' });
      assert.strictEqual(altaConBaseCaida.status, 503, 'y presentarse con la base caída tampoco inventa una credencial');
      assert.ok(!altaConBaseCaida.json.token);
    });
  });

  await promesa(408, 'ni la credencial ni su huella salen en el log, ni en la lista del panel', async () => {
    await con({ env: COMPUERTA }, async (h) => {
      const alta = (await h.presentarse()).json;
      await h.pedir('GET', '/api/v1/agent/claves', { credencial: alta.token });
      await h.pedir('GET', '/api/v1/agent/claves', { credencial: 'udev_otra-que-nadie-emitio-0123456789abcdef0123456789' });
      await h.decidir(alta.device_id, 'aprobada');
      const lista = await h.pedir('GET', '/api/windows/devices', { clave: null });
      assert.strictEqual(lista.status, 200);
      assert.strictEqual(lista.json.devices.length, 1);
      assert.strictEqual(lista.json.devices[0].codigo, alta.codigo, 'el panel enseña el mismo código que vio la persona');
      assert.strictEqual(lista.json.devices[0].status, 'aprobada');
      assert.strictEqual(lista.json.devices[0].decided_by, 'admin@miracle.test', 'y quién la aprobó');

      const todo = `${h.lineas.join('\n')}\n${lista.texto}`;
      assert.ok(!todo.includes(alta.token), 'la credencial no aparece');
      assert.ok(!todo.includes(huella(alta.token)), 'ni su huella');
      assert.ok(!todo.includes('otra-que-nadie-emitio'), 'ni una credencial inventada que alguien probó');
      assert.ok(!('token_hash' in lista.json.devices[0]), 'la lista no trae la columna de la huella');
      assert.ok(h.lineas.some((l) => l.includes('[agent/enroll]')), 'pero sí queda una línea por alta');
      assert.ok(h.lineas.some((l) => l.includes('[agent/gate]') && l.includes('instalacion_pendiente')), 'y una por rechazo, con su causa');
    });
  });

  await promesa(409, 'presentarse tiene tope por IP', async () => {
    await con({ env: COMPUERTA, limitePorIp: 3 }, async (h) => {
      const estados = [];
      for (let i = 0; i < 5; i += 1) estados.push((await h.presentarse({ install_id: `inst-${i}` })).status);
      assert.deepStrictEqual(estados, [200, 200, 200, 429, 429], `tres altas y después 429 (${estados.join(',')})`);
      assert.strictEqual(h.supabase.filas.length, 3, 'las rechazadas no dejan fila');
      const r = await h.presentarse({ install_id: 'inst-x' });
      assert.strictEqual(r.json.code, 'limite_de_uso');
    });
  });

  await promesa(410, 'aprobar y revocar exige ser administrador del panel', async () => {
    await con({ env: COMPUERTA, admin: false }, async (h) => {
      const alta = (await h.presentarse()).json;
      assert.strictEqual((await h.decidir(alta.device_id, 'aprobada')).status, 403);
      assert.strictEqual((await h.pedir('GET', '/api/windows/devices', { clave: null })).status, 403);
      assert.strictEqual(h.supabase.filas[0].status, 'pendiente');
    });
    await con({ env: COMPUERTA }, async (h) => {
      const alta = (await h.presentarse()).json;
      assert.strictEqual((await h.decidir(alta.device_id, 'lo-que-sea')).status, 400, 'un estado que no existe no se escribe');
      assert.strictEqual((await h.decidir('00000000-0000-4000-8000-000000000000', 'aprobada')).status, 404, 'una instalación que no existe: 404');
      assert.strictEqual((await h.decidir("x' or '1'='1", 'aprobada')).status, 400, 'un id que no es un uuid ni llega a la base');
      assert.strictEqual(h.supabase.filas[0].status, 'pendiente');
    });
  });

  await promesa(411, 'cada instalación guarda con qué clave se presentó, y el panel lo dice junto al estado de la compuerta', async () => {
    await con({}, async (h) => {
      // La etiqueta sale de la clave con la que llegó la petición, no de lo que diga el cuerpo.
      await h.presentarse({ api_label: ETIQUETA_DEL_PORTAL, etiqueta: ETIQUETA_DEL_PORTAL });
      assert.strictEqual(h.supabase.filas[0].api_label, ETIQUETA_DEL_INSTALADOR, 'la fila guarda la etiqueta de la clave, y un «api_label» en el cuerpo no se obedece');
      await h.presentarse({ install_id: 'inst-2' }, { clave: 'clave-del-portal' });
      assert.strictEqual(h.supabase.filas[1].api_label, ETIQUETA_DEL_PORTAL);

      const lista = await h.pedir('GET', '/api/windows/devices', { clave: null });
      assert.strictEqual(lista.status, 200);
      assert.deepStrictEqual(lista.json.devices.map((d) => d.api_label).sort(), [ETIQUETA_DEL_PORTAL, ETIQUETA_DEL_INSTALADOR].sort(), 'la lista dice con qué clave vino cada una');
      assert.deepStrictEqual(lista.json.compuerta, {
        encendida: false,
        etiquetas: [],
        etiquetas_de_las_instalaciones: [ETIQUETA_DEL_PORTAL, ETIQUETA_DEL_INSTALADOR].sort(),
        se_puede_cambiar: true
      }, 'y trae el estado de la compuerta: apagada, y con qué claves se están presentando');
    });
    await con({ env: COMPUERTA, vercel: vercelFalso({ escribible: false }) }, async (h) => {
      const lista = await h.pedir('GET', '/api/windows/devices', { clave: null });
      assert.strictEqual(lista.json.compuerta.encendida, true);
      assert.deepStrictEqual(lista.json.compuerta.etiquetas, [ETIQUETA_DEL_INSTALADOR]);
      assert.strictEqual(lista.json.compuerta.se_puede_cambiar, false, 'sin poder escribir en Vercel, el panel lo sabe antes de ofrecer el botón');
    });
  });

  await promesa(412, 'un administrador enciende y apaga la compuerta desde el panel: queda escrita en Vercel, se redespliega y esta instancia la obedece ya', async () => {
    await con({ env: {} }, async (h) => {
      const alta = (await h.presentarse()).json;
      await h.decidir(alta.device_id, 'aprobada');
      assert.strictEqual((await h.pedir('GET', '/api/v1/agent/claves')).status, 200, '[preparación] apagada, la clave sola entra');

      const on = await h.compuerta([ETIQUETA_DEL_INSTALADOR]);
      assert.strictEqual(on.status, 200, `encender contesta 200 (contestó ${on.status}: ${on.texto})`);
      assert.strictEqual(on.json.compuerta.encendida, true);
      assert.deepStrictEqual(on.json.compuerta.etiquetas, [ETIQUETA_DEL_INSTALADOR]);
      assert.deepStrictEqual(h.vercel.escrituras, [{ key: 'WINDOWS_DEVICE_GATE_LABELS', value: ETIQUETA_DEL_INSTALADOR, secret: false }], 'queda escrita en Vercel: sobrevive al siguiente despliegue');
      assert.strictEqual(h.vercel.estado.redespliegues, 1, 'y se redespliega, para que las demás instancias la lean');
      assert.strictEqual(on.json.deployment.triggered, true);

      const sola = await h.pedir('GET', '/api/v1/agent/claves');
      assert.strictEqual(sola.status, 403, 'esta instancia la obedece ya, sin esperar al redespliegue: la clave sola deja de entrar');
      assert.strictEqual(sola.json.code, 'instalacion_sin_credencial');
      assert.strictEqual((await h.pedir('GET', '/api/v1/agent/claves', { credencial: alta.token })).status, 200, 'y la aprobada sigue entrando');
      assert.ok(h.lineas.some((l) => l.includes('compuerta') && l.includes(ETIQUETA_DEL_INSTALADOR) && l.includes('admin@miracle.test')), 'queda una línea con quién la encendió');

      const off = await h.compuerta([]);
      assert.strictEqual(off.status, 200);
      assert.strictEqual(off.json.compuerta.encendida, false);
      assert.deepStrictEqual(off.json.compuerta.etiquetas, []);
      const escrito = h.vercel.escrituras[1];
      assert.ok(escrito && escrito.key === 'WINDOWS_DEVICE_GATE_LABELS' && escrito.value.length > 0, 'apagar también se escribe, y no vacío: Vercel no guarda una variable vacía');
      assert.deepStrictEqual(registerWindowsDeviceRoutes.etiquetasDeLaCompuerta({ WINDOWS_DEVICE_GATE_LABELS: escrito.value }), [], 'y lo escrito se lee como apagada en el despliegue siguiente');
      assert.strictEqual((await h.pedir('GET', '/api/v1/agent/claves')).status, 200, 'apagada, la clave sola vuelve a entrar');
    });
    await con({ env: {}, admin: false }, async (h) => {
      const r = await h.compuerta([ETIQUETA_DEL_INSTALADOR], { forzar: true });
      assert.strictEqual(r.status, 403, 'quien no es administrador no la toca');
      assert.strictEqual(h.vercel.escrituras.length, 0);
    });
    await con({ env: {}, vercel: vercelFalso({ escribible: false }) }, async (h) => {
      const r = await h.compuerta([ETIQUETA_DEL_INSTALADOR], { forzar: true });
      assert.strictEqual(r.status, 503, `sin poder escribir en Vercel no se enciende a medias (contestó ${r.status})`);
      assert.strictEqual(r.json.code, 'compuerta_no_se_puede_cambiar');
      assert.ok(!r.texto.includes('valor secreto'), 'sin repetir el mensaje interno');
      assert.strictEqual((await h.pedir('GET', '/api/v1/agent/claves')).status, 200, 'y esta instancia sigue como estaba');
    });
  });

  await promesa(413, 'la compuerta no se enciende para una etiqueta que no existe, ni para una sin ninguna instalación aprobada salvo que se pida a sabiendas', async () => {
    await con({ env: {} }, async (h) => {
      const alta = (await h.presentarse()).json;

      const inventada = await h.compuerta(['una-que-no-existe']);
      assert.strictEqual(inventada.status, 400);
      assert.strictEqual(inventada.json.code, 'etiqueta_desconocida', 'una etiqueta que no es de ninguna clave no protege nada: se dice');

      const sinForma = await h.pedir('POST', '/api/windows/devices/gate', { clave: null, cuerpo: { etiquetas: ETIQUETA_DEL_INSTALADOR } });
      assert.strictEqual(sinForma.status, 400, 'la lista de etiquetas tiene que ser una lista');

      const pronto = await h.compuerta([ETIQUETA_DEL_INSTALADOR]);
      assert.strictEqual(pronto.status, 409, `con todas pendientes, encender dejaría fuera a todas: 409 (contestó ${pronto.status})`);
      assert.strictEqual(pronto.json.code, 'sin_instalaciones_aprobadas');

      // Una aprobada que se presentó con OTRA clave no cuenta para esta.
      const delPortal = (await h.presentarse({ install_id: 'inst-p' }, { clave: 'clave-del-portal' })).json;
      await h.decidir(delPortal.device_id, 'aprobada');
      assert.strictEqual((await h.compuerta([ETIQUETA_DEL_INSTALADOR])).status, 409, 'una aprobada de otra etiqueta no cuenta');

      assert.strictEqual(h.vercel.escrituras.length, 0, 'ninguno de los rechazos escribió nada');
      assert.strictEqual((await h.pedir('GET', '/api/v1/agent/claves')).status, 200, 'y la compuerta sigue apagada');

      h.supabase.caer(true);
      const aCiegas = await h.compuerta([ETIQUETA_DEL_INSTALADOR]);
      assert.strictEqual(aCiegas.status, 503, 'sin poder contar las aprobadas no se enciende a ciegas');
      h.supabase.caer(false);

      const aSabiendas = await h.compuerta([ETIQUETA_DEL_INSTALADOR], { forzar: true });
      assert.strictEqual(aSabiendas.status, 200, 'pedido a sabiendas, se enciende: cerrar ya y aprobar después es una decisión del administrador');
      assert.strictEqual((await h.pedir('GET', '/api/v1/agent/claves', { credencial: alta.token })).json.code, 'instalacion_pendiente');

      await h.decidir(alta.device_id, 'aprobada');
      await h.compuerta([]);
      assert.strictEqual((await h.compuerta([ETIQUETA_DEL_INSTALADOR])).status, 200, 'y con una aprobada de esa etiqueta, se enciende sin más');
    });
  });

  await promesa(414, 'con la compuerta puesta, las claves de terceros solo se entregan a una instalación aprobada o a una etiqueta nombrada aparte', async () => {
    if (!cargarLaRutaDeLasClaves()) pendiente('web/api/registerAgentKeysRoute.js (la ruta de las claves como pieza que se puede juzgar)');

    await con({ env: COMPUERTA }, async (h) => {
      const alta = (await h.presentarse()).json;
      await h.decidir(alta.device_id, 'aprobada');

      // La clave de OTRA app (Android, Mac, la extensión): también va embebida en algo que se reparte.
      const otra = await h.pedir('GET', '/api/v1/agent/claves', { clave: 'clave-del-portal' });
      assert.strictEqual(otra.status, 403, `con la compuerta puesta, otra etiqueta ya no recibe las claves crudas (contestó ${otra.status})`);
      assert.strictEqual(otra.json.code, 'claves_no_permitidas', 'y el código dice por qué');
      assert.ok(!otra.texto.includes('sk-de-mentira'), 'sin dejar escapar ninguna');
      assert.strictEqual((await h.pedir('POST', '/api/v1/agent/turn', { clave: 'clave-del-portal', cuerpo: {} })).status, 200, 'lo demás de /api/v1 le sigue abierto: solo se cierran las claves');

      const aprobada = await h.pedir('GET', '/api/v1/agent/claves', { credencial: alta.token });
      assert.strictEqual(aprobada.status, 200, `la instalación aprobada sí las recibe (contestó ${aprobada.status})`);
      assert.strictEqual(aprobada.json.openai, 'sk-de-mentira');
      assert.ok(h.lineas.some((l) => l.includes('[agent/claves]') && l.includes(ETIQUETA_DEL_PORTAL) && l.includes('no se le sirven')), 'el rechazo deja su línea, con la etiqueta');
      assert.ok(!h.lineas.join('\n').includes('sk-de-mentira'), 'y ninguna clave en el log');
    });

    // La excepción se nombra: quien de verdad las necesite sin ser una instalación de Windows.
    await con({ env: { ...COMPUERTA, AGENT_KEYS_ALLOWED_LABELS: ` ${ETIQUETA_DEL_PORTAL} ` } }, async (h) => {
      assert.strictEqual((await h.pedir('GET', '/api/v1/agent/claves', { clave: 'clave-del-portal' })).status, 200, 'una etiqueta nombrada en AGENT_KEYS_ALLOWED_LABELS las sigue recibiendo');
      const alta = (await h.presentarse()).json;
      await h.decidir(alta.device_id, 'aprobada');
      assert.strictEqual((await h.pedir('GET', '/api/v1/agent/claves', { credencial: alta.token })).status, 200, 'y la instalación aprobada también, sin tener que nombrar su etiqueta');
    });

    // Con la compuerta APAGADA nada cambia: es como se despliega.
    await con({ env: {} }, async (h) => {
      assert.strictEqual((await h.pedir('GET', '/api/v1/agent/claves', { clave: 'clave-del-portal' })).status, 200, 'apagada y sin lista, cualquier clave válida las recibe, como hoy');
    });
    await con({ env: { AGENT_KEYS_ALLOWED_LABELS: ETIQUETA_DEL_PORTAL } }, async (h) => {
      assert.strictEqual((await h.pedir('GET', '/api/v1/agent/claves')).status, 403, 'apagada y con lista, solo la lista: lo que ya hacía');
      assert.strictEqual((await h.pedir('GET', '/api/v1/agent/claves', { clave: 'clave-del-portal' })).status, 200);
    });

    // Y encenderla desde el panel lo cierra en el mismo gesto.
    await con({ env: {} }, async (h) => {
      const alta = (await h.presentarse()).json;
      await h.decidir(alta.device_id, 'aprobada');
      assert.strictEqual((await h.compuerta([ETIQUETA_DEL_INSTALADOR])).status, 200);
      assert.strictEqual((await h.pedir('GET', '/api/v1/agent/claves', { clave: 'clave-del-portal' })).status, 403, 'encender la compuerta en el panel cierra también las claves a las demás etiquetas');
    });
  });

  cerrar('verify-windows-devices');
}

main().catch((error) => {
  // «No pude juzgar» no es «la promesa falló» (aprendizaje nº17 de apps/windows).
  console.error(`NO PUDE JUZGAR: ${error.stack || error.message}`);
  process.exit(2);
});
