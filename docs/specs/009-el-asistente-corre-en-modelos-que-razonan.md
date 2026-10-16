# 009 — El asistente corre en modelos que razonan (gpt-5-mini, gpt-5.6-luna, gpt-6-luna) sin romperse

Estado: **implementado** (2026-10-16) · Lo pide el dueño el 2026-10-16 · Rama: `feat/asistente-modelos-que-razonan` (espejo de ZevCorp/Miracle, spec 021)

El dueño quiere poder pasar el asistente de gpt-4.1-mini a un modelo mejor y de precio parecido. Esos modelos rechazan dos parámetros que Graph mandaba, y elegirlos en Provider Studio habría dejado el chat respondiendo «No fue posible generar la respuesta».

## Diagnóstico: qué se midió

Se midió contra la API de OpenAI el 2026-10-16, con una petición mínima por modelo.

| Qué | Medida | Fuente |
|---|---|---|
| `temperature: 0.3` | gpt-5-mini, gpt-5.6-luna y gpt-6-luna: 400 «Only the default (1) value is supported»; gpt-4.1-mini: OK | API de OpenAI |
| `max_tokens` | los tres: 400 «Use 'max_completion_tokens' instead» | API de OpenAI |
| `reasoning_effort` | gpt-4.1-mini: 400 «Unrecognized request argument» | API de OpenAI |
| Qué reconocía Graph como modelo que razona | `gpt-5…` y `o…`, pero no `gpt-6…` | `LLMProvider.usesCompletionTokens` |
| `temperature` | se mandaba siempre, salvo con la variable `…_LLM_DISABLE_TEMPERATURE=1` | `LLMProvider.generationParams` |
| Tope de salida del chat | 1 800 tokens, que en un modelo que razona incluyen el razonamiento: cortaría el JSON | `ClinicalAssistantService` |
| Modelos en Provider Studio para OpenAI | gpt-4.1-mini, gpt-4.1, gpt-4o, gpt-4o-mini | `MiracleAssistantProviderConfigService` |
| Tarifas en el registro de consumo | sin gpt-5-mini, gpt-5.6-luna ni gpt-6-luna: su costo saldría «sin tarifa» | `pricing.js` |

## Promesas

| # | Promesa | Juez |
|---|---|---|
| 901 | Con un modelo que razona (gpt-5-mini, gpt-5.6-luna, gpt-6-luna, la serie o) el proveedor manda max_completion_tokens y esfuerzo de razonamiento y nunca temperature; con uno que no razona manda temperature y max_tokens como antes | `verify-asistente-modelos-que-razonan.js` |
| 902 | El chat del asistente con un modelo que razona sube el tope de salida (5 000 directo, 9 000 razonado) para que el razonamiento no corte el JSON, con esfuerzo bajo en lo directo y medio en lo razonado; con un modelo que no razona los topes siguen en 1 800 y 3 500 | `verify-asistente-modelos-que-razonan.js` |
| 903 | Provider Studio ofrece gpt-5-mini, gpt-5.6-luna y gpt-6-luna para el asistente con OpenAI, y el registro de consumo les pone precio | `verify-asistente-modelos-que-razonan.js` |

## Las fases

| Fase | Promesa que pone verde | Qué toca | Sitios con esta clase de error |
|---|---|---|---|
| 1 | 901 | `LLMProvider.usesCompletionTokens` y `generationParams` | 1: `generationParams` es el único sitio que arma los parámetros (spec del monorepo 012, fase 4) |
| 2 | 902 | `ClinicalAssistantService` y `withProviderFallback` (`web/server.js`), que expone `usesCompletionTokens` | — |
| 3 | 903 | `MiracleAssistantProviderConfigService`, `pricing.js` | — |

## Medido en vivo

Con la clave del dueño, `node scripts/eval-assistant-abstention.js --live` corrió las 48 preguntas con cada modelo. La comparación completa, con la evaluación ciega de calidad, está en [`docs/asistente/MODELOS-EN-VIVO.md`](../asistente/MODELOS-EN-VIVO.md).

## Lo que NO entra

- Cambiar el modelo de producción: es una decisión del dueño, que se toma en Provider Studio sin desplegar código.

## Cierre

- [x] `npm test` → `CONTRATO INTACTO`
- [x] Cada promesa se vio en rojo: 901 y 902 con `LLMProvider` y el servicio de `main` (temperature a gpt-5-mini, tope de 1 800); 903 con la lista y las tarifas de `main`
- [x] Probado contra la API real: las 48 preguntas con los cuatro modelos, 0 errores y 0 respuestas cortadas
- [x] Estado de este documento: **implementado** (2026-10-16)
