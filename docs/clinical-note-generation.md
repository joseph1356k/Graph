# Generación de Notas Clínicas — Diseño

Cómo el backend convierte `transcript + template_snapshot` en `note_json` estructurado.

> La plantilla NO es la nota. La plantilla es el molde. La transcripción es la materia prima.

## Piezas

| Módulo | Responsabilidad |
|---|---|
| [ClinicalNotePromptBuilder](../src/application/use-cases/ClinicalNotePromptBuilder.js) | Construye los mensajes system/user con reglas estrictas |
| [ClinicalNoteGeneratorService](../src/application/use-cases/ClinicalNoteGeneratorService.js) | Orquesta: carga encounter, llama LLM, valida, persiste |
| [ClinicalNoteValidationService](../src/application/use-cases/ClinicalNoteValidationService.js) | Valida y repara la salida del LLM contra el snapshot |
| [LLMProvider](../src/infrastructure/LLMProvider.js) | Proveedor existente (OpenAI / OpenRouter / Azure Foundry) con `response_format: json_object` |

## template_snapshot: la fuente de verdad

- Al crear un encounter (`POST /api/clinical/encounters`), el backend copia la plantilla completa dentro del encounter (`template_snapshot`): `template_id`, `name`, `specialty`, `sections` (key/label/order/required/instruction) y `snapshot_at`.
- `generate-note` SIEMPRE usa `template_snapshot`, nunca la plantilla actual. Editar o archivar la plantilla después no cambia consultas ya creadas.
- El snapshot también gobierna la validación de la nota editada por el médico (`PUT /note`).

## Construcción del prompt

`ClinicalNotePromptBuilder.build({ transcript, templateSnapshot, doctor })` produce dos mensajes (`doctor` es opcional: la preferencia de extensión del médico, ver abajo):

**System** (reglas fijas):
- Rol: "Miracle Clinical Note Generator", notas en español.
- Reglas de NO invención: solo información explícita de la transcripción; prohibido inventar signos vitales, examen físico, antecedentes, medicamentos, dosis, laboratorios o diagnósticos confirmados.
- Reglas de fidelidad al dictado (siempre): escribir con las palabras del médico, conservar el orden en que enunció los datos, no resumir ni recortar, no agregar conectores ni frases de relleno. "Redactar" = repartir el dictado en las secciones correctas y aplicar la puntuación dictada.
- Reglas de puntuación dictada: signos dictados como palabras ("coma", "punto y aparte", "abre paréntesis"…) y el signo `x` entre medidas ("tres por cuatro centímetros" → `3 x 4 cm`).
- Modo literal cuando aplica (ver abajo).
- Preferencia de extensión del médico cuando aplica (ver abajo): bloque `PREFERENCIA DE EXTENSIÓN DEL MÉDICO`, entre el modo literal y las reglas de estructura.
- Prudencia diagnóstica: impresión en términos de probabilidad, "pendiente de criterio médico".
- Frases prudentes obligatorias cuando falta información: `"No referido."`, `"No mencionado en la consulta."`, `"No documentado en la transcripción."`
- Estructura: devolver SOLO JSON; `sections` con exactamente las keys/labels/orden de la plantilla; `confidence` 0–1; `evidence` como cita textual breve; `warnings` y `missing_required_sections`.
- Lista numerada de las secciones del snapshot con su instrucción individual (la instrucción de cada sección viaja en el prompt); las secciones literales llevan la marca `· LITERAL`.

**User** (payload JSON): `{ task, fidelity: {mode, reason, verbatim_sections}, note_detail?, template: {name, specialty, sections}, transcript, expected_schema }` (`note_detail` solo viaja cuando la preferencia se aplicó).

La llamada usa `chatExpectingJson(messages, { type: 'json_object' })` del `LLMProvider` existente, que fuerza salida JSON en los tres proveedores soportados.

## Modo literal (especialidades de reporte)

En patología, radiología y demás áreas de informe el médico dicta la nota tal cual: reordenar, parafrasear o recortar el dictado se lee como un error de la herramienta. Para eso el prompt tiene un **modo literal** que se activa solo (el médico no configura nada) y añade un bloque de reglas duras: copiar palabra por palabra y en el mismo orden, conservar cifras/unidades/rótulos/nomenclatura (CIE, TNM, Bethesda, Gleason, BI-RADS, HGVS…) sin normalizar formatos, no reordenar enumeraciones, no fusionar ni dividir oraciones, no completar frases ni corregir términos técnicos, no mover datos entre casillas. La única transformación permitida sigue siendo la puntuación dictada (incluido el signo `x` entre medidas).

Se activa por cualquiera de estas vías:

| Vía | Dónde | Efecto |
|---|---|---|
| Especialidad de la plantilla | `template_snapshot.specialty` en `ClinicalNotePromptBuilder.DEFAULT_VERBATIM_SPECIALTIES` | Toda la plantilla es literal |
| Variable de entorno | `CLINICAL_VERBATIM_SPECIALTIES` (lista separada por comas) | Agrega especialidades a la lista base sin tocar código |
| Plantilla completa | `template_snapshot.verbatim === true` | Toda la plantilla es literal |
| Casilla individual | `section.verbatim === true` | Solo esa sección es literal; el resto sigue las reglas generales |

Lista base: `patologia`, `anatomia_patologica`, `patologia_clinica`, `histopatologia`, `dermatopatologia`, `citologia`, `citopatologia`, `radiologia`, `imagenes_diagnosticas`, `radiologia_e_imagenes_diagnosticas`, `medicina_nuclear`, `laboratorio_clinico`, `genetica`, `genetica_medica`, `medicina_legal`. La comparación normaliza tildes, mayúsculas y guiones (`"Patología"`, `"anatomía-patológica"` → coinciden).

`verbatim` viaja como campo de cada sección: se normaliza en `ClinicalTemplateService.normalizeSections`, se congela en `ClinicalEncounterService.buildTemplateSnapshot` y llega al prompt. Una casilla `verbatim` sin instrucción propia recibe una instrucción por defecto que manda copiar el dictado en lugar de redactarlo.

Cobertura: [scripts/verify-note-fidelity.js](../scripts/verify-note-fidelity.js) (`npm run test:note-fidelity`).

## Preferencia de extensión (note_detail)

El médico elige en la web (Configuración > General) qué tan extensa quiere la nota: `concisa`, `estandar` o `detallada`. Llega en el cuerpo de `generate-note` como `{ doctor: { note_detail } }` y `ClinicalNotePromptBuilder` la convierte en un bloque del system prompt, colocado después del modo literal y antes de las reglas de estructura.

| Valor | Efecto en el prompt |
|---|---|
| `estandar` (o ausente / inválido) | Nada. El prompt es byte a byte el de siempre y el JSON de usuario no lleva `note_detail`. |
| `concisa` | Estilo telegráfico de historia clínica: frases cortas, sin narrativa de conversación. Se acorta la forma, nunca la información: cada dato dictado o escrito va completo y por separado; "concisa" no es "más técnica" ni siglas que el médico no usó; ante la duda se quitan palabras, no datos. `summary` en una o dos frases. |
| `detallada` | Oraciones completas con todo el contexto que sí se expresó (cronología, características, agravantes/atenuantes, negativos y hallazgos normales uno por uno). Más completa, no más adornada: sin conectores de relleno, sin plantillas de "examen físico normal" en aparatos no explorados; lo no mencionado sigue fuera. `summary` en un párrafo breve. |

Reglas de convivencia:

- El encabezado del bloque acota su alcance a la FORMA: nunca relaja las reglas de no invención, de fidelidad al dictado ni de puntuación dictada, ni el formato JSON.
- Plantilla literal completa (especialidad de informe o `verbatim: true`): la preferencia se apaga entera, `summary` incluido (`resolveNoteDetail` devuelve `{ requested, effective: 'estandar' }`). Literal parcial: el bloque se emite y excluye explícitamente las secciones literales.
- Saneo: `ClinicalNotePromptBuilder.sanitizeDoctor` acepta un solo campo y un enum cerrado; strings sueltos, mayúsculas, espacios o saltos de línea se descartan. Lo inválido nunca responde 400.
- El rescate automático (`NoteGenerationRescueService`) no tiene la preferencia y regenera en estándar. Seguimiento posible: leer `user_preferences.note_detail` por `encounter.doctor_id` con service role.
- El log de generación añade `extensión concisa|detallada` (o `… ignorada por plantilla literal`), nunca contenido.

Cobertura: [scripts/verify-note-fidelity.js](../scripts/verify-note-fidelity.js) (bloque, orden, saneo, literal) y [scripts/verify-clinical-workflow.js](../scripts/verify-clinical-workflow.js) (llega por HTTP al system prompt, no se pega entre peticiones).

## Validación y reparación post-LLM

`ClinicalNoteValidationService.validateAndRepair(parsed, templateSnapshot)` garantiza el contrato aunque el modelo falle:

| Problema del modelo | Reparación |
|---|---|
| Respuesta no es objeto JSON | Se reconstruye nota vacía prudente + warning |
| Sección omitida | Se inserta `{ content: "No mencionado en la consulta.", confidence: 0, evidence: "" }` + warning |
| Sección extra | Se ignora (+ warning informativo) |
| `key` o `label` alterados | Se corrigen desde el snapshot (match por key y fallback por label) |
| Orden alterado | Se restaura el orden del snapshot |
| `content` vacío | Frase prudente + confidence 0 + warning |
| `confidence` inválida o fuera de rango | Clamp a [0,1]; ausente → 0.5; secciones "no mencionadas" → 0 |
| `evidence` no string | `""` |
| `summary` ausente | Placeholder mínimo + warning |
| `warnings` del modelo | Se conservan y se concatenan con los de la reparación (tope 20) |

`missing_required_sections` se **recalcula siempre** en backend: secciones con `required: true` cuyo contenido quedó vacío o en frase prudente. No se confía en la lista del modelo.

Límites defensivos: summary ≤ 2000 chars, content ≤ 8000, evidence ≤ 500.

## Ciclo de estados y errores

1. `generate-note` valida: encounter propio, transcript no vacío (`TRANSCRIPT_REQUIRED`), snapshot con secciones (`TEMPLATE_INVALID`), LLM configurado (`LLM_NOT_CONFIGURED`).
2. Marca `status: note_generating`.
3. Llama LLM → parsea → repara → guarda `note_json` y `status: note_generated`.
4. Si algo falla: marca `status: failed` (best-effort) y responde `502 NOTE_GENERATION_FAILED` sin detalles internos. Se puede reintentar (regeneración permitida).

## Privacidad (PHI)

- Nunca se registran en logs transcripciones ni contenido de notas: solo ids, conteos de secciones y warnings.
- Los mensajes de error al frontend no incluyen contenido clínico ni stack traces.
- Datos clínicos viven solo en Supabase (`clinical_encounters`), con RLS por médico y acceso del backend vía service role (server-only).

## Medir si la IA acierta

`generate-note` guarda la nota **dos veces**: en `note_json` (la nota viva, que el médico edita) y en `note_json_ai` (congelada, más `note_generated_at`). El repositorio solo acepta escribir `note_json_ai` desde la generación: `PUT /note` nunca la manda, así que la versión original no se puede pisar.

Con eso, la vista `public.clinical_note_edit_stats` responde la única pregunta que dice si un prompt sirve: **cuánto tiene que corregirle el médico a la IA, por especialidad**. Devuelve conteo de notas, cuántas se editaron y el cambio medio en porcentaje — solo longitudes y conteos, nunca contenido clínico.

Ojo: los datos empiezan a acumularse **desde el despliegue**; no hay nada retroactivo, porque antes la versión de la IA simplemente se perdía.

## Mantenimiento automático

El cron diario (`/api/internal/maintenance/daily`, 07:00 Bogotá) hace dos cosas:

1. **Limpia consultas abandonadas** con `purge_abandoned_encounters(dias)`: borra las que se crearon y nunca se usaron (sin transcripción, sin nota, sin versión IA). Una consulta con cualquier contenido del médico **nunca** se borra sola.
2. **Avisa por correo** ([SystemHealthAlertService](../src/application/use-cases/SystemHealthAlertService.js)) si hay notas fallidas, consultas atascadas, exportaciones trabadas o el proveedor de IA sin configurar. Solo escribe cuando hay algo que contar: un correo diario que siempre dice "todo bien" se deja de leer.

La ruta exige `CRON_SECRET`; sin él responde 503 en vez de quedar abierta. Cobertura: [scripts/verify-health-alerts.js](../scripts/verify-health-alerts.js) (`npm run test:health-alerts`).

## Nota editada por el médico (sin LLM)

`PUT /api/clinical/encounters/:id/note` usa `validateEditedNote`, que es **estricta** (no repara): exige exactamente las keys del snapshot (faltante, extra o duplicada → `NOTE_JSON_INVALID`), `content` string por sección y `summary` string. `label`/orden se restauran del snapshot, `confidence` ausente se asume 1. Deja el encounter `completed`.

## Caso de prueba canónico

Transcripción de referencia (cefalea de 3 días) en [scripts/verify-clinical-workflow.js](../scripts/verify-clinical-workflow.js); resultado esperado: identificación "paciente sin identificar", examen físico "No mencionado en la consulta.", impresión diagnóstica prudente y plan con las recomendaciones dictadas — sin inventar examen físico, signos vitales, medicamentos ni diagnósticos definitivos.

## Limitaciones actuales

- La generación es sincrónica (una llamada LLM por request); transcripciones muy largas dependen del límite de contexto del modelo configurado.
- No hay verificación automática de que `evidence` sea cita literal de la transcripción (el prompt lo exige; el médico revisa).
- No hay versionado histórico completo: cada guardado sobreescribe `note_json`. Sí se conserva **la versión de la IA** (`note_json_ai`, congelada en la generación), así que se puede medir cuánto corrige el médico — pero no las ediciones intermedias.
- No hay integración con HIS/EMR/GIS externos (fuera de alcance en esta fase, por diseño).
- `confidence` es autoreportada por el modelo (clampeada); no es una probabilidad calibrada.
