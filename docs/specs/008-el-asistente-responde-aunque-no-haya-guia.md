# 008 — El asistente responde aunque no haya guía, y contesta «¿qué hago con este caso?»

Estado: **implementado** (2026-10-16) · Lo pide el dueño el 2026-10-16 · Rama: `feat/asistente-responde-sin-guias` (espejo de ZevCorp/Miracle, spec 020)

El dueño pidió tres cosas:

- que el asistente conteste bien aunque no encuentre guía, pensando más en esos casos;
- que conteste «¿qué hago con este caso?» leyendo la consulta;
- que el porcentaje de «no sé» no pase del 20 %, y ojalá sea cero.

La spec 007 hizo que el prompt vaya vacío cuando el tema no tiene guía (veto de la cabeza léxica). Pero el prompt v6 trataba la falta de guía casi como motivo para abstenerse, y las preguntas de dosis difíciles terminaban en «no puedo» aunque la respuesta tuviera contenido útil.

## Diagnóstico: qué se midió

La medición usa `eval-assistant-abstention.js` con 48 preguntas: 15 casos con la consulta cargada, 15 temas sin guía, 10 preguntas con guía y 8 cifras difíciles. Las respuestas son de un modelo sustituto (Claude Haiku actuando como el modelo de producción, sin saber qué se mide), sobre los mensajes reales del prompt.

| Qué | Prompt v6 (antes) | Fuente |
|---|---|---|
| «No sé» (respaldo «insuficiente» o negativa sin contenido) | 12,5 % (6/48); en cifras difíciles 50 %; incluso 1 con guía (H. pylori) | `eval-assistant-abstention.js` |
| Preguntas de caso con protocolo («¿qué hago?») | no existía: el prompt no tenía instrucción de caso | `ClinicalAssistantPromptBuilder.js` |
| Razonamiento antes de responder | no: una sola salida de 1 800 tokens para todo | `ClinicalAssistantService.js` |
| JSON cortado | mostraba el texto crudo del modelo | `ClinicalAssistantResponseParser.js` |

**Resultado (prompt v7, mismo modelo sustituto, mismas 48 preguntas):**

- «No sé» baja de 12,5 % a **0 %**: casos 6,7 → 0 %, con guía 10 → 0 %, cifras difíciles 50 → 0 %.
- Las cifras difíciles siguen sin inventarse:
  - las cifras sin respaldo por respuesta son 0,25, igual que antes;
  - en vez de «no puedo», la respuesta dice cómo se decide la dosis y lleva la cifra que falta a «faltantes».
- En casos y temas sin guía, las cifras sin respaldo por respuesta suben de 1,2 a 1,9, porque las respuestas son más completas. El verificador las marca todas para el médico.
- Respuesta mediana: de 1 352 a 1 551 caracteres.
- Los mismos 15 casos se responden con el protocolo de caso.

## Promesas

| # | Promesa | Juez |
|---|---|---|
| 801 | Sobre al menos 40 preguntas reales de consulta (casos con la consulta cargada, temas sin guía, preguntas con guía y cifras difíciles), con las respuestas grabadas del prompt vigente, el asistente dice «no sé» en el 5 % o menos, devuelve JSON válido en el 100 % y su razonamiento interno nunca llega al médico | `verify-asistente-responde-sin-guias.js` |
| 802 | Una pregunta de caso («¿qué hago con este paciente?») o una pregunta clínica sin guía va en modo razonado (protocolo de caso, razonamiento previo, 3 500 tokens de salida); una pregunta con guía, la charla y las preguntas de la app van en modo directo | `verify-asistente-responde-sin-guias.js` |
| 803 | Sin guías recuperadas el prompt pide responder con la consulta y el conocimiento general marcado, y «insuficiente» queda solo para cuando no hay nada clínico que aportar | `verify-asistente-responde-sin-guias.js` |
| 804 | El razonamiento interno no llega al médico ni cuando la respuesta del modelo llega cortada: se rescata el texto de "respuesta" o se avisa que llegó incompleta | `verify-asistente-responde-sin-guias.js` |
| 805 | Una cita agrupada («[G1; G3]») cuenta como las citas que agrupa: sus fuentes se declaran y las inventadas se borran | `verify-asistente-responde-sin-guias.js` |

Lo que no cambia, y lo siguen juzgando las mismas promesas:

- Una cifra sin respaldo en las fuentes se marca para el médico: 603 de la spec 006.
- Una sola llamada al modelo y la mediana de tokens de entrada ≤ 6 000: 607. El protocolo de caso y el campo de razonamiento solo entran en modo razonado, para que el prompt de una pregunta simple no crezca.

## Las fases

| Fase | Promesa que pone verde | Qué toca | Sitios con esta clase de error |
|---|---|---|---|
| 1 | 803 | prompt del chat v7: abstención reescrita y aviso de «sin guías» | — |
| 2 | 802 | `answerDepth` en el servicio, protocolo de caso y contrato con "razonamiento" | — |
| 3 | 804 | `fallbackAnswer` en el parser | — |
| 4 | 801 | `eval-assistant-abstention.js`, fixture y respuestas grabadas | — |
| 5 | 805 | `GROUPED_REFS` en el parser (las respuestas grabadas citaban «[G1; G3]») | 1: el parser es el único sitio que resuelve citas |

## Lo que NO entra

- La medida con el modelo real de producción. El script tiene `--live`: con `MIRACLE_ASSISTANT_LLM_API_KEY` mide el modelo configurado con las mismas preguntas y el mismo umbral. Sin clave en el sandbox, la medida es con un modelo sustituto y puede diferir del modelo de producción.
- Mostrar el razonamiento al médico: es borrador del modelo, no una respuesta revisada.

## Cierre

- [x] `npm test` → `CONTRATO INTACTO`
- [x] Cada promesa se vio en rojo: las cinco con el prompt y el parser de `main` (v6), y la 801 además con las respuestas del prompt v6 (12,5 % de «no sé» > 5 %) y con las de la primera versión de v7, que el guardián de huella del prompt rechazó por ser de otro texto
- [ ] Medido con el modelo real (`--live`, requiere la clave del modelo).
- [x] Estado de este documento: **implementado** (2026-10-16)
