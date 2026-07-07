# Miracle Backend API (v1)

Backend central para aplicaciones cliente: web apps, extension Chrome, Windows,
Android o scripts internos. Todo el contrato publico vive bajo `/api/v1` y se
autentica con una API key permanente enviada como `X-API-Key` o
`Authorization: Bearer <key>`.

## Descubrimiento

`GET /api/v1`

Devuelve el manifiesto de capacidades: pipeline, transcripcion, autofill,
learning y workflows.

## Transcripcion y nota

`POST /api/v1/transcription/session`

Devuelve credenciales de Deepgram para que el cliente abra el WebSocket de audio
en tiempo real.

`POST /api/v1/pipeline`

Ejecuta las etapas activadas por `stages`.

```json
{
  "session_id": "optional-session",
  "transcript": "texto final de Deepgram",
  "language": "es",
  "sequence": 1,
  "note": { "content": "", "title": "Nota" },
  "fields": [],
  "stages": { "transcription": true, "note": true, "autofill": false }
}
```

Etapas:

| Stage | Default | Funcion |
| --- | --- | --- |
| `transcription` | `true` | Devuelve el texto recibido. |
| `note` | `true` | Organiza el transcript en una nota clinica estructurada. |
| `autofill` | `false` | Mapea la nota contra los campos detectados por el cliente. |

## Autofill directo

`POST /api/v1/autofill/match`

Usalo cuando ya tienes una nota organizada y una lista de campos detectados en
la UI.

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
    },
    {
      "stepOrder": 2,
      "actionType": "select",
      "selector": "#laterality",
      "label": "Laterality",
      "controlType": "select",
      "allowedOptions": [
        { "value": "right", "label": "Right" },
        { "value": "left", "label": "Left" }
      ]
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
    "ready_to_submit": false,
    "readyToSubmit": false,
    "submit_reason": "",
    "usage": null
  }
}
```

El cliente ejecuta el llenado. El backend solo decide que valor corresponde a
cada campo.

## Entrenamiento de workflows

El cliente entrena workflows enviando la interaccion de UI como pasos
estructurados. El backend persiste el mapa en Neo4j usando los servicios
existentes de learning.

### Iniciar sesion

`POST /api/v1/learning/sessions`

```json
{
  "description": "Autofill intake note in Acme EMR",
  "app_id": "acme-emr",
  "source_url": "https://cliente.example/emr/intake",
  "source_origin": "https://cliente.example",
  "source_pathname": "/emr/intake",
  "source_title": "Intake",
  "context": {
    "surface": "expanded-emr",
    "specialty": "orthopedics"
  }
}
```

Respuesta:

```json
{
  "session": {
    "id": "wf_1783450000000",
    "workflow_id": "wf_1783450000000",
    "recording": true
  }
}
```

### Registrar pasos

`POST /api/v1/learning/sessions/:id/steps`

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

Campos esperados por paso:

| Campo | Uso |
| --- | --- |
| `actionType` | `input`, `select`, `click` o `navigation`. |
| `selector` | Selector estable que el cliente pueda volver a usar. |
| `label` | Texto visible o nombre semantico del campo. |
| `controlType` | Tipo de control: `text`, `textarea`, `select`, `checkbox`, etc. |
| `value` | Valor observado durante entrenamiento, si aplica. |
| `allowedOptions` | Opciones para selects o controles enumerados. |
| `semanticTarget` | Intencion clinica o funcional del campo. |
| `surfaceSection` | Seccion visual donde vive el campo. |

### Contexto opcional

`POST /api/v1/learning/sessions/:id/context-notes`

```json
{
  "note": {
    "role": "clinical_context",
    "transcript": "este workflow llena motivo de consulta, lateralidad y plan",
    "mode": "training"
  }
}
```

### Finalizar

`POST /api/v1/learning/sessions/:id/finish`

Devuelve `workflow_id`, `summary` y el workflow guardado cuando esta disponible.

## Workflows y ejecucion

`GET /api/v1/workflows`

Lista workflows privados del cliente API key y workflows globales.

`GET /api/v1/workflows/:id`

Lee un workflow especifico.

`POST /api/v1/workflows/:id/plan`

Devuelve un plan ejecutable para que el cliente llene la UI localmente.

```json
{
  "variables": {
    "input_1": "Dolor de rodilla derecha"
  },
  "execution_intent": {
    "source": "autofill",
    "encounter_id": "enc-123"
  }
}
```

Respuesta:

```json
{
  "execution_plan": {
    "workflowId": "wf_1783450000000",
    "steps": [
      {
        "stepOrder": 1,
        "actionType": "input",
        "selector": "#chief-complaint"
      }
    ]
  }
}
```

## Responsabilidad del cliente

El cliente debe:

1. Detectar campos visibles y accionables de su UI.
2. Enviar labels, selectors, opciones y valores actuales al backend.
3. Entrenar workflows con las acciones humanas observadas.
4. Pedir matches de autofill o planes de workflow.
5. Ejecutar el llenado localmente, respetando validaciones de la app destino.

El backend no toma control remoto del dispositivo del cliente; entrega decisiones
y planes estructurados.
