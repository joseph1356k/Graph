# Miracle Backend API (v1)

Backend central que expone las funcionalidades de Miracle a las aplicaciones
cliente (extensión Chrome, app de Windows, web app). Una sola central de
exposición bajo `/api/v1`.

## Autenticación

Todas las rutas `/api/v1/*` se autentican con una **API key permanente** por
cliente (`MIRACLE_API_KEYS`), enviada como `X-API-Key` o `Authorization:
Bearer`. Es el único método: no hay fallback al token de sesión del dashboard.

```
X-API-Key: <TU_API_KEY>
```

Si falta o es inválida, la API responde `401`.

---

## `GET /api/v1`

Manifiesto de capacidades y etapas disponibles. Útil para descubrimiento.

---

## `POST /api/v1/pipeline` — el llamado único

Un solo llamado que corre **solo las etapas que actives**. El backend procesa
únicamente lo pedido.

### Request

```json
{
  "session_id": "opcional-uuid",
  "transcript": "texto crudo de la transcripción",
  "language": "es",
  "sequence": 1,
  "note": { "content": "nota actual (markdown)", "title": "Nota" },
  "fields": [ /* campos detectados por el cliente (para autofill) */ ],
  "stages": { "transcription": true, "note": true, "autofill": false }
}
```

`stages` controla qué procesa el backend (todos opcionales):

| Etapa | Default | Qué hace |
|---|---|---|
| `transcription` | `true` | Devuelve la transcripción cruda recibida. |
| `note` | `true` | Organiza la transcripción en una nota estructurada (Product-LLM). |
| `autofill` | `false` | Mapea la nota a los `fields` detectados por el cliente. Se activa solo si envías `fields`. |

Ejemplos de uso:
- Solo transcripción: `{"stages":{"transcription":true,"note":false,"autofill":false}}`
- Transcripción + nota: `{"stages":{"note":true}}` (default)
- Todo: `{"stages":{"note":true,"autofill":true}, "fields":[...]}`

### Response

Contiene **solo las claves de las etapas activadas**:

```json
{
  "session_id": "…",
  "stages": { "transcription": true, "note": true, "autofill": false },
  "transcription": { "text": "…" },
  "note": {
    "content": "## Identificacion\n- Nombre: …",
    "backend_status": "product-llm",
    "usage": { "model": "gpt-4.1-mini", "total_tokens": 1110 }
  },
  "autofill": { "matches": [ … ], "readyToSubmit": false }
}
```

Estados posibles por etapa cuando no se procesa: `skipped` (`no_transcript`,
`no_fields`, `no_note_content`), `unavailable` (`runtime_not_configured`,
`not_configured`) o `error`.

### Streaming de dictado

Para dictado en tiempo real, el cliente reutiliza el mismo `session_id` y va
incrementando `sequence` en cada segmento final; el backend acumula la nota
sobre el `note.content` que le envíes.

---

## `POST /api/v1/transcription/session` — transcripción cruda en streaming

Devuelve credenciales para conectar el streaming de transcripción cruda
(Deepgram) en tiempo real. Necesario porque la transcripción es un flujo
bidireccional que no cabe en un request/response único.

### Response

```json
{
  "provider": "deepgram",
  "access_token": "…",
  "auth_scheme": "bearer",
  "websocket_url": "wss://api.deepgram.com/v1/listen?…",
  "model": "nova-3",
  "language": "es",
  "timeslice_ms": 250
}
```

---

## Roadmap

- **Autofill:** la etapa ya existe y se activa con `fields`; se completará al
  refactorizar la capa de detección de campos del cliente.
- **Pipeline en streaming (SSE/WS):** fusionar audio-in → transcripción cruda +
  nota + autofill en un único flujo en tiempo real (hoy la transcripción cruda
  usa `transcription/session` + Deepgram directo).
