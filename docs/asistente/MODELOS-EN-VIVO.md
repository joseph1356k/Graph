# Qué modelo usar para el asistente clínico: medido en vivo (2026-10-16)

El dueño pidió un modelo de OpenAI de precio parecido a gpt-4.1-mini y mejor calidad. Con su clave se midieron cuatro modelos sobre las mismas 48 preguntas de `scripts/fixtures/abstencion-eval.json`:

- 15 casos con la consulta cargada («¿qué hago con este paciente?»);
- 15 temas sin guía;
- 10 preguntas con guía;
- 8 cifras difíciles (Child C, neonato, diálisis…).

Se usó el prompt del chat v7, con el servicio y el parser reales.

## Resultado

| Modelo | Calidad global (ciega, /10) | Gana en | Exactitud ≤ 5 | «No sé» | Tiempo p50 · p95 | Costo / 1 000 preguntas |
|---|---|---|---|---|---|---|
| **gpt-5.6-luna** | **8,13** | **30 / 48** | **0** | 0 % | 9,4 s · 12,3 s | **1,23 USD** |
| gpt-5-mini | 7,83 | 16 / 48 | 1 | 0 % | 16,3 s · 21,8 s | 4,42 USD |
| gpt-6-luna | 7,33 | 2 / 48 | 0 | 0 % | 9,0 s · 15,8 s | 0,49 USD |
| gpt-4.1-mini (producción hasta hoy) | 5,65 | 0 / 48 | 11 | 2,1 % | 3,3 s · 4,5 s | 1,66 USD |

Calidad por dimensión (promedio sobre 10):

| Modelo | Exactitud | Utilidad | Seguridad | Uso de la consulta |
|---|---|---|---|---|
| gpt-5.6-luna | 8,52 | 8,00 | 8,67 | 8,00 |
| gpt-5-mini | 7,98 | 7,98 | 8,15 | 7,98 |
| gpt-6-luna | 8,19 | 7,27 | 7,81 | 7,25 |
| gpt-4.1-mini | 6,56 | 5,79 | 5,77 | 5,71 |

Calidad global por tipo de pregunta:

| Modelo | Casos | Sin guía | Con guía | Cifras difíciles |
|---|---|---|---|---|
| gpt-5.6-luna | 7,93 | 8,13 | 8,50 | 8,00 |
| gpt-5-mini | 7,87 | 7,80 | 8,20 | 7,38 |
| gpt-6-luna | 7,47 | 7,27 | 7,80 | 6,63 |
| gpt-4.1-mini | 4,93 | 5,73 | 6,60 | 5,63 |

**Recomendación: gpt-5.6-luna.** Es el mejor en calidad, seguridad y uso de la consulta, y cuesta un 26 % menos que gpt-4.1-mini. Responde en ~9 s en vez de ~3 s, porque razona antes de escribir. Queda como «recomendado» en Provider Studio; el cambio se hace ahí, sin desplegar código.

Por qué no los otros:

- **gpt-5-mini:** el triple de caro y el doble de lento, y escribe más cifras sin respaldo (2,3 por respuesta contra 0,5).
- **gpt-6-luna:** el más barato, pero sus respuestas son menos útiles y peores en cifras difíciles.
- **gpt-4.1-mini:** 11 de sus 48 respuestas tienen exactitud ≤ 5. Por ejemplo, en hipertiroidismo no usa los valores del caso, y en mieloma omite las cadenas ligeras y las alarmas de compresión medular.

## Cómo se midió

- **Respuestas:** `MIRACLE_ASSISTANT_LLM_MODEL=<modelo> node scripts/eval-assistant-abstention.js --live --out <archivo>`. Usa el proveedor real con sus topes y parámetros: los modelos que razonan reciben `max_completion_tokens` y no `temperature` (spec 009). Mide «no sé», JSON, respuestas cortadas, tiempo, tokens y costo con las tarifas de `pricing.js`.
- **Resultado técnico:** los cuatro modelos dieron 100 % de JSON válido, 0 errores, 0 respuestas cortadas y 0 filtraciones del razonamiento.
- **Calidad:** la midieron cuatro evaluadores con perfil de internista colombiano (Claude Opus), a ciegas. Las cuatro respuestas de cada pregunta iban barajadas con letras y sin el nombre del modelo, y cada una se puntuó de 1 a 10 en exactitud, utilidad, seguridad, uso de la consulta y global, con un ranking por pregunta.
- **Límites:**
  - Los evaluadores son un modelo, no médicos. La señal es fuerte, sobre todo la distancia con gpt-4.1-mini, pero la prueba decisiva sigue siendo el conjunto de preguntas escritas por médicos colombianos.
  - La latencia se midió desde el sandbox, con 6 preguntas en paralelo por modelo.
