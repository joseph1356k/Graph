# Asistente Clínico Contextual Miracle — Backend

Backend del panel de asistente flotante y de la caja "Pídale a Miracle un ajuste de la nota...". Tres capacidades: **chat clínico** (general o contextual a una consulta), **sugerencias diagnósticas** (por encounter, o por texto plano para el plugin) y **ajuste de nota** propuesto (nunca persistido), en dos modos: `rewrite` (reorganiza sin datos nuevos) y `dictation` (inserta lo que el médico dicta).

> Apoyo clínico para revisión médica. El asistente no confirma diagnósticos, no inventa datos y no reemplaza el criterio profesional — esas reglas están codificadas en prompts Y en validación de salida.

## Módulos

| Módulo | Rol |
|---|---|
| [ClinicalAssistantPromptBuilder](../src/application/use-cases/ClinicalAssistantPromptBuilder.js) | System prompt del asistente (reutilizable, no vive en rutas) + prompts de chat/diagnóstico/ajuste |
| [ClinicalAssistantContextBuilder](../src/application/use-cases/ClinicalAssistantContextBuilder.js) | Arma el contexto clínico: encounter, especialidad, transcript, note_json, screen_context, history (sanitizados) |
| [ClinicalAssistantService](../src/application/use-cases/ClinicalAssistantService.js) | Orquesta los 3 casos de uso; usa su propio `LLMProvider('MIRACLE_ASSISTANT')` (ver abajo) y `getOwnedEncounter` (ownership) |
| [ClinicalAssistantValidationService](../src/application/use-cases/ClinicalAssistantValidationService.js) | Valida salidas: evidencia literal, detección (sin reescritura) de lenguaje definitivo, límites, proyección al contrato del plugin |
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

- Máximo **5** sugerencias; `type` siempre `differential_or_working_impression`. Cada sugerencia trae `grounding` (`explicit|entailed|inferred`) y `confidence` se **calcula** desde él (1 / 0.8 / 0.4), no lo dicta el modelo.
- **Cada `supporting_evidence` debe existir literalmente** en el transcript o en la nota (comparación sin acentos y con espacios colapsados). Evidencia inventada se elimina; una sugerencia sin evidencia real se **descarta entera** — así el modelo no puede "inventar examen físico".
- Lenguaje definitivo ("diagnóstico confirmado", "se confirma", "definitivo") se **detecta, no se reescribe**: el texto queda intacto, la sugerencia baja a `grounding: "inferred"` (confidence 0.4), recibe la nota fija `Redacción definitiva detectada: tratar como hipótesis pendiente de confirmación.` al inicio de `against_or_uncertain`, y la respuesta trae el contador `definitive_language_hits`. (Antes un regex cambiaba "confirmado" por "a considerar" y alteraba hechos del paciente: «contacto confirmado de tuberculosis» salía como «contacto a considerar».)
- Encounter sin transcript ni nota → `{ "suggestions": [] }` prudente (200, sin llamar al LLM).

Nota: `POST /api/clinical/diagnosis-suggestions` (por contenido de nota suelto, auth local, usado por el plugin del EMR demo) es ahora un **adaptador** sobre este mismo motor: mismo prompt, misma verificación de evidencia, mismo provider del asistente (con fallback al provider de Graph si el del asistente no tiene key). Su contrato de salida no cambió: `{ suggestions: [{ title, rationale, supportingEvidence }], reviewNotice }`. El motor anterior en inglés (`ClinicalDiagnosisSuggestionService`) fue eliminado.

## 3. Ajuste de nota clínica

```http
POST /api/clinical/assistant/note-adjustment
Authorization: Bearer <supabase_access_token>
```

```json
{ "encounter_id": "enc_123", "instruction": "Haz el plan más breve y claro.", "section_key": "plan", "instruction_kind": "rewrite" }
```

Respuesta:

```json
{
  "proposed_note_json": { "summary": "...", "sections": [ ... ], "warnings": [], "missing_required_sections": [] },
  "changed_sections": ["plan"],
  "instruction_kind": "rewrite",
  "explanation": "Se acortó el plan sin agregar información nueva.",
  "requires_physician_review": true
}
```

`instruction_kind` (opcional, default `rewrite`):

- `rewrite`: reorganiza, acorta, aclara o corrige la redacción **sin datos clínicos nuevos**. Si la instrucción exige inventar información, el modelo no lo hace y lo explica en `warnings`.
- `dictation`: el médico **es la fuente**. Lo dictado en `instruction` se integra exactamente en `section_key` (obligatorio en este modo; sin él → `400 ASSISTANT_INVALID`), sustituyendo la frase prudente si la sección estaba vacía o añadiéndose al final si ya tenía contenido. La sección queda con `grounding: "explicit"` y `evidence: "[dictado del médico]"`, que el validador reconoce como centinela y no intenta buscar en la transcripción. El portal elige este modo desde el micrófono («agrega que el paciente niega fiebre»).

Garantías:

- **Nunca persiste.** Devuelve una propuesta; el médico la revisa y la guarda con el `PUT /api/clinical/encounters/:id/note` existente.
- La propuesta se valida contra el `template_snapshot` (mismas keys, mismo orden) **con la transcripción**: la evidencia de las secciones tocadas se verifica igual que en la generación. Si el modelo responde parcial (solo la sección ajustada), el backend hace **merge con la nota original** — las secciones no mencionadas se conservan textuales. Secciones inventadas se ignoran. Los `warnings` del modelo se conservan (antes se descartaban).
- El prompt de ajuste es propio (~180 palabras): ya no hereda el system prompt del chat.
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

## Privacidad

Todo lo que el asistente manda al proveedor —pregunta, historial, transcripción, nota, `screen_context`— pasa por el escudo de privacidad ([privacy-egress-gateway.md](privacy-egress-gateway.md)): los identificadores directos del paciente salen como marcadores y la respuesta vuelve con los datos reales. Las tres respuestas traen `privacy` (modo, conteos, resultado). Un marcador que venga en `history` o `message` desde el cliente es texto opaco: nunca se convierte en el dato de nadie. La validación de evidencia literal de las sugerencias sigue funcionando porque cada marcador restaura la forma exacta que tapó.

## Seguridad y límites (resumen)

El system prompt de chat (`ClinicalAssistantPromptBuilder.buildChatSystemPrompt`) se estructura en tres bloques: REGLAS INVIOLABLES (límite de rol frente a datos delimitados, no diagnóstico definitivo, no órdenes finales, no inventar datos, señalar incertidumbre y red flags), ESPECIALIDAD ACTIVA (solo la regla de la familia que aplica, no las siete) y ESTILO. Diferenciales y ajuste componen prompts propios y más cortos con las mismas cláusulas compartidas (`src/application/prompts/PromptClauses.js`). Transcripción, nota y pantalla viajan delimitadas (`<transcripcion>`, `<nota>`, `<pantalla>`) y el prompt declara que son datos, no instrucciones. La validación de salida refuerza lo verificable (evidencia literal, detección de lenguaje definitivo, estructura de nota). Sin PHI en logs (solo ids y conteos). `safety_notice` viaja en TODAS las respuestas. Temperaturas fijas: chat 0.4, diferenciales 0.2, ajuste 0.2. Cada llamada registra `promptVersion` en telemetría.

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
