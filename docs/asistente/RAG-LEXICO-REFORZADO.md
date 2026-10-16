# RAG del asistente: léxico reforzado (2026-10-16)

Decisión, implementación y métricas del buscador de guías que ganó el torneo de RAG del 2026-10-14.
La spec es [`docs/specs/007-el-asistente-encuentra-la-guia-o-calla.md`](../specs/007-el-asistente-encuentra-la-guia-o-calla.md).

## La pregunta y el torneo

El buscador de la spec 006 (BM25 en memoria con sinónimos) tenía 100 % de recall@3 sobre su propia
evaluación. La duda era si había algo mejor para Miracle. Cinco enfoques compitieron en cuatro rondas,
cada uno midiendo sobre preguntas escritas por los demás, y un juez eliminó uno por ronda:

| Enfoque | Cayó en | Por qué |
|---|---|---|
| E · Contexto largo (todas las guías en el prompt) | ronda 1 | arriesgaba el p95 de 25 s y costaba de +39 % a +225 % por pregunta |
| D · Recuperar y reordenar (cross-encoder) | ronda 2 | su propio reordenador empeoró la G1 (8 a 1) y la abstención (p = 1,2e-4) |
| B · Híbrido local (embeddings en proceso) | ronda 3 | +3/−0 (p = 0,25) solo en frases citadas, con 66 MB de artefactos, 380 a 396 MB de RAM y onnxruntime |
| C · Embeddings gestionados y base vectorial | ronda 4 | la cabeza léxica local lo igualó; su ventaja salía de un modelo que no cabe en Vercel y costaba una segunda transmisión de la pregunta |
| **A · Léxico reforzado** | **ganó** | la única ganancia grande medida en conjuntos de otros autores; 0 USD, sin red, sin dependencias |

El hallazgo que justificó todo: **la evaluación propia estaba inflada**. Con preguntas de otros autores
la guía correcta llegaba al prompt solo en el 74 al 84 % de los casos.

## Qué se implementó

1. **Consultas (doc2query)** — `knowledge/guias-clinicas/consultas.json`, 6 por guía (540), como
   preguntaría un médico colombiano. Campo BM25 extra con filtro de muletillas. Nunca llegan al prompt.
2. **Reglas léxicas** — guarda de «pa»/«ta», presión arterial en cifras, regla enclítica, «alta» con
   cobertura IDF ≥ 0,7, digitación corregida solo contra el texto de las guías.
3. **Selección diversa** — el prompt lleva el mejor fragmento de cada una de las tres primeras guías.
4. **Cabeza léxica** — regresión logística local (TF-IDF de palabras y caracteres, 90 clases, 4,2 MB
   int8), entrenada en Node sin red. Cuando el buscador duda: **veto** (K = 10) y **cupo** (p ≥ 0,41),
   calibrados solo con la evaluación del repo.
5. **Bandera y auditoría** — `MIRACLE_ASSISTANT_RAG_HEAD=on|shadow|off`; `retrieval_mode` y
   `guideline_ids` en `used_context`, `retrievalMode` en el ledger.
6. **Conjuntos ciegos en el repo** — `scripts/fixtures/rag-ciego/` (259 coloquiales de cuatro autores,
   fresco D 90 + 14, fresco C4 90 + 45 con su sha256 c94ba378…), y `scripts/eval-guideline-prompt.js`,
   que mide lo que llega al prompt con la misma función del chat.

## Métricas: antes y después

«Antes» es `main` en 9319a1b (spec 006, 90 guías); «después», esta rama. Mismo corpus de guías.
Discordantes por pregunta contra «antes», con prueba de McNemar.

| Métrica | Antes | Después | Mejoran / empeoran | p |
|---|---|---|---|---|
| Guía correcta en el prompt · repo (559) | 99,3 % | **100 %** | +4 / −0 | 0,13 |
| · 259 coloquiales (ciego) | 73,7 % | **96,1 %** | +58 / −0 | 6,9e-18 |
| · 97 limpias (ciego, la menos contaminada) | 81,4 % | **95,9 %** | +14 / −0 | 1,2e-4 |
| · fresco D (90, ciego) | 78,9 % | **98,9 %** | +18 / −0 | 7,6e-6 |
| · fresco C4 (90, ciego) | 84,4 % | **94,4 %** | +10 / −1 | 0,012 |
| Urgencias en el prompt (49 coloquiales) | 55,1 % | **95,9 %** | | |
| Fuera de tema con prompt vacío (71) | 70 | **71** | | |
| Fuera del corpus con extractos (84) | 67 | **54** | 13 vaciados / 0 llenados | 2,4e-4 |
| · fresco C4 fuera del corpus (45) | 40 | **34** | 6 vaciados / 0 llenados | 0,031 |
| Caracteres de guías ajenas fuera del corpus (84) | 233 615 | **196 889** (−16 %) | | |
| Fuera del corpus con un extracto «alta» (84) | 5 | **1** | | |
| G1 equivocada con relevancia «alta» · repo | 18 | **12** | | |
| recall@1 · repo | 94,8 % | **96,6 %** | | |
| recall@3 · repo | 100 % | 100 % | | |
| MRR · repo | 0,973 | **0,983** | | |
| Búsqueda p95 | 3,3 ms | 3,0 ms | | |
| Construcción del índice | 210 ms | **~170 ms** (normalización por carácter y digitación al primer uso) | | |
| Cabeza léxica: carga (primer uso) · por pregunta p95 | — | 46–57 ms · 0,35 ms | | |
| Tamaño: corpus · cabeza | 947 KB · — | 978 KB · 4,17 MB | | |
| Costo por pregunta · llamadas al modelo | 1 llamada | 1 llamada, 0 USD extra | | |

Los umbrales nuevos (spec 007 y la 605 de la 006) quedan en estos valores: solo pueden subir.

**El único retroceso:** en el fresco C4, «paciente con 34 semanas y le está doliendo la barriga cada 5
minutos» (parto pretérmino) entraba al prompt y ahora no. Es una urgencia obstétrica. No se arregló
contra el conjunto ciego (la regla del torneo): queda anotado para el conjunto de médicos y para la
revisión de las consultas de `parto-pretermino`.

## Cómo se mantiene

- **Guía nueva:** su Markdown, sus 6 consultas en `consultas.json` y sus 4 preguntas en
  `scripts/fixtures/rag-eval.json`; luego `npm run build:corpus && npm run build:head` (~45 s) y
  `npm test`. Si cambia el corpus o la evaluación del repo y no se regenera la cabeza, `npm test` falla.
- **Nunca** se ajusta nada contra `scripts/fixtures/rag-ciego/`, y ninguna consulta copia una pregunta
  de la evaluación (`verify-guideline-corpus.js` lo rechaza).
- **Emergencia:** `MIRACLE_ASSISTANT_RAG_HEAD=off` apaga la cabeza (queda el buscador reforzado);
  `MIRACLE_ASSISTANT_RAG_DISABLED=1` apaga todo el RAG.

## Lo que sigue sin resolver

- Temas cercanos sin guía que ningún veto vacía (metimazol → hipotiroidismo, crisis miasténica →
  organofosforados, alacrán → accidente ofídico): siguen 54 de 84 prompts fuera del corpus con extractos.
  El prompt ya marca la relevancia de cada extracto; un contrato de abstención más estricto y una marca
  del verificador para citas de otro tema necesitan la evaluación con el modelo real.
- Paráfrasis de urgencias que la cabeza pone primera pero con poca probabilidad («dolor como un peso
  encima y suda frío», «sangró mucho después de tener el bebé»): no se bajó el umbral para no ajustar
  contra los ciegos.
- Sepsis descrita sin la palabra («anciano con fiebre, FC 120, FR 28, tensión bajita»).
- La puerta decisiva: 100 a 150 preguntas escritas por médicos colombianos, unas 30 fuera del corpus, y
  dos semanas de `shadow` en producción para un veto más agresivo (K = 5).
