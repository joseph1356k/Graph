# Guía para consumir la API de Miracle

Esta guía es para conectar **cualquier aplicación cliente** (app de Windows,
extensión, web, scripts) al backend de Miracle y usar sus funcionalidades:
transcripción de voz, organización de la nota médica y (pronto) autofill.

Todo se consume vía HTTPS bajo `/api/v1`.

---

## 1. URL base

```
https://miracle-zeta.vercel.app
```

> Si más adelante hay un dominio propio, solo cambia la URL base; las rutas
> (`/api/v1/...`) no cambian.

---

## 2. Autenticación: cómo obtener tu token

**Todas** las llamadas a `/api/v1/*` se autentican con una **API key
permanente**. Es el único método (no hay tokens temporales).

El dueño del backend te entrega la API key (una cadena secreta) por un canal
privado. **No expira**. Va en la cabecera `X-API-Key`:

```
X-API-Key: <TU_API_KEY>
```

(También se acepta como `Authorization: Bearer <TU_API_KEY>`.)

Eso es todo. Si falta o es inválida, la API responde `401 API key invalida o
ausente`. Guarda la key en un gestor de secretos; nunca la subas a un repo.

---

## 3. El llamado principal: `POST /api/v1/pipeline`

Un solo llamado que hace **transcripción cruda + nota organizada + autofill**.
Con `stages` decides qué procesa el backend; lo que no actives, no se procesa
(ni se cobra en LLM).

### Ejemplo mínimo (transcripción → nota)

```bash
curl -sX POST https://miracle-zeta.vercel.app/api/v1/pipeline \
  -H "X-API-Key: <TU_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "paciente con dolor de rodilla derecha desde la semana pasada",
    "note": { "content": "", "title": "Nota" },
    "stages": { "transcription": true, "note": true, "autofill": false }
  }'
```

Respuesta (solo trae lo que pediste):

```json
{
  "session_id": "…",
  "stages": { "transcription": true, "note": true, "autofill": false },
  "transcription": { "text": "paciente con dolor de rodilla derecha desde la semana pasada" },
  "note": {
    "content": "## Motivo de consulta\n- Dolor de rodilla derecha (1 semana)",
    "backend_status": "product-llm",
    "usage": { "model": "gpt-4.1-mini", "total_tokens": 1110 }
  }
}
```

### Parámetros del body

| Campo | Tipo | Descripción |
|---|---|---|
| `transcript` | string | Texto crudo a procesar (obligatorio si activas `note`). |
| `note.content` | string | Nota actual (markdown). El backend acumula sobre esto. |
| `note.title` | string | Título de la nota. |
| `session_id` | string | Reúsalo entre llamadas para acumular una misma sesión de dictado. |
| `sequence` | number | Nº de segmento (1, 2, 3…) en dictado en streaming. |
| `language` | string | Idioma (`es`). |
| `fields` | array | Campos detectados por el cliente (para autofill). |
| `stages` | object | `{ transcription, note, autofill }` — activa/desactiva etapas. |

### Combinaciones típicas

- **Solo transcripción cruda:** `"stages": { "transcription": true, "note": false, "autofill": false }`
- **Transcripción + nota** (default): `"stages": { "note": true }`
- **Todo** (cuando llegue autofill): `"stages": { "note": true, "autofill": true }` + `"fields": [...]`

### Ejemplo en JavaScript (fetch)

```js
const res = await fetch("https://miracle-zeta.vercel.app/api/v1/pipeline", {
  method: "POST",
  headers: {
    "X-API-Key": apiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    transcript: "el paciente refiere fiebre de 3 dias",
    note: { content: "", title: "Nota" },
    stages: { note: true },
  }),
});
const data = await res.json();
console.log(data.note.content);
```

---

## 4. Dictado en tiempo real (transcripción cruda en streaming)

La transcripción cruda en vivo es un flujo bidireccional, así que va por su
propio canal:

1. Pide credenciales de streaming:

```bash
curl -sX POST https://miracle-zeta.vercel.app/api/v1/transcription/session \
  -H "X-API-Key: <TU_API_KEY>" -H "Content-Type: application/json" -d '{}'
```

Respuesta:

```json
{
  "provider": "deepgram",
  "access_token": "…",
  "auth_scheme": "bearer",
  "websocket_url": "wss://api.deepgram.com/v1/listen?model=nova-3&language=es&…",
  "timeslice_ms": 250
}
```

2. Con esas credenciales, tu cliente abre el WebSocket a `websocket_url`
   (subprotocolos `["bearer", access_token]`) y envía audio (`MediaRecorder`,
   webm/opus, chunks cada `timeslice_ms`). Deepgram devuelve parciales y
   finales.
3. Por cada transcripción **final**, llama a `POST /api/v1/pipeline` con ese
   `transcript` (reutilizando el `session_id`) para obtener la nota organizada.

> El motor de dictado del navegador ya hace esto; puedes ver la implementación
> de referencia en `web/public/shared/deepgram-dictation.js`.

---

## 5. Descubrir capacidades

```bash
curl -s https://miracle-zeta.vercel.app/api/v1 -H "X-API-Key: <TU_API_KEY>"
```

Devuelve el manifiesto con las etapas y endpoints disponibles.

---

## 6. Errores comunes

| Código | Significado | Qué hacer |
|---|---|---|
| `401` `API key invalida o ausente` | Falta la `X-API-Key` o no es válida. | Revisa la API key (sección 2). |
| `429` | Límite de tasa (20/min en `/pipeline`). | Reintenta con backoff. |
| `503` `runtime no configurado` | El motor de nota no está disponible en ese entorno. | Avisa al dueño del backend. |
| `note.status: "skipped"` | Faltó `transcript`. | Envía `transcript`. |
| `autofill.status: "skipped"` | Falta `fields` (o autofill aún no activo). | Envía `fields` cuando esté disponible. |

---

## 7. Estado actual y próximos pasos

- ✅ **Transcripción cruda** (streaming) y **nota organizada**: listas.
- 🟡 **Autofill**: la etapa ya existe en la API; se activa enviando `fields` y
  se completará al refactorizar la capa de detección de campos del cliente.
- 🔜 **Pipeline unificado en streaming** (un solo canal audio→crudo→nota→autofill).
- 🔜 **Gestión de API keys desde el dashboard** (crear/rotar sin tocar env vars).
