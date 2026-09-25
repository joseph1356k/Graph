# El escudo de privacidad: qué sale hacia los proveedores de IA, y qué no

Cómo Graph reemplaza los identificadores directos del paciente antes de que un
texto salga hacia un proveedor externo de IA, cómo los devuelve al volver la
respuesta, y cómo se demuestra.

> La frontera es el último salto antes del proveedor. Por debajo de ese salto no
> hay ningún punto de persistencia, así que todo lo que Miracle guarda —la nota
> del taller, la versión de la IA, el espejo en el historial, el snapshot de
> exportación, los valores que Operations escribe en SAP— lleva los datos reales.

## Por qué aquí y no en el navegador

Hasta el 2026-09-07 el portal tenía un redactor en el navegador
(`lib/privacy/redact.ts`). Estaba apagado desde el 2026-07-21 porque su `[NUMERO]`
era irreversible y el médico perdía la cédula de la transcripción; solo tapaba al
paciente registrado y asociado (casi nunca lo está); y, encendido, guardaba la
nota **con marcadores** en Graph, que a su vez espeja `consultations` desde el
servidor y congela el snapshot de exportación desde ahí. Los marcadores habrían
llegado a SAP. Ese es el fallo que este diseño existe para impedir.

Las llamadas reales al modelo no viven en el portal: viven aquí, y todas las de
texto pasan por `LLMProvider.postChatCompletions` — el mismo paso obligado que ya
se instrumentó para medir consumo. Instrumentarlo una vez cubre a los ~15
servicios que llaman a un modelo, y una ruta nueva no puede «olvidarse» del escudo.

## Piezas

| Pieza | Responsabilidad |
|---|---|
| [`src/domain/privacy/tokens.js`](../src/domain/privacy/tokens.js) | Gramática de marcadores (`[PACIENTE_NOMBRE_1]`, alias `[PACIENTE_NOMBRE_1_2]`), reconocimiento tolerante, normalización de alias en la casilla de identificación |
| [`src/domain/privacy/canon.js`](../src/domain/privacy/canon.js) | Cómo se escribe un nombre, un documento o un teléfono para poder encontrarlos (portado del portal); nunca reescribe nada |
| [`src/domain/privacy/detectors.js`](../src/domain/privacy/detectors.js) | Detectores deterministas: nombre anclado, documento (con separadores y en palabras), teléfono, correo, dirección, corridas largas de dígitos |
| [`src/domain/privacy/ProtectionMap.js`](../src/domain/privacy/ProtectionMap.js) | El mapa de UNA llamada: semillas, sustitución, restauración exacta, barrido anti-fuga |
| [`src/domain/privacy/jsonWalk.js`](../src/domain/privacy/jsonWalk.js) | Recorrido de las hojas de un JSON: los prompts salen como un solo `JSON.stringify` |
| [`src/domain/privacy/identitySection.js`](../src/domain/privacy/identitySection.js) | Lectura de «Nombre:» / «Documento:» para el chequeo post-hoc |
| [`PrivacyShieldService`](../src/application/use-cases/PrivacyShieldService.js) | Semillas por ámbito, modos, protect/restore de un payload de chat y de los textos que van al runtime Python, resumen para el ledger |
| [`PrivacyContext`](../src/infrastructure/privacy/PrivacyContext.js) | Ámbito por `AsyncLocalStorage`, fijado por el servicio que conoce el encounter |
| [`SupabasePatientSeedRepository`](../src/infrastructure/repositories/SupabasePatientSeedRepository.js) | Lectura mínima de `patients`, `profiles`, `consultations` para sembrar |
| [`PrivacyLedgerReader`](../src/infrastructure/privacy/PrivacyLedgerReader.js) | Lo que se protegió en cada envío de una consulta, leído del ledger de consumo |

## Los marcadores

`[<TIPO>_<n>]` es la forma principal de una entidad; `[<TIPO>_<n>_<k>]` es cada
alias distinto de la misma entidad. **Cada marcador restaura exactamente la forma
que tapó**: «don José» vuelve como «don José» y «23-45-67-75-43» vuelve con sus
guiones. El modo literal de patología y los validadores de evidencia comparan
texto exacto, y una forma canónica en su lugar rompía los dos. La canonización
del documento sigue viviendo donde vivía, en el borde del portal
(`lib/clinical/patient-identity.ts`).

| Marcador | Qué tapa |
|---|---|
| `[PACIENTE_NOMBRE_n]` | nombre del paciente: frase completa y tramos de ≥2 palabras; tokens sueltos solo con mayúscula o pegados a un ancla, y nunca los que son palabras corrientes («Luz», «Dolores») sin ancla |
| `[DOCUMENTO_n]` | cédula, TI, RC, CE, pasaporte, PPT, NUIP; con los separadores del dictado y también en palabras («uno cero tres seis…»); correcciones («repito: …») |
| `[TELEFONO_n]` | celular y fijo colombianos, con separadores |
| `[CORREO_n]` | correo electrónico |
| `[DIRECCION_n]` | tras «dirección», «vive en», «reside en», «domicilio», si hay un patrón vial |
| `[NUMERO_n]` | corrida de 7–12 dígitos sin ancla que no es valor clínico; reversible, a diferencia del `[NUMERO]` viejo |

Diferido a una segunda versión, por coste de falsos positivos: terceros sin ancla
(`[PERSONA_n]`), fecha de nacimiento, correo dictado («arroba», «punto»).

Lo que **no se tapa**, a propósito: el nombre del médico (dato propio; el asistente
lo usa por preferencia explícita del médico y se usa como semilla negativa para
que nunca pase por paciente), edad, sexo, EPS y todo lo clínico.

Dos reglas que no se relajan:

- **Solo se restauran los marcadores que emitió el `protect` de esa misma llamada.**
  Un marcador que venga en el texto del cliente (historial del chat, `noteContent`
  del ejecutor) es texto opaco. Sin esto, la X-API-Key compartida del cliente
  Windows sería un oráculo para obtener el nombre de cualquier consulta.
- **En la casilla de identificación un alias se lleva a la forma principal**, para
  que «Nombre:» salga con el nombre registrado completo y no con el diminutivo que
  el modelo copió de la prosa. En cualquier otro sitio, la forma exacta.

## Qué ocurre en cada llamada

1. **Ámbito.** Lo fija el servicio que conoce el encounter, no la ruta:
   `ClinicalNoteGeneratorService`, `ClinicalAssistantService`, `NoteFieldMatcher`
   y `DynamicValueResolver` envuelven su llamada con `withPrivacyScope(...)`. El
   rescate oportunista corre bajo `runAsSystem`: antes heredaba el contexto de la
   petición de un médico cualquiera.
2. **Semillas por llamada** (sin bóveda persistente; todo se recalcula desde lo
   que el servicio ya tiene cargado): paciente registrado (`clinical_encounters.
   patient_id` validado como uuid y por organización → `patients`), líneas
   «Nombre:»/«Documento:» de la nota, detección anclada sobre la transcripción del
   encounter, y para Operations la identidad que la web dejó en `consultations`.
   Los campos de pantalla con etiqueta de identidad («Nombre del paciente» =
   «Ana Torres») se siembran por su etiqueta: el valor es de quien esté en
   pantalla y no lleva ancla.
3. **Detección** sobre cada parte de texto de `messages`; si el contenido parsea
   como JSON se recorren sus hojas string, saltando claves estructurales (`key`,
   `selector`, `stepOrder`…), y se vuelve a serializar.
4. **Sustitución** valor → marcador, más largo primero, insensible a tildes y
   mayúsculas, tolerante a separadores en cifras; mismo valor ⇒ mismo marcador.
   Sobre una **copia**: el payload del llamador no se toca.
5. **Barrido anti-fuga:** ninguna semilla poco ambigua (frases de ≥2 palabras,
   corridas de dígitos) puede seguir visible; si sigue, reemplazo literal y
   `leak_scan: repaired`.
6. **Regla de sistema**, solo si hubo marcadores: qué son y que se copien tal cual.
7. **Llamada** al proveedor con la copia tapada. `protect` corre **antes** de
   `usageRecorder.measure` (un fallo del escudo no es una llamada facturable ni
   una caída del proveedor); la respuesta se rehidrata **dentro** de la llamada,
   así que ningún servicio ve marcadores. Se rechaza `stream: true`; `error.response`
   se conserva sin `config` para que un error nunca lleve el cuerpo enviado.
8. **Ledger:** `ai_usage_events.metadata` lleva `privacyMode`, `privacyTokens`
   («PACIENTE_NOMBRE:2,DOCUMENTO:1»), `privacySeeded`, `privacyDetected`,
   `privacyLeakScan`, `privacyRehydration`, `privacyImageParts`,
   `privacyPayloadSha256`, `privacyPosthoc`. Conteos y estados; **nunca valores**.
9. **Chequeo post-hoc** (generación, `enforce`): si la casilla de identificación
   vuelve con un nombre o documento real en vez de un marcador, el modelo lo vio.
   Se cuenta (`privacyPosthoc`) y la alerta diaria lo dice; **no se siembra** con
   ello (auto-sembrar convertiría el nombre del médico o de un familiar en tapado
   permanente).

## Modos

`PRIVACY_SHIELD_MODE` (global) y `PRIVACY_SHIELD_MODE_<FEATURE>` (por
funcionalidad: `NOTE_GENERATION`, `ASISTENTE`, `FIELD_MATCHING`, `DYNAMIC_VALUES`,
`DIAGNOSIS_SUGGESTION`, `CLINICAL_STRUCTURING`). Hace falta por funcionalidad
porque `GRAPH_LLM_*` sirve a la vez generación y matching.

| Modo | Qué sale | Para qué |
|---|---|---|
| `off` | el original; el ledger lo dice | comportamiento anterior |
| `shadow` (defecto) | el original; el ledger anota cuánto **habría** tapado | calibrar sin tocar la calidad de la nota |
| `enforce` | la copia tapada; falla cerrado (`PRIVACY_SHIELD_FAILED`, 503) si el escudo no puede correr | el claim |

Despliegue recomendado: `shadow` unos días → revisar `privacyTokens` en el ledger
y `clinical_note_edit_stats` → `enforce` por funcionalidad, generación primero.
En `/api/v1/pipeline` un fallo del escudo no llega al cliente Windows como 503:
`NoteFieldMatcher.match` ya traga errores y responde `matches: []`, que es seguro.

## Operations / SAP

- `/api/v1/pipeline`, `/api/v1/autofill/match`, `/api/workflows/:id/note-field-matches`
  y `/api/v1/workflows/:id/plan` aceptan `consultation_id` (o `export_id`, o
  `variables.consultationId`) para sembrar desde `consultations` y `patients`. Sin
  él, las líneas de identidad de la propia nota y los campos con etiqueta de
  identidad bastan.
- La etapa `note` del pipeline y `/api/medical/notes/organized` se tapan en el
  salto Node → runtime Python (`callMiracleRuntime`): el runtime no tiene otra
  fuente de datos, así que taparlo ahí equivale a taparlo antes del proveedor.
- **Guarda de marcadores:** `NoteFieldMatcher.normalizeResult` y
  `DynamicValueResolver.resolve` descartan cualquier valor que traiga un marcador
  sin resolver. El cliente Windows escribe en SAP lo que recibe sin mirarlo, lo
  relee no vacío y lo reporta como éxito; sin esta guarda un marcador acabaría en
  la historia clínica.

## Registro de excepciones (lo que el escudo NO cubre)

| Código | Egreso | Estado | Decisión pendiente |
|---|---|---|---|
| **E4** | Puente consciente (`conscious-brain/openaiBrain.js`, `geminiBrain.js`): captura de pantalla completa + árbol UIA + valores SAP hacia OpenAI/Gemini | fuera del escudo; el hilo vive en el proveedor (`previous_response_id`) y un mapa por turno cambiaría el significado de los marcadores entre turnos | fase propia: mapa por sesión, política de capturas (`deny` = no declarar la herramienta `computer`/`look`) |
| **E8** | Audio de la consulta → Deepgram/Soniox: desde el navegador y el PC del hospital por WebSocket con token efímero, y desde Graph (`ClinicalRawTranscriptionService`, audio del collar Omi) | necesario para transcribir; sin retención en Miracle | contrato de encargado sin retención, o STT propio/en región. `redact` de Deepgram no ayuda: el audio ya salió |
| **E10** | Video de enseñanza (`teach/GeminiVideoClient.js`): grabación de pantalla + audio del HIS hacia Gemini, con el texto de los pasos grabados | fuera del flujo de Notes; solo protección por prompt | tapar el texto de los pasos; grabar solo sobre datos de prueba |
| E5–E7 | Fotos (horario del día, hoja de patología, formulario) hacia modelos de visión, desde el portal y `BiopsyExtractionService` | imagen: no se puede tapar texto | mover al ledger como excepción declarada; a futuro OCR local + escudo de texto |
| **E12** | Proxy de voz Live para Android (`web/api/liveVoiceProxy.js`, WebSocket en `/api/android/live/session`): relé entre la app y `wss://api.openai.com/v1/live/sessions`. Por él pasan, en las dos direcciones, el audio de la conversación y los eventos de la sesión, cada trama tal cual llega: el proxy no la interpreta ni la filtra. Lo que la app ponga en esa sesión sale hacia OpenAI y Graph no puede verificar su contenido. La key (`OPENAI_LIVE_KEY`) vive solo en el servidor; el celular no la ve | fuera del escudo de privacidad: no pasa por `PrivacyShieldService` y no se tapa nada. Lo autoriza la whitelist `graph_app_users.realtime_allowed` (la enciende el panel Android de Provider Studio), y la petición solo lleva `device_id`: no hay otra credencial. El proxy no persiste las tramas; el log de cierre lleva conteos, bytes, duración y el `device_id`, nunca el contenido | retención: según los términos de OpenAI; Graph no la fija ni puede comprobarla. Sin decisión tomada sobre si esta ruta puede llevar datos de pacientes: hoy Graph no lo impide ni lo detecta. Por decidir: si basta el `device_id` como única credencial |
| **E13** | Token efímero de voz Realtime para Android (`RealtimeSessionService.js`, `POST /api/android/realtime/session`): Graph llama a `https://api.openai.com/v1/realtime/client_secrets` con la key `OPENAI_REALTIME_KEY` (solo en el servidor) y en el cuerpo manda únicamente `{ session: { type: 'realtime', model: 'gpt-realtime' } }`: ningún dato del usuario, ni `device_id`, ni audio ni texto. Devuelve al celular el `client_secret` de un solo uso y su `expires_at`; no lo guarda ni lo registra. La conversación posterior va del celular directo a OpenAI (`wss://api.openai.com/v1/realtime`) sin pasar por Graph: comprobado leyendo el cliente Android (`RealtimeVoiceClient.kt`, 2026-09-25); desde este repo no se puede comprobar | fuera del escudo: por Graph no pasa nada de la conversación, así que aquí no hay qué tapar, y el audio y los eventos de esa sesión quedan fuera de Graph y del escudo. Lo autoriza la misma whitelist `graph_app_users.realtime_allowed`; la ruta es pública (sin sesión de Provider Studio) y la petición solo lleva `device_id` | retención: según los términos de OpenAI; Graph no la fija ni puede comprobarla, y la sesión posterior ni siquiera pasa por Graph. Por decidir: si basta el `device_id` como única credencial |

`scripts/verify-egress-gateway.js` falla si aparece un transporte hacia un
proveedor que no esté en esta tabla ni en la lista de transportes con escudo.

## Cómo se demuestra

```bash
npm run test:privacy      # corpus dorado + por el cable + estructural
npm test                  # toda la suite, incluidos los tres
node scripts/evidencia-privacidad.js <consultation_id>   # sobre una consulta real
```

| Prueba | Qué demuestra |
|---|---|
| `verify-privacy-shield.js` | el corpus dorado (`tests/fixtures/privacidad/corpus.json`, ≥60 fragmentos con nombre compuesto, cédula en grupos y en palabras, celular, correo, dirección, médico presentándose, nombres que son palabras y valores clínicos que no se tocan): recall ≥ 0,98 y precisión ≥ 0,95, restauración exacta, alias, marcadores desconocidos, barrido, aislamiento, modos |
| `verify-privacy-gateway-e2e.js` | **por el cable**: rutas reales + Supabase falso + `LLMProvider` real apuntado a un proveedor HTTP falso que hace `assert` sobre el cuerpo recibido. Generación, asistente con historial real, sugerencias con evidencia literal, pipeline (runtime Python + matches para SAP), valores dinámicos, dos consultas con el mismo nombre, shadow, streaming rechazado, fallo cerrado, marcadores del cliente, `GET /privacy` |
| `verify-egress-gateway.js` | estructural: nadie nombra un proveedor fuera de los transportes conocidos; `protect → POST (copia) → restore` en ese orden; el salto a Python tapado; las excepciones declaradas aquí; las guardas antes de SAP |
| `evidencia-privacidad.js` | para una consulta real: cada envío con su protección y la comprobación de que lo persistido no contiene marcadores. Es lo que se le enseña a un hospital |

`GET /api/clinical/encounters/:id/privacy` devuelve lo mismo que el informe para
el médico dueño del encounter (conteos y estados, sin valores); es lo que el
portal muestra en vez de una insignia fija.

## El claim, y su alcance

Cuando generación, asistente y matching estén en `enforce` con el informe en verde:

> «Antes de enviar texto de una consulta a un proveedor externo de IA, Miracle
> reemplaza dentro de su propia infraestructura los identificadores directos del
> paciente (nombre, documento, teléfono, correo y dirección) por marcadores sin
> significado; el proveedor trabaja sólo con esa representación, y los datos
> reales se reconstruyen únicamente dentro de Miracle antes de guardar la nota,
> mostrarla al médico o llevarla al sistema del hospital. Cada envío queda
> registrado con el resultado de esa protección. El audio de la consulta se
> transcribe con un proveedor de voz bajo contrato de encargado, y las funciones
> que envían imágenes están identificadas y son opcionales.»

No se usa comercialmente hasta que `evidencia-privacidad.js` lo demuestre sobre
consultas reales.

## Limitaciones conocidas

- El detector es determinista: un nombre dictado sin ningún ancla y sin registro
  previo («viene con fiebre, Pedro») no se tapa. El chequeo post-hoc mide cuánto
  pasa; el corpus es donde se cierra cada patrón que aparezca.
- `formatExample` de los valores dinámicos lleva el valor grabado de otra
  ejecución (la persona con la que se enseñó el workflow): las cifras caen como
  `[NUMERO_n]`, un nombre suelto sin ancla puede no caer.
- El escudo tapa texto. Las imágenes, el audio y el video son fronteras aparte
  (tabla de excepciones).
