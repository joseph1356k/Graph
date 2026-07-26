# Inspector de elementos: por qué un botón se marca en rojo

> **Estado:** implementado · **Verificado:** 2026-07-26 (lectura de código, sin medición en runtime) · **Código:** `windows-client/src/Uia/UiInspector.cs:161`

Todas las rutas de este doc son relativas al repo **windows-app**.

El inspector parece una herramienta de depuración visual —cajas de colores sobre la
pantalla— pero no lo es. Es un **instrumento de medida**: responde a una sola pregunta,
y la responde antes de que el asistente falle en producción.

La pregunta es: **si el asistente intentara reproducir este clic por su cuenta, ¿tocaría
el mismo elemento que acabas de tocar tú?**

Porque el asistente no clica coordenadas. Clica **etiquetas**. Cuando un workflow dice
"pulsa Guardar", en tiempo de ejecución alguien tiene que traducir «Guardar» a un
elemento concreto de la pantalla, y esa traducción es donde vive el fallo silencioso: si
hay tres controles con la etiqueta «Guardar», el asistente se queda con el primero en
orden de lectura y **cree que acertó**. El paso reporta ✓ y en pantalla no pasó lo que
tenía que pasar.

El inspector hace visible exactamente esa traducción, clic a clic, antes de grabar nada.

---

## Qué significa cada color

La paleta está en `windows-client/src/Ui/InspectorOverlay.cs:36-44`. **No hay verde**:
el "todo bien" es amarillo, porque el inspector no valida elementos, valida
resoluciones.

- **Blanco al 40%** — todo elemento accionable que UIA detecta en la pantalla. Es el
  fondo permanente: te dice qué ve el sistema, no qué está bien o mal.
- **Amarillo `#F2C200`** — **COINCIDE**. El elemento que tocaste es el mismo que el
  asistente resolvería. Una sola caja.
- **Rojo `#E5534B`** — **NO COINCIDE**. Se dibujan **dos** cajas: la que tocaste en rojo
  sólido de grosor 2.5, y la que el asistente tocaría en rojo **punteado** (patrón de
  guiones `{3,2}`). Ver `InspectorOverlay.cs:146-147` y `:170`.
- **Cian `#25C8E0`** — campos y botones leídos por SAP GUI Scripting.
- **Ámbar `#FFA51F`** — shells de SAP (árbol, grid), con rótulo pegado arriba a la
  izquierda.

Cian y ámbar existen porque dentro de SAP GUI, UIA se queda en un `Pane` y **no ve
nada**. Que se dibujen las dos familias a la vez, con colores distintos, es la razón de
ser del inspector doble: de un vistazo sabes qué llega por UIA y qué llega por
Scripting.

El destello se borra solo: **3000 ms** si hubo mismatch, **1600 ms** si coincidió
(`UiInspector.cs:232`, temporizador en `ScheduleClear` `:236-247`). El rojo dura casi el
doble a propósito — es lo que hay que leer con calma.

---

## La comparación, que es el corazón del motor

Aquí está todo. El resto (hooks, overlay, timers) es plomería.

### En UIA la comparación es por RECTÁNGULO, no por ID

`DiagnoseUia` (`UiInspector.cs:161-179`) hace tres cosas:

1. **Qué tocaste** (`:164-167`): de todos los elementos accionables cuyo `Bounds`
   contiene el punto del clic, se queda con el de **menor área**. Es la heurística
   estándar: el elemento más pequeño que contiene el punto es el más específico.
2. **Qué tocaría el asistente** (`:171-172`): `FirstOrDefault` sobre la misma lista,
   quedándose con el primero cuya `Label` coincide sin distinguir mayúsculas. Esto
   **replica a propósito** `UiaReader.TapTargetForLabel` (`windows-client/src/Uia/UiaReader.cs:85`),
   que es literalmente la línea que usa el ejecutor real. Si el inspector inventara su
   propia resolución, el rojo no significaría nada.
3. **El veredicto** (`:174`): `mismatch = intended != null && intended.Bounds != clicked.Bounds`.

Fíjate en el criterio de igualdad: **`Bounds`**. En UIA no existe un identificador de
selector estable —no hay nada equivalente al `id` de SAP o a un CSS—, así que la
identidad efectiva de un elemento **es su rectángulo en pantalla**. Es una decisión
consciente, documentada en `InspectorDiagnostics.cs:105-107`, y tiene una consecuencia
que hay que tener presente al trabajar sobre este motor: dos elementos distintos que
ocuparan exactamente el mismo rectángulo se leerían como el mismo elemento. En la
práctica no pasa, pero es el supuesto sobre el que descansa la comparación.

### En SAP la comparación sí es por ID

`DiagnoseSap` (`UiInspector.cs:188-218`) cambia las dos mitades:

- **Qué tocaste**: no se adivina, se pregunta. SAP tiene hit-test nativo
  (`session.FindByPosition(x, y, raise=false)`), envuelto en `SapInspectorReader.HitTest`
  (`windows-client/src/Uia/SapInspectorReader.cs:62` → `windows-graph/src/Surfaces/SapGuiSurface.cs:274`).
  Eso es **verdad de terreno**: SAP sabe exactamente qué control cae en ese píxel. Solo
  si el hit-test no devuelve nada se cae al bbox más pequeño (`:197-199`), y el log lo
  dice explícitamente para que no se confunda una aproximación con un hecho.
- **El veredicto** (`:206`): `mismatch = intended.Id != clicked.Id`. Aquí sí hay
  identidad real —la ruta `wnd[0]/usr/txtRSYST-BNAME`— así que se compara por ella.

Si bajo el punto no hay ningún elemento SAP con caja, `DiagnoseSap` devuelve `false` y
el clic cae al diagnóstico UIA (`:191`, `:200`). Es lo que pasa cuando tocas el marco de
la ventana de SAP: por fuera del dynpro, quien manda es UIA.

### El caso especial del árbol

Un clic dentro de un árbol de SAP registra además **qué fila** era, leyendo la selección
del árbol justo después del clic (`:211-212` → `SapGuiSurface.SelectedTreeNode`
`:300-313`). No es un capricho: la Scripting API de SAP **no expone geometría por nodo**,
así que el hit-test por píxel solo puede devolver el shell entero, nunca la fila. La
única forma coordinate-free de saber qué fila tocó el usuario es preguntar por la
selección. Si ningún getter responde, el log lo dice y explica qué haría falta (grabar
por el evento Change) en vez de callarse.

---

## De dónde salen las etiquetas, y por qué colisionan tanto

La etiqueta de un elemento UIA es la **primera no vacía** de tres candidatas:
`Name` → `AutomationId` → `HelpText` (`UiaReader.cs:130-142`). Solo se recogen los tipos
considerados accionables (`:36-41`: botón, menú, ítem de lista, ítem de árbol, pestaña,
enlace, edit, checkbox, radio, combo, split button y texto), se saltan los `IsOffscreen`,
y el recorrido está acotado a **profundidad 40** y **400 elementos** (`:105-128`).

Del lado SAP la etiqueta es `Tooltip` → `Name` → `Text` (`SapGuiSurface.cs:591-603`), y
ahí está la raíz del problema real: el tooltip de SAP suele ser el texto del `GuiLabel`
de al lado, que es un control aparte y no está enlazado al campo. Muchos controles
comparten tooltip, y muchos otros no tienen ninguno.

Esos dos hechos —etiquetas ausentes y etiquetas repetidas— son el 100% de los rojos.

---

## El log: la clasificación de causa raíz

El overlay dice *que* falla; `windows-client/src/Uia/InspectorDiagnostics.cs` dice **por
qué**. Cada clic analizado deja una bitácora estructurada en `LogBus` con el tag
`"inspector"` (`:26`), visible en la ventana de Logs del cliente. Como el hook de ratón
solo existe mientras el inspector está encendido, estas líneas no aparecen nunca sin
haberlo pedido.

Las cuatro etiquetas que emite, y qué significa cada una:

- **`causa=SIN-ETIQUETA`** (`:53-56` en SAP, `:126` en UIA) — el control no tiene
  `Tooltip`/`Name`/`Text`. El asistente no tiene texto estable con el que apuntar y
  resuelve al primero de N controles sin etiqueta. El fix que sugiere el propio log:
  guardar el Id absoluto, o el texto de un `GuiLabel` adyacente.
- **`causa=ETIQUETA-AMBIGUA`** (`:58-61` en SAP, `:127-128` en UIA) — la etiqueta existe
  pero la comparten N controles. El log dice **cuántos**, en qué **posición** estaba el
  que tocaste, y lista los Ids que colisionan (truncados por el medio en `:142-146`,
  máximo 6 en `:27`). Ese conteo es el dato accionable: te dice cuánta desambiguación
  hace falta.
- **`✗ NO-RESOLUBLE`** (`:72-74`) — tocaste algo real, pero **ningún** control resoluble
  comparte esa etiqueta. El asistente ni siquiera lo encontraría. Es peor que el
  mismatch: no toca otra cosa, no toca nada.
- **`✓ OK … · FRÁGIL`** (`:80-83` en SAP, `:133-134` en UIA) — coincidió, **pero** hay
  más de un control con esa etiqueta. Acertó solo por ser el primero en orden de lectura.

---

## Por qué `FRÁGIL` importa tanto como el rojo

Un `FRÁGIL` es un rojo que todavía no ha ocurrido.

La coincidencia se produjo porque el elemento que el usuario quería resultó ser el
primero en el orden de lectura del árbol. Ese orden **no es un contrato**: depende del
orden de creación de los controles, de qué paneles estén desplegados, de la versión de
la app, del tamaño de la ventana, de si una tabla tiene una fila más. En cuanto algo de
eso cambie, el mismo workflow que hoy marca amarillo empezará a tocar otra cosa — y sin
inspector encendido nadie se enterará, porque el paso seguirá reportando ✓.

Por eso el marcador del laboratorio debe mirar los dos: el rojo mide lo que **ya** está
roto; el `FRÁGIL` mide lo que se va a romper solo. Un motor con 0% de rojos y 40% de
frágiles no está sano, está de suerte.

---

## La consecuencia práctica, dicha sin rodeos

**El rojo no dice "este botón está roto".** El botón funciona perfectamente: lo acabas
de pulsar y la app respondió.

El rojo dice: **"si el asistente intentara esto por su cuenta, tocaría otra cosa"**.

Es un **detector de ambigüedad de etiquetas**, no un detector de bugs de la app. Y por
eso su lugar natural es *antes* de grabar un workflow: enciendes el inspector, recorres
el flujo que vas a enseñar, y todo lo que salga rojo o frágil es un paso que hay que
desambiguar (por Id, por posición, por contexto) **antes** de que quede grabado. Grabar
sobre rojo es grabar un fallo con fecha de caducidad.

---

## Cómo está montado por dentro

Dos relojes independientes:

- **El refresco de las cajas neutras.** `Start()` (`:63-78`) arranca un `DispatcherTimer`
  de **700 ms** (`:72`) que re-enumera toda la pantalla. La enumeración corre en
  `Task.Run` (`RefreshBoxes` `:91-122`) porque UIA puede bloquear; solo los rects
  —structs— cruzan de vuelta al hilo de UI, que es quien dibuja.
- **El clic.** Un hook global de ratón de bajo nivel `WH_MOUSE_LL` (`:28`, instalado con
  `SetWindowsHookEx` en `:70`). El callback no hace trabajo: publica el punto al
  dispatcher y el diagnóstico corre otra vez en `Task.Run` (`:145`).

Detalle que no se puede tocar sin romper todo: `_proc` se guarda como campo
(`:52`). Si el GC recoge el delegate, el hook revienta.

Hay **dos lectores UIA distintos**, uno para el refresco y otro para el clic (`:41-43`).
No es redundancia: `UiaReader` tiene estado mutable (`Elements`), y compartirlo entre dos
`Task.Run` concurrentes produce cajas fantasma de una pantalla que ya no existe. Ese
error concreto se cometió y se revirtió (ver el doc de hipótesis del grafo de
ubicaciones).

La lectura SAP solo se dispara si el proceso en primer plano empieza por `"sap"`
(`IsSapForeground` `:129-130`). La compuerta es necesaria porque las coordenadas de SAP
son **absolutas de pantalla**: sin SAP delante, dibujaríamos sus cajas encima de otra
app.

El overlay es una ventana **click-through** real: `WS_EX_TRANSPARENT | WS_EX_LAYERED |
WS_EX_TOOLWINDOW` (`InspectorOverlay.cs:80`), sin activación ni foco, para que el usuario
siga usando su app con normalidad. Recibe rects en **píxeles físicos** (los que da
`BoundingRectangle` de UIA) y los convierte a DIPs con la transform del propio HWND
(`:82` y `:120-125`), de modo que se alinean aunque haya escalado de DPI.

---

## Limitaciones y pendientes

- **Solo pantalla primaria.** El overlay se dimensiona con
  `SystemParameters.PrimaryScreenWidth/Height` (`InspectorOverlay.cs:70-71`). En un
  monitor secundario no se dibuja nada. El resto de la app (ejecutor de input,
  screenshotter) asume lo mismo, así que arreglarlo aquí solo sería media solución.
- **Mover una ventana no reposiciona las cajas.** No es un cambio de superficie, así que
  nada lo notifica; hay que esperar al siguiente tick de 700 ms. Y ese tick es una
  enumeración UIA completa, así que no se puede acelerar simplemente bajando el
  intervalo.
- **Los nodos de árbol de SAP no se enmarcan.** Se detectan y se listan, pero sin
  geometría no hay caja (`SapVisualElement.cs:17-21`). El overlay enmarca el árbol
  entero con el rótulo `"… · N nodos"`.
- **No se emite telemetría.** Todo el diagnóstico va a `LogBus`, que es **en memoria** y
  cuyo único suscriptor es la ventana local de logs. Hoy nada de esto sale de la máquina,
  así que la tab "Inspector" del marcador está vacía por construcción hasta que exista el
  puente `LogBus` → telemetría. Los `kind` previstos (`inspector_click`,
  `inspector_mismatch`) ya están declarados en el catálogo de motores del backend
  (`Graph/src/domain/windowsEngines.js:38`) pero **ningún cliente los emite todavía**.
- **La comparación por `Bounds` en UIA** no distingue dos elementos superpuestos con el
  mismo rectángulo. No se ha observado en la práctica; queda anotado como supuesto.
- **El límite de 400 elementos** de `UiaReader` (`:107`) recorta pantallas muy densas.
  Un elemento que quede fuera del corte no se dibuja **y** no participa en la
  comparación, así que podría producir un falso amarillo. No hay hoy ninguna señal en el
  log de que se alcanzó el tope: sería una mejora barata y útil.
