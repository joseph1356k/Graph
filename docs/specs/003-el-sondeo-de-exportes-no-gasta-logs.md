# 003 — Preguntar por exportes y registrarse dejan de gastar la cuota de logs

Estado: **implementado** (2026-10-01) · Nace del diagnóstico del 2026-10-01 · Rama: `jose/el-sondeo-de-exportes-no-gasta-logs`

Cada petición de Graph a Supabase por la API REST deja una línea en los logs del gateway, y esas
líneas cuentan para la cuota de *Log Ingestion* del plan. El 2026-10-01 la cuota del ciclo estaba
pasada (1,02 GB de 1 GB), y más de la mitad la gastaba una sola pregunta: el ejecutor de exportes
de cada Ü Windows pregunta cada 3 s si hay una nota que pasar a la historia clínica, y cada
pregunta llega a la base aunque la cola esté vacía.

## Diagnóstico: qué se midió

| Qué | Medida | Fuente |
|---|---|---|
| Cuota de logs del ciclo | 1,02 GB de 1 GB | panel de uso de la organización en Supabase, 2026-10-01 |
| Logs de un día | 80 MB: 69 MB del gateway (38.336 peticiones), 10 MB del pooler, 1 MB del resto | `logs` de Supabase, últimas 24 h, texto + atributos |
| `POST /rest/v1/rpc/graph_claim_next_note_export` | 21.027 peticiones y 37,2 MB al día: el 54 % del gateway | ídem, agrupado por ruta |
| Exportes que ha tenido la cola | 10 en toda su historia | `count(*)` de `graph_note_exports` |
| El ritmo del ejecutor | una pregunta cada 3 s por equipo, toda la jornada; 204 si no hay trabajo | `EjecutorDeExportaciones.cs:66` y `:177` |
| `GET /rest/v1/graph_windows_users` | 1.214 al día: el `select` previo de cada `register()`, que el cliente llama cada 60 s y va seguido de un `PATCH` | ídem, y `WindowsTelemetryService.register` |
| Quién crea y reintenta exportes | solo Graph: `NoteExportService.createExport` y `retryExport` | `grep insertExport` |

## Promesas

| # | Promesa | Juez |
|---|---|---|
| 301 | Mientras no hay exportes pendientes, las preguntas de los ejecutores llegan a la base como mucho una vez cada 15 segundos | `verify-sondeo-de-exportes.js` |
| 302 | Un exporte pedido en Graph se entrega en la siguiente pregunta de un ejecutor | `verify-sondeo-de-exportes.js` |
| 303 | Un exporte reintentado en Graph se entrega en la siguiente pregunta de un ejecutor | `verify-sondeo-de-exportes.js` |
| 304 | Después de entregar un exporte, la siguiente pregunta vuelve a ir a la base | `verify-sondeo-de-exportes.js` |
| 305 | Si la base falla al responder una pregunta, la siguiente pregunta vuelve a ir a la base | `verify-sondeo-de-exportes.js` |
| 306 | Un exporte que entra a la cola por otro camino se entrega como mucho 15 segundos después | `verify-sondeo-de-exportes.js` |
| 307 | El registro de un usuario de Windows es una sola petición a la base | `verify-sondeo-de-exportes.js` |
| 308 | Registrarse otra vez no cambia cuándo se vio por primera vez a ese usuario | `verify-sondeo-de-exportes.js` |

La que cierra el asunto es la 301. La 302, la 303 y la 306 son el precio que no se paga: lo que
pide el médico no espera. La 304 y la 305 impiden que el ahorro tape trabajo: después de entregar
uno puede haber otro, y un fallo no es una cola vacía.

**Con qué se juzga.** Con el servicio y el repositorio reales sobre la base falsa de exportes
(`tests/helpers/fakeNoteExportSupabase.js`, la misma del juez del flujo), contando las llamadas a
la RPC del claim, y un reloj que el juez mueve. El registro, con `scripts/lib/fakeSupabase.js`.

## Las fases

| Fase | Promesa que pone verde | Qué toca | Sitios con esta clase de error |
|---|---|---|---|
| 1 | 301, 304, 305, 306 | `NoteExportService.claimNext` | 1: el único camino a la RPC del claim |
| 2 | 302, 303 | `NoteExportService.createExport` y `retryExport` | 2: los dos sitios que ponen un trabajo en `pending` |
| 3 | 307, 308 | `SupabaseRestClient.upsert` (nuevo), `WindowsTelemetryService.register`, `scripts/lib/fakeSupabase.js` | 1 |

## Lo que NO entra

- **El ritmo del cliente.** Que el ejecutor de Windows pregunte cada 15 s, o que espere más cuando
  la cola lleva rato vacía, ahorraría además las peticiones a Graph. Es de Windows, necesita una
  versión nueva instalada en cada PC, y la rama `jose/u-gasta-menos` tiene abierto su contrato.
  Con esta spec el ahorro en Supabase llega hoy, sin tocar los PCs.
- **El pooler de conexiones** (10 MB de logs al día): son las conexiones que abre y cierra la
  plataforma del medidor, con `idle_timeout` de 8 s. Subirlo ahorraría logs, pero ese valor corto
  es el arreglo de un incidente (conexiones muertas tras congelarse un Lambda). Es del repo del
  medidor y se decide allí.

## Límites que se aceptan

- **Lo que se recuerda vive en la memoria de cada instancia.** Con dos instancias de Graph a la vez,
  cada una pregunta a la base como mucho cada 15 s. Un exporte pedido en una instancia se entrega
  al momento en esa, y en la otra como mucho 15 s después (promesa 306).
- **El que pide el exporte y el ejecutor casi nunca hablan con la misma instancia** en el instante
  justo: en el peor caso, la nota firmada tarda 15 s más en empezar a escribirse en el HIS.

## Hallazgos

- 2026-10-01 · Antes del código estaban rojas la 301 («en un minuto sin trabajo llegaron 40
  preguntas a la base») y la 307 («registrarse hizo 2 peticiones»). Las otras seis ya se cumplían:
  son lo que el ahorro no puede romper, y solo se vieron rojas por sabotaje.
- 2026-10-01 · Los sabotajes: 7, cada uno comprobando que el reemplazo se aplicó, y los 7 pusieron
  roja su promesa (recordar la cola vacía antes de preguntar pone rojas la 304 y la 305 a la vez).
- 2026-10-01 · El juez del flujo de exportes (promesa 21) no necesitó cambios: todo lo que encola
  o reintenta pasa por el servicio.
- 2026-10-01 · La prueba contra el servidor en marcha (`node web/server.js`, con un PostgREST de
  mentira que apunta lo que recibe): dos equipos preguntando cada 3 s durante 20 s, 14 preguntas,
  todas 204, y a la base llegaron 2. Dos `POST /api/v1/agent/register` seguidos, dos peticiones a
  la base (`POST graph_windows_users?on_conflict=email`, `Prefer: resolution=merge-duplicates`),
  un solo usuario, con la versión del segundo registro y el `first_seen_at` del primero.

## Cierre

- [x] `npm test` → `CONTRATO INTACTO: 59 promesas`, sin pendientes (la 22 sin juzgar: no hay `psql`)
- [x] Cada promesa se vio en rojo antes de su código, o al romper el código a propósito
- [x] Probado contra el servidor en marcha, con la llamada y la respuesta pegadas en el PR
- [ ] El mismo cambio en `joseph1356k/Graph`, que es de donde sale la producción hasta el corte
- [x] Estado de este documento: **implementado** (2026-10-01)
