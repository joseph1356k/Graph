# SurfaceNavigator: el motor que alcanza el punto de arranque

Un workflow subconsciente no puede arrancar en cualquier parte: se grabó en una
**superficie** concreta (una app, una pantalla) y su primer paso solo tiene sentido
ahí. El **punto de conexión** es ese match entre *dónde está el usuario ahora* y
*dónde nació el workflow*. Si no coinciden, antes el workflow **fallaba**. El
`SurfaceNavigator` es el motor que, en vez de fallar, **navega el sistema operativo
hasta el punto de arranque** y recién ahí deja correr el workflow.

Es el reemplazo evolutivo del viejo `AppAligner` (una sola jugada hardcodeada): ahora
es una **escalera de estrategias** que iremos poniendo a punto con el tiempo.

---

## Las dos capas del punto de conexión

Alcanzar el arranque tiene dos capas, y hoy solo se ataca la primera:

- **Capa 1 — llegar a la APP** (el `origin`, ej. `uia://saplogon.exe`). Enfocar la app
  si ya está abierta, o lanzarla si no. Es determinista y debe ser **instantáneo**.
- **Capa 2 — llegar a la PANTALLA dentro de la app** (el estado/`pathname`, ej. la
  transacción correcta). Navegar por menús/vistas hasta que el primer paso sea visible.
  Aquí es donde entrará el **LLM**, como un rung superior de esta misma escalera.

Decisión de diseño: **la capa 1 nunca usa LLM.** El camino subconsciente tiene que ser
rápido, barato y predecible; enfocar/lanzar una app es un problema resuelto. El LLM se
gana su lugar en la capa 2, cuando la escalera determinista ya se agotó.

---

## Cómo funciona

El motor recibe el `origin` destino (de dónde nació el workflow) y una señal en vivo de
*dónde estoy* — el **SurfaceLocator**, la "URL de Windows" del badge arriba-derecha.
Entonces:

1. Si el `origin` actual ya coincide con el destino → no toca nada (idempotente).
2. Recorre la **escalera de estrategias** en orden. Cada estrategia hace su intento
   (enfocar, lanzar…) y el motor **espera a que el locator confirme** la llegada.
3. En cuanto una confirma, para y devuelve éxito. Si agota la escalera sin confirmar,
   reporta el mismatch (como antes).

La verdad de si llegó **siempre** la pone el locator, nunca el "lo intenté" de la
estrategia: lanzar por shell puede "no tirar excepción" sin que la app abra. La única
señal válida es que el `origin` cambió al destino.

Se enchufa en el punto de extensión `WorkflowPlayer.Aligner` del cliente, así que **no
cambia el contrato entre el cliente y Graph**: el player sigue pidiendo el plan y
decidiendo el CÓMO; el navegador solo se asegura de estar en el lugar correcto antes.

---

## La escalera v1 (capa 1)

Tres rutas de intento, de la más barata a la de último recurso:

- **`enfocar-app-viva`** — si el proceso ya está abierto con ventana, lo trae al frente.
  El caso más común (la app está detrás de otra) y el más rápido. Confirma en ~2s.
- **`acceso-directo-inicio`** — si la app está cerrada, busca su acceso directo en el
  menú Inicio (usuario + máquina) por nombre normalizado ("SAP Logon" ≈ `saplogon`,
  "Google Chrome" ≈ `chrome`) y lanza el `.lnk`. **Esta ruta arregla la fuga de
  resiliencia #1**: apps cuyo nombre de proceso no es un comando del PATH (SAP Logon,
  muchas apps de negocio/Electron) que `Process.Start("saplogon")` no podía abrir.
  Confirma en ~10s (lanzar en frío tarda).
- **`shell`** — último recurso: `Process.Start(nombre)` y, si falla, `cmd /c start`.
  Solo sirve para nombres que el PATH resuelve (notepad, calc, msedge), pero cubre esos
  casos y no cuesta nada al final.

Hoy la escalera solo opera sobre superficies `uia://` (apps nativas). `sapgui://` y
`web://` no se alinean todavía: la escalera se agota y el player reporta el mismatch,
igual que antes para esos orígenes.

---

## Estado actual del cableado

- Cableado **solo en el botón "Ejecutar workflow" directo** del panel Backend, que es
  el **banco de pruebas**. Los otros dos caminos de ejecución (invocación por MCP desde
  el chat, y la biblioteca de workflows) siguen usando el viejo `AppAligner` hasta que
  esto se valide en el banco.
- Los pasos de la escalera se registran en los logs del cliente con el tag **`nav`**
  (botón 📜 Logs): se ve la secuencia completa, ej.
  `[enfocar-app-viva] no aplica → [acceso-directo-inicio] lanzando 'SAP Logon.lnk' → confirmado en destino`.

---

## Aprendizaje: consciente → subconsciente

Cuando el navegador tuvo que alinear conscientemente (abrir/enfocar), el player se lo
**enseña al workflow**: antepone un paso de alineación (`app:<proceso>` en orden 0) vía
Graph, para que la próxima vez el workflow arranque solo desde el principio sin volver a
razonar la ruta. Es el eslabón que cierra el loop consciente → subconsciente.

---

## Rungs pendientes (el motor que iremos poniendo a punto)

- **Resolver el destino del `.lnk`** (vía `IShellLink`) para casar por ejecutable cuando
  el nombre del acceso directo no se parece al del proceso.
- **Cubrir `sapgui://` y `web://`** en la alineación (hoy solo `uia://`).
- **App viva sin ventana principal** (tray/splash): hoy la ruta de enfoque la salta y un
  rung de lanzamiento podría abrir una 2ª instancia; falta un manejo dedicado.
- **Capa 2 — navegación dentro de la app** (con LLM): el gran rung siguiente, navegar por
  menús/vistas hasta que el primer paso del workflow sea visible.
