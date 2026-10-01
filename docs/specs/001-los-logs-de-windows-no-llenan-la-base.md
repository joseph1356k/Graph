# 001 — Los logs de Ü Windows dejan de llenar la base

Estado: **implementado** (2026-10-01) · Nace del diagnóstico del 2026-10-01 · Rama: `jose/la-telemetria-no-llena-la-base`

El panel de Windows del Provider Studio refleja el log de cada equipo (`EspejoDelLog` en el cliente,
`POST /api/v1/agent/events` aquí). Cada línea del log es una fila en `graph_windows_events`, y nada
las borra. El proyecto `miracle-app` de Supabase está en el plan Free (500 MB) y el 2026-10-01 pasó
de ese límite. Esta spec hace que Graph guarde lo que sirve para depurar —cada línea distinta, y
cuántas veces se repitió— sin guardar cada repetición, y que lo guardado caduque.

## Diagnóstico: qué se midió

Todo medido el 2026-10-01 contra `miracle-app` (Supabase, Postgres 17), con consultas de solo lectura.

| Qué | Medida | Fuente |
|---|---|---|
| Tamaño de la base | 613 MB, sobre 500 MB del plan | `pg_database_size` |
| `graph_windows_events` | 246 MB: 145 MB de datos y 101 MB de índices | `pg_total_relation_size` |
| Filas de `graph_windows_events` | 410.635; 407.979 son `kind='log'` y 2.656 son de los otros ocho `kind` | `count(*)` por `kind` |
| Cuándo llegaron | 133.679 en la semana del 14-sep y 243.010 en la del 21-sep (9 usuarios) | `count(*)` por semana |
| Logs con más de 7 días | 331.330 de 407.979 (81 %) | `created_at < now() - 7 días` |
| Las líneas que más se repiten | `ubicación cada N ms (…)` 116.372 · `delante no es SAP («…»): que lo intente UIA` 49.798 · `marca: «…» (Button)` 25.993 · `no se pudo abrir el collar · COMException` 23.340 | agrupando por texto sin números ni comillas |
| Juntando por usuario, etiqueta, hora y texto exacto | 170.685 filas (2,4 veces menos) | `count(distinct …)` |
| Juntando sin los números | 100.343 filas (4 veces menos) | ídem |
| Juntando sin los números ni lo que va entre comillas | 40.873 filas (10 veces menos) | ídem |
| El texto va dos veces en cada fila | en `label` y en `detail.text`; 95 caracteres de media | `EspejoDelLog.cs:66`, `avg(length)` |
| Índices sin uso | `graph_windows_events_app_idx` 35 MB, 25 lecturas · `graph_windows_events_run_idx` 22 MB, 0 lecturas | `pg_stat_all_indexes`, desde que existe la tabla |
| Quién lee la tabla | solo `WindowsPanelService`, siempre por `email` + `id` (3 consultas) | `grep graph_windows_events` en `src/` |
| El latido | `ingestEvents` hace un `PATCH graph_windows_users` por lote: 7.061 al día. El cliente ya manda su latido cada 60 s por `/agent/register` | logs del gateway de Supabase, 24 h; `Telemetry.cs:78` |
| Peticiones a la base por la telemetría | 13.000 de las 35.375 diarias del gateway (37 %) | logs del gateway, 24 h |

Los dos índices sin uso se quitaron de producción el mismo 2026-10-01, por orden del dueño, y la
base bajó a 536 MB. La migración que lo deja escrito va en esta rama.

## Promesas

| # | Promesa | Juez |
|---|---|---|
| 101 | Las líneas de log de un usuario que solo cambian en sus números o en lo que va entre comillas se guardan una sola vez por hora | `verify-telemetria-windows.js` |
| 102 | Cuando una línea se repitió durante la hora, al cerrarse la hora queda guardado cuántas veces llegó | `verify-telemetria-windows.js` |
| 103 | Dos líneas de log con texto distinto se guardan las dos | `verify-telemetria-windows.js` |
| 104 | Los eventos que no son log se guardan todos, aunque sean idénticos | `verify-telemetria-windows.js` |
| 105 | Mientras alguien mira en vivo a un usuario en el panel, cada línea de su log se guarda, sin juntar | `verify-telemetria-windows.js` |
| 106 | El latido de un usuario se escribe como mucho una vez por minuto, por muchos lotes que mande | `verify-telemetria-windows.js` |
| 107 | Un lote en el que todo son repeticiones no hace ninguna petición a la base | `verify-telemetria-windows.js` |
| 108 | El mantenimiento diario borra los logs con más de 7 días | `verify-telemetria-windows.js` |
| 109 | El mantenimiento diario conserva los logs de los últimos 7 días | `verify-telemetria-windows.js` |
| 110 | El mantenimiento diario conserva los eventos que no son log, tengan la edad que tengan | `verify-telemetria-windows.js` |
| 111 | Graph no recuerda más plantillas de log por usuario que su tope, lleguen las que lleguen | `verify-telemetria-windows.js` |
| 112 | Las líneas de un usuario no se juntan con las de otro | `verify-telemetria-windows.js` |
| 113 | El texto de una línea de log se guarda una sola vez en su fila | `verify-telemetria-windows.js` |
| 114 | Cuando ya nadie mira en vivo a un usuario, sus líneas vuelven a juntarse | `verify-telemetria-windows.js` |
| 115 | Una línea que la base no llegó a guardar se guarda la siguiente vez que llega | `verify-telemetria-windows.js` |

Las que cierran el asunto son la 101 y la 108: sin la primera la tabla crece diez veces más rápido
de lo que hace falta, y sin la segunda crece para siempre. Las demás impiden que esas dos se cumplan
a costa de lo que sirve: la 102, la 103 y la 105 guardan lo que se necesita para depurar; la 104, la
109, la 110 y la 112 ya se cumplen hoy y entran para congelarlas.

**Qué es «la misma línea».** Dos líneas de la misma etiqueta (`phase`) y del mismo usuario cuyo
texto es igual después de cambiar cada número por `#` y cada tramo entre `«»` o entre comillas dobles
por `«»`. La fila que se guarda lleva el texto de la primera, con sus números y sus nombres.

**Con qué se juzga.** Con `scripts/lib/fakeSupabase.js` y un reloj que el juez mueve. La 105 y la
114 pasan por la ruta real del stream (`registerWindowsPanelRoutes`), y la 108, la 109 y la 110 por
la ruta real del mantenimiento (`registerMaintenanceRoutes`), montadas sobre una `app` de mentira que
solo recoge los manejadores: no hace falta Express ni red.

## Las fases

| Fase | Promesa que pone verde | Qué toca | Sitios con esta clase de error |
|---|---|---|---|
| 1 | 101, 102, 111, 113, 115 (y congela 103, 104, 112) | `src/domain/plantillaDeLog.js` (nuevo), `WindowsTelemetryService.ingestEvents`, `scripts/lib/fakeSupabase.js` | 1: el único `insert` en `graph_windows_events` |
| 2 | 106, 107 | `WindowsTelemetryService.ingestEvents` | 1: el `update` de `last_seen_at` por lote. El de `register()` se queda: es el latido de verdad, cada 60 s |
| 3 | 105, 114 | `WindowsPanelService.marcarMirando` (nuevo), `registerWindowsPanelRoutes` (el stream), migración `detalle_hasta` | 1 |
| 4 | 108 (y congela 109, 110) | `SupabaseRestClient.delete` (nuevo), `WindowsTelemetryService.purgarLogsViejos` (nuevo), `registerMaintenanceRoutes`, `web/server.js` | 3 tablas de bitácora sin caducidad: esta, `graph_exec_logs` (7 MB) y `ai_usage_events` (4 MB). Entra solo esta; las otras dos, abajo |

## Lo que NO entra

- **El cliente de Windows sigue mandando cada línea.** Juntarlas en `EspejoDelLog` ahorraría además
  la petición, que es lo que cuenta para la cuota de logs de Supabase. No entra porque la rama
  `jose/u-gasta-menos` (spec 072 de Windows) tiene abiertos `MapaVivo.cs`, de donde sale la línea más
  repetida, y `tests/ContratoDelGrafo/Contrato.cs`. Va en una rama propia cuando esa cierre.
- **El sondeo de exportes** (`EjecutorDeExportaciones.cs:66`, cada 3 s por equipo: 17.800 peticiones
  al día para una cola que ha tenido 10 trabajos). Es de Windows y es otra cosa: otra rama.
- **La limpieza de lo que ya había no la hace este código.** Se hizo a mano el 2026-10-01, antes de
  estrenarlo (ver *Hallazgos*): el mantenimiento diario habría intentado borrar 330 mil filas en una
  sola petición REST.
- **`graph_exec_logs` y `ai_usage_events`**: no caducan, pero entre las dos pesan 11 MB.
  `ai_usage_events` es el libro de consumo y no se borra sin decidir antes qué se factura con él.
- **El esquema `medicion`** (302 MB, la otra mitad de la base). Su código no vive en este repo, y
  `medicion.recompute_jornada` recalcula los resúmenes desde las muestras crudas cada vez que cambia
  `algo_version`: resumir las muestras viejas sin tocar esa función dejaría los resúmenes en cero al
  siguiente recálculo. Necesita su propia spec, con quien lleva el medidor.

## Límites que se aceptan

- **Lo que Graph recuerda vive en la memoria de cada instancia.** Al arrancar en frío una instancia
  nueva no recuerda nada, así que vuelve a guardar la primera aparición de cada línea, y la cuenta de
  la hora que llevaba la instancia anterior se pierde. El error va siempre hacia guardar de más,
  nunca hacia perder una línea distinta. Con dos instancias a la vez puede haber dos filas de la
  misma línea en la misma hora.
- **El modo en vivo tarda hasta un minuto en empezar**: Graph se entera de que alguien mira cuando
  le toca escribir el latido de ese usuario.
- **El log completo sigue en el equipo**: `%LOCALAPPDATA%\U\logs\u-AAAAMMDD.log`. Lo que se junta
  aquí no se pierde allí.

## Hallazgos

- 2026-10-01 · El portal no lee `graph_windows_events`: sus RPC de superadmin leen
  `graph_windows_users`. Quitarle historia a la tabla no le quita nada al portal.
- 2026-10-01 · En esta máquina no había Node ni `node_modules`. Las promesas se vieron en rojo y en
  verde con el `node.exe` que trae Codex (v24.19.0), corriendo el juez suelto. Después, con permiso
  del dueño, se instaló Node 24.21.0 y `npm test` dio `CONTRATO INTACTO: 48 promesas`, con la 22 sin
  juzgar (no hay `psql`).
- 2026-10-01 · La prueba contra el servidor en marcha: `node web/server.js` con un PostgREST de
  mentira que apunta lo que le llega. Tres lotes por `POST /api/v1/agent/events`, cada uno con dos
  líneas de log y un paso de workflow: el primero hizo `PATCH graph_windows_users` y un `POST`, y
  guardó 3 filas; el segundo y el tercero, solo un `POST` con el paso (`inserted: 1, juntadas: 2`).
  Quedaron 2 logs y 3 pasos. `GET /api/internal/maintenance/daily` respondió 200 con
  `purgedWindowsLogs: 1` y mandó
  `DELETE graph_windows_events?kind=eq.log&created_at=lt.<hace 7 días>&select=id`.
- 2026-10-01 · La limpieza de lo que ya había, hecha a mano en `miracle-app`: 400.235 líneas
  salieron de `graph_windows_events` a `archivo.graph_windows_logs` (331.330 de más de 7 días y
  68.905 repeticiones de la última semana), cada tanda en una sola sentencia que saca y archiva, y
  comprobando que lo archivado se lee de vuelta línea por línea. La tabla pasó de 246 MB a 5,6 MB,
  el archivo ocupa 17 MB, y la base de 536 MB a 370 MB.
- 2026-10-01 · Antes del código estaban rojas la 101, 102, 106, 107, 108, 111 (pendiente), 113 y
  114. La 105 estaba verde, porque hoy se guarda todo: se puso roja al entrar la fase 1 («con el
  panel abierto, tres líneas dejaron 1 fila») y volvió a verde con la fase 3.
- 2026-10-01 · La primera vez, el rojo fue del arnés y no de las promesas: el juez envolvía
  `insert` para contar peticiones y la base de mentira llamaba a `this.insert`. Siete promesas
  decían «this.insert is not a function». Corregida la base de mentira, el rojo fue el de la tabla.
- 2026-10-01 · La 115 no estaba en la spec: salió al escribir el código (si el `insert` falla, las
  líneas ya quedaban recordadas como guardadas). Su código entró antes que ella, así que solo se vio
  en rojo por sabotaje.
- 2026-10-01 · Los sabotajes: 14, uno por pieza, cada uno comprobando que el reemplazo se aplicó.
  La primera pasada dijo «sigue verde» en los 14: el script de sabotajes no reconocía las marcas
  `✘` por la codificación de PowerShell 5.1. Corregido, los 14 pusieron roja su promesa (la 101
  arrastra además la 102, la 107 y la 114; la 103, la 111).
- 2026-10-01 · La purga del estreno, medida con un `select` de solo lectura: 331.330 logs de más de
  7 días, 68.746 repeticiones de los últimos 7 días, y quedan 8.035 logs y los 2.656 eventos que no
  son log: 10.691 filas de 410.767.

## Cierre

- [x] `npm test` → `CONTRATO INTACTO`, sin pendientes
- [x] Cada promesa se vio en rojo antes de su código, y otra vez al romper el código a propósito
      (salvo la 115 y las que ya se cumplían, que solo se vieron rojas por sabotaje)
- [x] Probado contra el servidor en marcha, con la llamada y la respuesta pegadas en el PR
- [x] La migración `detalle_hasta` aplicada en `miracle-app` antes de mergear (2026-10-01)
- [x] Estado de este documento: **implementado** (2026-10-01)
- [x] El mismo cambio en `joseph1356k/Graph`, que es de donde sale la producción hasta el corte
      (su PR 35, mergeado el 2026-10-01; en producción los logs llegan juntados desde las 06:21 UTC)
