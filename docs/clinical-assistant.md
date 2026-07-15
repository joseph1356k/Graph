# Asistente Clínico Contextual Miracle — Backend

Backend del panel de asistente flotante y de la caja "Pídale a Miracle un ajuste de la nota...". Tres capacidades: **chat clínico** (general o contextual a una consulta), **sugerencias diagnósticas** por encounter y **ajuste de nota** propuesto (nunca persistido).

> Apoyo clínico para revisión médica. El asistente no confirma diagnósticos, no inventa datos y no reemplaza el criterio profesional — esas reglas están codificadas en prompts Y en validación de salida.

## Módulos

| Módulo | Rol |
|---|---|
| [ClinicalAssistantPromptBuilder](../src/application/use-cases/ClinicalAssistantPromptBuilder.js) | System prompt del asistente (reutilizable, no vive en rutas) + prompts de chat/diagnóstico/ajuste |
| [ClinicalAssistantContextBuilder](../src/application/use-cases/ClinicalAssistantContextBuilder.js) | Arma el contexto clínico: encounter, especialidad, transcript, note_json, screen_context, history (sanitizados) |
| [ClinicalAssistantService](../src/application/use-cases/ClinicalAssistantService.js) | Orquesta los 3 casos de uso; usa su propio `LLMProvider('MIRACLE_ASSISTANT')` (ver abajo) y `getOwnedEncounter` (ownership) |
| [ClinicalAssistantValidationService](../src/application/use-cases/ClinicalAssistantValidationService.js) | Valida salidas: evidencia literal, degradación de lenguaje definitivo, límites |
| [MiracleAssistantProviderConfigService](../src/application/use-cases/MiracleAssistantProviderConfigService.js) | Provider Studio: catálogo + guardado en Vercel env del provider del asistente (independiente de Graph) |

Auth: los 3 endpoints van detrás de `requireClinicalAuth` (Bearer token de Supabase → `req.clinicalUser`), igual que el resto del módulo clínico. Rate limit reforzado (gastan créditos LLM).

## Provider independiente (Provider Studio)

El asistente tiene su **propio** provider LLM, desacoplado del de Graph (field matching). `LLMProvider` (`src/infrastructure/LLMProvider.js`) acepta un `envPrefix` en el constructor — Graph usa `new LLMProvider()` (default `'GRAPH'`, lee `GRAPH_LLM_*`), el asistente usa `new LLMProvider('MIRACLE_ASSISTANT')` (lee `MIRACLE_ASSISTANT_LLM_*`). Cambiar uno no afecta al otro.

- Tarjeta **"Asistente"** en Provider Studio (`/provider-studio.html`), mismo patrón que Graph/STT/Product LLM: `GET/POST /api/providers/assistant/status` y `/configure` (admin-gated, igual que los demás providers).
- Providers soportados: `azure-foundry`, `openrouter`, `openai`, `google`, `disabled`. Cada uno guarda su API key en una env var dedicada (`MIRACLE_ASSISTANT_LLM_<PROVIDER>_API_KEY`) además de la legada compartida `MIRACLE_ASSISTANT_LLM_API_KEY` que lee el runtime — así la key se recuerda al cambiar de provider y volver.
- **Superficie de prueba**: botón "Probar asistente" en Provider Studio → `/assistant-lab.html`, un chat simple contra `POST /api/providers/assistant/test-chat` (admin-gated, modo general — sin `encounter_id`). Usa el mismo `ClinicalAssistantService.chat()` que la ruta real; sirve para confirmar que el provider configurado responde antes de exponerlo a médicos.

## API pública (`/api/v1`)

`POST /api/v1/assistant/chat` — autenticado con API key permanente (`X-API-Key` o `Authorization: Bearer`, ver `MIRACLE_API_KEYS`), para que frontends externos consuman el asistente. Solo **modo general** (sin `encounter_id`/ownership — un cliente de API no tiene sesión de médico de Supabase). Body: `{ message, specialty?, history? }`. Respuesta: `{ answer, specialty, safety_notice, usage }`. Registra consumo de tokens en el dashboard de uso (`feature: "assistant_chat"`), igual que `/api/v1/autofill/match` y `/api/v1/pipeline`.

## 1. Chat clínico contextual

```http
POST /api/clinical/assistant/chat
Authorization: Bearer <supabase_access_token>
```

```json
{
  "message": "¿Qué diagnósticos diferenciales consideras?",
  "encounter_id": "enc_123",
  "specialty": "medicina_general",
  "screen_context": {
    "route": "/app/consultas/enc_123",
    "page": "consulta_detalle",
    "visible_panel": "nota_clinica",
    "selected_section_key": "plan",
    "selected_section_label": "Plan",
    "visible_text": "Plan: Analgesia según indicación...",
    "user_intent_surface": "assistant_button"
  },
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

Todos los campos excepto `message` son opcionales.

Respuesta:

```json
{
  "answer": "...",
  "mode": "clinical_chat",
  "specialty": "medicina_general",
  "used_context": { "encounter": true, "transcript": true, "note_json": true, "screen_context": true },
  "safety_notice": "Apoyo clínico para revisión médica. No reemplaza el criterio profesional.",
  "suggested_actions": []
}
```

### Modos

- **Sin `encounter_id` (modo general):** responde preguntas clínicas generales ("Dosis de amoxicilina en adultos", "¿Qué CIE-10 uso para cefalea tensional?") de forma prudente. El prompt le prohíbe fingir que conoce a un paciente.
- **Con `encounter_id` (modo contextual):** el backend carga el encounter (con ownership: ajeno → 404), y el prompt incluye especialidad del `template_snapshot`, tipo de consulta, secciones de la plantilla, transcript (cap 16k chars en prompt) y note_json completo.

### Cómo se resuelve `specialty`

1. `template_snapshot.specialty` del encounter (si hay `encounter_id`);
2. si no, el campo `specialty` del body (acepta guiones o guion_bajo, se normaliza);
3. si no, `medicina_general` como contexto prudente (la respuesta siempre dice cuál se usó).

### Cómo mandar `screen_context` desde el frontend

Objeto plano con **solo** estos campos (whitelist; cualquier otro se descarta): `route`, `page`, `visible_panel`, `selected_section_key`, `selected_section_label`, `visible_text` (≤2000 chars), `user_intent_surface`. Mándalo al abrir el panel del asistente para que sepa "qué está viendo el médico". El backend lo trata como **informativo, no autoritativo**: si contradice los datos persistidos del encounter, mandan los persistidos.

### `history`

Array `[{role, content}]` con `role ∈ {user, assistant}` únicamente (cualquier otro role se descarta — anti prompt-injection). El backend conserva los últimos 12 mensajes, cada uno cap 4000 chars. Recomendado enviar los últimos 8 como hace el resto de la app.

## 2. Sugerencias diagnósticas al final de la cita

```http
POST /api/clinical/encounters/:encounter_id/diagnostic-suggestions
Authorization: Bearer <supabase_access_token>
```

Sin body. Usa el encounter completo: transcript + note_json + specialty + template_snapshot.

```json
{
  "suggestions": [
    {
      "title": "Cefalea tensional probable",
      "type": "differential_or_working_impression",
      "confidence": 0.72,
      "rationale": "Cefalea de 3 días, intermitente, empeora con pantallas y mejora con reposo.",
      "supporting_evidence": ["cefalea de tres días", "empeora con exposición a pantallas"],
      "against_or_uncertain": ["No se documentó examen físico neurológico completo."],
      "red_flags_to_check": ["inicio súbito e intenso", "déficit neurológico"],
      "suggested_next_questions": ["¿El dolor inició de forma súbita?"]
    }
  ],
  "safety_notice": "Sugerencias generadas por IA para revisión médica. No constituyen diagnóstico confirmado."
}
```

Garantías del backend (validación post-LLM, no solo prompt):

- Máximo **5** sugerencias; `confidence` clamp [0,1]; `type` siempre `differential_or_working_impression`.
- **Cada `supporting_evidence` debe existir literalmente** en el transcript o en la nota (comparación sin acentos y con espacios colapsados). Evidencia inventada se elimina; una sugerencia sin evidencia real se **descarta entera** — así el modelo no puede "inventar examen físico".
- Lenguaje definitivo se degrada: "diagnóstico confirmado de X" → "posibilidad clínica de X"; "se confirma" → "es compatible con".
- Encounter sin transcript ni nota → `{ "suggestions": [] }` prudente (200, sin llamar al LLM).

Nota: convive con el endpoint legacy `POST /api/clinical/diagnosis-suggestions` (por contenido de nota suelto, auth local, usado por el EMR demo). Este nuevo es por-encounter y con contrato más rico; el legacy no cambió.

## 3. Ajuste de nota clínica

```http
POST /api/clinical/assistant/note-adjustment
Authorization: Bearer <supabase_access_token>
```

```json
{ "encounter_id": "enc_123", "instruction": "Haz el plan más breve y claro.", "section_key": "plan" }
```

Respuesta:

```json
{
  "proposed_note_json": { "summary": "...", "sections": [ ... ], "warnings": [], "missing_required_sections": [] },
  "changed_sections": ["plan"],
  "explanation": "Se acortó el plan sin agregar información nueva.",
  "requires_physician_review": true
}
```

Garantías:

- **Nunca persiste.** Devuelve una propuesta; el médico la revisa y la guarda con el `PUT /api/clinical/encounters/:id/note` existente.
- La propuesta se valida contra el `template_snapshot` (mismas keys, mismo orden). Si el modelo responde parcial (solo la sección ajustada), el backend hace **merge con la nota original** — las secciones no mencionadas se conservan textuales. Secciones inventadas se ignoran.
- `section_key` es opcional; enfoca la instrucción en una sección.
- Requiere que el encounter ya tenga `note_json` (si no → `400 ENCOUNTER_INVALID`).

## Errores

Envelope estándar del módulo clínico `{ "error": { "code", "message" } }`:

| Código | HTTP | Cuándo |
|---|---|---|
| `ASSISTANT_INVALID` | 400 | `message`/`instruction` vacíos o demasiado largos |
| `ASSISTANT_FAILED` | 502 | El LLM falló o devolvió algo irreparable |
| `ENCOUNTER_NOT_FOUND` | 404 | Encounter inexistente o de otro médico |
| `ENCOUNTER_INVALID` | 400 | Ajuste de nota sin nota generada |
| `LLM_NOT_CONFIGURED` | 503 | Sin proveedor LLM |
| `UNAUTHORIZED` | 401 | Sin Bearer de Supabase / token inválido |

## Seguridad y límites (resumen)

El system prompt (en `ClinicalAssistantPromptBuilder.SYSTEM_PROMPT`) prohíbe: diagnóstico definitivo, órdenes médicas finales, inventar datos, dosis específicas como orden final sin datos esenciales, y exige señalar incertidumbre y red flags. La validación de salida refuerza lo verificable (evidencia literal, degradación de lenguaje, estructura de nota). Sin PHI en logs (solo ids y conteos). `safety_notice` viaja en TODAS las respuestas.

## Limitaciones actuales

- Las respuestas de chat son texto libre: la no-invención se exige por prompt pero no es verificable automáticamente (por eso el safety notice y la revisión médica).
- En ajustes de nota, la estructura está garantizada (keys/orden/merge); el contenido textual final requiere revisión (`requires_physician_review`).
- `confidence` es autoreportada por el modelo (clampeada), no calibrada.
- `suggested_actions` se devuelve vacío — reservado para acciones futuras del frontend.
- No hay streaming de respuesta (una llamada, una respuesta).

## Tests

```bash
npm run test:clinical-assistant-api   # 15 checks (fake LLM + fake Supabase + rutas reales)
npm test                              # catálogo (8) + workflow (19) + asistente (15)
```
