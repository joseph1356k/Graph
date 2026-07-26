/* ============================================================================
   Windows Lab — el mapa del sistema real, en lenguaje humano.

   No es un diagrama de arquitectura: es el RECORRIDO de lo que pasa entre
   "el usuario hace algo" y "la máquina lo repite sola".

     · Los sentidos  — siempre encendidos (dónde estoy / cómo toco Windows)
     · Camino A 🎓   — CONSCIENTE: razonar la pantalla y enseñar un workflow
     · Camino B ⚡   — SUBCONSCIENTE: repetir un workflow ya aprendido

   Cada estación se ENCIENDE cuando llega un evento real que le corresponde
   (evento `wl:event` que emite windows-live.js al pulsar la visualización).
   Las que nunca se encienden son los puntos ciegos de telemetría: el botón
   "Ver puntos ciegos" los deja a la vista.

   La fuente de verdad de los textos son los .md de /studio-docs/ — cada
   estación enlaza al suyo y lo abre con window.StudioDocs.open().
   ============================================================================ */
(function () {
    'use strict';

    var ROOT = document.getElementById('lab-map');
    if (!ROOT) return;

    var GLOW_MS = 2600;

    // ------------------------------------------------------------------ datos
    // match: cómo se decide que un evento pasa por aquí.
    //   kinds  — ev.kind exacto
    //   text   — regex contra label + detalle (los logs del cliente llegan así)
    //   any    — función libre sobre el evento
    var BANDS = [
        {
            id: 'sentidos',
            tag: 'Siempre encendido',
            icon: '📡',
            title: 'Los sentidos',
            lead: 'Dos cosas corren todo el tiempo, pase lo que pase. Sin ellas nada de lo de abajo puede funcionar.',
            flow: false,
            stations: [
                {
                    id: 'locator',
                    icon: '📍',
                    name: 'Dónde está parado el usuario',
                    engine: 'SurfaceLocator',
                    one: 'La «URL de Windows»: convierte la pantalla en la que estás en una dirección, igual que una web.',
                    status: 'ok',
                    detail: [
                        'App de Windows → uia://proceso.exe/título-de-ventana',
                        'Navegador → web://dominio/ruta (sin lo que va después del «?»)',
                        'SAP → sapgui://SISTEMA/TRANSACCIÓN',
                        'Se refresca cada ~0,8 s pero solo hace el trabajo caro cuando algo cambió.',
                        'Las ventanas de la propia app (Ü) no cuentan: si no, abrir el panel borraría el contexto.'
                    ],
                    pending: ['Hoy solo sabe en qué ventana estás, no en qué pantalla DENTRO de la app.'],
                    doc: { file: 'motor-localizador-superficie.md', title: 'SurfaceLocator: la "URL de Windows"' },
                    sensor: true,
                    match: { any: function (ev) { return !!ev.surface_url; } }
                },
                {
                    id: 'surfaces',
                    icon: '🔌',
                    name: 'Cómo se toca cada mundo',
                    engine: 'Superficies (IUiSurface)',
                    one: 'El traductor. Arriba siempre se habla igual; abajo cambia si es una app normal o SAP.',
                    status: 'ok',
                    detail: [
                        'UiaSurface — cualquier app de Windows. Es la red de seguridad: funciona en todas partes.',
                        'SapGuiSurface — SAP por su propia API. Sin esto, dentro de SAP no se ve nada.',
                        'Cada campo se guarda con 3 formas de encontrarlo (id, nombre visible, posición) por si la app cambia.',
                        'Si el cliente no habilitó el scripting de SAP, lo dice con esas palabras en vez de «no funciona».'
                    ],
                    pending: ['Faltan más mundos detrás de la misma interfaz: web nativa, Office…'],
                    doc: { file: 'motor-superficies-uisurface.md', title: 'Superficies (IUiSurface): el CÓMO de cada mundo' },
                    sensor: true,
                    match: { any: function (ev) { return !!ev.app_id; } }
                }
            ]
        },
        {
            id: 'ensenar',
            tag: 'Camino A · consciente',
            icon: '🎓',
            title: 'Razonar y enseñar',
            lead: 'Aquí el sistema todavía PIENSA cada paso. Es lento y caro, pero es la única puerta de entrada: todo lo que después sale automático entró por aquí.',
            flow: true,
            stations: [
                {
                    id: 'analyze',
                    icon: '👁',
                    name: 'Mira la pantalla',
                    engine: 'Cerebro consciente',
                    one: 'El modelo ve lo que hay en pantalla y decide qué hacer. Cada vez, desde cero.',
                    status: 'ok',
                    detail: [
                        'Es el modo caro: razona en cada turno.',
                        'Es el que consulta al subconsciente para ver si ya hay algo aprendido que aplique.'
                    ],
                    match: { kinds: ['analyze', 'conscious_run_start'] }
                },
                {
                    id: 'act',
                    icon: '🖱',
                    name: 'Actúa',
                    engine: 'Cerebro consciente',
                    one: 'Hace clic, escribe, navega — lo que decidió en el paso anterior.',
                    status: 'ok',
                    detail: ['Vuelve a mirar la pantalla después de actuar: el bucle se repite hasta terminar.'],
                    match: { kinds: ['action', 'conscious_run_end'] }
                },
                {
                    id: 'countdown',
                    icon: '⏱',
                    name: 'La cuenta de 3 segundos',
                    engine: 'Enseñar',
                    one: 'Al dar 🎓 Enseñar espera 3 s. No es adorno: te da tiempo de poner el foco en la app de verdad.',
                    status: 'ok',
                    detail: ['Sin esa pausa grabaríamos la ventana de Ü como si fuera la app que quieres enseñar.'],
                    doc: { file: 'motor-ensenanza-workflow.md', title: 'Enseñanza: cómo un workflow entra al sistema' },
                    match: { text: /countdown|cuenta regresiva|teach_start|enseñar/i }
                },
                {
                    id: 'record',
                    icon: '🎬',
                    name: 'Dos grabadoras a la vez',
                    engine: 'WorkflowRecorder + TeachSession',
                    one: 'Una anota los pasos exactos (qué campo, qué valor, qué clic). La otra graba el video y lo que explicas hablando.',
                    status: 'ok',
                    detail: [
                        'Son independientes y corren en paralelo sobre la misma acción tuya.',
                        'El orden de llegada de los pasos ES el contrato: se mandan de a uno, nunca en paralelo.',
                        'Si se pierde un paso NO se aborta: mejor un workflow con un hueco que perder toda tu sesión.'
                    ],
                    pending: [
                        'Reiniciar en caliente (🔄) todavía no existe: hay que detener y empezar de nuevo.',
                        'Falta ejercitar la grabación real de SAP en la máquina del cliente.'
                    ],
                    doc: { file: 'motor-ensenanza-workflow.md', title: 'Enseñanza: cómo un workflow entra al sistema' },
                    match: { text: /step_observed|recorder|graba|teach/i }
                },
                {
                    id: 'stop-order',
                    icon: '🧷',
                    name: 'El orden al detener',
                    engine: 'WorkflowTeachSession',
                    one: 'Primero cerrar el video y sacar su resumen, DESPUÉS cerrar la grabación. Al revés, el resumen se pierde.',
                    status: 'ok',
                    detail: [
                        'Detener la grabación ya cierra y persiste el workflow: si el resumen llega después, ya no hay sesión abierta.',
                        'Si el video no arranca no se deja una grabación de pasos huérfana: se aborta todo y se dice por qué.'
                    ],
                    doc: { file: 'motor-ensenanza-workflow.md', title: 'Enseñanza: cómo un workflow entra al sistema' },
                    match: { text: /stop|detener|teach_stop/i }
                },
                {
                    id: 'organizer',
                    icon: '🧠',
                    name: 'El organizador decide qué es fijo y qué no',
                    engine: 'LLM organizador · valueMode',
                    one: 'Lee tus pasos y lo que dijiste, y marca cada paso: siempre este valor, un valor distinto cada vez, o da igual.',
                    status: 'ok',
                    detail: [
                        'fijo — «siempre este documento». Se usa tal cual se enseñó.',
                        'dinámico — «el mismo paciente del paso anterior». Cambia cada ejecución pero se mantiene consistente.',
                        'flexible — «cada vez que abras el Bloc de notas…». El valor exacto no importa; si no resuelve, se salta sin romper.',
                        'También pone el título solo, si lo dejaste vacío.'
                    ],
                    pending: ['Tomar el valor dinámico del chat en tiempo de ejecución es la fase siguiente.'],
                    doc: { file: 'coincidencia-superficie-estado.md', title: 'Coincidencia de superficie y estado: los 3 escenarios' },
                    match: { text: /organiz|valuemode|guide|clasific/i }
                },
                {
                    id: 'store',
                    icon: '🗄',
                    name: 'Queda guardado',
                    engine: 'Graph (Neo4j)',
                    one: 'El resultado es un workflow con sus pasos. Desde aquí ya es memoria: puede repetirse sin pensar.',
                    status: 'ok',
                    detail: ['Es lo que ves dibujado arriba, en el lado subconsciente de la visualización en vivo.'],
                    match: { text: /workflow_saved|persist|guardad/i }
                }
            ]
        },
        {
            id: 'ejecutar',
            tag: 'Camino B · subconsciente',
            icon: '⚡',
            title: 'Repetir sin pensar',
            lead: 'Aquí ya no se razona nada. El reparto no se negocia: <strong>Graph decide QUÉ, la máquina decide CÓMO</strong>. Rápido, barato y predecible — y conservador: al primer fallo, para.',
            flow: true,
            stations: [
                {
                    id: 'mcp',
                    icon: '🛰',
                    name: 'Pregunta qué hay aprendido para aquí',
                    engine: 'Scoping por MCP',
                    one: 'Según dónde estás parado, Graph le ofrece al cerebro solo los workflows que aplican a esa pantalla.',
                    status: 'ok',
                    detail: ['Usa la «URL de Windows» del primer sentido. Por eso un workflow de Windows y uno de web se tratan igual.'],
                    doc: { file: 'coincidencia-superficie-estado.md', title: 'Coincidencia de superficie y estado: los 3 escenarios' },
                    match: { kinds: ['mcp'] }
                },
                {
                    id: 'plan',
                    icon: '📋',
                    name: 'Pide el plan',
                    engine: 'WorkflowPlayer',
                    one: 'La máquina no se inventa nada: le pide a Graph la lista de pasos y solo la traduce a acciones.',
                    status: 'ok',
                    detail: ['Graph devuelve solo los pasos ejecutables, cada uno con su modo de valor (fijo/dinámico/flexible).'],
                    doc: { file: 'motor-ejecucion-workflowplayer.md', title: 'WorkflowPlayer: el motor de ejecución subconsciente' },
                    match: { kinds: ['workflow_start'] }
                },
                {
                    id: 'collapse',
                    icon: '⌨',
                    name: 'Limpia el tecleo',
                    engine: 'CollapseInputRuns',
                    one: 'Al grabar, escribir «hola» deja 4 pasos. Se queda solo el último: escritura instantánea y logs limpios.',
                    status: 'ok',
                    doc: { file: 'motor-ejecucion-workflowplayer.md', title: 'WorkflowPlayer: el motor de ejecución subconsciente' },
                    match: { text: /collapse|colaps/i }
                },
                {
                    id: 'pick-surface',
                    icon: '🎯',
                    name: 'Elige con qué mundo hablar',
                    engine: 'WorkflowPlayer',
                    one: 'Lo decide el primer paso real del workflow, no una configuración. Un workflow puede empezar en Windows y seguir en SAP.',
                    status: 'ok',
                    doc: { file: 'motor-ejecucion-workflowplayer.md', title: 'WorkflowPlayer: el motor de ejecución subconsciente' },
                    match: { text: /surface|superficie/i }
                },
                {
                    id: 'mismatch',
                    icon: '🧭',
                    name: '¿Estoy en la pantalla correcta?',
                    engine: 'SurfaceMismatch',
                    one: 'Se comprueba ANTES de tocar nada. Un formulario llenado a ciegas con los campos corridos no lo arregla nadie.',
                    status: 'ok',
                    detail: [
                        'En apps de Windows generaliza: el título de la ventana es el documento abierto, no la identidad de la app.',
                        'En web y en SAP la ruta sí cuenta: /mail no es /settings, y una transacción no es otra.'
                    ],
                    doc: { file: 'coincidencia-superficie-estado.md', title: 'Coincidencia de superficie y estado: los 3 escenarios' },
                    match: { text: /mismatch|no coincide/i }
                },
                {
                    id: 'navigator',
                    icon: '🪜',
                    name: 'Si no estás ahí, te lleva',
                    engine: 'SurfaceNavigator',
                    one: 'Antes esto fallaba. Ahora navega el sistema hasta el punto de arranque del workflow y recién ahí lo deja correr.',
                    status: 'bench',
                    detail: [
                        'Escalera de 3 intentos, de barato a último recurso:',
                        '1 · enfocar-app-viva — si ya está abierta, la trae al frente (~2 s). El caso más común.',
                        '2 · acceso-directo-inicio — si está cerrada, busca su acceso directo del menú Inicio y lo lanza (~10 s). Esto arregló la fuga #1: apps como SAP Logon que no se abren por nombre.',
                        '3 · shell — último recurso, para nombres que el sistema resuelve solo (notepad, calc, msedge).',
                        'La verdad de si llegó SIEMPRE la pone el sentido de ubicación, nunca el «lo intenté» de la estrategia.'
                    ],
                    pending: [
                        'Solo está cableado en el botón «Ejecutar workflow» del panel Backend — es el banco de pruebas.',
                        'Hoy solo alinea apps nativas: SAP y web todavía no.',
                        'Capa 2 — navegar DENTRO de la app hasta la pantalla correcta. Ahí es donde entrará el LLM.'
                    ],
                    doc: { file: 'motor-navegacion-superficie.md', title: 'SurfaceNavigator: el motor que alcanza el punto de arranque' },
                    match: { text: /\bnav\b|enfocar|acceso.?directo|shell|alinea|aligner/i }
                },
                {
                    id: 'readiness',
                    icon: '⏳',
                    name: 'Espera a que la pantalla cargue',
                    engine: 'SurfaceReadiness',
                    one: 'La barra de carga interna. Si actúa antes de tiempo el paso falla porque el campo todavía no existe.',
                    status: 'ok',
                    detail: [
                        'Señal principal: ¿ya está el elemento que voy a tocar? En cuanto está, se ejecuta YA.',
                        'Señal de respaldo: al grabar se guarda cuántos elementos hay en esa pantalla; al ejecutar se espera al 80 %.',
                        'Si en 4 s nada se confirma, lo intenta igual — resiliente antes que perfecto.',
                        'En los logs se ve: carga UI [████████░░] 80% (24/30)'
                    ],
                    pending: [
                        'Falta la barra visible debajo del badge de ubicación (hoy solo se ve en los logs).',
                        'SAP todavía no reporta su carga: ahí no se espera.'
                    ],
                    doc: { file: 'motor-carga-ui.md', title: 'SurfaceReadiness: el motor de carga de UI' },
                    match: { text: /carga ui|readiness|elemento objetivo/i }
                },
                {
                    id: 'steps',
                    icon: '▶',
                    name: 'Ejecuta paso a paso',
                    engine: 'IUiSurface.Execute',
                    one: 'Cada paso lo aplica el mundo de abajo y devuelve éxito o el motivo exacto del fallo. Al primer fallo, para.',
                    status: 'ok',
                    detail: ['Si el campo cambió de sitio, prueba las otras formas de encontrarlo antes de rendirse.'],
                    doc: { file: 'motor-ejecucion-workflowplayer.md', title: 'WorkflowPlayer: el motor de ejecución subconsciente' },
                    match: { kinds: ['workflow_step', 'workflow_end'] }
                },
                {
                    id: 'learn',
                    icon: '🔁',
                    name: 'Se aprende el camino',
                    engine: 'Consciente → subconsciente',
                    one: 'Si tuvo que abrir o enfocar la app, le añade ese paso al workflow. La próxima vez arranca solo, desde el principio.',
                    status: 'ok',
                    detail: ['Es el eslabón que cierra el círculo: lo que costó razonar una vez, la siguiente ya es automático.'],
                    doc: { file: 'motor-navegacion-superficie.md', title: 'SurfaceNavigator: el motor que alcanza el punto de arranque' },
                    match: { text: /aprend|prepend|paso de alineación|app:/i }
                }
            ]
        }
    ];

    var STATUS = {
        ok: { label: 'Funciona', cls: 'is-ok' },
        bench: { label: 'Solo en el banco de pruebas', cls: 'is-bench' },
        todo: { label: 'Pendiente', cls: 'is-todo' }
    };

    var index = {};   // stationId -> { def, node, hits, hitsEl, timer }
    var revealBlind = false;

    // ------------------------------------------------------------------- dom
    function h(tag, attrs, children) {
        var node = document.createElement(tag);
        if (attrs) for (var k in attrs) {
            if (k === 'class') node.className = attrs[k];
            else if (k === 'text') node.textContent = attrs[k];
            else if (k === 'html') node.innerHTML = attrs[k];
            else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
            else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
        }
        if (children) [].concat(children).forEach(function (c) { if (c) node.appendChild(c); });
        return node;
    }

    function buildStation(def) {
        var card = h('article', { class: 'lab-station', 'data-station': def.id });
        var hits = h('span', { class: 'lab-hits', title: 'Eventos reales que pasaron por aquí', text: '0' });

        var head = h('button', {
            type: 'button',
            class: 'lab-station-head',
            'aria-expanded': 'false',
            onclick: function () {
                var open = card.classList.toggle('is-open');
                head.setAttribute('aria-expanded', String(open));
            }
        }, [
            h('span', { class: 'lab-station-icon', 'aria-hidden': 'true', text: def.icon }),
            h('span', { class: 'lab-station-copy' }, [
                h('strong', { class: 'lab-station-name', text: def.name }),
                h('span', { class: 'lab-station-one', text: def.one })
            ]),
            hits
        ]);

        var body = h('div', { class: 'lab-station-body' });
        var status = STATUS[def.status || 'ok'];
        body.appendChild(h('div', { class: 'lab-station-meta' }, [
            h('span', { class: 'lab-chip lab-chip-engine', text: def.engine }),
            h('span', { class: 'lab-chip ' + status.cls, text: status.label })
        ]));

        if (def.detail && def.detail.length) {
            var ul = h('ul', { class: 'lab-detail' });
            def.detail.forEach(function (d) { ul.appendChild(h('li', { text: d })); });
            body.appendChild(ul);
        }
        if (def.pending && def.pending.length) {
            var pend = h('div', { class: 'lab-pending' }, [h('p', { class: 'lab-pending-title', text: '🚧 Todavía no' })]);
            var pu = h('ul');
            def.pending.forEach(function (p) { pu.appendChild(h('li', { text: p })); });
            pend.appendChild(pu);
            body.appendChild(pend);
        }
        if (def.doc) {
            body.appendChild(h('button', {
                type: 'button',
                class: 'lab-doc-link',
                text: 'Leer el doc completo →',
                onclick: function (e) {
                    e.stopPropagation();
                    if (window.StudioDocs) window.StudioDocs.open(def.doc);
                }
            }));
        }

        card.appendChild(head);
        card.appendChild(body);
        index[def.id] = { def: def, node: card, hits: 0, hitsEl: hits, timer: null };
        return card;
    }

    function buildBand(band) {
        var section = h('section', { class: 'lab-band', 'data-band': band.id }, [
            h('header', { class: 'lab-band-head' }, [
                h('span', { class: 'lab-band-icon', 'aria-hidden': 'true', text: band.icon }),
                h('div', { class: 'lab-band-copy' }, [
                    h('p', { class: 'lab-band-tag', text: band.tag }),
                    h('h2', { class: 'lab-band-title', text: band.title }),
                    h('p', { class: 'lab-band-lead', html: band.lead })
                ])
            ])
        ]);
        var track = h('div', { class: 'lab-track' + (band.flow ? ' is-flow' : '') });
        band.stations.forEach(function (st, i) {
            if (band.flow && i > 0) track.appendChild(h('span', { class: 'lab-arrow', 'aria-hidden': 'true', text: '↓' }));
            track.appendChild(buildStation(st));
        });
        section.appendChild(track);
        return section;
    }

    function buildToolbar() {
        var blindBtn = h('button', {
            type: 'button',
            class: 'lab-tool',
            text: '🔦 Ver puntos ciegos',
            onclick: function () {
                revealBlind = !revealBlind;
                ROOT.classList.toggle('show-blind', revealBlind);
                blindBtn.classList.toggle('is-on', revealBlind);
                blindBtn.textContent = revealBlind ? '🔦 Ocultar puntos ciegos' : '🔦 Ver puntos ciegos';
            }
        });
        return h('div', { class: 'lab-toolbar' }, [
            h('p', { class: 'lab-toolbar-note', text: 'Las estaciones se encienden con los eventos reales del usuario seleccionado arriba.' }),
            blindBtn
        ]);
    }

    // ------------------------------------------------------------------ vivo
    function haystack(ev) {
        var parts = [ev.kind || '', ev.phase || '', ev.label || ''];
        if (ev.detail) { try { parts.push(JSON.stringify(ev.detail)); } catch (e) { /* */ } }
        return parts.join(' ');
    }

    function matches(def, ev, text) {
        var m = def.match;
        if (!m) return false;
        if (m.kinds && m.kinds.indexOf(ev.kind) !== -1) return true;
        if (m.text && m.text.test(text)) return true;
        if (m.any && m.any(ev)) return true;
        return false;
    }

    function ignite(entry, isError) {
        entry.hits += 1;
        entry.hitsEl.textContent = String(entry.hits);
        entry.node.classList.add('is-live');
        entry.node.classList.toggle('is-error', !!isError);
        entry.node.classList.remove('is-blind');
        clearTimeout(entry.timer);
        entry.timer = setTimeout(function () {
            entry.node.classList.remove('is-live');
            entry.node.classList.remove('is-error');
        }, GLOW_MS);
    }

    function onEvent(e) {
        var ev = e.detail;
        if (!ev) return;
        var text = haystack(ev);
        var isError = ev.phase === 'error';
        for (var id in index) {
            var entry = index[id];
            // Los sentidos pasan por TODO: que un paso falle no los pone en rojo a ellos.
            if (matches(entry.def, ev, text)) ignite(entry, isError && !entry.def.sensor);
        }
    }

    // Al cambiar de usuario el mapa arranca de cero: los contadores son por usuario.
    function resetHits() {
        for (var id in index) {
            var entry = index[id];
            entry.hits = 0;
            entry.hitsEl.textContent = '0';
            clearTimeout(entry.timer);
            entry.node.classList.remove('is-live');
            entry.node.classList.remove('is-error');
            entry.node.classList.add('is-blind');
        }
    }

    // ------------------------------------------------------------------ boot
    ROOT.appendChild(buildToolbar());
    BANDS.forEach(function (band) { ROOT.appendChild(buildBand(band)); });
    for (var id in index) index[id].node.classList.add('is-blind');

    window.addEventListener('wl:event', onEvent);
    window.addEventListener('wl:user', resetHits);
})();
