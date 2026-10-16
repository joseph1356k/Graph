# 007 — El asistente encuentra la guía aunque le pregunten en coloquial, y calla cuando no hay guía

Estado: **implementado** (2026-10-16) · Nace del torneo de RAG del 2026-10-14 · Rama: `feat/asistente-rag-lexico-reforzado` (espejo de ZevCorp/Miracle, spec 019)

La spec 006 dejó el buscador de guías con 100 % de recall@3 sobre su propia evaluación. El torneo de
RAG (cinco enfoques, cuatro rondas, un juez) mostró que esa cifra estaba inflada: con preguntas
escritas por otros autores, como las diría un médico colombiano («le duele el pecho como si tuviera un
peso encima y suda frío»), la guía correcta llegaba al prompt solo en el 74 al 84 % de los casos, y en
el 55 % de las urgencias. Y cuando el tema no tiene guía, 67 de 84 prompts llevaban extractos de guías
ajenas. Ganó el «léxico reforzado»: mejorar el mismo BM25, sin embeddings, sin red y sin costo por
pregunta. La decisión, los rivales y cada métrica antes y después están en
[`docs/asistente/RAG-LEXICO-REFORZADO.md`](../asistente/RAG-LEXICO-REFORZADO.md).

## Diagnóstico: qué se midió

| Qué | Medida (antes) | Fuente |
|---|---|---|
| Guía correcta en el prompt, evaluación del repo (559) | 99,3 % | `eval-guideline-prompt.js` |
| Guía correcta en el prompt, conjuntos ciegos | 259 coloquiales 73,7 % · 97 limpias 81,4 % · fresco D 78,9 % · fresco C4 84,4 % | `eval-guideline-prompt.js` |
| Urgencias en el prompt (coloquiales) | 27 de 49 (55,1 %) | `eval-guideline-prompt.js` |
| Fuera de tema con prompt vacío | 70 de 71 | `eval-guideline-prompt.js` |
| Fuera del corpus con extractos en el prompt | 67 de 84 (233 615 caracteres de guías ajenas) | `eval-guideline-prompt.js` |
| G1 equivocada con relevancia «alta» en el repo | 18 | `eval-guideline-prompt.js` |
| recall@1 y MRR del repo | 94,8 % · 0,973 | `eval-guideline-retrieval.js` |

## Promesas

| # | Promesa | Juez |
|---|---|---|
| 701 | La guía correcta llega al prompt en el 100 % de la evaluación del repo y, en los conjuntos ciegos que nadie ajusta, en el 96 % o más de las 259 coloquiales, el 95 % o más de las 97 limpias, el 98 % o más del fresco D, el 94 % o más del fresco C4 y el 95 % o más de las urgencias | `verify-rag-lexico-reforzado.js` |
| 702 | Sin guía para el tema, el prompt va limpio: ninguna pregunta fuera de tema lleva extractos, como mucho 54 de las 84 preguntas fuera del corpus llevan alguno y como mucho 1 lleva uno «alta», y en el repo como mucho 12 preguntas tienen una G1 equivocada con relevancia «alta» | `verify-rag-lexico-reforzado.js` |
| 703 | La cabeza léxica es del corpus compilado (mismo source_hash y mismas guías), el runtime reproduce los rankings del build, carga en 150 ms o menos y responde con p95 de 2 ms o menos, sin red ni dependencias | `verify-rag-lexico-reforzado.js` |
| 704 | Cada guía trae al menos 6 consultas (doc2query), ninguna dispara el escudo de privacidad, ninguna copia una pregunta de la evaluación y ninguna llega al prompt | `verify-rag-lexico-reforzado.js` |
| 705 | Cada decisión del buscador es auditable sin texto (modo léxico, veto o cupo e ids de guía en used_context y en el ledger) y la cabeza se apaga o pasa a sombra con MIRACLE_ASSISTANT_RAG_HEAD en off o shadow, sin desplegar código | `verify-rag-lexico-reforzado.js` |

La 605 de la spec 006 sube con esta: recall@1 de 96 % o más y MRR de 0,98 o más (antes 90 % y 0,93).
Las reglas nuevas del índice (guarda de «pa»/«ta», presión en cifras, regla enclítica, «alta» con
cobertura IDF, digitación solo contra el texto de las guías, selección diversa, veto y cupo) tienen su
prueba unitaria en `verify-guideline-index.js` (602); las consultas y la cabeza, en
`verify-guideline-corpus.js` (601).

**La regla de los conjuntos ciegos** (`scripts/fixtures/rag-ciego/`): nada del buscador se ajusta
contra ellos. Si una pregunta ciega falla, el arreglo se valida con la evaluación del repo y se acepta
el resultado ciego que salga. Las 97 «limpias» son la medida menos contaminada: autor distinto del que
escribió las consultas, no citadas en el debate y sin una consulta casi igual.

## Las fases

| Fase | Promesa que pone verde | Qué toca | Sitios con esta clase de error |
|---|---|---|---|
| 1 | 701 | `knowledge/guias-clinicas/consultas.json`, `scripts/lib/guideline-corpus.js`, `ClinicalGuidelineIndex.js` (campo de consultas, reglas léxicas, selección diversa) | — |
| 2 | 702, 703 | `GuidelineHead.js`, `scripts/build-guideline-head.js`, `scripts/lib/guideline-head-trainer.js`, `retrieveForPrompt` | — |
| 3 | 704, 705 | `verify-guideline-corpus.js`, `ClinicalAssistantService.retrieveGuidelines`, `UsageEvent` | — |

## Lo que NO entra

- La generación de consultas con el modelo de producción (`LLMProvider` sobre el texto de cada guía):
  las 540 de hoy las escribió un modelo en el torneo y se revisan en el PR. Sin clave del modelo en el
  sandbox no se puede medir la generación real; una guía nueva trae sus seis consultas a mano.
- El contrato de abstención en el prompt («no hay guía para X» cuando el tema no coincide) y la marca
  del verificador para una cita de una guía de otro tema: el torneo no los midió y cambiar el prompt
  exige la evaluación con el modelo real.
- K† = 5 (un veto más agresivo, que vacía 18 prompts y no 13) pierde leptospirosis y conjuntivitis
  neonatal en el repo: queda para una sombra en producción con revisión de cada divergencia.
- La puerta final: 100 a 150 preguntas escritas por médicos colombianos que no redactaron guías.

## Hallazgos

- 2026-10-16: cuatro de las 540 consultas del torneo eran copia literal de preguntas ciegas (el
  verificador nuevo lo detectó). Se reescribieron; una de ellas sostenía una pregunta del repo
  («todo le da vueltas cuando se acuesta»), y sin ella el veto perdía esa pregunta con cualquier K. Se
  reescribió con el vocabulario del vértigo («siente que el cuarto le da vueltas al acostarse») sin
  copiar ninguna pregunta.
- 2026-10-16: el entrenamiento en Node llega a un óptimo mejor que el `LogisticRegression` del torneo
  (objetivo 0,769377 frente a 0,769542: scikit-learn paró a las 35 iteraciones). Mismo vocabulario
  (8 456 rasgos de palabras y 23 138 de caracteres) y 1 064 de 1 068 top-1 iguales; las métricas del
  torneo se reproducen al número.

## Cierre

- [x] `npm test` → `CONTRATO INTACTO`, sin pendientes
- [x] Cada promesa se vio en rojo: 701 y 702 con el buscador de antes (línea base de arriba) y con
  `MIRACLE_ASSISTANT_RAG_HEAD=off`; 703 con una cabeza de otro corpus (las cinco en rojo: «no se pudo
  medir»); 704 con una guía de cinco consultas; 705 con una bandera que se ignora
- [ ] Probado contra el servidor en marcha (`npm start`) con el modelo real (requiere la clave del modelo)
- [x] Estado de este documento: **implementado** (2026-10-16)
