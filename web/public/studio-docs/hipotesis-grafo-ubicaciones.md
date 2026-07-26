# HIPÓTESIS: nodos = ubicaciones, aristas = transiciones

> **Estado:** hipótesis · **Verificado:** sin medir · **Código:** no existe (propuesta sobre `windows-client/src/Uia/SurfaceLocator.cs:95`)

**Este documento no describe nada que exista.** Es una propuesta sin validar, venida de un
análisis externo al equipo, y está aquí para que se pueda discutir y **medir** antes de
que alguien empiece a construir sobre ella. Nada de lo que sigue está implementado. Si
buscas cómo funciona el sistema hoy, este no es el doc.

Se escribe con el mismo rigor que los demás precisamente porque una hipótesis mal
registrada se convierte en folclore: alguien la recuerda a medias, la cuenta como si fuera
un plan aprobado, y seis meses después hay código.

---

## La observación de partida (esto sí es un hecho)

Hoy `surface_url` es una **columna** de `graph_windows_events`
(`Graph/supabase/migrations/20260722120000_windows_live_users_and_events.sql`), no un
evento propio. Se rellena cuando ocurre **otra cosa**.

Y "otra cosa" es, hoy, exactamente **un** sitio: el evento `analyze` que emite el bucle
consciente (`windows-client/src/Agent/AgentLoop.cs:158-160`). Verificado por grep sobre
todo el cliente: ninguna otra llamada a `TelemetryBus.Emit` pasa `surfaceUrl`. Ni las
acciones, ni los pasos de workflow, ni los finales de corrida.

La consecuencia es directa: **el muestreo de la ubicación lo dicta la actividad del
asistente, no el movimiento del usuario.** Si el usuario recorre cuatro pantallas sin
pedirle nada a la carita, no queda ningún registro de que estuvo ahí. Y si le pide algo
tres veces seguidas en la misma pantalla, quedan tres registros del mismo sitio.

Como base para razonar sobre "por dónde se mueve la gente", ese muestreo no sirve. Eso es
un hecho, y es lo que motiva toda la propuesta.

---

## La propuesta

Emitir un `kind` nuevo, `surface_change`, con `detail: {from, to, dwell_ms}`, disparado
desde el evento `Changed` del locator (`SurfaceLocator.cs:95-97`).

Técnicamente es barato: **no requiere migración**. El esquema lo dice explícitamente en
sus propios comentarios — el feed es genérico (`kind` + `detail` jsonb) y está pensado
para "colgar cualquier métrica futura sin cambiar el esquema: basta un `kind` nuevo y
payload en `detail`". El catálogo de motores del backend ya reserva el nombre
(`Graph/src/domain/windowsEngines.js:58`).

Con eso se tendría una traza de ubicaciones a la que se podría llamar grafo: los ID de
superficie serían nodos, y cada `surface_change` una arista.

---

## Las dos objeciones que hay que registrar

Ninguna de las dos invalida la propuesta. Las dos invalidan la **conclusión** que se
sacaba de ella.

### 1. Falta el "por qué"

El propio análisis define una transición como la tupla (desde, hacia, cuándo, **por qué**).
El diseño propuesto emite `from`, `to` y `dwell_ms`. Falta justo el cuarto.

Y no es un olvido de redacción: **el locator estructuralmente no puede saberlo.** Se
entera de que la ventana **ya** cambió; no de qué acción la cambió. Vio Chrome, luego vio
Excel. Si fue un clic en un enlace, un Alt-Tab, una notificación que robó el foco o el
usuario abriendo el menú Inicio, es información que no pasa por ahí.

La consecuencia es la que importa: **tendrías un mapa que se puede LEER pero no CAMINAR.**
El camino más corto entre dos nodos te devuelve una secuencia de **nodos**. Para
ejecutarlo hacen falta las **aristas** — la acción concreta que lleva de uno al siguiente.
Sin eso, saber que "de A se llega a C pasando por B" no te dice cómo llegar de A a B.

Por tanto, la afirmación de que "con este grafo la capa 2 de navegación deja de necesitar
LLM" **está sin demostrar**. Puede que sea cierta con un diseño distinto de arista; con
este, no se sigue.

### 2. `dwell_ms` no sirve como peso

La propuesta sugiere ponderar el camino más corto por el tiempo de permanencia. Eso
optimiza para el objetivo equivocado.

`dwell_ms` mide **tiempo de pensamiento humano**: cuánto tardó una persona en leer la
pantalla, decidir y actuar. Ponderar por ahí produce rutas que evitan las pantallas donde
la gente se queda mirando — que son precisamente las pantallas complicadas, no las lentas
para una máquina. Un ejecutor automático no lee: rellena campos y pulsa. Su coste real es
el round-trip al servidor y el tiempo de carga de la UI, que no tienen ninguna relación
con el dwell.

Lo cual no quiere decir que `dwell_ms` sea inútil. Es una **señal de fricción de UX**, y
como tal es valiosísima: dice **qué** conviene automatizar. Solo que no es un coste de
máquina y no debe entrar en un cálculo de ruta.

---

## El riesgo de calidad de datos (el más grave)

Este es el que hunde la fase de medición si no se atiende primero.

El evento `Changed` del locator sale hoy de un sondeo de 800 ms con un **descarte
silencioso conocido**. En `Probe()` (`SurfaceLocator.cs:82`):

```
if (_computing) return;
```

Si llega un cambio de ventana mientras se está leyendo la identidad de la anterior, se
descarta. No se anota, no se reprograma. Como `_lastHwnd` se asigna en la línea siguiente
—después del `return`— el siguiente tick recuperará el cambio **si la ventana sigue
siendo la misma**; pero cualquier ventana intermedia de una ráfaga desaparece sin dejar
rastro.

O sea: **las transiciones que capturaría `surface_change` YA vienen con huecos, y los
huecos son justamente las transiciones rápidas.** Que son, además, las más interesantes
para un grafo de navegación: los pasos intermedios de un flujo van rápido; las pantallas
donde uno se queda pensando son las que sobreviven al muestreo.

Medir sobre esa base no mide el comportamiento del usuario. Mide el comportamiento del
usuario **más el bug**, sin forma de separarlos después.

---

## El precedente: el intento de pasar a eventos de Windows

Esto ya se intentó. El conocimiento vive hoy en tres mensajes de commit que nadie lee, y
alguien lo va a reintentar. Va entero.

**`7f2f894` — "el locator escucha los eventos de Windows en vez de sondear".** La
motivación estaba medida: 8 cambios de ventana reales, el reloj de 800 ms tardaba 15, 62,
187, 360, 391, 484, 547 y 734 ms (**media ~348 ms**) en descubrir un cambio que Windows ya
había anunciado. Y el total hasta publicar era exactamente ese retraso en todos los casos:
leer la identidad por UIA costaba ~0 ms. El 100% del desfase era el reloj. Se cambió a dos
win-events (`EVENT_SYSTEM_FOREGROUND` y `EVENT_OBJECT_NAMECHANGE`), dejando el timer como
red de seguridad.

**`38a5866` — el revert.** Medido en la misma máquina, la versión por eventos quedó
**4x PEOR**:

- sondeo de 800 ms: 15, 62, 187, 360, 391, 484, 547, 734 ms — **media ~348 ms**
- por eventos: 266, 828, 875, 1015, 1125, 1594, 1828, 2094, 6765 ms — **media ~1400 ms**

La causa **no era el driver de eventos**. Era `if (_computing) return;` — código original,
anterior a todo el hilo. Con el reloj de 800 ms las colisiones eran raras; con ráfagas de
`EVENT_OBJECT_NAMECHANGE` casi todos los cambios reales caían sobre un `_computing` activo
y se perdían hasta que el timer los rescataba. De ahí el peor caso de 6765 ms: el evento
llegó, pero ninguna sonda pudo consumirlo en 6,7 segundos.

(El mismo revert documenta un segundo fallo, colateral pero instructivo: la invalidación
inmediata llamaba a `RefreshBoxes()`, que comparte `_refreshReader` con el timer de 700 ms
del propio inspector. Dos `Task.Run` concurrentes sobre un lector cuyo comentario dice
literalmente "un lector por rol para no compartir el estado mutable". Esa carrera era el
glitch de recuadros persistentes de una ventana ya cerrada.)

**`d1f9ee6` — el arreglo del bug de fondo.** Se anotaba el cambio perdido
(`_missedWhileComputing`) y se reintentaba en cuanto terminaba la lectura en curso; y de
paso el sondeo bajaba de 800 a 200 ms.

**`8ad3537` — se revirtió TODO.** Motivo: el sistema se sentía inestable y no valía la
pena seguir depurando sobre una base modificada. `SurfaceLocator.cs` quedó **byte a byte**
como estaba.

**Conclusión honesta: hoy el locator sigue con el sondeo de 800 ms y con el descarte
silencioso.** El arreglo existió, funcionaba, y se fue por el desagüe de un revert más
amplio. Cualquiera que vuelva aquí debería empezar recuperando `d1f9ee6` — no
reinventándolo, y desde luego no volviendo a intentar el cambio de driver antes de
arreglar el descarte.

---

## El plan por fases que sí es defendible

El orden importa más que el contenido.

1. **Arreglar el descarte silencioso.** Sin esto, todo lo que se mida después mide también
   el bug. Es independiente del driver de eventos y hay que hacerlo con sondeo o sin él.
2. **Emitir `surface_change` y dejarlo correr.** Sin construir nada encima. Solo recoger.
3. **MEDIR.** La pregunta concreta: **cuántos `surface_url` distintos hay por app**. Si
   una app produce 3 ubicaciones, el título de ventana no distingue sus pantallas y todo
   el grafo se apoya en una identidad que no existe. Si produce 300, hay identidad de
   sobra pero probablemente demasiado ruido (títulos con estado vivo). El número decide el
   paso 4.
4. **Recién entonces, diseñar la firma de pantalla.** Con datos sobre qué distingue de
   verdad una pantalla de otra en las apps reales que usa la gente.
5. **Y solo después, construir el grafo.**

Empezar por el 5 —que es lo que propone el análisis original— obliga a **adivinar** la
identidad de pantalla y a migrar los datos cuando se descubra que la suposición era falsa.
Es el orden que garantiza retrabajo.

---

## Privacidad

Decisión ya tomada por el owner: **se rastrea todo EXCEPTO las ventanas de incógnito de
Chrome**, con consentimiento del usuario.

Dos matices que hay que implementar bien, porque son fáciles de hacer mal:

- **El locator debe seguir sabiendo la ubicación en incógnito.** Los workflows la
  necesitan para funcionar. Lo que se filtra es únicamente lo que **SALE** de la máquina.
  La supresión va en la capa de telemetría, no en el locator.
- **Al suprimir hay que cortar la arista.** Si se omite un nodo pero se deja que el
  siguiente `surface_change` use el anterior como `from`, se estaría inventando una
  transición directa que **nunca ocurrió**. La supresión tiene que poner `prev = null`, de
  modo que el evento siguiente salga sin origen en vez de con un origen falso.

---

## Qué haría falta para que esto deje de ser hipótesis

- Una medición del paso 3 con datos reales de la máquina de pruebas.
- Una propuesta concreta de **qué va en la arista** además de `from`/`to`, que resuelva la
  objeción 1. Sin eso, el grafo es un mapa de lectura, y hay que decirlo así en vez de
  venderlo como un sustituto del LLM.
- Un peso de arista que represente coste de **máquina**, no de humano.
- El descarte silencioso arreglado, con una medición antes y después que lo demuestre.
