# Estado del loop del asistente clínico

Archivo de continuidad del loop autónomo. Cada iteración lo lee, mide, hace UNA tarea, y lo actualiza.
Repos: Graph `feat/asistente-contexto-rag` · Web `claude/clinical-assistant-rag-context-gitl2z`.

## Métricas

| Métrica | Línea base (2026-10-09) | Actual | Meta | Estado |
|---|---|---|---|---|
| Guías en el corpus | 61 | 61 | ≥ 80 | pendiente |
| Preguntas de evaluación de retrieval | 86 | 86 | ≥ 300 (≥ 4 por guía) | pendiente |
| Preguntas fuera de tema | 9 | 9 | ≥ 60 | pendiente |
| Conjunto «fuera del corpus» | no existe | no existe | ≥ 40, ≥ 90 % sin extracto de relevancia alta | pendiente |
| recall@3 | 100 % | 100 % | ≥ 97 % | cumple |
| recall@1 | 90,7 % | 90,7 % | ≥ 90 % | cumple |
| MRR | 0,952 | 0,952 | ≥ 0,93 | cumple |
| Fuera de tema sin guías | 100 % | 100 % | 100 % | cumple |
| p95 de búsqueda | 2,85 ms | 2,35 ms | ≤ 10 ms | cumple |
| Construcción del índice | no medido | ≈ 360–550 ms | ≤ 300 ms | pendiente |
| Evaluación de respuestas sin red (casos) | no existe | no existe | ≥ 150 con 6 métricas | pendiente |
| Evaluación de respuestas en vivo | no existe | bloqueada | ≥ 60 casos | bloqueada: requiere humano |
| Medicamentos en el diccionario | 170 | 170 | ≥ 250 | pendiente |
| Instantánea de fichas técnicas | 0 % | 0 % | ≥ 90 % del diccionario | bloqueada: requiere humano |
| Cifras «de memoria» corregidas o retiradas | 0 | 6 | todas las marcadas | en curso |
| Graph `npm test` | verde | verde | verde | cumple |
| Web lint / typecheck / tests / build | 0 errores / limpio / 908 / OK | 0 errores / limpio / 908 / OK | verde | cumple |
| E2E Playwright del chat | no existe | no existe | 5 escenarios | pendiente |
| Tokens de entrada del chat (mediana) | no medido | no medido | ≤ 6 000 | pendiente |
| `guidelines.corpus.json` | 570 KB | ≈ 570 KB | ≤ 2 MB | cumple |
| Llamadas al modelo por pregunta | 1 | 1 | 1 | cumple |

## Backlog priorizado

1. **Exactitud clínica:** seguir verificando las cifras «Pendiente» de `knowledge/guias-clinicas/PENDIENTES-REVISION.md` (desnutrición y Res. 115/2026, código rojo, citología/ADN-VPH, ISPAD, anafilaxia, hemorragia digestiva).
2. **Calidad de respuesta:** `scripts/eval-assistant-answers.js` + fixture con ≥ 150 casos dorados y sus 6 métricas, en `npm test`.
3. **Retrieval:** ampliar `rag-eval.json` a ≥ 300 preguntas y ≥ 60 fuera de tema; crear el conjunto «fuera del corpus».
4. **Corpus:** 19+ guías nuevas de la lista prioritaria (crecimiento y desarrollo, PAI, lactancia, sangrado del primer trimestre, diabetes gestacional, hepatitis B y C, parasitosis, escabiosis, dermatitis atópica, ojo rojo, lesión renal aguda, electrolitos, pancreatitis y colecistitis, cirrosis, meningitis, tos ferina, leishmaniasis, Chagas, leptospirosis, accidente ofídico, rabia, organofosforados, quemaduras).
5. **Fichas:** diccionario a ≥ 250 principios activos con pruebas de detección.
6. **Funcionamiento:** E2E con Playwright del chat (v1, abstención, fuentes guía + ficha, cifras sin fuente, aplicar propuesta).
7. **Optimización:** construcción del índice ≤ 300 ms (expansión de sinónimos y vocabulario de trigramas); medir tokens de entrada.

## Hecho

- **Iteración 1 (2026-10-09):** archivo de estado y `PENDIENTES-REVISION.md`. Exactitud clínica: potasio en CAD corregido al consenso 2024 (10–20 mmol, no 20–30); atribuciones de PaCO2 y del plazo de 72 h en posparo corregidas; mamografía confirmada con la Res. 276 de 2019; edades y periodicidad colombianas de FIT y PSA retiradas por no verificables.

## Decisiones

- La verificación de cifras se hace con búsqueda web; los sitios oficiales no son alcanzables desde el sandbox. Una cifra se corrige con al menos dos fuentes secundarias concordantes; si no hay ninguna, se retira y queda en `PENDIENTES-REVISION.md`.
- `revisado_por` nunca lo llena el loop.

## Requiere humano

- **Revisión médica** de las 61 guías, empezando por lo marcado «Pendiente» en `knowledge/guias-clinicas/PENDIENTES-REVISION.md`.
- **Clave de modelo para la evaluación en vivo:** no hay `MIRACLE_ASSISTANT_LLM_API_KEY` en el sandbox. Bloqueada: requiere humano.
- **CIMA:** el proxy del sandbox responde 403 a `cima.aemps.es` (`npm run check:cima` falla en ~90 ms). Correr `npm run check:cima` en el entorno de Graph y, si responde, `npm run build:drug-labels` desde una máquina con red. Bloqueada: requiere humano.
