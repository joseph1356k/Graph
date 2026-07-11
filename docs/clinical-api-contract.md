# Contrato API Clínica — Miracle Backend

Motor de plantillas clínicas y notas estructuradas. La plantilla es el molde, la transcripción es la materia prima; el backend llena cada sección de la nota usando ambas.

- **Persistencia:** Supabase/Postgres (proyecto `miracle-app`, ref `zyvfamlhlmztliexvmej`), tablas `clinical_templates` y `clinical_encounters`.
- **Código:** rutas en [web/api/registerClinicalRoutes.js](../web/api/registerClinicalRoutes.js); servicios en `src/application/use-cases/Clinical*.js`; repositorios en `src/infrastructure/repositories/SupabaseClinical*.js`.

## Catálogo institucional (fuente de verdad)

Supabase es la fuente real de plantillas institucionales — **no** se usan plantillas hardcodeadas en el frontend como fuente principal. `clinical_templates` contiene **147 plantillas institucionales** (`scope = institutional`, `status = active`) que cubren **49 especialidades**, con 3 plantillas por especialidad: `Consulta inicial`, `Control y seguimiento` y una de valoración/procedimiento. La única `is_default = true` es `Consulta inicial · Medicina general`.

- El catálogo se siembra con [supabase/migrations/20260710060000_seed_institutional_templates.sql](../supabase/migrations/20260710060000_seed_institutional_templates.sql), generado por [scripts/generate-institutional-templates-seed.js](../scripts/generate-institutional-templates-seed.js) (catálogo de 49 especialidades embebido, derivado del catálogo original del frontend Next.js). El seed es idempotente: ids `UUIDv5(slug)` deterministas + `ON CONFLICT (id) DO NOTHING`.
- Las plantillas **personales** (`scope = personal`, creadas vía `POST /templates`) conviven en la misma tabla y solo son visibles para su dueño.

### specialty_code: guiones vs guion_bajo

En la base de datos `specialty_code` se almacena **normalizado con guion_bajo** (`medicina_general`, `ginecologia_obstetricia`). El frontend puede seguir usando slugs con guiones (`medicina-general`); el backend normaliza ambos formatos al consultar, así que `?specialty=medicina-general` y `?specialty=medicina_general` devuelven lo mismo. La respuesta del API siempre expone `specialty` en la forma normalizada (guion_bajo).

## Base URL

| Entorno | Base |
|---|---|
| Desarrollo local | `http://localhost:3000` |
| Vercel | `https://<tu-deployment>` (las rutas `/api/*` pasan por `api/index.js`) |

## Autenticación

Todas las rutas `/api/clinical/*` requieren sesión:

```
Authorization: Bearer <access_token>
```

- **Producción:** access token de Supabase Auth (login Google). El backend lo verifica offline contra el JWKS del proyecto.
- **Desarrollo:** también sirven la sesión local admin (`POST /api/auth/local-admin/login`) o el bypass `TEMPORARY_DISABLE_AUTH=true`.
- La identidad del médico (`doctor_id` / `owner_user_id`) se deriva del token. Si el `sub` del token no es un UUID (sesiones locales de desarrollo), el backend deriva un UUID estable a partir del id para mantener el ownership.
- Sin token → `401 { "error": "..." }` (respuesta del middleware de auth, formato legacy).

## Formato de errores

Los endpoints clínicos responden errores con envelope estable:

```json
{
  "error": {
    "code": "TEMPLATE_NOT_FOUND",
    "message": "No se encontró la plantilla clínica."
  }
}
```

| Código | HTTP | Cuándo |
|---|---|---|
| `TEMPLATE_NOT_FOUND` | 404 | Plantilla inexistente, archivada (al crear encounter) o no visible para el usuario |
| `TEMPLATE_INVALID` | 400 | Payload de plantilla inválido (nombre, especialidad, secciones) |
| `ENCOUNTER_NOT_FOUND` | 404 | Encounter inexistente o de otro médico |
| `ENCOUNTER_INVALID` | 400/409 | `consultation_type` inválido, `patient_id` muy largo, o transcript sobre encounter `completed` (409) |
| `CONSENT_REQUIRED` | 400 | `consent !== true` al crear encounter |
| `TRANSCRIPT_REQUIRED` | 400 | Transcript vacío al guardarlo, o generate-note sin transcript |
| `TRANSCRIPT_TOO_LONG` | 413 | Transcript > 200 000 caracteres |
| `LLM_NOT_CONFIGURED` | 503 | No hay proveedor LLM configurado |
| `NOTE_GENERATION_FAILED` | 502 | El LLM falló o devolvió algo irreparable |
| `NOTE_JSON_INVALID` | 400 | Nota editada con estructura/keys que no coinciden con el snapshot |
| `ASSISTANT_INVALID` | 400 | Mensaje/instrucción del asistente vacíos o demasiado largos |
| `ASSISTANT_FAILED` | 502 | El asistente no pudo generar respuesta (fallo LLM) |
| `UNAUTHORIZED` | 401/403 | Sin permiso para editar/archivar la plantilla (403) |
| `SUPABASE_NOT_CONFIGURED` | 503 | Falta `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` en el servidor |
| `INTERNAL_ERROR` | 500 | Error no clasificado (sin detalles internos) |

Nunca se devuelven stack traces ni contenido PHI en errores o logs.

## Modelos

### ClinicalTemplate

```json
{
  "id": "e3b0c442-98fc-4c14-9af4-a11e00000001",
  "name": "Consulta inicial · Medicina general",
  "specialty": "medicina_general",
  "description": "Plantilla institucional para primera consulta de medicina general.",
  "owner_user_id": null,
  "scope": "institutional",
  "is_default": true,
  "status": "active",
  "sections_count": 7,
  "sections": [
    {
      "key": "identificacion",
      "label": "Identificación",
      "order": 1,
      "required": false,
      "instruction": "Extrae los datos de identificación del paciente mencionados..."
    }
  ],
  "created_at": "2026-07-09T04:26:52.000Z",
  "updated_at": "2026-07-09T04:26:52.000Z"
}
```

Reglas de normalización (el backend siempre las aplica):

- `sections` acepta strings (`"Motivo de consulta"`) u objetos (`{ "label": "...", "order": 2, "required": true, "instruction": "..." }`).
- Si falta `key`, se genera snake_case estable desde el label (sin acentos): `"Impresión Diagnóstica"` → `impresion_diagnostica`.
- Si falta `instruction`, se genera una instrucción prudente por defecto.
- `order` se reordena y renumera secuencialmente (1..n) respetando el orden pedido.
- Mínimo 2 secciones, máximo 30. Labels vacíos y keys duplicadas → `TEMPLATE_INVALID`.
- `name`: 3–120 caracteres. `specialty`: obligatoria, se normaliza a snake_case (`"Medicina General"` → `medicina_general`). `description`: máx. 400.
- En Supabase, `specialty` se guarda en la columna `specialty_code` (la tabla ya existía con ese esquema); el API siempre expone `specialty`.

### ClinicalEncounter

```json
{
  "id": "0b3f...",
  "patient_id": null,
  "doctor_id": "7b8a4c8e-...",
  "consultation_type": "presencial",
  "consent": true,
  "template_id": "e3b0c442-98fc-4c14-9af4-a11e00000001",
  "template_snapshot": {
    "template_id": "e3b0c442-98fc-4c14-9af4-a11e00000001",
    "name": "Consulta inicial · Medicina general",
    "specialty": "medicina_general",
    "description": "...",
    "scope": "institutional",
    "is_default": true,
    "sections": [ { "key": "...", "label": "...", "order": 1, "required": false, "instruction": "..." } ],
    "snapshot_at": "2026-07-09T05:00:00.000Z"
  },
  "status": "created",
  "transcript": "",
  "note_json": null,
  "created_at": "...",
  "updated_at": "..."
}
```

- `patient_id` es texto libre opcional (máx. 200 caracteres) o `null`.
- `consultation_type` ∈ `presencial | telemedicina | audio_upload`.
- `template_snapshot` se congela al crear el encounter; editar la plantilla después NO afecta encounters existentes.

### NoteJson

```json
{
  "summary": "Consulta por cefalea de tres días sin signos de alarma referidos.",
  "sections": [
    {
      "key": "motivo_consulta",
      "label": "Motivo de consulta",
      "content": "Cefalea de 3 días de evolución.",
      "confidence": 0.92,
      "evidence": "cefalea de tres días"
    }
  ],
  "warnings": [],
  "missing_required_sections": []
}
```

- `sections` contiene EXACTAMENTE las secciones del `template_snapshot`, en el mismo orden. Nunca markdown gigante.
- `confidence` ∈ [0, 1]. Secciones sin información llegan con frases prudentes (`"No mencionado en la consulta."`), `confidence: 0` y `evidence: ""`.

## Estados del encounter

```
created ──transcript──▶ transcript_ready ──generate-note──▶ note_generating ──▶ note_generated ──PUT note──▶ completed
                                                                    │
                                                                    └──error──▶ failed
```

- Guardar transcript de nuevo (re-grabación) está permitido en cualquier estado excepto `completed` (→ 409 `ENCOUNTER_INVALID`); vuelve a `transcript_ready`.
- `generate-note` puede repetirse (regeneración) mientras haya transcript.
- `PUT /note` (nota editada por el médico) deja el encounter en `completed`.

## Endpoints

### 1. Listar plantillas

```http
GET /api/clinical/templates?specialty=medicina_general
```

`specialty` es opcional y acepta guiones o guion_bajo (`medicina-general` == `medicina_general`; se normaliza en el backend). Sin filtro devuelve las 147 plantillas institucionales activas + las plantillas personales activas del usuario, ordenadas por `is_default desc, name asc`:

```json
{ "templates": [ { "id": "...", "name": "...", "specialty": "medicina_general", "scope": "institutional", "is_default": true, "status": "active", "sections_count": 7, "sections": [ ... ] } ] }
```

### 2. Crear plantilla

```http
POST /api/clinical/templates
Content-Type: application/json
```

Body con strings u objetos en `sections` (ver normalización arriba):

```json
{
  "name": "Control de hipertensión",
  "specialty": "medicina_general",
  "description": "Plantilla para controles",
  "sections": ["Identificación", "Motivo de consulta", "Enfermedad actual", "Plan y recomendaciones"]
}
```

Respuesta `201`:

```json
{ "template": { "id": "...", "scope": "personal", "owner_user_id": "<uuid del médico>", "sections": [ ... ] } }
```

Las plantillas creadas por API siempre son `scope: "personal"` del usuario autenticado.

### 3. Obtener plantilla

```http
GET /api/clinical/templates/:template_id
```

Visible si es institucional o personal propia (archivadas incluidas). Ajena → 404.

### 4. Actualizar plantilla

```http
PUT /api/clinical/templates/:template_id
```

- Acepta `name`, `description`, `specialty`, `sections` (parciales; lo no enviado se conserva). Misma validación que crear.
- Personal: solo el dueño. Institucional: solo administradores globales (`GLOBAL_WORKFLOW_ADMIN_EMAILS`) → si no, `403 UNAUTHORIZED`.
- No afecta encounters ya creados (usan `template_snapshot`).

### 5. Archivar plantilla

```http
DELETE /api/clinical/templates/:template_id
```

Soft delete: cambia `status` a `archived` (no hay borrado físico). Respuesta: `{ "template": { ..., "status": "archived" } }`. Los permisos son los mismos de actualizar.

### 6. Crear encounter

```http
POST /api/clinical/encounters
```

```json
{
  "patient_id": null,
  "consultation_type": "presencial",
  "template_id": "e3b0c442-98fc-4c14-9af4-a11e00000001",
  "consent": true
}
```

Respuesta `201`:

```json
{ "encounter_id": "0b3f...", "status": "created", "template": { "...": "template_snapshot" } }
```

`consent: true` es obligatorio. La plantilla debe estar activa y ser visible para el médico.

### 7. Obtener encounter

```http
GET /api/clinical/encounters/:encounter_id
```

```json
{ "encounter": { "...": "modelo completo, incluye transcript y note_json si existen" } }
```

Solo el médico dueño; ajeno/inexistente → 404.

### 8. Guardar transcripción

```http
POST /api/clinical/encounters/:encounter_id/transcript
```

```json
{ "transcript": "Texto completo de la consulta..." }
```

Respuesta:

```json
{ "encounter_id": "0b3f...", "status": "transcript_ready", "transcript_length": 412 }
```

Vacío → `400 TRANSCRIPT_REQUIRED`. Más de 200 000 caracteres → `413 TRANSCRIPT_TOO_LONG`. No genera la nota automáticamente.

### 9. Generar nota clínica

```http
POST /api/clinical/encounters/:encounter_id/generate-note
```

Usa el `template_snapshot` (no la plantilla actual), construye el prompt clínico estricto, llama al LLM configurado, valida/repara el JSON y guarda el resultado. Endpoint con rate limit reforzado (gasta créditos LLM).

```json
{ "encounter_id": "0b3f...", "status": "note_generated", "note_json": { "summary": "...", "sections": [ ... ], "warnings": [], "missing_required_sections": [] } }
```

### 10. Guardar nota editada

```http
PUT /api/clinical/encounters/:encounter_id/note
```

```json
{ "note_json": { "summary": "...", "sections": [ { "key": "motivo_consulta", "content": "..." } ], "warnings": [] } }
```

- No llama al LLM. Valida estructura estricta: exactamente las keys del snapshot (extra o faltante → `400 NOTE_JSON_INVALID`), `content` string por sección.
- `label` y orden se restauran desde el snapshot; `confidence` ausente se asume 1 (edición humana).
- Deja el encounter en `status: "completed"`.

```json
{ "encounter_id": "0b3f...", "status": "completed", "note_json": { ... } }
```

## Asistente clínico contextual (11–13)

Tres endpoints adicionales bajo la misma auth Supabase Bearer, con rate limit reforzado (gastan LLM). Contrato completo, payload de `screen_context`, garantías anti-invención y ejemplos en **[docs/clinical-assistant.md](clinical-assistant.md)**.

### 11. Chat clínico

```http
POST /api/clinical/assistant/chat
```

`{ message, encounter_id?, specialty?, screen_context?, history? }` → `{ answer, mode:"clinical_chat", specialty, used_context, safety_notice, suggested_actions }`. Sin `encounter_id` responde en modo general (no finge conocer un paciente); con `encounter_id` usa transcript + note_json + especialidad del snapshot.

### 12. Sugerencias diagnósticas por encounter

```http
POST /api/clinical/encounters/:encounter_id/diagnostic-suggestions
```

Sin body → `{ suggestions:[{title,type,confidence,rationale,supporting_evidence,against_or_uncertain,red_flags_to_check,suggested_next_questions}], safety_notice }`. Máx 5, tentativas, con evidencia literal verificada contra transcript/nota; sin material clínico → `suggestions: []`. (El legacy `POST /api/clinical/diagnosis-suggestions` por contenido suelto sigue igual.)

### 13. Ajuste de nota (propuesta, no persiste)

```http
POST /api/clinical/assistant/note-adjustment
```

`{ encounter_id, instruction, section_key? }` → `{ proposed_note_json, changed_sections, explanation, requires_physician_review:true }`. Valida contra `template_snapshot` (merge con la nota original si el modelo responde parcial); el médico guarda con el endpoint 10.

Errores adicionales: `ASSISTANT_INVALID` (400), `ASSISTANT_FAILED` (502).

## Flujo completo (curl)

```bash
BASE=http://localhost:3000
TOKEN="<supabase_access_token>"
AUTH="Authorization: Bearer $TOKEN"
JSON="Content-Type: application/json"

# 1. Listar plantillas
curl -s "$BASE/api/clinical/templates?specialty=medicina_general" -H "$AUTH"

# 2. Crear encounter con la plantilla institucional "Consulta inicial"
ENC=$(curl -s -X POST "$BASE/api/clinical/encounters" -H "$AUTH" -H "$JSON" -d '{
  "consultation_type": "presencial",
  "template_id": "e3b0c442-98fc-4c14-9af4-a11e00000001",
  "consent": true
}' | node -pe "JSON.parse(require('fs').readFileSync(0)).encounter_id")

# 3. Guardar transcripción
curl -s -X POST "$BASE/api/clinical/encounters/$ENC/transcript" -H "$AUTH" -H "$JSON" -d '{
  "transcript": "Paciente consulta por cefalea de tres días de evolución. Refiere que el dolor es intermitente, empeora con exposición a pantallas y mejora con reposo. Presenta náuseas leves. Niega fiebre, vómito y alteraciones visuales. No refiere antecedentes relevantes durante la consulta. Se recomienda higiene del sueño, hidratación, pausas de pantalla y control si aparecen signos de alarma."
}'

# 4. Generar nota estructurada
curl -s -X POST "$BASE/api/clinical/encounters/$ENC/generate-note" -H "$AUTH" -H "$JSON"

# 5. Leer encounter completo (transcript + note_json)
curl -s "$BASE/api/clinical/encounters/$ENC" -H "$AUTH"

# 6. Guardar nota editada (tomar note_json de la respuesta anterior, editar content y:)
curl -s -X PUT "$BASE/api/clinical/encounters/$ENC/note" -H "$AUTH" -H "$JSON" -d '{ "note_json": { ... } }'
```

## Checklist para el frontend

1. Obtener el access token de Supabase tras login y mandarlo en `Authorization: Bearer` a todo `/api/clinical/*`.
2. Listar plantillas con `GET /templates?specialty=...` y renderizar selector (institucionales primero: `is_default`).
3. Crear plantillas mandando `sections` como strings u objetos; renderizar siempre lo que devuelve el backend (ya normalizado).
4. Antes de iniciar consulta: `POST /encounters` con `template_id` y `consent: true`; guardar `encounter_id`.
5. Al terminar la transcripción: `POST /encounters/:id/transcript` (no vacío).
6. Pedir la nota con `POST /encounters/:id/generate-note` y renderizar `note_json.sections` en orden — nunca dividir markdown ni adivinar estructura.
7. Mostrar `warnings` y `missing_required_sections` al médico.
8. Al editar: mantener las mismas `keys` y mandar `PUT /encounters/:id/note` con el `note_json` completo.
9. Manejar los códigos de error de la tabla (en especial `CONSENT_REQUIRED`, `TRANSCRIPT_REQUIRED`, `LLM_NOT_CONFIGURED`, `NOTE_GENERATION_FAILED`).
10. No usar `SUPABASE_SERVICE_ROLE_KEY` jamás en el cliente; el frontend solo habla con este API.

## Tests

```bash
npm test                              # catálogo (8) + workflow (19) + asistente (15)
npm run test:clinical-workflow
npm run test:templates-catalog
npm run test:clinical-assistant-api
```

Suites con rutas reales de Express + Supabase fake en memoria + LLM fake: [scripts/verify-clinical-workflow.js](../scripts/verify-clinical-workflow.js) (flujo plantillas→encounter→nota) y [scripts/verify-clinical-assistant.js](../scripts/verify-clinical-assistant.js) (asistente contextual).
