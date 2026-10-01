// El juez de docs/specs/001-los-logs-de-windows-no-llenan-la-base.md.
//   node scripts/verify-telemetria-windows.js
//
// Sin red y sin Express: la base es scripts/lib/fakeSupabase.js, el reloj lo mueve el juez, y las
// rutas reales (el stream del panel, el mantenimiento diario) se montan sobre una `app` de mentira
// que solo recoge sus manejadores.
const assert = require('assert');
const createFakeSupabase = require('./lib/fakeSupabase');
const { promesa, pendiente, cerrar } = require('./lib/promesas');
const WindowsTelemetryService = require('../src/application/use-cases/WindowsTelemetryService');
const WindowsPanelService = require('../src/application/use-cases/WindowsPanelService');
const registerWindowsPanelRoutes = require('../web/api/registerWindowsPanelRoutes');
const registerMaintenanceRoutes = require('../web/api/registerMaintenanceRoutes');

const ANA = 'ana@hospital.co';
const LUIS = 'luis@hospital.co';
const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
// Un instante a mitad de hora: las pruebas que no cruzan la hora no la cruzan por casualidad.
const T0 = Date.parse('2026-10-01T15:30:00.000Z');

// La base falsa, apuntando cada petición que recibe: la 106 y la 107 cuentan peticiones.
function baseContada() {
  const db = createFakeSupabase();
  const llamadas = [];
  for (const metodo of ['select', 'insert', 'update', 'delete', 'rpc']) {
    const real = db[metodo];
    if (typeof real !== 'function') continue;
    db[metodo] = async (...args) => {
      llamadas.push({ metodo, tabla: args[0] });
      return real(...args);
    };
  }
  return { db, llamadas };
}

function reloj(inicio = T0) {
  let t = inicio;
  return { ahora: () => t, avanzar: (ms) => { t += ms; } };
}

// Lo que manda EspejoDelLog por cada línea del log del equipo (Telemetry/EspejoDelLog.cs).
function linea(etiqueta, texto) {
  return { kind: 'log', phase: etiqueta, label: texto, detail: { tag: etiqueta, text: texto } };
}

async function escenario({ usuarios = [ANA], opciones = {} } = {}) {
  const { db, llamadas } = baseContada();
  const r = reloj();
  const servicio = new WindowsTelemetryService(db, { now: r.ahora, ...opciones });
  for (const email of usuarios) await servicio.register({ email, displayName: email });
  const mandar = (email, events) => servicio.ingestEvents({ email, installId: 'pc-1', events });
  const logs = (email) => db.table('graph_windows_events').filter((fila) => fila.kind === 'log' && (!email || fila.email === email));
  return { db, llamadas, reloj: r, servicio, mandar, logs };
}

// Una `app` que solo recoge los manejadores, para llamar a la ruta real sin Express.
function appDeMentira() {
  const rutas = {};
  const recoger = (ruta, ...manejadores) => { rutas[ruta] = manejadores[manejadores.length - 1]; };
  return { rutas, get: recoger, post: recoger, all: recoger };
}

// Abre el stream en vivo del panel para un usuario y lo cierra enseguida: lo que importa es lo que
// la ruta deja hecho al abrirse, no lo que empuja después.
async function mirarEnVivo(db, email, ahora) {
  const panel = new WindowsPanelService({ catalogService: {}, supabaseRestClient: db, now: ahora });
  const app = appDeMentira();
  registerWindowsPanelRoutes(app, { windowsPanelService: panel });
  const alCerrar = [];
  const req = { params: { email }, query: {}, on: (evento, fn) => { if (evento === 'close') alCerrar.push(fn); } };
  const res = { set() {}, flushHeaders() {}, write() {}, end() {} };
  await app.rutas['/api/windows/users/:email/events/stream'](req, res);
  for (const fn of alCerrar) fn();
}

// La ruta real del mantenimiento diario, con una base que ya trae un log viejo, uno reciente y un
// evento viejo que no es log.
async function trasElMantenimiento() {
  const { db } = baseContada();
  const r = reloj();
  const servicio = new WindowsTelemetryService(db, { now: r.ahora });
  const hace = (ms) => new Date(r.ahora() - ms).toISOString();
  const eventos = db.table('graph_windows_events');
  eventos.push({ id: 'viejo', email: ANA, kind: 'log', phase: 'mano', label: 'un log de hace 8 días', created_at: hace(8 * DIA) });
  eventos.push({ id: 'reciente', email: ANA, kind: 'log', phase: 'mano', label: 'un log de hace 6 días', created_at: hace(6 * DIA) });
  eventos.push({ id: 'corrida', email: ANA, kind: 'workflow_end', phase: 'ok', label: 'una corrida de hace 30 días', created_at: hace(30 * DIA) });

  const app = appDeMentira();
  registerMaintenanceRoutes(app, {
    healthAlertService: { send: async () => ({ sent: false, reason: 'el juez no manda correos', findings: [] }) },
    restClient: db,
    windowsTelemetryService: servicio
  });
  const antes = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'secreto-del-juez';
  const respuesta = { codigo: 0, cuerpo: null };
  const res = { status(codigo) { respuesta.codigo = codigo; return this; }, json(cuerpo) { respuesta.cuerpo = cuerpo; return this; } };
  const req = { get: (cabecera) => (cabecera.toLowerCase() === 'authorization' ? 'Bearer secreto-del-juez' : ''), query: {} };
  try {
    await app.rutas['/api/internal/maintenance/daily'](req, res);
  } finally {
    if (antes === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = antes;
  }
  return { respuesta, quedan: new Set(eventos.map((fila) => fila.id)) };
}

async function main() {
  await promesa(101, 'Las líneas de log de un usuario que solo cambian en sus números o en lo que va entre comillas se guardan una sola vez por hora', async () => {
    // Las dos líneas que más pesaban el 2026-10-01: 116.372 y 49.798 filas.
    const e = await escenario();
    for (const [ms, app] of [[1300, 'chrome'], [1900, 'notepad'], [2400, 'excel']]) {
      await e.mandar(ANA, [
        linea('mapa-vivo', `ubicación cada ${ms} ms (más lento): descarté una vuelta`),
        linea('clic-sap', `delante no es SAP («${app}»): que lo intente UIA`)
      ]);
      e.reloj.avanzar(2000);
    }
    assert.strictEqual(e.logs(ANA).length, 2, `seis líneas de dos plantillas dejaron ${e.logs(ANA).length} filas, y tenían que ser 2`);
    assert.strictEqual(e.logs(ANA)[0].label, 'ubicación cada 1300 ms (más lento): descarté una vuelta', 'la fila que queda lleva el texto de la primera, con sus números');
  });

  await promesa(102, 'Cuando una línea se repitió durante la hora, al cerrarse la hora queda guardado cuántas veces llegó', async () => {
    const e = await escenario();
    for (let i = 0; i < 6; i += 1) {
      await e.mandar(ANA, [linea('omi', `no se pudo abrir el collar · intento ${i}`)]);
      e.reloj.avanzar(2000);
    }
    e.reloj.avanzar(HORA);
    await e.mandar(ANA, [linea('arranque', 'otra cosa, ya en la hora siguiente')]);
    const cuenta = e.logs(ANA).find((fila) => fila.phase === 'omi' && fila.detail && fila.detail.veces);
    assert.ok(cuenta, 'al cerrarse la hora no quedó ninguna fila con la cuenta de la línea repetida');
    assert.strictEqual(cuenta.detail.veces, 6, `la línea llegó 6 veces y la cuenta guardada dice ${cuenta.detail.veces}`);
    assert.ok(cuenta.label.includes('no se pudo abrir el collar'), 'la fila de la cuenta dice de qué línea es');
  });

  await promesa(103, 'Dos líneas de log con texto distinto se guardan las dos', async () => {
    const e = await escenario();
    await e.mandar(ANA, [
      linea('mano', 'resultado acción: ok=True'),
      linea('mano', 'resultado acción: ok=False')
    ]);
    assert.strictEqual(e.logs(ANA).length, 2);
  });

  await promesa(104, 'Los eventos que no son log se guardan todos, aunque sean idénticos', async () => {
    const e = await escenario();
    const paso = { kind: 'workflow_step', phase: 'ok', workflowId: 'wf-1', runId: 'r-1', label: 'paso 3' };
    await e.mandar(ANA, [paso, paso, paso]);
    const pasos = e.db.table('graph_windows_events').filter((fila) => fila.kind === 'workflow_step');
    assert.strictEqual(pasos.length, 3, `tres pasos de workflow idénticos dejaron ${pasos.length} filas`);
  });

  await promesa(105, 'Mientras alguien mira en vivo a un usuario en el panel, cada línea de su log se guarda, sin juntar', async () => {
    const e = await escenario();
    await mirarEnVivo(e.db, ANA, e.reloj.ahora);
    for (let i = 0; i < 3; i += 1) {
      await e.mandar(ANA, [linea('mapa-vivo', `ubicación cada ${1000 + i} ms (más lento): descarté una vuelta`)]);
      e.reloj.avanzar(2000);
    }
    assert.strictEqual(e.logs(ANA).length, 3, `con el panel abierto, tres líneas dejaron ${e.logs(ANA).length} fila(s)`);
  });

  await promesa(106, 'El latido de un usuario se escribe como mucho una vez por minuto, por muchos lotes que mande', async () => {
    const e = await escenario();
    const latidos = () => e.llamadas.filter((llamada) => llamada.metodo === 'update' && llamada.tabla === 'graph_windows_users').length;
    const antes = latidos();
    for (let i = 0; i < 5; i += 1) {
      await e.mandar(ANA, [linea('mano', `una línea distinta cada vez: ${'x'.repeat(i + 1)}`)]);
      e.reloj.avanzar(2000);
    }
    assert.ok(latidos() - antes <= 1, `cinco lotes en diez segundos escribieron el latido ${latidos() - antes} veces`);
    e.reloj.avanzar(61000);
    await e.mandar(ANA, [linea('mano', 'y otra, un minuto después')]);
    assert.strictEqual(latidos() - antes, 2, 'pasado el minuto, el latido vuelve a escribirse');
  });

  await promesa(107, 'Un lote en el que todo son repeticiones no hace ninguna petición a la base', async () => {
    const e = await escenario();
    const lote = [linea('mapa-vivo', 'ubicación cada 1300 ms (más lento): descarté una vuelta')];
    await e.mandar(ANA, lote);
    e.reloj.avanzar(2000);
    const antes = e.llamadas.length;
    await e.mandar(ANA, lote);
    const hechas = e.llamadas.slice(antes).map((llamada) => `${llamada.metodo} ${llamada.tabla}`);
    assert.deepStrictEqual(hechas, [], `el lote repetido hizo ${hechas.length} petición(es): ${hechas.join(', ')}`);
  });

  let mantenimiento = null;
  const correrMantenimiento = async () => { mantenimiento = mantenimiento || await trasElMantenimiento(); return mantenimiento; };

  await promesa(108, 'El mantenimiento diario borra los logs con más de 7 días', async () => {
    const { quedan, respuesta } = await correrMantenimiento();
    assert.ok(!quedan.has('viejo'), `el log de hace 8 días sigue en la base (el mantenimiento respondió ${respuesta.codigo}: ${JSON.stringify(respuesta.cuerpo)})`);
  });

  await promesa(109, 'El mantenimiento diario conserva los logs de los últimos 7 días', async () => {
    const { quedan } = await correrMantenimiento();
    assert.ok(quedan.has('reciente'), 'el log de hace 6 días se borró');
  });

  await promesa(110, 'El mantenimiento diario conserva los eventos que no son log, tengan la edad que tengan', async () => {
    const { quedan } = await correrMantenimiento();
    assert.ok(quedan.has('corrida'), 'la corrida de hace 30 días se borró');
  });

  await promesa(111, 'Graph no recuerda más plantillas de log por usuario que su tope, lleguen las que lleguen', async () => {
    const e = await escenario({ opciones: { tope: 3 } });
    if (typeof e.servicio.plantillasRecordadas !== 'function') pendiente('WindowsTelemetryService.plantillasRecordadas');
    const letras = 'abcdefghij'.split('');
    await e.mandar(ANA, letras.map((letra) => linea('mano', `línea ${letra}`)));
    assert.ok(e.servicio.plantillasRecordadas(ANA) <= 3, `con tope 3 recuerda ${e.servicio.plantillasRecordadas(ANA)}`);
    assert.strictEqual(e.logs(ANA).length, 10, 'lo que no cabe en la memoria se guarda igual: el tope no pierde líneas');
  });

  await promesa(112, 'Las líneas de un usuario no se juntan con las de otro', async () => {
    const e = await escenario({ usuarios: [ANA, LUIS] });
    const lote = [linea('mano', 'resultado acción: ok=True')];
    await e.mandar(ANA, lote);
    await e.mandar(LUIS, lote);
    assert.strictEqual(e.logs(ANA).length, 1, 'la línea de Ana');
    assert.strictEqual(e.logs(LUIS).length, 1, 'la misma línea, en el equipo de Luis, también se guarda');
  });

  await promesa(113, 'El texto de una línea de log se guarda una sola vez en su fila', async () => {
    const e = await escenario();
    const texto = 'señalar «Guardar»: leí la ventana en 41 ms (212 elemento(s))';
    await e.mandar(ANA, [linea('mano', texto)]);
    const [fila] = e.logs(ANA);
    assert.ok(fila, 'la línea no se guardó');
    const veces = JSON.stringify(fila).split(JSON.stringify(texto).slice(1, -1)).length - 1;
    assert.strictEqual(veces, 1, `el texto está ${veces} veces en la fila`);
    assert.strictEqual(fila.detail.tag, 'mano', 'la etiqueta sigue en detail.tag: de ahí saca el panel el motor');
  });

  await promesa(114, 'Cuando ya nadie mira en vivo a un usuario, sus líneas vuelven a juntarse', async () => {
    const e = await escenario();
    await mirarEnVivo(e.db, ANA, e.reloj.ahora);
    await e.mandar(ANA, [linea('mapa-vivo', 'ubicación cada 1000 ms (más lento): descarté una vuelta')]);
    // Nadie renueva la mirada: dos horas después el panel lleva mucho cerrado.
    e.reloj.avanzar(2 * HORA);
    const antes = e.logs(ANA).length;
    for (let i = 0; i < 4; i += 1) {
      await e.mandar(ANA, [linea('mapa-vivo', `ubicación cada ${2000 + i} ms (más lento): descarté una vuelta`)]);
      e.reloj.avanzar(2000);
    }
    assert.strictEqual(e.logs(ANA).length - antes, 1, `con el panel cerrado, cuatro repeticiones dejaron ${e.logs(ANA).length - antes} filas`);
  });

  await promesa(115, 'Una línea que la base no llegó a guardar se guarda la siguiente vez que llega', async () => {
    const e = await escenario();
    const lote = [linea('mano', 'resultado acción: ok=True')];
    const insertar = e.db.insert;
    e.db.insert = async () => { throw new Error('la base no contesta'); };
    await assert.rejects(() => e.mandar(ANA, lote), /la base no contesta/, 'el fallo de la base llega a quien llamó');
    e.db.insert = insertar;
    e.reloj.avanzar(2000);
    await e.mandar(ANA, lote);
    assert.strictEqual(e.logs(ANA).length, 1, 'la línea que no se guardó se dio por vista, y ya no se guarda en toda la hora');
  });

  cerrar('verify-telemetria-windows');
}

main().catch((error) => {
  for (let e = error; e; e = e.cause) console.error(e.stack || e);
  process.exit(1);
});
