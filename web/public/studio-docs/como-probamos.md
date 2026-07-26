# Cómo probamos: el banco de pruebas del laboratorio

> **Estado:** implementado · **Verificado:** 2026-07-26 (backend y esquema en su sitio; el puente de logs del cliente NO existe todavía) · **Código:** `Graph/src/domain/windowsEngines.js:140`

Esta sección cambia según una restricción concreta: **varios desarrolladores prueban
contra UNA sola máquina**, la del owner. Nadie puede reproducir en local lo que otro vio.
El panel de Windows Live deja de ser un visor y pasa a ser el **banco de pruebas
compartido**.

Con esa restricción, hay dos preguntas que cualquiera del equipo tiene que poder responder
sin preguntarle a nadie:

1. **¿Qué funciona HOY, por motor?**
2. **¿Qué intentó cada quién, y cómo le fue?**

Son preguntas distintas y necesitan instrumentos distintos.

---

## Las dos mitades

### El marcador automático

Se **deriva** de la telemetría que ya existe. No hay tabla nueva ni columna nueva: cada
evento de `graph_windows_events` se enriquece en un solo sitio
(`Graph/src/domain/windowsEngines.js`) con dos dimensiones que no están en la base de
datos:

- **`engine`** — a qué motor pertenece. Es a la vez la tab del panel, el ancla del doc y
  el ancla de los avances.
- **`outcome`** — si salió bien o mal.

De ahí sale el porcentaje de éxito **por motor** y, dentro de cada motor, el mismo
desglose **por versión de la app** (`summarizeEngines`, `:233-272`). Ese segundo desglose
es la respuesta literal a "¿qué implementación fue exitosa?": mismo motor, dos versiones,
dos porcentajes.

La clasificación tiene un orden de prioridad deliberado (`engineForEvent`, `:140-156`), y
lo explícito gana siempre sobre lo inferido:

1. `detail.engine` — el cliente lo dijo. Manda.
2. `detail.tag` — viene del puente de logs. Manda sobre `kind` porque `log` es genérico.
3. `kind` — los eventos de telemetría clásicos.
4. `app_id` — último recurso (hoy solo SAP).
5. `otros` — el motor de descarte.

Añadir un motor es tocar **solo ese archivo**: las tabs del panel se construyen desde el
catálogo (`engineCatalog`, `:276-290`), así que el front no se toca.

### La bitácora de avances

Es la otra mitad, y es conocimiento **humano**, no telemetría. Vive en
`graph_studio_progress`
(`Graph/supabase/migrations/20260726120000_studio_engine_lab.sql`) y se escribe por
`POST /api/studio/progress` (`Graph/web/api/registerStudioProgressRoutes.js:35`), detrás
del mismo gate de admin que el resto del panel.

Un avance es prosa libre (`body`) más un veredicto estructurado (`outcome`), y se ancla a
un motor y opcionalmente a un doc de esta misma documentación. El veredicto solo sirve
para filtrar; **el valor está en el relato.**

### Ninguna sustituye a la otra

El marcador sabe **contar**. No sabe **por qué**. Puede decirte que el motor de navegación
está al 62% esta semana y no puede decirte que es porque alguien probó una ruta nueva de
lanzamiento que no funciona con apps de Electron.

La bitácora sabe el porqué y no sabe contar: es memoria selectiva de quien la escribe.

Un motor con buen marcador y bitácora vacía es un motor del que nadie sabe nada. Un motor
con bitácora rica y marcador mudo es un motor que nadie ha instrumentado.

---

## El contrato que todo desarrollador debe cumplir

Cuatro puntos. Cada uno existe porque su ausencia produce un dato que **miente**, no un
dato que falta — y un dato que miente es peor que ninguno.

### Todo evento medible debe llevar `phase`

Los valores son `ok`, `error` o `skipped` (`outcomeForEvent`, `:169-184`). El campo ya
existe en el esquema; no hay que inventar nada.

**Por qué importa:** un motor que solo emite cuando le va bien marca **100% y miente**.
Peor: miente en la dirección exacta en la que nadie va a mirar, porque un 100% no invita a
investigar. Si tu motor puede fallar, tiene que emitir el fallo.

Si el evento no pasa por `phase` (el caso del puente de logs), el veredicto puede ir en
`detail.outcome`, y un `detail.level` de `error` o `fatal` también cuenta como fallo
(`:179-181`).

### Los eventos de log deben llevar `detail.tag`

El tag del motor, **el mismo de `LogBus.Log`** (`windows-client/src/Diagnostics/LogBus.cs:22`).
El catálogo mapea los tags reales que hoy existen en el cliente —`inspector`, `sap`, `uia`,
`nav`, `align`, `workflow`, `teach`, `update`, `telemetry`, `fatal`, `onboarding`— a su
motor. Si necesitas forzar una tab concreta, `detail.engine` explícito gana sobre todo lo
demás.

**Por qué importa:** sin tag, el evento cae en "Otros" y desaparece del marcador de su
motor. No se pierde —está visible— pero deja de contar donde debería.

### `detail.app_version` en cada lote

**Por qué importa:** sin versión, un "funcionó" no es reproducible. No puedes decir si
mejoró o empeoró, no puedes comparar dos implementaciones del mismo motor, y no puedes
descartar que el fallo que estás viendo lo arregló otro hace dos días. Es la columna que
convierte un número suelto en una medición (`versionForEvent`, `:189-192`; los eventos sin
ella se agrupan bajo `sin-versión`).

### `start` NO cuenta como intento

Un evento cuyo `outcome` es `null` **no entra en el denominador** (`addToTally`,
`:217-224`). Los `start`, y las líneas de log meramente informativas, están ahí para
contexto, no para el marcador.

**Por qué importa:** contar los `start` como éxitos inflaría el porcentaje de forma
proporcional al ruido. Un motor charlatán marcaría mejor que uno callado y correcto.

---

## Cómo se lee el marcador

- **`successRate: null` significa "sin intentos medibles"**, y no es lo mismo que 0%
  (`:226-231`). Es una distinción deliberada: un motor todavía sin instrumentar leído
  como 0% parece un motor roto, y alguien perdería una tarde depurando código que
  funciona.
- **Un motor mudo significa "no instrumentado", no "roto".** Hoy la mayoría lo son.
- **`lastError`** es lo primero que quiere ver quien abre una tab: el fallo más reciente,
  con su etiqueta y su `kind` (`:250-256`).
- **El desglose por versión** es donde vive la respuesta a "¿esto mejoró?". Un motor al
  70% global puede ser 40% en la versión vieja y 95% en la nueva.

### La tab "Otros"

Es el motor de descarte (`FALLBACK_ENGINE`, `:110`), y es **visible a propósito**. Nada
se pierde de vista por no estar clasificado.

**Si esa tab se llena, falta clasificar algo**: o un motor nuevo que no está en el
catálogo, o un tag que el cliente emite y el catálogo no conoce. Es la única señal
automática que tenemos de que la instrumentación se quedó atrás respecto del código.

---

## Cómo registrar un avance

Un avance útil tiene cuatro partes. En este orden:

1. **Qué se intentó.** El cambio concreto, no la intención. "Sustituir el sondeo del
   locator por `SetWinEventHook`", no "mejorar la latencia".
2. **Qué se midió.** Números. Sin números no es un avance, es una impresión.
3. **Qué pasó.** Incluida la causa, si se encontró.
4. **El veredicto.** `funciono`, `no_funciono`, `parcial` o `en_curso`
   (`Graph/src/application/use-cases/StudioProgressService.js:23`), más la
   `app_version` contra la que se probó.

Los avances de tipo `no_funciono` son los más valiosos del sistema, y son los que nadie
escribe. Un ejemplo REAL, que hoy vive solo en tres mensajes de commit del repo
`windows-app` que nadie va a leer:

**Título:** Sondeo del locator sustituido por `SetWinEventHook` — 4x peor, revertido

**Qué se intentó:** cambiar el driver del `SurfaceLocator` de un `DispatcherTimer` de
800 ms a dos eventos de Windows (`EVENT_SYSTEM_FOREGROUND`, `EVENT_OBJECT_NAMECHANGE`),
dejando el timer como red de seguridad.

**Qué se midió:** latencia hasta publicar un cambio de ventana, misma máquina, mismos
gestos.

- sondeo 800 ms: 15, 62, 187, 360, 391, 484, 547, 734 ms — media ~348
- por eventos: 266, 828, 875, 1015, 1125, 1594, 1828, 2094, 6765 ms — media ~1400

**Qué pasó:** los eventos llegaban bien; el problema era `if (_computing) return;` en
`Probe()`, código original anterior al cambio. Con el reloj las colisiones eran raras; con
ráfagas de `NAMECHANGE` casi todos los cambios caían en ese descarte y se perdían hasta
que el timer los rescataba (de ahí el peor caso de 6,7 s). Además hubo una carrera
colateral: la invalidación inmediata llamaba a `RefreshBoxes()`, que comparte el lector
UIA con el timer de 700 ms del inspector.

**Veredicto:** `no_funciono`. Revertido. El bug de fondo se arregló aparte y luego se
perdió en un revert más amplio, así que **sigue presente**.

Ese es el formato. Nótese qué lo hace útil: cualquiera que mañana piense "esto debería ir
por eventos" encuentra la medición, la causa real, y el orden correcto de trabajo
(arreglar el descarte primero). Sin este registro, ese alguien repite el experimento
completo.

---

## Estado honesto de la instrumentación

La instrumentación por motor está **recién montada**, y hay que decir exactamente qué
falta:

- **Hoy solo llegan 8 tipos de evento del cliente.** Verificado por grep sobre
  `windows-app`: `conscious_run_start`, `conscious_run_end`, `analyze`, `action`, `mcp`
  (en `windows-client/src/Agent/AgentLoop.cs`), y `workflow_start`, `workflow_step`,
  `workflow_end` (en `windows-client/src/Mcp/WorkflowMcpRunner.cs`). El `kind` `log` está
  previsto en el esquema pero **ningún cliente lo emite**.
- **El puente que sube el `LogBus` al backend todavía NO existe.** `LogBus` es un buffer
  **en memoria** de 500 líneas cuyo único suscriptor es la ventana local de logs. Todo el
  diagnóstico rico —el `causa=ETIQUETA-AMBIGUA` del inspector, el `FRÁGIL`, los pasos de
  la escalera de navegación, los fallos de scripting de SAP— se queda en la máquina.
- **Por tanto varias tabs estarán vacías**: Inspector, Escaneo SAP GUI, Localizador,
  Navegación, Enseñanza y Sistema dependen todas de tags que hoy no salen. Los `kind`
  reservados en el catálogo (`inspector_click`, `inspector_mismatch`, `sap_scan`,
  `surface_change`) están declarados y no emitidos.
- **Lo único con datos reales hoy** son las tabs "Consciente" (por `kind`) y "Ejecución"
  (por los eventos de workflow, que sí traen `phase`).
- **Ningún evento emite `detail.app_version` todavía**, así que el desglose por versión
  agrupará todo bajo `sin-versión` hasta que el cliente lo incluya.

Nada de eso es un bug: es el orden natural de montar un banco de pruebas. Pero hay que
saberlo antes de mirar el marcador, porque **un marcador vacío se parece mucho a un
marcador con malas noticias**, y no lo es.
