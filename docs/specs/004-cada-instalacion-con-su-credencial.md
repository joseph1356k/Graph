# 004 — cada instalación de Ü para Windows tiene su credencial, y la clave del instalador solo sirve para presentarse

Estado: **implementado, sin encender** (2026-10-01) · Nace del diagnóstico del 2026-09-30 · Rama: `jose/el-instalador-solo-se-presenta`

Es la mitad de Graph de la spec 076 de `apps/windows`
(`apps/windows/docs/specs/076-cada-instalacion-con-su-credencial.md`), donde están el diagnóstico
entero, el diseño y la corrida sobre el PC real. Una sola rama y un solo PR.

## Diagnóstico: qué se midió

| Qué | Medida | Fuente |
|---|---|---|
| El instalador es público | `U-win-Setup.exe` contesta HTTP 302 sin credenciales; el repo es `PUBLIC` | `curl -I` anónimo, 2026-09-30 |
| Qué da la clave de Graph que lleva dentro | `GET /api/v1/agent/claves` devuelve las claves crudas de OpenAI y TypeSafe | llamada real a `graph-eight-pied`, 2026-09-30 |
| Qué más abre | todo `/api/v1`, incluida la cola de exportaciones de notas firmadas | `web/server.js`, `registerNoteExportRoutes.js` |
| Cuántas instalaciones la comparten | todas: una sola clave, sin identidad por instalación | `GraphConfig.BakedDefaultApiKey` |

La cadena, en una línea: instalador público → clave de Graph embebida → `/agent/claves` → claves de
pago. No hace falta ser usuario: basta descargar el instalador.

## Promesas

| # | Promesa | Juez |
|---|---|---|
| 401 | presentarse da una credencial que se ve una sola vez: en la base queda su huella, no ella | `verify-windows-devices.js` |
| 402 | una instalación nueva nace pendiente: ni el correo ni presentarse otra vez la aprueban | `verify-windows-devices.js` |
| 403 | con la compuerta apagada, que es como nace, nada cambia: la clave embebida entra como hoy | `verify-windows-devices.js` |
| 404 | con la compuerta puesta, la clave del instalador sola solo sirve para presentarse y preguntar su estado | `verify-windows-devices.js` |
| 405 | una instalación aprobada entra, y revocarla la deja fuera sin tocar a las demás | `verify-windows-devices.js` |
| 406 | las claves de otras etiquetas no pasan por la compuerta | `verify-windows-devices.js` |
| 407 | si no se puede comprobar la instalación, la compuerta se cierra: 503, no se deja pasar | `verify-windows-devices.js` |
| 408 | ni la credencial ni su huella salen en el log, ni en la lista del panel | `verify-windows-devices.js` |
| 409 | presentarse tiene tope por IP | `verify-windows-devices.js` |
| 410 | aprobar y revocar exige ser administrador del panel | `verify-windows-devices.js` |
| 411 | cada instalación guarda con qué clave se presentó, y el panel lo dice junto al estado de la compuerta | `verify-windows-devices.js` |
| 412 | un administrador enciende y apaga la compuerta desde el panel: queda escrita en Vercel, se redespliega y esta instancia la obedece ya | `verify-windows-devices.js` |
| 413 | la compuerta no se enciende para una etiqueta que no existe, ni para una sin ninguna instalación aprobada salvo que se pida a sabiendas | `verify-windows-devices.js` |
| 414 | con la compuerta puesta, las claves de terceros solo se entregan a una instalación aprobada o a una etiqueta nombrada aparte | `verify-windows-devices.js` |

**La que cierra el asunto es la 404.** Mientras la clave embebida abra algo más que presentarse, lo
demás es cosmético: el instalador público sigue siendo una llave.

## Las fases

| Fase | Promesa que pone verde | Qué toca | Sitios con esta clase de error |
|---|---|---|---|
| 1 | 401–410 | migración `graph_windows_devices`, `WindowsDeviceService.js`, `registerWindowsDeviceRoutes.js`, `web/server.js`, `.env.example` | 1 compuerta delante de todo `/api/v1` |
| 2 | — (pantalla) | la tarjeta «Instalaciones» de Provider Studio: lista, aprueba y revoca | — |
| 3 | 411–413 | la columna `api_label`, `POST /api/windows/devices/gate`, y el botón de la compuerta en la tarjeta | 1 sitio donde se enciende |

**Por qué la fase 3 (2026-10-01).** Encender la compuerta era «entra a Vercel, pon
`WINDOWS_DEVICE_GATE_LABELS` con la etiqueta de la clave embebida y redespliega». La etiqueta no se la
sabe nadie —habría que comparar a ojo el secreto de GitHub con `MIRACLE_API_KEYS`—, y un paso así se
deja para luego mientras el instalador público sigue abriéndolo todo. El panel ya escribe variables de
su propio proyecto (las API keys), así que encender pasa a ser un botón: cada instalación guarda con
qué clave se presentó, y el botón ya trae esa etiqueta puesta.

## Cómo se enciende

Se despliega apagado: con `WINDOWS_DEVICE_GATE_LABELS` vacía, nada cambia. El orden para encenderlo
está en la spec 076 de Windows («Cómo se enciende, en orden»): migración, despliegue, versión de
Windows, aprobar las instalaciones conocidas, y solo entonces el botón «Encender la compuerta» de la
tarjeta «Instalaciones» de Provider Studio. A mano sigue valiendo: es la misma variable.

## Lo que NO entra

- **Que las claves de terceros no salgan nunca de Graph.** Una instalación aprobada sigue recibiendo
  las claves crudas en memoria. Pasar Jev y los planes por Graph, y la voz por un relé, es otra spec.
- **Mover las API keys de las variables de entorno a la base.** Hoy la etiqueta de cada clave sale de
  `MIRACLE_API_KEYS`.
