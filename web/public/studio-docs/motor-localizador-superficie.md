# SurfaceLocator: el mapa generado por URL

> **Estado:** implementado · **Verificado:** 2026-07-26 (lectura de código; las mediciones de latencia citadas son de 2026-07-26, ver la sección del sondeo) · **Código:** `windows-client/src/Uia/SurfaceLocator.cs:107`

Todas las rutas de este doc son relativas al repo **windows-app**, salvo donde se indique.

Todo el sistema de workflows descansa sobre una pregunta: **¿dónde está parado el usuario
ahora mismo?** El `SurfaceLocator` la responde dando una geolocalización dentro del
sistema operativo con la misma forma que una URL.

La idea vino del navegador. La extensión de Chrome decide qué workflows aplican mirando
`origin` + `pathname`. En Windows no hay URL, así que **la sintetizamos**, y con eso un
workflow nativo pasa a ser indistinguible de uno web del lado del backend: mismo
`source_url`, mismo scoping, mismo mismatch.

Es el badge fijo arriba a la derecha de la pantalla. Y es, con diferencia, la pieza de la
que más cosas cuelgan.

---

## El esquema

- **App nativa** → `uia://proceso.exe/titulo-de-ventana-normalizado`
- **Navegador** → `web://dominio/ruta/subruta`
- **SAP GUI** → `sapgui://SID/TCODE`

El ID se parte en dos ejes, y esa división gobierna todo lo demás:

- **`origin`** — la identidad estable: la app, el dominio, el sistema SAP. **Siempre**
  acota.
- **`pathname`** — la ruta dentro. Acota **solo** cuando es estable: en `web://` es la
  URL real, en `sapgui://` es la transacción. En `uia://` el pathname es el **título de la
  ventana**, o sea el documento abierto: es instancia, no identidad, y por eso se ignora
  como criterio de scoping.

Esa asimetría no es una inconsistencia: es el resultado de que Windows no tiene ningún
concepto de "en qué pantalla de la app estoy". El título es lo más cercano que hay, y no
es suficiente.

---

## El sondeo: por qué un timer y no eventos

`SurfaceLocator` corre un `DispatcherTimer` de **800 ms** (`:47`). No escucha eventos de
Windows. Es una decisión que ya se cuestionó, se cambió, se midió y se revirtió — el
relato completo está en el doc de hipótesis del grafo de ubicaciones, y es lectura
obligatoria antes de volver a intentarlo.

El diseño del sondeo es el que hace que sea barato. `Probe()` (`:67-105`) tiene dos
mitades:

**La mitad barata, en el hilo de UI:** `GetForegroundWindow()` + `GetWindowText()` +
nombre de proceso. Nada más. Si el hwnd y el título son los mismos que la última vez, se
sale (`:81`). Esto corre 75 veces por minuto y no se nota.

**La mitad cara, en `Task.Run` (`:87`):** solo cuando algo cambió. Es donde vive la
lectura de la omnibox por UIA, que es lo único que puede tardar.

Dos detalles del sondeo que hay que conocer:

- **Las ventanas propias no cuentan como superficie** (`:75`). Si el proceso en foco es
  `"U"`, se sale sin tocar nada, conservando el ID de la app real que el usuario estaba
  usando. Sin esto, cada interacción con la carita borraría el contexto que los workflows
  necesitan. La superficie de windows-graph resuelve lo mismo de otra forma —bajando por
  el orden-Z hasta la primera ventana visible que no sea de Ü, `UiaSurface.cs:171-180`—
  que es más robusta pero también más cara.
- **`Changed` solo se dispara si el `Id` cambió** (`:95`). Recalcular y llegar al mismo
  ID no notifica a nadie. Es la razón por la que el evento es utilizable como señal de
  "el usuario se movió".

Y un detalle que es un bug conocido: `if (_computing) return;` (`:82`). Si llega un
cambio de ventana mientras se está resolviendo la identidad de la anterior, **ese cambio
se descarta**. Como `_lastHwnd` no se actualiza (la asignación está en `:83`, después del
`return`), el siguiente tick lo recuperará *si la ventana sigue ahí* — pero las
transiciones intermedias de una ráfaga se pierden del todo. Es el bug que hundió el
intento de pasar a eventos de Windows, y sigue presente.

---

## Las reglas de normalización, línea a línea

Todo ocurre en `Compute` (`:107-121`). Son dos caminos.

### Navegadores

La lista está en `:32-33` y es cerrada: `chrome`, `msedge`, `firefox`, `brave`, `opera`,
`vivaldi`, `arc`. Un navegador fuera de esa lista cae al camino de app nativa y produce
un `uia://`.

`TryReadBrowserUrl` (`:127-143`) lee la URL así:

1. `FindFirst(TreeScope.Descendants, ControlType.Edit)` — el **primer** `Edit`
   descendiente del árbol UIA de la ventana. En Chrome, Edge y Brave ese primer `Edit` es
   la omnibox. Es una heurística, no un contrato.
2. Se lee por `ValuePattern`. Si el elemento no lo soporta, se abandona.
3. **Se rechaza** si el texto está vacío o **contiene espacios** (`:138`). Ese filtro es
   lo que evita que una búsqueda a medias se convierta en una ubicación.
4. Si no trae esquema, se antepone `https://` (`:139`).
5. Tiene que parsear como `Uri` **absoluta** y el host tiene que contener **un punto**
   (`:140`). Sin eso, cualquier palabra suelta sería un host válido.

Con la Uri en mano (`:114-115`):

- Se toma `AbsolutePath` y se le quita la barra final.
- **Se descartan la querystring y el fragmento.** Eso es estado volátil, no ubicación:
  `?page=2` o `#seccion` no cambian en qué pantalla estás, y meterlos en el ID haría que
  cada recarga fuese un sitio nuevo.
- Resultado: `web://{host}{path}`, con `origin = web://{host}` y `path = "/"` si el path
  quedó vacío.

Si cualquiera de esos pasos falla, **no hay fallback a `web://`**: se cae al camino
nativo y el navegador se reporta como `uia://chrome.exe/...`. Es correcto (mejor un ID
honesto que uno inventado) pero significa que un `uia://chrome.exe` en los datos puede
ser un fallo de lectura de la omnibox, no una preferencia.

### Apps nativas

`Slug(title)` (`:146-159`) convierte el título de ventana en un segmento de ruta:

- Todo a minúsculas.
- Se conservan solo letras y dígitos.
- Cualquier otra cosa colapsa a un único guion.
- **Corte duro a 60 caracteres** (`:155`). Un título largo se trunca por la mitad de una
  palabra.
- Si el resultado queda vacío (o el título lo estaba), el literal `"ventana"`.

Resultado: `uia://{proc}.exe/{slug}`, con `origin = uia://{proc}.exe`.

---

## AVISO: hay DOS sintetizadores distintos, y no son iguales

Esta es la trampa más real de todo el sistema, y hay que tenerla presente **antes** de
analizar cualquier dato de superficies.

El ID que ves en el badge lo produce `SurfaceLocator.Compute`. El ID con el que se
**graban** los workflows lo produce `IUiSurface.Identity()`, que es otro código, en otro
repo, con otras reglas.

Comparando `SurfaceLocator.cs:107-121` contra
`windows-graph/src/Surfaces/UiaSurface.cs:139-153`:

- **El sufijo `.exe`.** El locator produce `uia://chrome.exe`. `UiaSurface` produce
  `uia://chrome`, **sin `.exe`** (`:152`). Son orígenes distintos como cadenas, y
  `SameOrigin` compara cadenas.
- **El slug.** El locator normaliza el título con `Slug()`. `UiaSurface` usa el título
  **crudo**, solo con `Trim()`: `"/" + title.Trim()` (`:152`). Espacios, mayúsculas,
  paréntesis y acentos incluidos.
- **El escritorio.** `UiaSurface` lo trata como una superficie de primera clase,
  `uia://desktop` (`:30`, `:147-148`), detectándolo por **clase de ventana** (`Progman` o
  `WorkerW`, `:156-162`) y no por título. El locator no tiene ese concepto: para él el
  escritorio es `explorer.exe`.
- **SAP.** `UiaSurface` no sabe de SAP; el equivalente lo produce
  `SapGuiSurface.Identity()` (`SapGuiSurface.cs:174-191`) como `sapgui://{SID}/{TCODE}`.
  El locator **tampoco** sabe de SAP: reporta SAP como `uia://saplogon.exe/{slug}`.

El contrato común es `SurfaceIdentity(Origin, Pathname, Title)` con
`Url => Origin.TrimEnd('/') + Pathname` (`windows-graph/src/Surfaces/IUiSurface.cs:11-17`).
Lo que no es común es quién lo rellena.

Hubo un commit que unificaba esto ("un solo productor del ID de superficie", `a1b292f`) y
fue revertido por completo en `8ad3537` junto con otros cambios, por inestabilidad
general. El propio mensaje del revert lista lo que se perdió: el escritorio como
superficie propia, SAP como `sapgui://SID/TCODE`, y **que el ID que se reporta al backend
sea el mismo que se guardó al grabar**.

Consecuencia práctica para quien trabaje sobre esto: **no asumas que el `surface_url` de
la telemetría y el `source_url` de un workflow grabado son comparables carácter a
carácter.** No lo son.

---

## Cómo se compara una ubicación con otra

Todo el álgebra de comparación vive en `windows-graph/src/WorkflowPlayer.cs`, y es
sorprendentemente pequeña:

- **`OriginOf`** (`:380-387`) — parte por `"://"`, busca la primera barra después, y
  devuelve lo de antes. `uia://chrome.exe/x` → `uia://chrome.exe`.
- **`PathnameOf`** (`:390-397`) — lo de después. `uia://chrome.exe/x` → `/x`. Cadena
  vacía si no hay.
- **`SameOrigin`** (`:399-401`) — igualdad de cadenas, sin distinguir mayúsculas, tras
  quitar la barra final.
- **`SamePlace`** (`:404-410`) — mismo origin **y** mismo pathname normalizado, con el
  pathname normalizado no vacío.

Y la pieza que hace que todo esto funcione en el mundo real:

- **`NormalizePlace`** (`:417-423`) — pasa a minúsculas y **se queda solo con las
  letras**. Descarta dígitos, espacios y toda la puntuación.

Merece la pena detenerse aquí, porque es la línea más astuta del motor. Los títulos de
ventana traen **contadores vivos**: `"Inbox (1,956)"` cambia a `"Inbox (1,988)"` mientras
el usuario mira la pantalla, sin que se haya movido a ningún sitio. Si se comparasen los
pathnames tal cual, el usuario "cambiaría de lugar" cada vez que llega un correo. Con
`NormalizePlace`, ambos colapsan a `inbox` y son el mismo sitio.

El precio es que **también** colapsan cosas que quizá no deberían: `"Pedido 4711"` y
`"Pedido 4712"` son el mismo lugar para este motor. Para "en qué pantalla estoy" eso es
lo que se quiere; para "sobre qué documento estoy trabajando" no lo sería.

### El mismatch

`SurfaceMismatch` (`:436-453`) es la comprobación previa a ejecutar un workflow:

- El **origin** se compara **siempre**. Si no coincide, mismatch con mensaje explícito.
- El **pathname** se compara **solo si el origin no es `uia://`** (`:447`). En apps
  nativas el pathname es el título = el documento abierto, o sea instancia y no identidad.
  Un workflow de "escribir en Notepad" tiene que servir en cualquier nota, no solo en la
  que se grabó.

Ojo con el detalle: aquí el pathname se compara **sin** `NormalizePlace`, con igualdad de
cadena directa (`:449`). `NormalizePlace` solo interviene en `SamePlace`. Son dos
comparadores con reglas distintas y conviene no confundirlos al depurar.

---

## Para qué se usa

Tres consumidores, cada uno con una necesidad distinta:

**1. Reanudar donde estás.** `ResumeIndexFor` (`:326-361`) decide en qué paso arrancar un
workflow según dónde esté el usuario, con dos niveles de precisión:

- *Nivel 1, match completo:* busca el **último** paso cuyo nodo grabado coincide exacto
  con la ubicación actual, y de ahí retrocede al **primero** de ese grupo contiguo
  (`:337-350`). Traducido: si ya estás en la pantalla del paso 7, no rehagas del 1 al 6,
  pero sí haz todo lo que había que hacer *en esa pantalla*.
- *Nivel 2, fallback por origin:* si nada casa exacto, el primer paso de esa misma app
  (`:353-359`).
- Si tampoco, 0. Los workflows viejos, grabados sin superficie por paso, siempre caen
  aquí.

**2. Saltar hacia adelante tras un fallo.** `JumpForwardIndex` (`:369-377`): tras fallar
el paso N, se busca el primer paso posterior cuyo nodo coincide **exacto** con dónde
estás ahora. El caso típico: Chrome abrió directo en la página objetivo y el clic que
falló ya no hacía falta. Solo match completo — saltar por origin sería adivinar.

**3. Scoping por MCP.** `windows-client/src/Agent/AgentLoop.cs:150-160`: en cada turno se
lee la ubicación y se cuelga del `ScreenState` (`SurfaceId`, `SurfaceOrigin`,
`SurfacePathname`), que es lo que Graph usa para decidir **qué workflows le ofrece al
cerebro**. En el mismo bloque se emite el evento de telemetría `analyze` con el
`surface_url` actual — y ese es, hoy, el mecanismo principal por el que la ubicación llega
al backend.

Además, el `SurfaceNavigator` usa el locator como **única señal válida de llegada**: tras
enfocar o lanzar una app, espera a que el `origin` cambie al destino. El "lo intenté" de
una estrategia no cuenta.

---

## Limitaciones

- **Solo sabe la VENTANA, no la pantalla dentro de la app.** Es la limitación de fondo, y
  la que bloquea la capa 2 de la navegación. Salvo en SAP —donde el TCODE sí es la
  pantalla— el locator no distingue dos vistas distintas de la misma app si la ventana no
  cambia de título.
- **El título de ventana contamina la identidad.** `NormalizePlace` tapa el caso de los
  contadores, pero el problema de base sigue: la identidad de un lugar depende de una
  cadena que la app puede cambiar por cualquier motivo, incluido ninguno.
- **Los dos sintetizadores divergen** (ver arriba). Es la limitación más peligrosa porque
  no produce errores, produce **datos que parecen comparables y no lo son**.
- **El descarte silencioso de `_computing`** (`:82`) pierde transiciones rápidas. Está
  documentado, medido y sin arreglar.
- **La lectura de la omnibox es una heurística**, no un contrato: "el primer `Edit` del
  árbol". Un cambio de la UI de un navegador la rompe sin previo aviso, y el síntoma sería
  que ese navegador empieza a aparecer como `uia://`.
- **Un solo intento por cambio.** Si la URL aún no se ha actualizado cuando se lee (una
  navegación en curso), el ID queda con la página anterior hasta el siguiente cambio de
  título.
