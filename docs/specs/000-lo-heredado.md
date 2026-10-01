# 000 — Lo heredado

Las verificaciones que Graph traía cuando entró al monorepo (2026-09-28), registradas como promesas
el 2026-09-30. No es una spec escrita antes que su código: es el inventario de lo que ya se juzgaba,
para que desde aquí cada verificación tenga una fila y cada fila tenga un juez.

Una fila de esta tabla vale lo que el código de salida de su juez. Las specs nuevas no funcionan
así: sus promesas llevan número propio y el juez las imprime una por una (ver
[`PLANTILLA.md`](PLANTILLA.md)).

## Promesas

| # | Promesa | Juez |
|---|---|---|
| 1 | El decisor de Android (`POST /api/v1/agent/decidir`) nace apagado, arma él mismo el cuerpo hacia TypeSafe, lleva la key solo en `Authorization` y devuelve solo la elección y números | `verify-agent-decisor.js` |
| 2 | El turno del agente (`POST /api/v1/agent/turn`) le responde a Windows byte a byte como antes de Android, y a Android con su prompt y su catálogo | `verify-agent-platform.js` |
| 3 | En el turno de Android las coordenadas vuelven en píxeles de pantalla aunque el modelo las dé en píxeles de la imagen reducida | `verify-agent-screen-scale.js` |
| 4 | En el turno del agente, cada API key ve y puede invocar solo los workflows que grabó ella | `verify-agent-workflow-access.js` |
| 5 | El catálogo de tarifas de Node y la tabla `ai_model_prices` de SQL dicen lo mismo | `verify-ai-usage-pricing.js` |
| 6 | La telemetría de consumo de IA calcula el costo, lo atribuye y lo registra una sola vez, también con streaming, reintentos y fallback | `verify-ai-usage-telemetry.js` |
| 7 | El Asistente Clínico responde en chat general y contextual, sugiere diagnósticos por encounter y ajusta la nota, por las rutas reales | `verify-clinical-assistant.js` |
| 8 | El texto clínico se normaliza, y cada fragmento de la nota se localiza en la transcripción de la que salió | `verify-clinical-text.js` |
| 9 | El flujo clínico completo funciona por las rutas reales: plantilla, encounter, transcripción, nota generada y nota editada | `verify-clinical-workflow.js` |
| 10 | Publicar la consulta en el historial se hace en el servidor y no pisa el estado, la firma ni el paciente que puso el médico | `verify-consultation-mirror.js` |
| 11 | Con varias voces el prompt explica las etiquetas de hablante, lo del médico manda y un diagnóstico que solo dice el paciente no cuenta como conocido; con una sola voz, la transcripción llega como antes (promesas 600-603 y 610 de la spec 070 de Windows) | `verify-diarizacion.js` |
| 12 | El `context` que manda el agente reemplaza los valores grabados de los pasos dinámicos al construir el plan | `verify-dynamic-values.js` |
| 13 | Ningún archivo de Graph habla con un proveedor de IA fuera de los transportes conocidos, y los que llevan texto clínico pasan por el escudo | `verify-egress-gateway.js` |
| 14 | Los `valueMode` y `bindTo` que trae un paso se guardan tal cual, y el clasificador solo rellena los que vienen sin modo | `verify-explicit-modes.js` |
| 15 | El vigilante del sistema detecta lo que debe, no manda correo cuando no hay nada que contar, y el correo nunca lleva datos de pacientes | `verify-health-alerts.js` |
| 16 | El catálogo institucional genera exactamente 147 plantillas en 49 especialidades, con ids únicos y secciones válidas | `verify-institutional-catalog.js` |
| 17 | El proxy de voz Live rechaza al dispositivo no autorizado antes del handshake, y lee la misma lista que la voz Realtime | `verify-live-voice-proxy.js` |
| 18 | `LLMProvider` respeta los parámetros de generación y el timeout, y recupera el JSON de una respuesta mal formada | `verify-llm-provider.js` |
| 19 | Los logs no escriben el `device_id` completo, ni el del proxy de voz Live ni el que viaja en la URL | `verify-log-redaction.js` |
| 20 | El validador de la nota clínica y sus métricas dan lo mismo sobre las fixtures grabadas | `verify-note-evals.js` |
| 21 | La exportación de la nota a la historia clínica recorre el camino entero por las rutas reales: firma, validación, cola, ejecutor y resultado | `verify-note-export-flow.js` |
| 22 | En un Postgres real, la migración de `graph_note_exports` y sus RPC cumplen sus aserciones, y dos ejecutores no reclaman el mismo trabajo | `verify-note-exports-db.js` |
| 23 | Cada sección de la nota se interpreta o se copia literal según la precedencia sección, plantilla, especialidad, y el prompt lo refleja | `verify-note-fidelity.js` |
| 24 | El rescate de consultas a medias rescata lo que debe, no toca lo que el propietario pidió dejar quieto, y dos ejecuciones no pelean por el mismo trabajo | `verify-note-rescue.js` |
| 25 | Graph calcula el mismo hash de firma que Miracle Notes sobre el vector compartido | `verify-note-signature-hash.js` |
| 26 | ~~Quien no es médico configura su perfil por voz, lo consulta, le enseña capturas nuevas y organiza una transcripción con él~~ (retirada el 2026-10-01: el organizador no tenía ningún cliente y se borró, spec 005) | `verify-organizer-profiles.js` |
| 27 | Por el cable, ningún identificador del paciente sale hacia el proveedor de IA, y la nota vuelve con los datos reales y sin marcadores | `verify-privacy-gateway-e2e.js` |
| 28 | El escudo de privacidad detecta el corpus dorado, restaura exacto, no fuga y aísla una consulta de otra | `verify-privacy-shield.js` |
| 29 | Las cláusulas compartidas de los prompts existen, no están vacías, y el espejo de Python lleva la misma versión | `verify-prompt-clauses.js` |
| 30 | `POST /api/v1/pipeline` da la nota del motor canónico cuando hay plantilla, y un bloque provisional del orquestador de voz cuando no | `verify-public-pipeline.js` |
| 31 | Para el token de voz Realtime, a OpenAI solo sale la configuración de la sesión, un dispositivo fuera de la lista no llega, y el secreto no se escribe en ningún log | `verify-realtime-session.js` |
| 32 | El paso de árbol de SAP conserva `nodeKey`, `nodePath` y `nodeAction` desde la entidad hasta el plan de ejecución | `verify-tree-node-steps.js` |
| 33 | El asistente de captura sanea el contexto de la página, no inventa datos y no ejecuta nada sin modelo | `verify-workflow-assistant-policy.js` |
| 34 | El aprendizaje de workflows da la guía de ejecución sin llamar al LLM, y título, resumen y modos de valor en una sola llamada | `verify-workflow-learning.js` |

La 22 necesita un Postgres real. Sin él, su juez lo dice y sale con 0, así que el contrato la marca
`⏭` y la nombra en el veredicto: no se cuenta como cumplida. En el CI tampoco hay base, de modo que
hoy solo se juzga en una máquina con Postgres (`GRAPH_TEST_DATABASE_URL`).

## Fuera del contrato

Verificaciones que existen en `scripts/` y que el juez no corre, con su motivo. Un `verify-*.js` que
no esté ni arriba ni aquí detiene al juez: no hay verificaciones sin dueño.

| Fuera del contrato | Por qué |
|---|---|
| `verify-chrome-extension-auth.js` | No estaba en `npm test` cuando Graph entró al monorepo. Pasa sin red en 27 s (medido el 2026-09-30): `npm run test:chrome-extension` |
| `verify-clinical-assistant-features.js` | Necesita el Chromium de Playwright (`npx playwright install`). Sin él falla y no termina: el 2026-09-30 se quedó nueve minutos colgado |
| `verify-live-plan.js` | No es una verificación: es una herramienta que consulta producción con una API key |
| `verify-note-export-real-postgres.js` | Necesita un Postgres real y el paquete `pg`: `npm run test:note-export-real` |
