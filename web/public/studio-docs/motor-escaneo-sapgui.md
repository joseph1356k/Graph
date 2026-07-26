# Escaneo SAP GUI: cómo leemos una pantalla de SAP

> **Estado:** implementado · **Verificado:** 2026-07-26 (lectura de código, sin medición contra un SAP real) · **Código:** `windows-graph/src/Surfaces/SapGuiSurface.cs:26`

Todas las rutas de este doc son relativas al repo **windows-app**.

Este es el motor que más va a crecer, y el que más te va a costar depurar, así que
conviene entender primero **por qué existe**.

Dentro de SAP GUI, UI Automation no ve nada. Literalmente: el árbol de UIA se queda en un
`Pane` y por debajo no hay elementos que enumerar. No es un bug de Windows — SAP
documenta que sus controles están acoplados a la lógica de negocio y no pueden
instanciarse fuera de SAP GUI, y en lugar de exponerlos a la automatización genérica
crearon su propia API: **SAP GUI Scripting**, un modelo de objetos COM.

Para SAP, esto o nada. Toda la lectura, la grabación y la ejecución sobre SAP pasa por
`windows-graph/src/Surfaces/SapGuiSurface.cs`.

---

## Cómo nos enganchamos al COM (y por qué por reflexión)

La cadena de arranque está en `ResolveEngine` (`SapGuiSurface.cs:136-155`) y son tres
saltos:

1. `Type.GetTypeFromProgID("SapROTWr.SapROTWrapper")` — el wrapper de la Running Object
   Table que instala SAP GUI (`saprotwr.dll`). Si el ProgID no está registrado, **SAP GUI
   no está instalado** y se devuelve `null` (`:144`).
2. `GetROTEntry("SAPGUI")` (`:149-150`) — la entrada de la ROT. `null` aquí significa que
   SAP GUI **no está corriendo** (`:151`).
3. `GetScriptingEngine` (`:153-154`) — el `GuiApplication`, la raíz del modelo de objetos.

Todo eso se llama **por reflexión, sin ninguna referencia a `sapfewse.ocx`**. Es una
decisión de diseño explícita (`:14-18`) con dos beneficios que hay que respetar al tocar
este archivo:

- El proyecto **compila en máquinas sin SAP GUI** (CI, el portátil de cualquier
  desarrollador). La ausencia de SAP es un estado que se reporta, no un fallo de build.
- Sobrevive mejor a los cambios de versión. El interop generado de C# se ha roto entre
  7.40 → 7.70 → 8.0.

Hay un detalle que parece trivial y no lo es: los ProgIDs candidatos
(`RotWrapperProgIds`, `:99-103`). El registrado de verdad es `SapROTWr.SapROTWrapper`
—verificado contra SAP GUI 8.00 x64—; el nombre `SapROTWr.CSapROTWrapper` que aparece en
muchos ejemplos antiguos es el de la **clase C++ interna**, no un ProgID COM. Pedirlo
devuelve `null`, y el síntoma es que todo parece decir "SAP no instalado" en una máquina
que sí lo tiene. Se prueban ambos, el correcto primero.

Desde el `GuiApplication` se baja a la sesión concreta en `Session` (`:158-170`):
**la primera sesión de la primera conexión**. `app.Connections.ElementAt(0)` →
`conn.Sessions.ElementAt(0)`. Con dos sistemas SAP abiertos, hoy siempre se trabaja
contra el primero; no hay selección de conexión.

### El cache del motor, y el aviso de seguridad de SAP

`ScriptingEngine` (`:121-134`) cachea el motor **a nivel de proceso** con un `lock`
estático. La razón está en `:106-112` y es puramente de experiencia de usuario: SAP GUI
dispara su aviso de seguridad ("un script está intentando acceder a SAP GUI") en **cada
attach**. El inspector lee cada 700 ms y en cada clic; resolver el motor de cero cada vez
haría reaparecer el aviso sin parar.

El cache se valida con una sonda de liveness barata antes de devolverlo
(`_ = ((dynamic)_cachedEngine).Connections.Count`, `:129`): si el proxy murió porque SAP
se cerró, se invalida y se re-resuelve. Un attach nuevo, y un aviso nuevo — pero solo
tras un fallo real.

**Excepción importante:** el observador de grabación llama con `useCache: false`
(`:817`). Sus sinks COM exigen que la sesión se resuelva **en su propio hilo STA**; un
proxy resuelto en otro hilo rompe el enganche de eventos.

### Qué pasa si SAP no está, o el scripting está apagado

`Check()` (`:59-89`) devuelve un `SurfaceAvailability` con **motivo**, no un booleano, y
distingue cuatro estados:

- No hay motor → "No hay ninguna sesión de SAP GUI abierta, o SAP GUI no está instalado en este equipo."
- `Connections.Count == 0` → "SAP GUI está abierto pero no hay ninguna conexión activa."
- `Sessions.Count == 0` → "La conexión de SAP no tiene ninguna sesión abierta."
- Cualquier excepción → el mensaje largo de `:84-87`, que nombra la causa más probable:
  el Basis del sistema SAP tiene que poner `sapgui/user_scripting` en `TRUE` (RZ11), y
  el SAP GUI local tiene que permitirlo en Opciones → Accessibility & Scripting.

Esta granularidad no es cosmética. En la máquina de un cliente, "no funciona" es inútil;
"tu Basis no ha habilitado el scripting" es accionable — y es un cambio de configuración
del servidor que **no controlamos**. El valor por defecto de `sapgui/user_scripting` es
`FALSE`.

---

## Los tres recorridos de la pantalla

No hay un solo escaneo: hay **tres**, con propósitos distintos y límites distintos. Es la
primera cosa que confunde al leer el archivo.

### 1. `ReadFields` — los campos de formulario (`:203-230`)

Arranca en `wnd[0]/usr`, el **área de usuario**: lo que el operador rellena. Quedan
fuera a propósito la barra de herramientas, los menús y la statusbar, que no son campos
de formulario.

Reconoce solo los tipos de `Interactive` (`:40-44`): `GuiTextField`, `GuiCTextField`,
`GuiPasswordField`, `GuiComboBox`, `GuiCheckBox`, `GuiRadioButton`, `GuiButton`,
`GuiOkCodeField`.

Límites del recorrido `Walk` (`:537-559`): **profundidad 20**, **300 elementos**.

Cada nodo se traduce a un `DetectedField` en `Describe` (`:561-584`): selector
normalizado, etiqueta, tipo de control traducido al vocabulario de Graph
(`GraphControlType` `:660-668`), valor actual y —solo para combos— las opciones
permitidas con su clave interna y su texto visible (`OptionsOf` `:625-648`, tope de 80).

Detalle no negociable: `ValueOf` **nunca** lee el valor de un `GuiPasswordField`
(`:616-617`). Devuelve `null`. Una contraseña no se lee ni se graba.

Este es el recorrido que alimenta al cerebro: `SapContextReader`
(`windows-client/src/Uia/SapContextReader.cs:18-46`) lo envuelve como un bloque de texto
—hasta 80 campos, `:34`— y lo **añade** al contexto de UI del turno cuando la app en foco
es SAP.

### 2. `ReadVisibleElements` — todo lo visible, con geometría (`:251-265`)

Este es el que alimenta al inspector visual. A diferencia del anterior, recorre la
**ventana entera**: `session.ActiveWindow`, con fallback a `wnd[0]` (`:258-260`). Ahí
entran la barra de herramientas, el código OK, los títulos, y sobre todo los **shells**
(el árbol de SAP Easy Access, los grids).

`WalkVisual` (`:341-380`) tiene límites propios: **profundidad 30**, **700 elementos**
(`:343`). Y una regla de emisión que conviene entender (`:348-353`):

- Los shells cuyo `SubType` es **layout puro** —`Splitter`, `Container`, `Docking`,
  `Dockshell` (`:239-242`)— no se enmarcan: solo se recorren para llegar a sus hijos.
- El resto de shells (`Tree`, `GridView`, `TextEdit`, `Picture`, `HTMLViewer`…) **sí** son
  contenido que el usuario ve y toca, y se emiten como caja.
- Las hojas (todo lo que no es contenedor) se emiten siempre.

`DescribeVisual` (`:391-426`) exige geometría: `ScreenLeft`, `ScreenTop`, `Width`,
`Height` en **píxeles físicos de pantalla** (no relativos al contenedor). Y hay un filtro
de cordura en `:408` que descarta lo degenerado: la barra de menú principal, por ejemplo,
reporta ancho/alto/top negativos cuando no está desplegada.

### 3. Los nodos de árbol (`:440-480`)

Un `GuiTree` se enumera aparte, y con un límite duro de la API que hay que conocer:
**SAP no expone coordenadas por nodo**. Da claves y textos (`GetNodesCol`,
`GetNodeTextByKey`) pero ningún rectángulo. Por eso los nodos se emiten como elementos
**lógicos** (`BoundsKnown: false`): el cerebro los ve y puede accionarlos por clave, pero
el overlay solo puede enmarcar el árbol entero.

El recorrido es **en anchura por clave**, no una sola pasada, y la razón está documentada
en `:435-438`: según el control, `GetNodesCol` devuelve **solo los nodos raíz** (en SAP
Easy Access, "Favoritos" y "Menú SAP" → dos). Para capturar todo lo cargado hay que bajar
con `GetSubNodesCol` desde cada clave, deduplicando con un `HashSet` por si alguna versión
sí devuelve todo de golpe. Topes: **600 nodos** emitidos (`:453`), **800 claves** vistas
(`:475`).

Las carpetas colapsadas cuyos hijos aún no se han traído del servidor **no aparecen**, y
es correcto: no se expanden pasivamente. El agente las desplegará cuando navegue.

El texto de un nodo se busca primero en el nodo (`GetNodeTextByKey`) y, si viene vacío, en
los ítems de columna (`GetItemText`, `NodeText` `:524-535`), porque en los árboles de
columnas el texto visible vive en el ítem, no en el nodo. Los nombres de columna se leen
una sola vez, con tope de 20 (`TreeColumnNames` `:505-521`).

---

## El formato de los IDs y por qué se normalizan

El `id` de la Scripting API es una ruta tipo URL desde la raíz del modelo de objetos:

```
/app/con[0]/ses[0]/wnd[0]/usr/txtRSYST-BNAME
```

Es un **selector excelente**, bastante mejor que un CSS: SAP lo deriva del nombre del
campo del Dynpro (`RSYST-BNAME`), no de la maquetación. Cambia el layout y el id
sobrevive.

Pero se guarda **normalizado**, sin el prefijo de conexión y sesión
(`windows-graph/src/Surfaces/SapSelector.cs:28-49`):

```
sap:wnd[0]/usr/txtRSYST-BNAME
```

El motivo está en `SapSelector.cs:14-21` y es la clase de detalle que hunde un workflow
en producción: **`con[N]` y `ses[M]` identifican la conexión y la sesión concretas del
momento en que se grabó.** Un operador con dos sistemas SAP abiertos tiene otros índices.
Un operador que cierre SAP y lo reabra tiene otros índices. El id absoluto dejaría de
resolver, y el fallo se vería como "el campo ya no existe" cuando el campo está ahí.

Lo que empieza en `wnd[0]` sí describe la pantalla, y `GuiSession.FindById` **acepta
rutas relativas a la sesión** — que es justo como se resuelven en `Execute` (`:687`).

La normalización es una sola regex (`:28-29`), case-insensitive, más un `TrimStart('/')`.
El prefijo `sap:` es lo que le dice al `WorkflowPlayer` que ese paso pertenece a esta
superficie (`SapSelector.Owns`, `:34-35`).

---

## Cómo se identifica la pantalla actual

`Identity()` (`:174-192`) sintetiza la "URL de Windows" de SAP a partir de tres lecturas
sobre `session.Info`:

- `info.SystemName` → el **SID** del sistema (p.ej. `PRD`). Si viene vacío, se usa el
  literal `sap` (`:187`).
- `info.Transaction` → el **TCODE** (p.ej. `VA01`).
- `session.FindById("wnd[0]").Text` → el título, que se guarda pero **no forma parte de
  la identidad**.

El resultado es un `SurfaceIdentity(Origin: "sapgui://PRD", Pathname: "/VA01",
Title: …)`, y su `Url` (`windows-graph/src/Surfaces/IUiSurface.cs:14`) es
`sapgui://PRD/VA01`.

Esta es la mejor identidad de pantalla de todo el sistema, y merece la pena decir por
qué: en `uia://` el pathname es el título de la ventana —o sea, el documento abierto, que
es instancia y no identidad— mientras que aquí el pathname es **la transacción**, que es
exactamente el concepto de "en qué pantalla estoy". Por eso `WorkflowPlayer.SurfaceMismatch`
(`windows-graph/src/WorkflowPlayer.cs:447`) acota por pathname en `sapgui://` y lo ignora
en `uia://`.

Cualquier excepción devuelve `SurfaceIdentity.Unknown` (`:191`).

---

## La regla de hilos

El COM de SAP bloquea, y además exige un apartamento STA con bomba de mensajes. Eso
produce dos reglas distintas según el camino:

**Lectura y ejecución** (`ReadFields`, `ReadVisibleElements`, `HitTest`, `Execute`): el
contrato de `IUiSurface` (`IUiSurface.cs:56-59`) dice que **pueden bloquear** y que hay
que llamarlas **fuera del hilo de UI**. Se cumple en todos los llamadores: el inspector
las invoca desde `Task.Run` (`UiInspector.cs:93`, `:145`), y el cerebro también
(`AgentLoop.cs:167`). No hay nada en el código que lo imponga: si alguien las llama desde
el hilo de UI, la carita se congela y no hay ningún aviso.

**Grabación** (`StartObserving`, `:776-805`): esto sí necesita un hilo propio. Se arranca
un `Thread` dedicado marcado `ApartmentState.STA` (`:784-786`) que corre `Dispatcher.Run()`
(`:851`) hasta que `StopObserving` llame a `InvokeShutdown()`. La sesión se resuelve
**dentro** de ese hilo, sin cache (`:817`), porque un proxy COM heredado de otro hilo
rompe los sinks.

El arranque es síncrono con timeout: el llamador espera hasta **8 segundos** a que el
hilo señale que está listo (`:788`). Si no lo hace, o si hubo error, el hilo se apaga
ordenadamente antes de lanzar (`:794-800`) — sin eso, cada reintento del operador dejaría
un hilo STA huérfano corriendo `Dispatcher.Run()`.

Dentro del hilo, `PumpMain` (`:808-858`) intenta enganchar los eventos COM de
`GuiSession` (`Change`, `StartRequest`, `EndRequest`, `ErrorMessage`) vía
`SapComEvents.TryHook`. Si falla **por cualquier motivo**, cae a un `DispatcherTimer` de
sondeo de **500 ms** (`:845`) en vez de lanzar: la grabación sigue funcionando, degradada.

Sea cual sea el driver, lo que se publica es lo mismo (`PublishChangedFields` `:865-886`):
se relee el área de usuario completa y se emite un `ObservedStep` por cada campo cuyo
valor **cambió** respecto del snapshot anterior. Ni el evento `Change` ni el sondeo traen
"qué cambió", así que la única fuente de verdad es la relectura.

---

## Cómo se ejecuta un paso

`Execute` (`:672-702`) toma el selector del paso más sus `AlternativeTargets`, se queda
con los que son de esta superficie (`SapSelector.Owns`) y prueba cada uno con
`session.FindById(id, false)` — el `false` es el flag de "no lances si no existe".

`Apply` (`:704-747`) traduce el `actionType` a la API de SAP:

- `input` → `node.Text = valor`.
- `select` → en un `GuiComboBox` se fija **la CLAVE** (`node.Key`), no el texto visible.
  Graph guarda las dos: `selectedValue` es la clave y `selectedLabel` el texto (`:716-724`).
  Si el paso no trae clave, falla con mensaje explícito.
- `click` → `Press()` en botones; `Selected = …` en checkbox y radio; en cualquier otro
  control, `SetFocus()`.

Los errores se devuelven por `out string error` en vez de lanzar, con el id y la etiqueta
dentro del mensaje. Es deliberado: un workflow a medias en un SAP de producción tiene que
reportar **exactamente** dónde se rompió.

---

## Qué proceso se considera SAP

Hay tres criterios distintos en el código, y no coinciden. Vale la pena saberlo:

- `SurfaceDetector` (`windows-graph/src/Surfaces/SurfaceDetector.cs:21-24`) usa una lista
  cerrada: `saplogon`, `sapgui`.
- El inspector (`windows-client/src/Uia/UiInspector.cs:129-130`) usa el **prefijo** `sap`,
  para cubrir variantes históricas sin listarlas.
- El catálogo de motores del backend (`Graph/src/domain/windowsEngines.js:49`) lista
  `sap`, `saplogon`, `saplgpad`.

No es un bug conocido, pero es una divergencia real: una instalación cuyo proceso se
llame distinto se comportará de forma diferente según qué parte del sistema la mire.

---

## Limitaciones y pendientes

- **Un clic que no cambia ningún valor no se puede grabar.** Es un límite heredado de la
  API de SAP, no de esta implementación (`:764-768`): pulsar "Grabar" cuando ya se llenó
  todo es indistinguible de "no pasó nada", ni por eventos COM ni por sondeo. SAP no
  expone qué control tenía el foco al disparar el round-trip. La vía prevista es
  inferirlo en post-proceso desde el video adjunto de la enseñanza.
- **`Change` no es un evento por pulsación.** Se dispara por lotes en el round-trip al
  servidor, así que **la granularidad máxima de grabación es el viaje al servidor**, no
  la tecla (`:755-757`).
- **`sapgui/user_scripting_disable_recording`** apaga TODOS los eventos de scripting sin
  avisar (`:760-762`). Si el enganche COM se hizo pero nunca publica nada mientras el
  operador sí interactúa, esa es la causa más probable — y es indistinguible de un bug
  nuestro salvo por ese comentario.
- **El enganche de eventos COM nunca se ha verificado contra un SAP real**
  (`SapComEvents.cs:22-26`). Toda la introspección (IID de la interfaz de origen, DISPIDs
  por nombre, aridad de cada sink) se resuelve en runtime y está escrita para degradar a
  sondeo. El primer log de `Diagnostic` contra un SAP real es lo que confirmará si calzó.
- **Siempre la primera conexión y la primera sesión.** Con varios sistemas abiertos no hay
  forma de elegir.
- **`ReadinessCount()` devuelve 0** (`:196`) y `IsStepReady` devuelve siempre `true`
  (`:199`): el motor de carga de UI **se salta** SAP por completo. La navegación por
  scripting es síncrona, así que en la práctica funciona, pero no hay señal de "pantalla
  lista" propia de SAP.
- **Ningún límite de recorrido se reporta.** Si una pantalla supera los 300 campos, los
  700 elementos visuales o los 600 nodos de árbol, el corte es silencioso. No hay log ni
  telemetría que diga "se truncó", así que un fallo por elemento faltante se vería como
  "el campo no existe".
- **Sin telemetría propia.** El `kind` `sap_scan` está declarado en el catálogo de
  motores del backend (`Graph/src/domain/windowsEngines.js:47`) pero **ningún cliente lo
  emite**. Lo único que sale hoy son las líneas de `LogBus` con tag `"sap"`, que no
  abandonan la máquina. La tab "Escaneo SAP GUI" del marcador está vacía hasta que exista
  el puente de logs.
- **Pendiente de documentar:** cómo se comporta el escaneo con `GuiGridView` y
  `GuiTableControl` fila a fila. El código los reconoce como shells de contenido y los
  enmarca como una caja, pero **no hay ninguna enumeración de celdas ni de filas**
  equivalente a la de `GuiTree`. No está claro si eso es una decisión o un hueco; hay que
  probarlo contra un SAP real antes de escribirlo aquí.
