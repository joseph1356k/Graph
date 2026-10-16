# 006 — El asistente clínico responde con respaldo citado o se abstiene

Estado: **implementado** (2026-10-09) · Nace del diagnóstico del 2026-10-09 · Rama: `feat/asistente-contexto-rag`

El asistente del portal conoce la consulta abierta (transcripción, nota en pantalla, códigos, edad y
sexo), recupera extractos de un corpus curado de guías clínicas y de fichas técnicas oficiales, los
cita como `[G#]` y `[F#]`, marca las cifras que no encuentra en sus fuentes, se abstiene cuando no hay
respaldo y propone cambios a la nota que el médico aplica con un botón. El detalle técnico está en
[`docs/clinical-assistant.md`](../clinical-assistant.md); la bitácora del trabajo, con cada métrica
antes y después, en [`docs/asistente/ESTADO-LOOP.md`](../asistente/ESTADO-LOOP.md).

## Diagnóstico: qué se midió

| Qué | Medida | Fuente |
|---|---|---|
| Guías en el corpus | 61 al empezar; 80 al cerrar | `verify-guideline-corpus.js` |
| Evaluación de retrieval | 86 preguntas y 9 fuera de tema al empezar (recall@1 90,7 %, MRR 0,952); 483 preguntas, 65 fuera de tema y 45 fuera del corpus al cerrar (recall@1 94,8 %, recall@3 100 %, MRR 0,973) | `eval-guideline-retrieval.js` |
| Respuestas grabadas | no existía; 192 casos al cerrar, las seis métricas en su meta y 0 falsos positivos del verificador | `eval-assistant-answers.js` |
| Tokens de entrada del chat (mediana, consulta típica) | 7 424 en la primera medida; 5 896 al cerrar | `measure-chat-tokens.js` |
| Fichas técnicas | diccionario cerrado de 320 principios activos; CIMA no responde desde el sandbox (proxy 403), la instantánea está vacía | `verify-drug-labels.js`, `npm run check:cima` |

## Promesas

| # | Promesa | Juez |
|---|---|---|
| 601 | Cada guía del corpus compilado coincide con su Markdown, declara fuente, año y población, y ningún fragmento activa el escudo de privacidad | `verify-guideline-corpus.js` |
| 602 | Las preguntas canónicas recuperan su guía entre las tres primeras, las que no son clínicas no recuperan ninguna, y al prompt llegan como mucho unos 5 000 caracteres de extractos numerados G1 a Gn | `verify-guideline-index.js` |
| 603 | Una cifra de la respuesta que no está en las fuentes citadas ni en la consulta se marca para el médico, y cada extracto declara su relevancia | `verify-assistant-grounding.js` |
| 604 | Una pregunta de dosis trae la ficha técnica del medicamento del diccionario cerrado, y a CIMA solo sale el principio activo | `verify-drug-labels.js` |
| 605 | Sobre la evaluación de retrieval, con al menos 300 preguntas, 60 fuera de tema y 40 fuera del corpus: recall@3 de 97 % o más, recall@1 de 96 % o más, MRR de 0,98 o más, ninguna guía en las preguntas fuera de tema, 90 % o más de las preguntas fuera del corpus sin extracto de relevancia alta, búsqueda p95 de 10 ms o menos e índice construido en 300 ms o menos | `verify-asistente-metricas.js` |
| 606 | Sobre al menos 150 respuestas de modelo grabadas: 100 % de las referencias inventadas eliminadas, 95 % o más de las cifras plantadas detectadas, 5 % o menos de falsos positivos del verificador, 100 % de los casos sin respaldo en abstención o con cifras marcadas, 100 % de las salidas rotas sin romper el chat y 100 % de las propuestas de nota sin persistir y respetando la nota firmada | `verify-asistente-metricas.js` |
| 607 | La mediana de tokens de entrada del chat en una consulta típica es de 6 000 o menos, con una sola llamada al modelo por pregunta | `verify-asistente-metricas.js` |

El chat por las rutas reales (contexto de la consulta, guías en el prompt, referencias inventadas
borradas, propuesta de nota que no persiste, respuesta compatible con `answer` de texto) lo sigue
juzgando la fila 7 de [lo heredado](000-lo-heredado.md), `verify-clinical-assistant.js`. La promesa
que cierra el asunto es la 606: sin ella, citar guías sería cosmético.

## Las fases

La spec se escribió al integrar `main` (2026-10-09), cuando el trabajo ya estaba hecho: las promesas
congelan lo que ya se cumplía. Cada métrica se vio en rojo en su momento, antes de su arreglo (la
historia está en `docs/asistente/ESTADO-LOOP.md`).

| Fase | Promesa que pone verde | Qué toca | Sitios con esta clase de error |
|---|---|---|---|
| 1 | 601, 602 | `knowledge/guias-clinicas/`, `src/application/knowledge/ClinicalGuidelineIndex.js` | — |
| 2 | 603, 606 | `src/application/use-cases/ClinicalAnswerVerifier.js`, `ClinicalAssistantResponseParser.js` | — |
| 3 | 604 | `src/application/knowledge/DrugLabelService.js`, `knowledge/fichas-tecnicas/` | — |
| 4 | 605 | índice, sinónimos y `scripts/fixtures/rag-eval.json` | — |
| 5 | 607 | `selectForPrompt`, prompt del chat v6, `contexto_consulta` compacto | — |

## Lo que NO entra

- La evaluación con el modelo real (JSON válido, abstención correcta, guía esperada citada, latencia y
  tokens reales): necesita `MIRACLE_ASSISTANT_LLM_API_KEY`, que el sandbox no tiene.
- La instantánea de fichas técnicas de CIMA: el sandbox no llega a `cima.aemps.es`. Se construye con
  `npm run build:drug-labels` desde una máquina con red.
- La revisión médica de las 80 guías (`revisado_por` lo llena solo un médico); lo que necesita
  contraste con la fuente primaria está en `knowledge/guias-clinicas/PENDIENTES-REVISION.md`.
- La mitad del portal (contexto, tarjetas de fuentes, abstención, cifras sin fuente, aplicar la
  propuesta y su prueba E2E con Playwright) vive en `joseph1356k/Pagina-web-clientes-final`, rama
  `claude/clinical-assistant-rag-context-gitl2z`.

## Hallazgos

- 2026-10-09: al integrar `main`, el límite de rol nuevo del chat (`roleBoundary`) suma también
  `<guias_clinicas>` y `<fichas_tecnicas>` como dato: una ficha que llega de fuera no puede dar
  órdenes. El texto nuevo subía la mediana de tokens a 5 915; se compactaron dos frases y quedó en 5 896.

- 2026-10-16: la spec 007 (léxico reforzado, ganador del torneo de RAG) sube la 605: recall@1 de 90 % a
  96 % y MRR de 0,93 a 0,98, con el repo en 96,6 % y 0,983.

## Cierre

- [x] `npm test` → `CONTRATO INTACTO`, sin pendientes
- [ ] Cada promesa se vio en rojo antes de su código, y otra vez al romper el código a propósito (cada métrica se vio en rojo durante el trabajo y las promesas se numeraron después; al romperlas a propósito el 2026-10-09 se vieron en rojo la 601, con un Markdown sin recompilar, y la 607, con el umbral en 5 000)
- [ ] Probado contra el servidor en marcha (`npm start`), con la llamada y la respuesta pegadas en el PR (requiere la clave del modelo)
- [x] Estado de este documento: **implementado** (2026-10-09)
