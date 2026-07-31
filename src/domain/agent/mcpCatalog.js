// El catálogo MCP del agente de escritorio: SOLO la declaración (nombre,
// descripción, esquema de parámetros, `via`). Port de Android/backend/src/domain/mcp.ts.
//
// Diferencia CLAVE con un catálogo clásico: aquí NO hay ejecutores. El cerebro
// vive en este backend y solo DECLARA las herramientas al modelo; la EJECUCIÓN
// ocurre en el cliente Windows, que tiene su propio registro `nombre -> ejecutor
// local` (gesto de Windows / acción de sistema). Así los prompts, descripciones
// y la lógica del catálogo — la innovación — nunca salen del servidor.

const GESTURE = 'gesto de Windows';
const SYSTEM = 'API/acción del sistema (sin navegar la UI)';
const WORKFLOW_VIA = 'workflow (subconsciente ↔ consciente)';
const LEARNED_VIA = 'aprendido (árbol de UI)';

/**
 * Gestos de navegación de Windows, análogos a los gestos de accesibilidad de
 * Android. El cliente los implementa con atajos del shell (Win, Win+D, Win+A,
 * Alt+Tab, rueda del ratón).
 */
const gestureTools = [
  { name: 'go_home', via: GESTURE, params: [], description: 'Muestra el escritorio (minimiza todo), equivalente a ir al inicio.' },
  { name: 'open_app_drawer', via: GESTURE, params: [], description: 'Abre el menú Inicio para buscar y lanzar aplicaciones.' },
  { name: 'open_notifications', via: GESTURE, params: [], description: 'Abre el centro de notificaciones de Windows.' },
  {
    name: 'switch_window', via: GESTURE,
    description: 'Cambia entre ventanas abiertas (Alt+Tab).',
    params: [{ name: 'direction', description: 'Hacia qué ventana moverse', options: ['next', 'previous'] }]
  },
  {
    name: 'scroll_menu', via: GESTURE,
    description: 'Desliza (scroll) dentro de una lista o menú.',
    params: [{ name: 'direction', description: 'Dirección del desplazamiento', options: ['up', 'down'] }]
  }
];

/**
 * Acciones del sistema por API/protocolo de Windows (headless, sin navegar la
 * UI). El cliente las implementa con `Process.Start`, protocolos (`mailto:`,
 * `ms-settings:`), el portapapeles, etc. El modelo las prefiere sobre
 * computer-use para tareas del sistema.
 */
const systemTools = [
  {
    name: 'launch_app', via: SYSTEM,
    description: 'Abre una aplicación por su nombre directamente (menú Inicio / ejecutable), sin navegar la UI.',
    params: [{ name: 'app', description: 'Nombre visible o ejecutable de la app' }]
  },
  {
    name: 'set_alarm', via: SYSTEM,
    description: 'Crea una alarma en la app Reloj de Windows / Tareas programadas.',
    params: [
      { name: 'hour', description: 'Hora 0-23' },
      { name: 'minute', description: 'Minuto 0-59' },
      { name: 'message', description: 'Etiqueta (opcional)' }
    ]
  },
  {
    name: 'set_timer', via: SYSTEM,
    description: 'Inicia un temporizador.',
    params: [
      { name: 'seconds', description: 'Duración en segundos' },
      { name: 'message', description: 'Etiqueta (opcional)' }
    ]
  },
  {
    name: 'create_event', via: SYSTEM,
    description: 'Crea un evento de calendario (protocolo del calendario / Outlook).',
    params: [
      { name: 'title', description: 'Título del evento' },
      { name: 'start', description: 'Inicio ISO-8601 local, p.ej. 2026-07-06T15:00 (opcional)' },
      { name: 'location', description: 'Lugar (opcional)' }
    ]
  },
  {
    name: 'dial', via: SYSTEM,
    description: 'Abre el marcador (tel:) con un número.',
    params: [{ name: 'number', description: 'Número de teléfono' }]
  },
  {
    name: 'send_sms', via: SYSTEM,
    description: 'Abre un SMS prellenado (protocolo sms:) — el usuario confirma el envío.',
    params: [
      { name: 'number', description: 'Destinatario' },
      { name: 'message', description: 'Texto (opcional)' }
    ]
  },
  {
    name: 'send_email', via: SYSTEM,
    description: 'Abre un correo prellenado (mailto:).',
    params: [
      { name: 'to', description: 'Destinatario (opcional)' },
      { name: 'subject', description: 'Asunto (opcional)' },
      { name: 'body', description: 'Cuerpo (opcional)' }
    ]
  },
  {
    name: 'web_search', via: SYSTEM,
    description: 'Busca en la web en el navegador por defecto.',
    params: [{ name: 'query', description: 'Qué buscar' }]
  },
  {
    name: 'open_url', via: SYSTEM,
    description: 'Abre una URL en el navegador.',
    params: [{ name: 'url', description: 'URL http(s)' }]
  },
  {
    name: 'open_maps', via: SYSTEM,
    description: 'Abre un lugar o búsqueda en el mapa.',
    params: [{ name: 'query', description: 'Lugar o búsqueda' }]
  },
  {
    name: 'directions', via: SYSTEM,
    description: 'Abre la navegación hacia un destino.',
    params: [{ name: 'destination', description: 'Destino' }]
  },
  {
    name: 'open_camera', via: SYSTEM,
    description: 'Abre la app de Cámara.',
    params: []
  },
  {
    name: 'open_settings', via: SYSTEM,
    description: 'Abre una pantalla de Configuración de Windows (ms-settings:).',
    params: [{ name: 'section', description: 'Sección', options: ['general', 'wifi', 'bluetooth', 'network', 'display', 'sound', 'battery', 'privacy', 'apps'] }]
  },
  {
    name: 'share_text', via: SYSTEM,
    description: 'Abre el diálogo de compartir de Windows con un texto.',
    params: [{ name: 'text', description: 'Texto a compartir' }]
  },
  {
    name: 'set_clipboard', via: SYSTEM,
    description: 'Copia un texto al portapapeles (sin UI).',
    params: [{ name: 'text', description: 'Texto a copiar' }]
  },
  {
    name: 'set_volume', via: SYSTEM,
    description: 'Ajusta el volumen del sistema directamente (sin UI) a un porcentaje 0-100.',
    params: [{ name: 'percent', description: 'Nivel 0-100 (usa 100 para asegurar que se oiga)' }]
  },
  {
    name: 'adjust_volume', via: SYSTEM,
    description: 'Sube, baja, muda o restaura el volumen del sistema con un solo golpe (como la tecla física).',
    params: [{ name: 'direction', description: 'Acción', options: ['raise', 'lower', 'mute', 'unmute'] }]
  }
];

/**
 * El catálogo MCP base: gestos + acciones de sistema. Las herramientas
 * APRENDIDAS y los WORKFLOWS se añaden encima en runtime desde los stores de
 * aprendizaje (ver learning.js), sin tocar esto.
 */
function baseCatalog() {
  return [...gestureTools, ...systemTools, ...mapTools];
}

/** Nombres de las herramientas (para distinguir llamadas MCP vs funciones custom). */
/**
 * EL MAPA DEL COMPUTADOR. El cliente construye pasivamente un grafo de las pantallas que ha visto
 * —nodos= superficies, aristas= transiciones con la acción que las provoca— mientras el usuario
 * trabaja, sin que nadie enseñe nada. Esto lo expone al modelo.
 *
 * Es distinto de un workflow y conviene que el modelo lo entienda: un workflow es una tarea que
 * alguien enseñó a propósito; el mapa es terreno conocido. Sirve para LLEGAR a sitios, no para
 * hacer tareas.
 *
 * Las descripciones dicen lo que el mapa NO sabe además de lo que sabe. El terreno se aprende
 * observando y su precisión medida ronda el 78%: un modelo que crea que es infalible improvisará
 * sobre pantallas equivocadas, y uno que sepa que puede fallar preguntará o verificará. El cliente
 * comprueba la llegada en cada tramo y se detiene si no coincide — por eso `map_go_to` puede
 * responder "me quedé a mitad", y eso es una respuesta correcta, no un error.
 */
const MAP_VIA = 'mapa del computador (terreno aprendido por observación)';

const mapTools = [
  {
    name: 'map_where_am_i', via: MAP_VIA, params: [],
    description: 'Dice en qué pantalla está el usuario ahora mismo y cuántas salidas conocidas tiene.'
  },
  {
    name: 'map_places', via: MAP_VIA,
    description: 'Lista las pantallas que el mapa conoce, las más visitadas primero. Útil para saber a dónde se PUEDE ir antes de intentarlo.',
    params: [{ name: 'app', description: 'Filtrar por app o dominio (opcional), p.ej. "explorer.exe" o "github.com"' }]
  },
  {
    name: 'map_routes_from', via: MAP_VIA,
    description: 'Salidas conocidas de una pantalla y con qué elemento se recorre cada una. Indica explícitamente las que se observaron pero cuya acción se desconoce.',
    params: [{ name: 'surface', description: 'Id de superficie; si se omite, la pantalla actual' }]
  },
  {
    name: 'map_take', via: MAP_VIA,
    description: 'Toma UNA salida de la pantalla actual, elegida por su nombre tal como lo devuelve map_routes_from (p.ej. "Videos", "Documentos"). Es la forma natural de navegar el mapa: pide las salidas, elige la que sirva, y toma esa. Si el nombre coincide con varias, las devuelve para que elijas en vez de adivinar. Verifica la llegada.',
    params: [{ name: 'exit', description: 'Nombre de la salida, como aparece en map_routes_from' }]
  },
  {
    name: 'map_go_to', via: MAP_VIA,
    description: 'Navega hasta una pantalla conocida recorriendo la ruta aprendida, verificando la llegada en cada paso. Solo usa rutas COMPLETAS: si falta saber cómo se recorre algún tramo, no se mueve y lo dice. Si un paso no llega a donde debía, se detiene e informa dónde quedó.',
    params: [{ name: 'surface', description: 'Id de superficie destino, tal como aparece en map_places' }]
  }
];

function catalogNames(tools) {
  return new Set(tools.map((tool) => tool.name));
}

module.exports = { baseCatalog, catalogNames, WORKFLOW_VIA, LEARNED_VIA };
