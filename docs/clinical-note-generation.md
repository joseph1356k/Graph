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

`ClinicalNotePromptBuilder.build({ transcript, templateSnapshot })` produce dos mensajes:

**System** (reglas fijas):
- Rol: "Miracle Clinical Note Generator", notas en español.
- Reglas de NO invención: solo información explícita de la transcripción; prohibido inventar signos vitales, examen físico, antecedentes, medicamentos, dosis, laboratorios o diagnósticos confirmados.
- Prudencia diagnóstica: impresión en términos de probabilidad, "pendiente de criterio médico".
- Frases prudentes obligatorias cuando falta información: `"No referido."`, `"No mencionado en la consulta."`, `"No documentado en la transcripción."`
- Estructura: devolver SOLO JSON; `sections` con exactamente las keys/labels/orden de la plantilla; `confidence` 0–1; `evidence` como cita textual breve; `warnings` y `missing_required_sections`.
- Lista numerada de las secciones del snapshot con su instrucción individual (la instrucción de cada sección viaja en el prompt).

**User** (payload JSON): `{ task, template: {name, specialty, sections}, transcript, expected_schema }`.

La llamada usa `chatExpectingJson(messages, { type: 'json_object' })` del `LLMProvider` existente, que fuerza salida JSON en los tres proveedores soportados.

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

## Nota editada por el médico (sin LLM)

`PUT /api/clinical/encounters/:id/note` usa `validateEditedNote`, que es **estricta** (no repara): exige exactamente las keys del snapshot (faltante, extra o duplicada → `NOTE_JSON_INVALID`), `content` string por sección y `summary` string. `label`/orden se restauran del snapshot, `confidence` ausente se asume 1. Deja el encounter `completed`.

## Caso de prueba canónico

Transcripción de referencia (cefalea de 3 días) en [scripts/verify-clinical-workflow.js](../scripts/verify-clinical-workflow.js); resultado esperado: identificación "paciente sin identificar", examen físico "No mencionado en la consulta.", impresión diagnóstica prudente y plan con las recomendaciones dictadas — sin inventar examen físico, signos vitales, medicamentos ni diagnósticos definitivos.

## Limitaciones actuales

- La generación es sincrónica (una llamada LLM por request); transcripciones muy largas dependen del límite de contexto del modelo configurado.
- No hay verificación automática de que `evidence` sea cita literal de la transcripción (el prompt lo exige; el médico revisa).
- No hay versionado histórico de notas (cada guardado sobreescribe `note_json`; el estado anterior no se archiva).
- No hay integración con HIS/EMR/GIS externos (fuera de alcance en esta fase, por diseño).
- `confidence` es autoreportada por el modelo (clampeada); no es una probabilidad calibrada.
