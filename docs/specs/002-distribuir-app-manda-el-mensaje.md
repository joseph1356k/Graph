# 002 — «Distribuir App» publica: manda el mensaje que el workflow exige

Estado: **implementado** (2026-10-01) · Nace del diagnóstico del 2026-09-30 · Rama: `jose/la-actualizacion-llega`

## Diagnóstico: qué se midió

El dueño (2026-09-30): «los releases que estamos haciendo para actualizar Windows no están surtiendo
efecto». La mitad del asunto era del cliente de Windows (spec 072 de `apps/windows`); la otra, de aquí.

| Qué | Medida | Fuente |
|---|---|---|
| Última release de Windows | la 1.3.6, del 2026-09-24, lanzada a mano desde la terminal | `gh run list --workflow windows-release.yml` |
| Lo que manda `triggerBuild` | `version` y `request_id`, nada más | `WindowsAppReleaseService.js` |
| Lo que exige el workflow | `version`, `request_id` y `user_message`, los tres `required: true` desde el commit `30259989` | `.github/workflows/windows-release.yml` |
| Qué contesta GitHub | `422 Required input 'user_message' not provided`, y no crea ningún run | `gh api … /dispatches` sin `user_message`, en dry-run |

El botón de Provider Studio no podía publicar nada, y como las releases salían por otro camino nadie
lo vio.

## Promesas

| # | Promesa | Juez |
|---|---|---|
| 201 | «Distribuir App» lanza el workflow de Windows con todos los datos que el workflow declara obligatorios, el mensaje para la persona incluido y sin espacios de sobra | `verify-windows-release.js` |
| 202 | sin mensaje no se llama a GitHub: se rechaza antes, con un 400 que dice qué falta | `verify-windows-release.js` |
| 203 | la ruta que usa el botón le pasa al servicio el mensaje que llega en el cuerpo | `verify-windows-release.js` |

La que cierra el asunto es la 201, y lee los obligatorios del propio `.yml` cuando lo tiene a mano: si
mañana el workflow exige un cuarto dato, se pone roja en vez de enterarnos por un 422.

## Las fases

| Fase | Promesa que pone verde | Qué toca | Sitios con esta clase de error |
|---|---|---|---|
| 1 | 201, 202 | `src/application/use-cases/WindowsAppReleaseService.js` | 1 dispatch |
| 2 | 203 | `web/api/registerWindowsDistributionRoutes.js`, `web/public/provider-studio.js` | 1 ruta, 1 botón |

## Lo que NO entra

- **La producción de hoy.** `graph-eight-pied` sale del repo viejo (`joseph1356k/Graph`) hasta el
  corte: allí el botón sigue sin mandar el mensaje. Este arreglo llega con el corte, o llevándolo a
  mano a ese repo.
- **El nombre del repo de Windows.** Lo lee de `WINDOWS_APP_GITHUB_REPO`; tras renombrar el monorepo
  hay que poner el nombre nuevo en Vercel. Con el viejo sigue funcionando por la redirección de
  GitHub, pero con una petición de más.

## Evidencia (2026-09-30)

`node scripts/verify-windows-release.js` en verde con el arreglo; con el código de `main`, rojo por
«el dispatch no lleva user_message, que el workflow exige: GitHub contestaría 422».
