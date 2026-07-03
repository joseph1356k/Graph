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

**Todas** las llamadas a `/api/v1/*` necesitan autenticación. Para apps/scripts
lo recomendado es una **API key permanente**; también se acepta un token de
sesión temporal.

### Opción 0 — API key permanente (recomendada para apps) ✅

El dueño del backend te entrega una **API key** (una cadena secreta) por un
canal privado. **No expira** y va en la cabecera `X-API-Key`:

```
X-API-Key: <TU_API_KEY>
```

(También funciona como `Authorization: Bearer <TU_API_KEY>`.)

Esa es toda la autenticación que necesitas para una app. Las opciones A y B de
abajo (token de sesión de 12 h) son solo si prefieres usar una cuenta humana.

### Opción A — Programática (recomendada para apps/scripts)

Haz un POST al endpoint de login con el usuario y la clave que te comparta el
dueño del backend **por un canal privado** (no están en esta guía a propósito):

```bash
curl -sX POST https://miracle-zeta.vercel.app/api/auth/local-admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"<usuario>","password":"<clave>"}'
```

Respuesta:

```json
{
  "accessToken": "miracle-local-admin-v1.<...>.<...>",
  "expiresAt": 1782999999000,
  "user": { "id": "local-admin:...", "username": "...", "role": "local-admin" }
}
```

El valor de `accessToken` es tu token. Úsalo tal cual en `Authorization: Bearer`.

### Opción B — Desde el navegador (rápida, manual)

1. Abre el dashboard e inicia sesión: `https://miracle-zeta.vercel.app`
2. Abre las **DevTools** del navegador (F12) → pestaña **Application**
   (o *Almacenamiento*).
3. En **Local Storage** → `https://miracle-zeta.vercel.app`, busca la clave
   **`miracle-admin-session-v1`**.
4. Su valor es un JSON; copia el campo **`accessToken`**.

Ese es el mismo token de la Opción A.

> Cuando el token expire (12 h) verás respuestas `401 No autorizado`; vuelve a
> pedir uno.

---

## 3. El llamado principal: `POST /api/v1/pipeline`

Un solo llamado que hace **transcripción cruda + nota organizada + autofill**.
Con `stages` decides qué procesa el backend; lo que no actives, no se procesa
(ni se cobra en LLM).

### Ejemplo mínimo (transcripción → nota)

```bash
curl -sX POST https://miracle-zeta.vercel.app/api/v1/pipeline \
  -H "Authorization: Bearer <TU_TOKEN>" \
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
    "Authorization": `Bearer ${token}`,
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
  -H "Authorization: Bearer <TU_TOKEN>" -H "Content-Type: application/json" -d '{}'
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
curl -s https://miracle-zeta.vercel.app/api/v1 -H "Authorization: Bearer <TU_TOKEN>"
```

Devuelve el manifiesto con las etapas y endpoints disponibles.

---

## 6. Errores comunes

| Código | Significado | Qué hacer |
|---|---|---|
| `401` `No autorizado` | Falta el token, es inválido o expiró (12 h). | Vuelve a pedir un token (sección 2). |
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
- 🔜 **API keys por cliente** (para no usar el token de sesión del dashboard).
