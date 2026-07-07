# Guia para consumir la API de Miracle

Esta guia conecta cualquier aplicacion cliente al backend de Miracle:
transcripcion de voz, organizacion de nota medica, autofill y entrenamiento de
workflows.

Base actual:

```txt
https://graph-five-orpin.vercel.app
```

Todas las rutas publicas viven bajo `/api/v1` y requieren API key permanente.

```txt
X-API-Key: <TU_API_KEY>
```

Tambien se acepta:

```txt
Authorization: Bearer <TU_API_KEY>
```

## Llamado principal

`POST /api/v1/pipeline`

```bash
curl -sX POST https://graph-five-orpin.vercel.app/api/v1/pipeline \
  -H "X-API-Key: <TU_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "paciente con dolor de rodilla derecha desde la semana pasada",
    "note": { "content": "", "title": "Nota" },
    "stages": { "transcription": true, "note": true, "autofill": false }
  }'
```

Con `stages` decides que se procesa:

| Stage | Uso |
| --- | --- |
| `transcription` | Devuelve el texto recibido. |
| `note` | Organiza el transcript en nota clinica. |
| `autofill` | Mapea la nota contra `fields`. |

Para usar autofill dentro del pipeline, envia `fields` y activa
`"autofill": true`.

## Dictado en tiempo real

`POST /api/v1/transcription/session`

```bash
curl -sX POST https://graph-five-orpin.vercel.app/api/v1/transcription/session \
  -H "X-API-Key: <TU_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

El cliente abre el WebSocket de Deepgram con la respuesta y, por cada segmento
final, llama `POST /api/v1/pipeline` reutilizando `session_id`.

## Autofill directo

`POST /api/v1/autofill/match`

```json
{
  "session_id": "encounter-123",
  "page_url": "https://cliente.example/emr",
  "note_content": "## Historia\nPaciente con dolor de rodilla derecha...",
  "fields": [
    {
      "stepOrder": 1,
      "actionType": "input",
      "selector": "#chief-complaint",
      "label": "Chief complaint",
      "controlType": "text",
      "currentValue": ""
    }
  ],
  "already_fulfilled": []
}
```

Respuesta:

```json
{
  "autofill": {
    "matches": [
      {
        "stepOrder": 1,
        "value": "Dolor de rodilla derecha",
        "confidence": 0.91,
        "evidence": "dolor de rodilla derecha"
      }
    ],
    "ready_to_submit": false
  }
}
```

## Entrenar workflows

1. `POST /api/v1/learning/sessions`
2. `POST /api/v1/learning/sessions/:id/steps`
3. `POST /api/v1/learning/sessions/:id/context-notes` opcional
4. `POST /api/v1/learning/sessions/:id/finish`

Ejemplo de inicio:

```json
{
  "description": "Autofill intake note in Acme EMR",
  "app_id": "acme-emr",
  "source_url": "https://cliente.example/emr/intake",
  "source_origin": "https://cliente.example",
  "source_pathname": "/emr/intake",
  "source_title": "Intake",
  "context": { "surface": "expanded-emr" }
}
```

Ejemplo de paso:

```json
{
  "actionType": "input",
  "selector": "#chief-complaint",
  "label": "Chief complaint",
  "controlType": "text",
  "value": "Dolor de rodilla derecha",
  "semanticTarget": "chief complaint",
  "surfaceSection": "intake"
}
```

## Workflows y planes

```txt
GET  /api/v1/workflows
GET  /api/v1/workflows/:id
POST /api/v1/workflows/:id/plan
```

El plan es client-side: Miracle devuelve pasos estructurados, y la app cliente
ejecuta el llenado localmente.

## Errores comunes

| Codigo | Significado |
| --- | --- |
| `401` | Falta API key o no es valida. |
| `429` | Limite de tasa. |
| `503` | Servicio interno no configurado en el entorno. |
| `autofill.matches: []` | No hay confianza suficiente o faltan campos/nota. |

La documentacion HTML especifica de autofill esta en
`/autofill-api-docs.html`.
