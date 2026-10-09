# Estado del loop del asistente clínico

Archivo de continuidad del loop autónomo. Cada iteración lo lee, mide, hace UNA tarea, y lo actualiza.
Repos: Graph `feat/asistente-contexto-rag` · Web `claude/clinical-assistant-rag-context-gitl2z`.

## Métricas

| Métrica | Línea base (2026-10-09) | Actual | Meta | Estado |
|---|---|---|---|---|
| Guías en el corpus | 61 | 80 | ≥ 80 | cumple |
| Preguntas de evaluación de retrieval | 86 | 483 (≥ 4 por guía) | ≥ 300 (≥ 4 por guía) | cumple |
| Preguntas fuera de tema | 9 | 65 | ≥ 60 | cumple |
| Conjunto «fuera del corpus» | no existe | 45, 100 % sin extracto de relevancia alta | ≥ 40, ≥ 90 % sin extracto de relevancia alta | cumple |
| recall@3 | 100 % | 100 % (483 preguntas) | ≥ 97 % | cumple |
| recall@1 | 90,7 % | 94,8 % | ≥ 90 % | cumple |
| MRR | 0,952 | 0,973 | ≥ 0,93 | cumple |
| Fuera de tema sin guías | 100 % | 100 % | 100 % | cumple |
| p95 de búsqueda | 2,85 ms | 1,8 ms | ≤ 10 ms | cumple |
| Construcción del índice | no medido | ≈ 110–125 ms | ≤ 300 ms | cumple |
| Evaluación de respuestas sin red (casos) | no existe | 192 (12 omitidos) | ≥ 150 con 6 métricas | cumple |
| · referencias inventadas eliminadas | no medido | 100 % | 100 % | cumple |
| · cifras plantadas detectadas | no medido | 100 % (77/77) | ≥ 95 % | cumple |
| · falsos positivos del verificador | no medido | 0 % (0/162) | ≤ 5 % | cumple |
| · sin respaldo → abstención o marca | no medido | 100 % | 100 % | cumple |
| · salidas rotas que no rompen | no medido | 100 % | 100 % | cumple |
| · propuestas seguras | no medido | 100 % | 100 % | cumple |
| Evaluación de respuestas en vivo | no existe | bloqueada | ≥ 60 casos | bloqueada: requiere humano |
| Medicamentos en el diccionario | 170 | 320 | ≥ 250 | cumple |
| Instantánea de fichas técnicas | 0 % | 0 % | ≥ 90 % del diccionario | bloqueada: requiere humano |
| Cifras «de memoria» corregidas, verificadas o retiradas | 0 | 41 | todas las marcadas | en curso |
| Graph `npm test` | verde | verde | verde | cumple |
| Web lint / typecheck / tests / build | 0 errores / limpio / 908 / OK | 0 errores / limpio / 908 / OK (reverificado en la iteración 12) | verde | cumple |
| E2E Playwright del chat | no existe | 5 escenarios en verde (`npm run test:e2e` en la web) | 5 escenarios | cumple |
| Tokens de entrada del chat (mediana) | no medido | 5 900 (p95 7 404; 21 preguntas en 3 consultas típicas; antes de optimizar, 7 424) | ≤ 6 000 | cumple |
| `guidelines.corpus.json` | 570 KB | 816 KB | ≤ 2 MB | cumple |
| Llamadas al modelo por pregunta | 1 | 1 | 1 | cumple |

## Backlog priorizado

1. **Exactitud clínica (única meta en curso):** quedan pocas «Pendiente» de la primera tanda: anticoncepción (efectividad por método, categorías OMS 2025), desnutrición (egreso de la Res. 115, dosis del libro de bolsillo OMS), AUDIT > 15 de NICE, reglas de conducción ESC, muy alto riesgo AACE, redacción de ISPAD 24–48 h y edades de BHOF 2022. Lo marcado como «contrastar con la fuente primaria» queda para el médico.
2. **Corpus (prioridad baja, la meta de 80 se cumple):** parto pretérmino, menopausia, sangrado uterino anormal, dermatitis atópica, ojo rojo, otitis externa, artrosis, tos ferina, varicela y sarampión, quemaduras.

## Hecho

- **Iteración 1 (2026-10-09):** archivo de estado y `PENDIENTES-REVISION.md`. Exactitud clínica: potasio en CAD corregido al consenso 2024 (10–20 mmol, no 20–30); atribuciones de PaCO2 y del plazo de 72 h en posparo corregidas; mamografía confirmada con la Res. 276 de 2019; edades y periodicidad colombianas de FIT y PSA retiradas por no verificables.

- **Iteración 2 (2026-10-09):** exactitud clínica. Desnutrición: Res. 115 de 2026 verificada (riesgo Z > −2 y < −1, F-100 obligatorio en hospital y ambulatorio, egreso ampliado) y Sivigila evento 113 confirmado; retirada la «fórmula de inicio» atribuida a la Res. 115. Hemorragia posparto: tabla del Código Rojo verificada y corregida (moderado 70–79 mmHg); retiradas las cifras de la fila «compensado» y los cortes de signos vitales de la guía OMS 2025, no confirmados.

- **Iteración 3 (2026-10-09):** calidad de respuesta. Nuevo `scripts/eval-assistant-answers.js` (en `npm test`, `npm run eval:answers`): servicio real con modelo falso y salidas grabadas, 44 casos escritos a mano más 2 por guía. La primera corrida encontró dos fallas reales del verificador y se corrigieron: (1) una cifra inventada pasaba por buena si aparecía en una guía recuperada pero NO citada (ahora solo cuentan las fuentes citadas y la consulta); (2) una cifra del título de la sección del extracto se marcaba como falsa (ahora el título cuenta como evidencia). Además, el verificador entiende «g/kg». Resultado: cifras plantadas detectadas 96,6 % → 100 %, falsos positivos 0,8 % → 0 %.

- **Iteración 4 (2026-10-09):** retrieval. `rag-eval.json` pasó de 86 a 330 preguntas (≥ 4 por guía), de 9 a 65 fuera de tema, y se creó el conjunto «fuera del corpus» (45 preguntas médicas sin guía). La primera corrida bajó a recall@1 87,0 %, recall@3 94,8 %, fuera de tema 89,2 % y fuera del corpus 86,7 %; se corrigió la causa, no los umbrales: (1) palabras de la app («carga», «soporte», «pantalla», «blanco», «hora»), de población («niño», «hombre») y de cualquier pregunta médica («diagnóstico», «síndrome») pasan a genéricas; (2) 75 sinónimos coloquiales nuevos (406 en total); (3) sinónimos compilados una vez por mapa, que bajó la construcción del índice de ~390 ms a ~120 ms. Dos preguntas «fuera del corpus» se reemplazaron porque sí tienen guía (mononucleosis está en faringoamigdalitis; la hipoacusia súbita es signo de alarma en vértigo), y la úlcera genital acepta sífilis o ITS.

- **Iteración 5 (2026-10-09):** exactitud clínica. Ocho cifras verificadas o corregidas con búsqueda web (14 → 22). Anafilaxia: NICE NG258 (mayo de 2026) reemplazó a CG134; se retiró la observación de 6 a 12 h de CG134 y quedó la observación escalonada del Resuscitation Council UK 2021 (2, 6 y 12 h) que NG258 adoptó. Sífilis en la gestante: corregida la regla de la CDC 2021 (repetir el esquema si pasan más de 9 días entre dosis, no «si se pierde una»). Gota (colchicina 1 mg + 0,5 mg, prednisolona 30–35 mg por 3–5 días), malaria (cloroquina 10 / 7,5 / 7,5 mg/kg) y hemorragia digestiva (aspirina en 3–5 días según ESGE 2021, dosis de vasoactivos) quedan verificadas con fuentes secundarias. Métricas sin cambios fuera de esa; `npm test` de Graph y lint, typecheck y 908 pruebas de la web en verde.

- **Iteración 6 (2026-10-09):** corpus, 61 → 67 guías: lesión renal aguda, hiponatremia e hiperpotasemia, pancreatitis y colecistitis, cirrosis y complicaciones, meningitis bacteriana y hepatitis B y C. Seis agentes en paralelo, cada cifra verificada con búsqueda web (150 cifras con fuente; 72 descartadas por no poder verificarlas o por fuentes discordantes; lo que falta contrastar con la fuente primaria quedó en `PENDIENTES-REVISION.md`). Evaluación: 381 preguntas (51 nuevas). Las guías nuevas competían con las viejas (hipoglucemia, «falla renal», «dolor de espalda de años»); se corrigió con sinónimos de clase (AINE, IECA, diuréticos), «aparente» como genérica, síntomas de hipoglucemia en su guía (ADA) y un boost ×1.1 por frase clave completa (se probaron 1,05 a 1,2; 1,1 es el único que no baja nada en las 330 preguntas anteriores). Antes → después: recall@1 92,1 → 92,4 %, recall@3 100 → 100 %, MRR 0,959 → 0,959, respuestas sin red 154 → 166 casos, corpus 570 → 649 KB.

- **Iteración 7 (2026-10-09):** corpus, 67 → 73 guías: accidente ofídico, mordeduras y profilaxis de rabia, leptospirosis, leishmaniasis, enfermedad de Chagas e intoxicación por organofosforados (103 cifras con fuente textual; 67 descartadas, sobre todo tablas de viales de antiveneno y umbrales que las fuentes daban distinto). Las guías tropicales le quitaban el primer lugar a malaria y a hiponatremia en preguntas viejas; se corrigió con dos mejoras del índice: valores de laboratorio en la pregunta («sodio de 127» → hiponatremia) y tema del seguimiento corto (×1.25 a la guía de los términos más raros de la pregunta anterior), más sinónimos del patrón de fiebre de la malaria. Antes → después: recall@1 92,4 → 93,6 %, recall@3 100 → 100 %, MRR 0,959 → 0,966; respuestas sin red 166 → 178 casos; `verify-guideline-index` 96 → 104.

- **Iteración 8 (2026-10-09):** corpus, 73 → 80 guías (meta cumplida): crecimiento y desarrollo, vacunación PAI y del adulto, lactancia materna, sangrado del primer trimestre, diabetes gestacional, parasitosis intestinal, escabiosis y pediculosis (145 cifras con fuente textual; 78 descartadas). Las guías de embarazo declaraban también «adultos» y ganaban preguntas de diabetes general: ahora declaran solo gestantes y una guía de población especial baja ×0.85 si la pregunta no nombra la población; «IMC de 36» se lee como obesidad; «bajo/alto» y «pecho» pasan a genéricos. La construcción del índice había subido a ~205–280 ms con 80 guías (cerca del límite de 300): las frases de sinónimos se indexan ahora por su primera palabra y bajó a ~120 ms. Antes → después: recall@1 93,6 → 94,8 %, recall@3 100 → 100 %, MRR 0,966 → 0,973, respuestas sin red 178 → 192 casos.

- **Iteración 9 (2026-10-09):** fichas técnicas. El diccionario cerrado pasa de 170 a 320 principios activos (DCI en español, como en CIMA, con nombres colombianos): antiinfecciosos de las guías nuevas, urgencias y anestesia, cardiovasculares, insulinas y antidiabéticos, obstetricia y uso diario. La combinación gana a su componente y TAF no se confunde con TDF; no se usan siglas que chocan con el corpus (NAC) ni «calcio»/«potasio» solos. `verify-drug-labels` 13 → 14 (piso de 150 → 250 entradas). Revisadas las 593 preguntas de evaluación: ninguna detección nueva incorrecta. Retrieval y respuestas sin cambios (recall@1 94,8 %, MRR 0,973). CIMA sigue en 403.

- **Iteración 10 (2026-10-09):** exactitud clínica. 19 cifras de la primera tanda revisadas con búsqueda web (22 → 41): verificadas el tamizaje de cuello uterino de la Res. 3280/GPC 2014, potasio de 40 mmol/L en CAD pediátrica, WSES 3–5 días, piperacilina/tazobactam, dosis de abstinencia alcohólica y de prevención de recaídas, naloxona, reevaluación de opioides cada 2 semanas, calcio, vitamina D y edades de DXA; retiradas las edades e intervalo de VIA-VILI, la vancomicina «30 mg/kg/día en 2 dosis» y «2–3 L de agua y 10 g de sal». Métricas de retrieval y respuestas sin cambios. La construcción del índice midió una vez 273 ms dentro de `npm test` (fuera de él, 105–150 ms): se vigila.

- **Iteración 11 (2026-10-09):** funcionamiento (web). Prueba E2E con Playwright 1.56.1 (el que corresponde al Chromium del entorno): `npm run test:e2e` monta el `MedicalChat` real con Vite en `e2e/harness`, con sesión y navegación simuladas y la API en el mismo origen, e intercepta `/api/clinical/assistant/chat`. 5 escenarios en verde: v1 en texto plano, abstención, fuentes de guía y ficha con enlace (y el contexto sin identificadores), cifras sin fuente, aplicar una propuesta que cambia solo su sección. Web: lint 0 errores (24 avisos, como antes), typecheck limpio, 908 pruebas, build OK. Decisión D24 en la web. `graphify` no está instalado en el entorno: no se actualizó `graphify-out`.

- **Iteración 12 (2026-10-09):** optimización. Nuevo `scripts/measure-chat-tokens.js` (en `npm test`; `npm run measure:tokens`): servicio real con modelo falso sobre tres consultas típicas (crónicos 8 000 caracteres de transcripción, pediatría 5 000, prenatal 12 000; nota, códigos, paciente, dos turnos de historial; ficha técnica simulada del tamaño máximo en preguntas de medicamento). Primera medida: mediana 7 424 tokens. Tres cambios: (1) `selectForPrompt`, ≈ 5 000 caracteres de guías en el prompt, los dos mejores extractos siempre y después solo relevancia alta o media (→ 6 534); (2) prompt del chat v5 con las mismas reglas en forma compacta, 8 293 → 6 474 caracteres (→ 6 014); (3) con nota en el prompt, `contexto_consulta` lleva solo las keys obligatorias de la plantilla (→ 5 900). Evaluación de respuestas sin red y de retrieval idénticas (192 casos, 6 métricas en 100 % y 0 % de falsos positivos; recall@1 94,8 %, MRR 0,973). `verify-guideline-index` 111 → 112, `verify-clinical-assistant` 44 → 45. CIMA sigue en 403 (un intento).

## Decisiones

- La verificación de cifras se hace con búsqueda web; los sitios oficiales no son alcanzables desde el sandbox. Una cifra se corrige con al menos dos fuentes secundarias concordantes; si no hay ninguna, se retira y queda en `PENDIENTES-REVISION.md`.
- `revisado_por` nunca lo llena el loop.
- El conjunto «fuera del corpus» solo lleva temas que de verdad no están en ninguna guía (ni en `palabras_clave` ni como signo de alarma). Cuando una guía nueva cubre uno, la pregunta sale de ese conjunto y pasa a las preguntas con guía esperada.
- Dos guías que traen la misma conducta (la sección de hipoglucemia de DM2 y la guía de crisis; el potasio en lesión renal aguda y en la guía de electrolitos) son ambas respuesta correcta en la evaluación.
- Las guías nuevas las redactan agentes con búsqueda web en tandas de 6, y yo integro: preguntas, consulta canónica, sinónimos y pendientes. Ninguna cifra sin fuente textual.
- El diccionario de medicamentos usa la DCI española (la que entiende CIMA) y guarda los nombres colombianos como alias; una sigla entra solo si no choca con el corpus.
- Las guías de embarazo o de recién nacidos declaran solo esa población; si la pregunta no nombra población, ceden ante la guía general.
- Las palabras de población no identifican el tema: la población la decide `inferPopulations` y pesa como boost, no como término.
- La transcripción no se recorta para ahorrar tokens: es la fuente primaria. El ahorro sale de las guías (selección para el prompt), de reglas repetidas en el prompt de sistema y de metadatos duplicados. La medida de tokens es conservadora (ficha técnica simulada del tamaño máximo) y usa 3,5 caracteres por token.
- Las cifras de la respuesta se verifican solo contra las fuentes que la respuesta cita y la consulta. Más estricto que «cualquier extracto recuperado», alineado con el prompt v4 (cada cifra sale de una fuente citada o de la consulta).

## Requiere humano

- **Revisión médica** de las 80 guías, empezando por lo marcado «Pendiente» en `knowledge/guias-clinicas/PENDIENTES-REVISION.md`.
- **Clave de modelo para la evaluación en vivo:** no hay `MIRACLE_ASSISTANT_LLM_API_KEY` en el sandbox. Bloqueada: requiere humano.
- **graphify:** el CLAUDE.md de la web pide `graphify update .` tras cambiar código, pero la herramienta no está instalada en el sandbox; correrlo donde esté instalada.
- **CIMA:** el proxy del sandbox responde 403 a `cima.aemps.es` (`npm run check:cima` falla en ~90 ms). Correr `npm run check:cima` en el entorno de Graph y, si responde, `npm run build:drug-labels` desde una máquina con red. Bloqueada: requiere humano.
