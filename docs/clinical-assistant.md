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

## 2. Sugerencias diagnósticas

```http
POST /api/clinical/diagnosis-suggestions
```

`{ noteContent, specialty? }` (auth local; lo usa el plugin del EMR demo). Es la **única** entrada al
motor de diferenciales: la ruta por encounter (`POST /api/clinical/encounters/:encounter_id/diagnostic-suggestions`)
se borró el 2026-10-01 porque no tenía cliente. La ruta proyecta la salida del motor al contrato del
plugin, `{ suggestions: [{ title, rationale, supportingEvidence }], reviewNotice }`. El motor
(`ClinicalAssistantService.suggestFromText`) devuelve internamente el contrato rico:

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
- Nota vacía → 400 sin llamar al LLM; más de 20.000 caracteres → 413.

El motor usa el provider del asistente (con fallback al provider de Graph si el del asistente no tiene key). El motor anterior en inglés (`ClinicalDiagnosisSuggestionService`) fue eliminado.

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

## Chat v3 (2026-10-01): contexto completo, guías con RAG, abstención y propuesta de nota

El chat pasó de texto libre a una respuesta **estructurada** (`clinical-assistant-chat@3`). Lo que
cambia, de afuera hacia adentro:

### Campos nuevos del payload (todos opcionales)

| Campo | Qué es | Saneado en `ClinicalAssistantContextBuilder` |
|---|---|---|
| `note_json_draft` | la nota **tal como está en pantalla** (`{summary?, sections:[{key,label,content}]}`); manda sobre la persistida | 40 secciones, 8 000 chars c/u, 40 000 en total; con encounter, solo keys del `template_snapshot` |
| `codes` | `[{sistema:'CIE-10'|'CUPS', codigo, descripcion, estado:'sugerido'|'aceptado'}]` | 20 códigos, descripción ≤ 160; campos fuera de la whitelist se descartan |
| `patient_context` | `{edad?, sexo?:'F'|'M'}` — nunca nombre ni documento | enteros 0–120, enum |
| `note_editable` | `false` cuando la nota está firmada | el servicio anula cualquier propuesta aunque el modelo la devuelva |

Modos: con `encounter_id` (contextual: transcripción + nota); sin encounter pero con `note_json_draft`
(contextual con nota en pantalla, sin transcripción: consulta anterior al puente o supervisor); sin nada (general).

### Retrieval de guías clínicas (RAG léxico, sin proveedor externo)

- Corpus: `knowledge/guias-clinicas/*.md` (una guía por archivo, cada `##` es un fragmento citable, metadatos
  en la cabecera: `id`, `titulo`, `organismo`, `anio`, `fuente`, `especialidades`, `cie10`, `palabras_clave`,
  `fecha_revision`, `revisado_por`). `npm run build:corpus` lo compila a `guidelines.corpus.json`, que **se commitea**
  (en runtime se carga con `require`; nada de disco en Vercel). Cómo redactar una guía: `knowledge/guias-clinicas/README.md`.
- Índice: `src/application/knowledge/ClinicalGuidelineIndex.js` — BM25 en memoria con normalización en español,
  sinónimos (`sinonimos.json`: `hta` → `hipertension`, `curb65` → `curb 65 neumonia`…), peso extra a título y palabras
  clave, boost por especialidad activa (×1.15) y por código CIE-10 de la consulta (×1.3). La consulta de búsqueda es la
  pregunta del médico más el diagnóstico de la nota y las descripciones de los códigos.
- Devuelve **vacío a propósito** cuando la pregunta no aporta términos propios («hola», «resume la consulta»): entonces
  el mensaje al modelo dice «No se recuperaron guías clínicas: no cites ninguna». Máximo 6 fragmentos, 3 por guía,
  ≈ 9 000 caracteres, numerados `[G1]…[Gn]` dentro de `<guias_clinicas>`.
- Al prompt del chat entra una selección de esa lista (`selectForPrompt`): ≈ 5 000 caracteres; los dos mejores
  fragmentos entran siempre (aunque sean de relevancia baja, para que el modelo vea el mejor vecino y pueda abstenerse)
  y del tercero en adelante se omiten los de relevancia baja. Las referencias se renumeran `[G1]…[Gn]` después de
  seleccionar, así que lo que el modelo cita es exactamente lo que recibió.
- Apagado de emergencia: `MIRACLE_ASSISTANT_RAG_DISABLED=1`. Tope: `MIRACLE_ASSISTANT_RAG_TOP_K` (default 6).
- Privacidad: los fragmentos pasan por el escudo como cualquier texto; `verify-guideline-corpus.js` exige que ninguno
  produzca marcadores (una cifra de dosis nunca debe salir tapada como si fuera un documento).

### Respuesta

```json
{
  "answer": "texto plano; cita [G1] cuando usa una guía",
  "support": "consulta | guia | general | insuficiente",
  "sources": [{ "ref": "G1", "guideline_id": "hipertension-arterial-adultos", "title": "…", "organism": "…", "year": 2024, "section": "…", "source": "…" }],
  "missing_information": ["…"], "alarm_signs": ["…"], "follow_up_questions": ["hasta 3"],
  "note_proposal": { "proposed_note_json": {…}, "changed_sections": [{ "key", "label", "content", "previous_content" }], "summary": null, "explanation": "…", "requires_physician_review": true } | null,
  "used_context": { "encounter", "transcript", "note_json", "note_draft", "codes", "patient", "guidelines": 3, "screen_context", "doctor" },
  "mode": "clinical_chat", "specialty", "privacy", "safety_notice", "suggested_actions": [], "usage"
}
```

Lo que el prompt promete, `ClinicalAssistantResponseParser` lo comprueba: una referencia que no esté en lo recuperado
se descarta de `sources` **y se borra del texto**; `respaldo: "guia"` sin fuente resuelta baja a `general`;
`insuficiente` nunca llega con `missing_information` vacío. Si el modelo responde texto en vez de JSON, el texto es
`answer` con `support: "general"` y sin propuesta: la conversación no se rompe. `answer` sigue siendo un string, así que
`/api/v1/assistant/chat` y Provider Studio no cambian.

### Propuesta de nota desde el chat

Solo cuando el médico pide cambiar la nota, el modelo devuelve `propuesta_nota` con las secciones que cambian. El
servicio toma como base la nota en pantalla (o la persistida), hace `mergeWithOriginalNote`, valida con
`ClinicalNoteValidationService.validateAndRepair` contra el `template_snapshot` (o uno sintético cuando no hay
encounter) usando la transcripción **más el mensaje del médico** como texto de evidencia (lo que el médico escribe en
el chat es fuente legítima), y devuelve en `changed_sections` solo las secciones devueltas cuyo contenido difiere de la
base, con `previous_content` para que la web detecte si el médico editó entre la propuesta y el clic. **Nunca persiste.**
`proposed_note_json` no trae `discharge`: la web aplica `changed_sections` por clave sobre la nota actual.

### Telemetría

Cada llamada del chat registra en el ledger `promptVersion` (`clinical-assistant-chat@6…`), `guidelineHits` (cuántos
fragmentos entraron), `drugLabelHits` (cuántos extractos de fichas técnicas) y `noteSource` (`draft` | `persisted` |
`none`). Conteos y etiquetas, nunca texto.

## Chat v4 (2026-10-09): respuestas verificables

Objetivo: que cada respuesta diga de dónde sale y que lo que no se pueda respaldar se vea. Todo en Graph, en memoria
y sin proveedor nuevo; la única salida nueva es CIMA (solo el nombre del principio activo).

### Corpus (80 guías, 403 fragmentos)

Atención primaria y crónicos (HTA, DM2, dislipidemia, ERC, insuficiencia cardiaca, FA, EPOC, asma, hipotiroidismo,
anemia ferropénica, dispepsia/ERGE/H. pylori, gota, osteoporosis, rinitis alérgica, obesidad y tabaquismo, lumbalgia,
cefalea, vértigo, síncope, insomnio, dolor crónico y opioides, tamizaje de cáncer, CIE-10 frecuente); urgencias
(dolor torácico/SCA, sepsis, ACV, TEP/TVP, anafilaxia, RCP AHA 2025, CAD/EHH e hipoglucemia, hemorragia digestiva,
abdomen agudo y cólico renal, reglas de decisión en trauma menor, estatus epiléptico, lesión renal aguda,
hiponatremia e hiperpotasemia, pancreatitis y colecistitis, cirrosis y sus complicaciones); infecciosas y del trópico
(meningitis bacteriana, hepatitis B y C, leptospirosis, leishmaniasis, enfermedad de Chagas, accidente ofídico,
mordeduras y profilaxis de rabia, intoxicación por organofosforados, NAC, ITU, faringoamigdalitis, otitis/sinusitis, piel y tejidos blandos, ITS, sífilis, VIH, tuberculosis, malaria,
dengue, tabla de antibióticos); pediatría y neonatos (IRA/AIEPI, bronquiolitis, EDA y deshidratación, fiebre sin foco,
IVU pediátrica, ictericia neonatal, crecimiento y desarrollo (Res. 2465/2016, EAD-3), vacunación PAI y del adulto,
lactancia materna, parasitosis intestinal, escabiosis y pediculosis, desnutrición aguda Res. 2350/2020 y Res. 115/2026, convulsión febril); gineco-
obstetricia (control prenatal Res. 3280, sangrado del primer trimestre, diabetes gestacional, preeclampsia, hemorragia posparto, anticoncepción); salud mental y geriatría
(depresión, ansiedad y riesgo suicida, alcohol, delirium y demencia). Cada guía cita fuente y año y declara
`revisado_por` vacío hasta la revisión médica: el asistente las presenta como resumen orientativo.

### Retrieval v2 (`src/application/knowledge/ClinicalGuidelineIndex.js`)

- **Población.** Cada guía declara `poblacion` (adultos, adultos_mayores, gestantes, pediatria, neonatos). Si la
  pregunta nombra una («en niños», «en el embarazo») manda la pregunta; si no, se deduce de `patient_context` (edad,
  sexo) y de señales de embarazo en la nota o en los códigos (O00–O99, Z33–Z36). La guía de la población sube ×1.15,
  la de otra baja ×0.8 (no desaparece); la sección cuyo título nombra la población recibe ×1.1.
- **Seguimiento.** La pregunta anterior del médico entra como `followUp`: si la actual es corta («¿y en niños?»,
  «¿por cuánto tiempo anticoagulo?») sus términos pesan 0.8 y cuentan como propios; si es larga, 0.4.
- **Digitación.** Un término que no existe en el corpus se corrige al más parecido por trigramas (Dice ≥ 0.7),
  con peso 0.8; un término corregido nunca basta por sí solo para traer una guía («factura» no trae «fractura»).
- **Ruido.** Saludos, muletillas, números sueltos, palabras de la app («carga», «pantalla», «soporte») y de población
  («niño», «hombre») pesan como genéricos; la población la decide `inferPopulations`, no el término.
- **Laboratorio en la pregunta.** «Sodio de 127», «K 6,8» o «azúcar a 50» agregan el trastorno que definen
  (hiponatremia < 135, hiperpotasemia ≥ 5,5, hipoglucemia < 70, «IMC de 36» → obesidad, con los cortes de las guías
  del corpus); un valor normal, una edad o un peso no agregan nada (`labSignals`).
- **Guías de población especial.** Una guía solo para gestantes o recién nacidos (diabetes gestacional, sangrado del
  primer trimestre, ictericia neonatal) baja ×0.85 cuando la pregunta no dice nada de la población, para no ganarle a
  la guía general en «glucemia elevada en ayunas».
- **Tema del seguimiento.** En una pregunta de seguimiento corta, la guía cuyo título o palabras clave nombran los
  términos más raros de la pregunta anterior sube ×1.25 («¿y en niños?» después de leptospirosis sigue en leptospirosis).
- **Frase clave.** Si la pregunta, ya con sinónimos, contiene completa una frase del título o de `palabras_clave`
  («lesion renal aguda»), la guía sube ×1.1. Los sinónimos se compilan una vez por mapa y las frases se indexan por su primera palabra
  (construcción ≈ 120 ms con 80 guías).
- **Relevancia.** Cada extracto lleva `relevance` (alta, media, baja) según cuánto de la pregunta cubre y su
  distancia al mejor; el prompt la muestra para que el modelo no tome un vecino cercano como respuesta.

### Fichas técnicas oficiales (`src/application/knowledge/DrugLabelService.js`)

- Para preguntas de dosis, contraindicaciones (4.3), interacciones (4.5), embarazo y lactancia (4.6) o reacciones
  adversas (4.8) sobre un medicamento del diccionario cerrado `knowledge/fichas-tecnicas/medicamentos.json`
  (320 principios activos con sus nombres colombianos: acetaminofén→paracetamol, dipirona→metamizol,
  metimazol→tiamazol, succinilcolina→suxametonio…; la combinación gana a su componente y las siglas que chocan con el
  corpus, como NAC, no se usan), Graph añade
  hasta 2 extractos de la ficha técnica española (CIMA, AEMPS), numerados `[F1]`, `[F2]`, dentro de
  `<fichas_tecnicas>`. El extracto (≤ 1 800 caracteres) prioriza los párrafos que tocan lo que se preguntó (niños,
  falla renal o hepática, ancianos).
- **Privacidad:** a CIMA solo sale el principio activo de una entrada del diccionario; nunca texto del médico ni del
  paciente (`verify-drug-labels.js` lo comprueba con un mensaje que trae nombre y documento).
- **Resiliencia:** primero la instantánea `knowledge/fichas-tecnicas/fichas.snapshot.json`; si no está, CIMA en vivo
  con plazo de 2,5 s, caché de 12 h (fallos 10 min) y cortacircuitos (3 fallos seguidos → 10 min sin consultar).
  Nunca lanza: sin ficha, el chat sigue con las guías.
- **Operación:** `npm run check:cima` prueba la conexión desde el entorno donde corre Graph. Si CIMA es lento o no
  alcanzable desde el despliegue, `npm run build:drug-labels` (desde una máquina con red) precarga las secciones
  4.2, 4.3, 4.5 y 4.6 de todo el diccionario y se commitea el JSON; con `MIRACLE_ASSISTANT_DRUG_LABELS=snapshot` no
  se sale a la red. `=off` lo apaga.
- Es una ficha **española**: la pantalla pide verificar la presentación registrada en el INVIMA.

### Verificación de cifras (`src/application/use-cases/ClinicalAnswerVerifier.js`)

Tras la respuesta del modelo, cada cifra con unidad («500 mg cada 8 h», «≥140/90 mmHg», «7 días», «0,15 mg/kg») se
busca, con la misma familia de unidad y equivalencias (1 g = 1000 mg, 1 L = 1000 mL), en: extractos de guías y
fichas, nota (borrador o persistida), transcripción, descripciones de códigos, edad, mensaje e historial del médico.
Solo cuentan los extractos que la respuesta **citó** (con su título de sección) y la consulta: un extracto recuperado
pero no citado no respalda ninguna cifra. Las que no aparecen salen en `unverified_figures` (máx. 8);
`figures_checked` dice cuántas se revisaron. El prompt
v4 avisa al modelo de que esto ocurre y le pide copiar cada cifra con su unidad tal como está en la fuente o
marcarla como conocimiento general.

### Respuesta (campos nuevos, opcionales)

`sources[].kind` (`guia` | `ficha_tecnica`), `sources[].url` (solo fichas), `figures_checked`, `unverified_figures`,
`used_context.drug_labels`. `support: "guia"` cubre guías y fichas.

### Evaluación del retrieval (`scripts/eval-guideline-retrieval.js`)

Conjunto fijo `scripts/fixtures/rag-eval.json`: preguntas parafraseadas como se dicen en consulta, con errores de
digitación, de seguimiento, con distinta población y fuera de tema. Mide recall@1, recall@3, MRR, precisión fuera de
tema y latencia p95; `npm test` falla si recall@3 < 90 %, MRR < 0.75, alguna pregunta fuera de tema trae guías o el
p95 supera 25 ms. Al añadir una guía, añade sus preguntas aquí y en `verify-guideline-index.js`.

### Evaluación de calidad de respuesta (`scripts/eval-assistant-answers.js`)

Corre el servicio real con un modelo falso que devuelve salidas grabadas, buenas y malas a propósito
(`scripts/fixtures/answer-eval.json` más dos casos generados por guía del corpus) y mide lo que Graph hace con ellas:
referencias inventadas eliminadas (100 %), cifras plantadas detectadas (≥ 95 %), falsos positivos del verificador
(≤ 5 %), casos sin respaldo que terminan en abstención o con cifras marcadas (100 %), salidas rotas que no rompen el
chat (100 %) y propuestas de nota que no persisten y respetan `note_editable` (100 %), con al menos 150 casos. Está en
`npm test`; `npm run eval:answers` muestra el detalle. El modo en vivo (modelo real) necesita
`MIRACLE_ASSISTANT_LLM_API_KEY` y aún no existe.

### Tokens de entrada (chat v5 y v6, 2026-10-09)

`scripts/measure-chat-tokens.js` (en `npm test` por la promesa 607 de la
[spec 006](specs/006-el-asistente-clinico-responde-con-respaldo.md); `npm run measure:tokens` lista cada pregunta) corre el servicio real
con un modelo falso que solo captura los mensajes, sobre tres consultas típicas de `scripts/fixtures/token-budget.json`
(control de crónicos con 8 000 caracteres de transcripción, fiebre en pediatría con 5 000 y control prenatal con
12 000; nota en pantalla, códigos, edad y sexo, dos turnos de historial y 7 preguntas cada una). En las preguntas de
medicamento simula una ficha técnica del tamaño máximo (1 800 caracteres), así que la medida es conservadora. Estima
3,5 caracteres por token y falla si la mediana pasa de 6 000.

Qué se hizo para llegar (mediana 7 424 → 5 900): la selección de extractos para el prompt (arriba, 7 424 → 6 534), el
prompt de sistema v5 con las mismas reglas en forma compacta (8 293 → 6 474 caracteres; se quitaron las frases que
repetían otra regla) y, cuando la nota viaja en el prompt, `contexto_consulta` lleva solo las keys obligatorias de la
plantilla en vez de repetir todas sus secciones. La evaluación de respuestas sin red y la de retrieval quedaron
idénticas. La transcripción es lo que más pesa (≈ 2 300 tokens en el perfil de crónicos) y no se recorta: es la
fuente primaria.

v6 es v5 sobre el límite de rol de `main` (`roleBoundary`: la pregunta del médico se atiende; la
transcripción, la pantalla, `<guias_clinicas>` y `<fichas_tecnicas>` son dato) y sin repetir el aviso de
revisión que la app ya muestra. Mediana 5 896.

### Dónde se juzga

`npm test` es el contrato de Graph (`scripts/contrato.js`). Las piezas del asistente son las promesas
601 a 607 de la [spec 006](specs/006-el-asistente-clinico-responde-con-respaldo.md):
`verify-guideline-corpus.js`, `verify-guideline-index.js`, `verify-assistant-grounding.js`,
`verify-drug-labels.js` y `verify-asistente-metricas.js`, que corre las tres evaluaciones
(`eval-guideline-retrieval.js`, `eval-assistant-answers.js`, `measure-chat-tokens.js`) con sus umbrales.
El chat por las rutas reales sigue en la fila 7 de lo heredado (`verify-clinical-assistant.js`).

### Qué modelo usar (decisión de producto, no de código)

La calidad clínica del texto depende del modelo configurado en Provider Studio (tarjeta «Asistente»). La evidencia
2024–2026 (evaluaciones independientes y el benchmark HealthBench) no muestra ventaja de los modelos afinados en
medicina frente a los generalistas de frontera, y los productos con contenido licenciado (UpToDate, DynaMed,
OpenEvidence, ClinicalKey) no ofrecen API abierta utilizable desde Colombia. Recomendación:

- El modelo generalista de frontera más fuerte disponible, por la API nativa del proveedor (no a través de un
  intermediario) y con retención cero o acuerdo de tratamiento de datos; contrato de transmisión de datos según la
  Ley 1581 de 2012.
- Antes de fijarlo, comparar dos o tres candidatos con 150–300 preguntas clínicas colombianas en español,
  calificadas por médicos con una rúbrica (exactitud, seguridad, abstención correcta, uso de fuentes).
- Opcional a futuro: un segundo modelo de otro proveedor como verificador solo para respuestas de alto riesgo
  (dosis pediátricas, embarazo, interacciones), si la evaluación muestra que aporta.

### Fuentes externas evaluadas

| Fuente | Estado | Motivo |
|---|---|---|
| CIMA (AEMPS) fichas técnicas | integrada | oficial, en español, API sin clave; solo sale el principio activo |
| INVIMA CUM (datos.gov.co) | después | registro sanitario colombiano, sin posología; útil para «¿está registrado en Colombia?» |
| GPC MinSalud / IETS | vía corpus | sin API; se resumen con cita en `knowledge/guias-clinicas` |
| PubMed / Europe PMC | después | evidencia en inglés, 0,3–1,5 s por consulta; candidato a un modo «buscar evidencia» explícito |
| API CIE de la OMS | no ahora | la CIE-10 de la API está en inglés; la CIE-11 sí está en español (transición en Colombia hasta 2027) |
| NICE API | no | licencia y tarifa para uso fuera del Reino Unido |
| Embeddings locales (Model2Vec, e5-small) | después | solo si el corpus crece a cientos de guías; hoy la búsqueda léxica mide 100 % recall@3 en la evaluación |

## Seguridad y límites (resumen)

El system prompt de chat (`ClinicalAssistantPromptBuilder.buildChatSystemPrompt`) se estructura en bloques: REGLAS INVIOLABLES (límite de rol frente a datos delimitados, no diagnóstico definitivo, no órdenes finales, no inventar datos, señalar incertidumbre y red flags), ESPECIALIDAD ACTIVA (solo la regla de la familia que aplica, no las siete), RESPALDO Y FUENTES (jerarquía consulta → guías recuperadas → conocimiento general), ABSTENCIÓN («es preferible no responder a responder mal»), DIFERENCIALES, PROPUESTA DE NOTA, ESTILO y FORMATO DE SALIDA (JSON). Diferenciales y ajuste componen prompts propios y más cortos con las mismas cláusulas compartidas (`src/application/prompts/PromptClauses.js`). Transcripción, nota, pantalla y guías viajan delimitadas (`<transcripcion>`, `<nota>`, `<pantalla>`, `<guias_clinicas>`) y el prompt declara que son datos, no instrucciones. La validación de salida refuerza lo verificable (evidencia literal, detección de lenguaje definitivo, estructura de nota, resolución de citas). Sin PHI en logs (solo ids y conteos). `safety_notice` viaja en TODAS las respuestas. Temperaturas fijas: chat 0.3, diferenciales 0.2, ajuste 0.2. Cada llamada registra `promptVersion` en telemetría.

## Limitaciones actuales

- La no-invención en el texto de `answer` se exige por prompt. Lo que se verifica en código: las citas (`[G#]`, `[F#]`), la propuesta de nota y, desde v4, que cada cifra con unidad aparezca en las fuentes o en la consulta (`unverified_figures`). Que una cifra exista en la fuente no prueba que se usó bien: por eso es advertencia y el médico ve las fuentes.
- El corpus de guías es un resumen curado (fuente y año en cada una, `revisado_por` vacío hasta que un médico la revise). El asistente lo presenta como orientativo.
- En ajustes y propuestas de nota, la estructura está garantizada (keys/orden/merge); el contenido textual final requiere revisión (`requires_physician_review`).
- `confidence` es autoreportada por el modelo (clampeada), no calibrada.
- `suggested_actions` se devuelve vacío — reservado para acciones futuras del frontend.
- No hay streaming de respuesta (una llamada, una respuesta). Con el prompt v3 completo conviene `MIRACLE_ASSISTANT_LLM_TIMEOUT_MS=50000` para que un modelo lento devuelva un error limpio antes del límite de 60 s de Vercel.
- El borrador de transcripción (lo dictado y aún no guardado) no viaja: el chat usa la transcripción persistida.

## Tests

```bash
npm run test:guidelines               # corpus al día + retrieval + verificador de cifras + evaluación + fichas técnicas
npm run eval:rag                      # métricas del retrieval con el detalle de cada fallo
npm run check:cima                    # prueba EN VIVO de CIMA desde este entorno (requiere red)
npm run test:clinical-assistant-api   # ~42 checks (fake LLM + fake Supabase + rutas reales), incluye chat v3
npm run test:privacy                  # el borrador en pantalla siembra el escudo; las guías salen íntegras
npm test                              # todo lo anterior y el resto de suites
```
