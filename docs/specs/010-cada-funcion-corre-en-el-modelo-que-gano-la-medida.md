# 010 — Cada función corre en el modelo que ganó la medida, sin pasarse del tiempo de Vercel

Estado: **implementado** (2026-10-16) · Lo pide el dueño el 2026-10-16 · Rama: `feat/modelos-por-funcion`

El dueño pidió medir de verdad varios modelos por función y quedarse con el mejor en calidad y precio. La medición completa está en [`docs/modelos/MODELOS-POR-FUNCION.md`](../modelos/MODELOS-POR-FUNCION.md). Esta spec deja el código listo para que lo que ganó se elija en Provider Studio sin romper nada.

## Diagnóstico: qué se midió

| Qué | Medida | Fuente |
|---|---|---|
| Notas con gpt-4.1-mini (lo que corre hoy) | 5,88/10 a ciegas, 1,13 errores graves por nota; gpt-5.6-luna 8,38 y 0,19 | `MODELOS-POR-FUNCION.md`, 16 consultas |
| Tiempo de una nota con un modelo que razona y el esfuerzo por defecto de OpenAI («medium») | gpt-5-mini: 72 s en la consulta larga, más que los 60 s de Vercel; gpt-6-luna 57 s | idem |
| Esfuerzo que mandaban la nota, los campos y la revisión | ninguno: corrían con el «medium» de OpenAI | `ClinicalNoteGeneratorService`, `NoteFieldMatcher`, `ClinicalNoteReviewService` |
| Campos con unidad en la etiqueta («Peso (kg)») | gpt-5.6-luna escribía «14 kg» y «7/10»: 36-41 de 45 bien | `MODELOS-POR-FUNCION.md`, 6 formularios |
| Modelos de Field Matching en Provider Studio (OpenAI) | gpt-4.1-mini, gpt-4.1, gpt-4o, gpt-4o-mini: ni gpt-5.6-luna ni gpt-6-luna | `GraphProviderConfigService` |
| Hoja en blanco (dictado) | gpt-4.1; con un modelo que razona mandaría 2 000 tokens de salida, que el razonamiento se come, y ningún esfuerzo | `bounded/miracle-ai/.../product_llm` |
| Biopsia con fotos malas | gpt-4o (por defecto) 80 % de cifras exactas; gpt-4.1-mini 89 %, a un tercio del costo, y no estaba en la lista | `BiopsyPhotoProviderConfigService` |

## Promesas

| # | Promesa | Juez |
|---|---|---|
| 1001 | Con un modelo que razona, lo que no fija su esfuerzo (la nota, los campos, la revisión) pide esfuerzo bajo, y la variable …_LLM_REASONING_EFFORT del panel lo cambia; a un modelo que no razona nunca se le pide esfuerzo | `verify-modelos-por-funcion.js` |
| 1002 | El emparejador de campos pide solo el número cuando la etiqueta del campo ya trae la unidad o la escala, y que la conserve cuando no la trae | `verify-modelos-por-funcion.js` |
| 1003 | Provider Studio ofrece gpt-5.6-luna como modelo por defecto de notas y campos (con gpt-6-luna como opción) y gpt-4.1-mini como modelo por defecto de Biopsia, y el registro de consumo les pone precio | `verify-modelos-por-funcion.js` |
| 1004 | La hoja en blanco ofrece gpt-5.6-luna (por defecto) y gpt-6-luna en Provider Studio, y con un modelo que razona el dictado pide esfuerzo bajo y deja espacio de salida para razonar, sin mandarle esos parámetros a un modelo que no razona | `verify-modelos-por-funcion.js` |

La que cierra el asunto es la 1001: sin ella, elegir un modelo que razona en el panel deja notas que Vercel corta a los 60 s.

## Las fases

| Fase | Promesa que pone verde | Qué toca | Sitios con esta clase de error |
|---|---|---|---|
| 1 | 1001 | `LLMProvider` (esfuerzo por defecto en `generationParams`) | 1: `generationParams` es el único sitio que arma los parámetros; cubre a todos los que llaman sin fijar esfuerzo |
| 2 | 1002 | `NoteFieldMatchingPolicy` (regla y versión `2026-10-16.1`) | — |
| 3 | 1003 | `GraphProviderConfigService`, `BiopsyPhotoProviderConfigService` | — |
| 4 | 1004 | `MiracleProductLlmProviderConfigService`; en Python `product_llm/config.py` y `note_orchestrator_adapter.py` (pytest `test_reasoning_model_gets_low_effort_and_room_to_think`) | — |

## Lo que NO entra

- **Cambiar el modelo en producción.** Lo cambia el dueño en Provider Studio: Field Matching → gpt-5.6-luna; Biopsia → gpt-4.1-mini; Asistente → gpt-5.6-luna, de la spec 009.
- **Un panel propio para la revisión.** Hereda el modelo de las notas: gpt-5.6-luna detecta el 94 % de los errores sutiles. Si se quiere el 100 % de gpt-6-luna, se configura `MIRACLE_REVIEW_LLM_*` por variables de entorno.
- **Medir la hoja en blanco con su propio prompt.** La recomendación sale de la medida de notas (misma tarea); falta correrla con una clave.

## Hallazgos

- 2026-10-16:
  - Con la primera versión de la regla, gpt-4.1-mini quitó también la unidad de «Tiempo de evolución» («3» en vez de «3 horas»). La regla quedó en dos partes: sin unidad si la etiqueta la trae, con unidad si no.
  - Remedidos con la regla final: gpt-4.1-mini 135/135, gpt-5.6-luna 134/135 y gpt-6-luna 135/135.

## Cierre

- [x] `npm test` → `CONTRATO INTACTO`
- [x] Cada promesa se vio en rojo con el código de `main` y en verde con esta rama
- [x] Medido en vivo con la clave del dueño (`MODELOS-POR-FUNCION.md`)
- [x] Estado de este documento: **implementado** (2026-10-16)
