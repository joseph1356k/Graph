# Estado del loop del asistente clínico

Archivo de continuidad del loop autónomo. Cada iteración lo lee, mide, hace UNA tarea, y lo actualiza.
Repos: Graph `feat/asistente-contexto-rag` · Web `claude/clinical-assistant-rag-context-gitl2z`.

## Métricas

| Métrica | Línea base (2026-10-09) | Actual | Meta | Estado |
|---|---|---|---|---|
| Guías en el corpus | 61 | 61 | ≥ 80 | pendiente |
| Preguntas de evaluación de retrieval | 86 | 330 (≥ 4 por guía) | ≥ 300 (≥ 4 por guía) | cumple |
| Preguntas fuera de tema | 9 | 65 | ≥ 60 | cumple |
| Conjunto «fuera del corpus» | no existe | 45, 100 % sin extracto de relevancia alta | ≥ 40, ≥ 90 % sin extracto de relevancia alta | cumple |
| recall@3 | 100 % | 100 % (330 preguntas) | ≥ 97 % | cumple |
| recall@1 | 90,7 % | 92,1 % | ≥ 90 % | cumple |
| MRR | 0,952 | 0,959 | ≥ 0,93 | cumple |
| Fuera de tema sin guías | 100 % | 100 % | 100 % | cumple |
| p95 de búsqueda | 2,85 ms | 1,4 ms | ≤ 10 ms | cumple |
| Construcción del índice | no medido | ≈ 110–130 ms | ≤ 300 ms | cumple |
| Evaluación de respuestas sin red (casos) | no existe | 154 (12 omitidos) | ≥ 150 con 6 métricas | cumple |
| · referencias inventadas eliminadas | no medido | 100 % | 100 % | cumple |
| · cifras plantadas detectadas | no medido | 100 % (58/58) | ≥ 95 % | cumple |
| · falsos positivos del verificador | no medido | 0 % (0/124) | ≤ 5 % | cumple |
| · sin respaldo → abstención o marca | no medido | 100 % | 100 % | cumple |
| · salidas rotas que no rompen | no medido | 100 % | 100 % | cumple |
| · propuestas seguras | no medido | 100 % | 100 % | cumple |
| Evaluación de respuestas en vivo | no existe | bloqueada | ≥ 60 casos | bloqueada: requiere humano |
| Medicamentos en el diccionario | 170 | 170 | ≥ 250 | pendiente |
| Instantánea de fichas técnicas | 0 % | 0 % | ≥ 90 % del diccionario | bloqueada: requiere humano |
| Cifras «de memoria» corregidas, verificadas o retiradas | 0 | 22 | todas las marcadas | en curso |
| Graph `npm test` | verde | verde | verde | cumple |
| Web lint / typecheck / tests / build | 0 errores / limpio / 908 / OK | 0 errores / limpio / 908 / OK | verde | cumple |
| E2E Playwright del chat | no existe | no existe | 5 escenarios | pendiente |
| Tokens de entrada del chat (mediana) | no medido | no medido | ≤ 6 000 | pendiente |
| `guidelines.corpus.json` | 570 KB | ≈ 570 KB | ≤ 2 MB | cumple |
| Llamadas al modelo por pregunta | 1 | 1 | 1 | cumple |

## Backlog priorizado

1. **Exactitud clínica:** seguir con las cifras «Pendiente» de `knowledge/guias-clinicas/PENDIENTES-REVISION.md` (citología/ADN-VPH de la Res. 3280, ISPAD, anticoncepción, apendicitis, piel y tejidos blandos, alcohol, opioides, osteoporosis, síncope). Alternar con el resto para no frenar las metas.
2. **Corpus:** 19+ guías nuevas de la lista prioritaria (crecimiento y desarrollo, PAI, lactancia, sangrado del primer trimestre, diabetes gestacional, hepatitis B y C, parasitosis, escabiosis, dermatitis atópica, ojo rojo, lesión renal aguda, electrolitos, pancreatitis y colecistitis, cirrosis, meningitis, tos ferina, leishmaniasis, Chagas, leptospirosis, accidente ofídico, rabia, organofosforados, quemaduras). Cada guía nueva entra con ≥ 4 preguntas en `rag-eval.json`; al agregarla, sacar del conjunto «fuera del corpus» las preguntas que pase a cubrir.
3. **Fichas:** diccionario a ≥ 250 principios activos con pruebas de detección.
4. **Funcionamiento:** E2E con Playwright del chat (v1, abstención, fuentes guía + ficha, cifras sin fuente, aplicar propuesta).
5. **Optimización:** script que mida los tokens de entrada del chat (mediana ≤ 6 000).

## Hecho

- **Iteración 1 (2026-10-09):** archivo de estado y `PENDIENTES-REVISION.md`. Exactitud clínica: potasio en CAD corregido al consenso 2024 (10–20 mmol, no 20–30); atribuciones de PaCO2 y del plazo de 72 h en posparo corregidas; mamografía confirmada con la Res. 276 de 2019; edades y periodicidad colombianas de FIT y PSA retiradas por no verificables.

- **Iteración 2 (2026-10-09):** exactitud clínica. Desnutrición: Res. 115 de 2026 verificada (riesgo Z > −2 y < −1, F-100 obligatorio en hospital y ambulatorio, egreso ampliado) y Sivigila evento 113 confirmado; retirada la «fórmula de inicio» atribuida a la Res. 115. Hemorragia posparto: tabla del Código Rojo verificada y corregida (moderado 70–79 mmHg); retiradas las cifras de la fila «compensado» y los cortes de signos vitales de la guía OMS 2025, no confirmados.

- **Iteración 3 (2026-10-09):** calidad de respuesta. Nuevo `scripts/eval-assistant-answers.js` (en `npm test`, `npm run eval:answers`): servicio real con modelo falso y salidas grabadas, 44 casos escritos a mano más 2 por guía. La primera corrida encontró dos fallas reales del verificador y se corrigieron: (1) una cifra inventada pasaba por buena si aparecía en una guía recuperada pero NO citada (ahora solo cuentan las fuentes citadas y la consulta); (2) una cifra del título de la sección del extracto se marcaba como falsa (ahora el título cuenta como evidencia). Además, el verificador entiende «g/kg». Resultado: cifras plantadas detectadas 96,6 % → 100 %, falsos positivos 0,8 % → 0 %.

- **Iteración 4 (2026-10-09):** retrieval. `rag-eval.json` pasó de 86 a 330 preguntas (≥ 4 por guía), de 9 a 65 fuera de tema, y se creó el conjunto «fuera del corpus» (45 preguntas médicas sin guía). La primera corrida bajó a recall@1 87,0 %, recall@3 94,8 %, fuera de tema 89,2 % y fuera del corpus 86,7 %; se corrigió la causa, no los umbrales: (1) palabras de la app («carga», «soporte», «pantalla», «blanco», «hora»), de población («niño», «hombre») y de cualquier pregunta médica («diagnóstico», «síndrome») pasan a genéricas; (2) 75 sinónimos coloquiales nuevos (406 en total); (3) sinónimos compilados una vez por mapa, que bajó la construcción del índice de ~390 ms a ~120 ms. Dos preguntas «fuera del corpus» se reemplazaron porque sí tienen guía (mononucleosis está en faringoamigdalitis; la hipoacusia súbita es signo de alarma en vértigo), y la úlcera genital acepta sífilis o ITS.

- **Iteración 5 (2026-10-09):** exactitud clínica. Ocho cifras verificadas o corregidas con búsqueda web (14 → 22). Anafilaxia: NICE NG258 (mayo de 2026) reemplazó a CG134; se retiró la observación de 6 a 12 h de CG134 y quedó la observación escalonada del Resuscitation Council UK 2021 (2, 6 y 12 h) que NG258 adoptó. Sífilis en la gestante: corregida la regla de la CDC 2021 (repetir el esquema si pasan más de 9 días entre dosis, no «si se pierde una»). Gota (colchicina 1 mg + 0,5 mg, prednisolona 30–35 mg por 3–5 días), malaria (cloroquina 10 / 7,5 / 7,5 mg/kg) y hemorragia digestiva (aspirina en 3–5 días según ESGE 2021, dosis de vasoactivos) quedan verificadas con fuentes secundarias. Métricas sin cambios fuera de esa; `npm test` de Graph y lint, typecheck y 908 pruebas de la web en verde.

## Decisiones

- La verificación de cifras se hace con búsqueda web; los sitios oficiales no son alcanzables desde el sandbox. Una cifra se corrige con al menos dos fuentes secundarias concordantes; si no hay ninguna, se retira y queda en `PENDIENTES-REVISION.md`.
- `revisado_por` nunca lo llena el loop.
- El conjunto «fuera del corpus» solo lleva temas que de verdad no están en ninguna guía (ni en `palabras_clave` ni como signo de alarma). Cuando una guía nueva cubre uno, la pregunta sale de ese conjunto y pasa a las preguntas con guía esperada.
- Las palabras de población no identifican el tema: la población la decide `inferPopulations` y pesa como boost, no como término.
- Las cifras de la respuesta se verifican solo contra las fuentes que la respuesta cita y la consulta. Más estricto que «cualquier extracto recuperado», alineado con el prompt v4 (cada cifra sale de una fuente citada o de la consulta).

## Requiere humano

- **Revisión médica** de las 61 guías, empezando por lo marcado «Pendiente» en `knowledge/guias-clinicas/PENDIENTES-REVISION.md`.
- **Clave de modelo para la evaluación en vivo:** no hay `MIRACLE_ASSISTANT_LLM_API_KEY` en el sandbox. Bloqueada: requiere humano.
- **CIMA:** el proxy del sandbox responde 403 a `cima.aemps.es` (`npm run check:cima` falla en ~90 ms). Correr `npm run check:cima` en el entorno de Graph y, si responde, `npm run build:drug-labels` desde una máquina con red. Bloqueada: requiere humano.
