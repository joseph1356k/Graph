# Qué modelo usar en cada función: medido el 2026-10-16

El dueño pidió medir varios modelos por función y quedarse con el mejor en calidad y precio. Con su clave de OpenAI se midieron 7 modelos (gpt-4o, gpt-4.1, gpt-4.1-mini, gpt-5-mini, gpt-5.4-mini, gpt-5.6-luna, gpt-6-luna y, de referencia cara, gpt-5.6-terra). Cada función se midió con su servicio real de Graph: prompt, validador y filtros de producción.

Precios oficiales de OpenAI usados (USD por millón de tokens, entrada / salida):

| Modelo | Entrada | Salida |
|---|---|---|
| gpt-6-luna | 0,10 | 0,50 |
| gpt-5.6-luna | 0,20 | 1,20 |
| gpt-5-mini | 0,25 | 2,00 |
| gpt-4.1-mini | 0,40 | 1,60 |
| gpt-5.4-mini | 0,75 | 4,50 |
| gpt-4.1 | 2,00 | 8,00 |
| gpt-5.6-terra | 2,00 | 12,00 |
| gpt-4o | 2,50 | 10,00 |

## Resumen

| Función (panel) | Hoy | Recomendado | Por qué |
|---|---|---|---|
| Asistente | gpt-4.1-mini | **gpt-5.6-luna** | 8,1 contra 5,7 de calidad a ciegas y 26 % más barato ([MODELOS-EN-VIVO](../asistente/MODELOS-EN-VIVO.md)) |
| Notas clínicas (panel Field Matching, `GRAPH_LLM`) | gpt-4.1-mini | **gpt-5.6-luna** | 8,4 contra 5,9 a ciegas y 6 veces menos errores graves, y 29 % más barato |
| Llenado de campos (mismo panel) | gpt-4.1-mini | **gpt-5.6-luna** (con la regla de unidades de esta rama) | 134/135 campos correctos, 0 inventados; gpt-4.1-mini 135/135 |
| Revisión de la nota (`MIRACLE_REVIEW`, cae a `GRAPH_LLM`) | gpt-4.1-mini | gpt-5.6-luna (lo hereda); **gpt-6-luna** si se le da proveedor propio | Errores sutiles detectados: gpt-4.1-mini 54 %, gpt-5.6-luna 94 %, gpt-6-luna 100 % |
| Biopsia | gpt-4o | **gpt-4.1-mini** | Con fotos malas, cifras exactas: 89 % contra 80 %, con un tercio del costo |
| Hoja en blanco | gpt-4.1 | sin cambio por ahora | No se puede medir aquí (ver abajo) |

## Notas clínicas

Se usaron 16 consultas:

- **4 del repo:** `tests/fixtures/note-evals`.
- **12 escritas para esta medición:** HTA con diabetes, fiebre y tos pediátrica, dolor torácico, control prenatal, depresión con ideación pasiva, adulto mayor con caídas y polifarmacia, lesión pigmentada, cistitis corta, dolor abdominal crónico (10 000 caracteres), lumbalgia, warfarina con INR alto y plan literal de asma. Cada una trae sus hechos clave y sus trampas.

Para la calidad, 8 evaluadores con perfil de internista colombiano (Claude Opus) juzgaron a ciegas. Por consulta recibieron las 11 notas barajadas con letras, con la transcripción, los hechos clave y las trampas.

| Variante | Global /10 | Fidelidad | Errores graves por nota | Ranking medio | Tiempo p50 · máx | USD / 1 000 notas |
|---|---|---|---|---|---|---|
| gpt-5.6-luna (esfuerzo medio) | 8,44 | 9,19 | 0,19 | 2,8 | 24,2 s · 35,0 s | 16,19 |
| **gpt-5.6-luna (esfuerzo bajo)** | 8,38 | 9,00 | 0,19 | 3,1 | 17,1 s · 32,2 s | **14,48** |
| gpt-6-luna (esfuerzo bajo) | 8,31 | 9,44 | 0,06 | 3,3 | 25,8 s · 42,7 s | 6,92 |
| gpt-5.6-terra (esfuerzo bajo) | 8,19 | 9,06 | 0,19 | 4,1 | 25,1 s · 42,8 s | 154,36 |
| gpt-6-luna (esfuerzo medio) | 8,00 | 9,38 | 0,31 | 4,1 | 32,3 s · 56,8 s | 9,51 |
| gpt-5.4-mini | 7,50 | 8,56 | 0,50 | 6,5 | 9,7 s · 16,4 s | 54,38 |
| gpt-4.1 | 6,94 | 7,75 | 1,00 | 7,4 | 10,5 s · 20,2 s | 105,72 |
| gpt-5-mini (esfuerzo medio) | 6,69 | 7,88 | 1,13 | 8,1 | 47,7 s · **72,4 s** | 52,87 |
| gpt-5-mini (esfuerzo bajo) | 6,13 | 7,81 | 0,94 | 8,3 | 21,8 s · 34,7 s | 28,64 |
| gpt-4.1-mini (hoy) | 5,88 | 6,81 | 1,13 | 9,4 | 14,2 s · 26,3 s | 20,36 |
| gpt-4o | 5,81 | 7,13 | 1,00 | 8,9 | 16,4 s · 27,9 s | 119,30 |

Ejemplos de errores graves de gpt-4.1-mini que los evaluadores citaron:

- «Antecedente familiar de suicidio (tío materno)» en una consulta donde no se dijo.
- La alergia de la paciente de asma puesta como «al ibuprofeno y aspirina», cuando la aspirina solo la evita.
- El plan de dolor abdominal sin el «No dipirona», pese a una anafilaxia documentada.
- Una Tdap «administrada» que no se administró.

**Recomendación: gpt-5.6-luna con esfuerzo bajo.** Es la que mejor combina calidad, costo y tiempo:

- Está empatada arriba en calidad.
- Cuesta menos que gpt-4.1-mini.
- Su peor caso (32 s) queda lejos de los 60 s de Vercel.

gpt-6-luna escribe con aún menos errores graves y cuesta la mitad. Pero tarda más (hasta 43 s), y con esfuerzo medio llega a 57 s, al borde del corte de Vercel.

**Sobre el «límite de salida» de la nota: no existe.** El generador no le pone tope de tokens a la nota. El límite real es de tiempo: Vercel corta a los 60 s. gpt-5-mini con el esfuerzo por defecto de OpenAI («medium») tardó 72 s en la consulta larga, así que en producción esa nota fallaría. Por eso esta rama hace que, si la función no lo fija, se pida esfuerzo bajo. Con `GRAPH_LLM_REASONING_EFFORT` se cambia sin desplegar.

## Llenado de campos (Field Matching)

Se midieron 6 notas sintéticas con formularios de verdad conocida, 63 campos en total:

- 45 campos se debían llenar: números, selects y texto.
- 18 campos se debían dejar vacíos porque la nota no trae el dato: triage no dicho, troponina pendiente, GAD-7 no medido…

Hay 3 corridas por modelo.

| Variante | Con el prompt de `main` | Con la regla de unidades | Campos inventados | USD / 1 000 |
|---|---|---|---|---|
| gpt-4.1-mini | 45/45 por corrida | 135/135 | 0 | 1,1 |
| gpt-5.6-luna (bajo) | 36-41/45 por corrida | 134/135 | 0 | 0,8 |
| gpt-6-luna (bajo) | 41/45 por corrida | 135/135 | 0 | 0,3 |

Con el prompt de `main`, los modelos nuevos escribían «14 kg» en el campo «Peso (kg)» o «7/10» en «Dolor (0-10)», y en SAP eso es un dato mal escrito. La regla nueva del emparejador lo resuelve: si la etiqueta ya trae la unidad o la escala, el valor va solo con el número; si no la trae, la conserva. Con ella, gpt-4.1-mini sigue perfecto. gpt-5.4-mini llegó a inventar «pendiente» en un campo numérico de troponina, y gpt-5-mini solo acertó 35-36 de 45.

## Revisión de la nota

En las 12 notas de gpt-4o se plantaron 36 errores sutiles, 3 por nota, y se revisaron también las mismas notas limpias. Los errores fueron de lateralidad, frecuencia o dosis plausible, duración, negación invertida, antecedente inventado, hallazgo cambiado y medicamento suspendido puesto como continuado.

| Variante | Errores detectados (2 corridas) | Avisos graves en las 12 notas limpias | Tiempo p50 | USD / 1 000 |
|---|---|---|---|---|
| **gpt-6-luna** | **72/72** | 3 y 3 | 13-14 s | 0,5 |
| gpt-6-luna (bajo) | 72/72 | 5 y 4 | 9-11 s | 0,3-0,4 |
| gpt-5.6-terra (bajo) | 71/72 | 1 y 1 | 10-11 s | 8-9 |
| gpt-5.6-luna | 69/72 | 5 y 6 | 13-14 s | 0,9 |
| gpt-5.6-luna (bajo) | 68/72 | 3 y 2 | 10-11 s | 0,9-1,0 |
| gpt-5-mini (bajo) | 59/72 | 4 y 3 | 14-16 s | 0,9-1,9 |
| gpt-5.4-mini | 57/72 | 32 y 22 | 8-9 s | 3,2 |
| gpt-4o | 56/72 | 25 y 25 | 7 s | 8,5 |
| gpt-4.1 | 47/72 | 2 y 4 | 7-8 s | 6,3 |
| gpt-4.1-mini (hoy) | 39/72 | 2 y 8 | 6-8 s | 1,2-1,7 |

Las notas «limpias» de gpt-4o no están libres de errores: los evaluadores les encontraron 1 error grave por nota. Por eso parte de los avisos en notas limpias son aciertos y no ruido. Con 9 errores obvios (dosis ×10, negación invertida) casi todos los modelos detectan el 100 %; la diferencia sale con los sutiles.

## Biopsia (lectura de fotos)

Se fotografiaron 8 hojas de laboratorio sintéticas escritas a mano: urocultivo, biopsia de piel, baciloscopia, coprológico, uroanálisis, citología, hemograma manual y Gram. Tienen 39 cifras en total.

Se usaron dos juegos de fotos:

- **Juego limpio:** fotos nítidas.
- **Juego difícil:** fotos borrosas, torcidas, con sombra, una mancha y JPEG de baja calidad. Se corrió 3 veces por modelo.

Se usó el servicio real (`BiopsyExtractionService`).

| Modelo | Cifras exactas (difícil, 3 corridas) | Cifras mal leídas | Limpio | Tiempo p50 | USD / 1 000 fotos |
|---|---|---|---|---|---|
| **gpt-4.1-mini** | **104/117 (89 %)** | 12 | 39/39 | 2,2 s | **1,35** |
| gpt-5-mini | 103/117 (88 %) | 14 | 39/39 | 9,5 s | 1,60 |
| gpt-4.1 | 98/117 (84 %) | 19 | 36/39 | 2,5 s | 3,54 |
| gpt-5.4-mini | 97/117 (83 %) | 17 | 38-39/39 | 2,4 s | 2,20 |
| gpt-4o (hoy) | 94/117 (80 %) | 20 | 35/39 | 2,7 s | 4,29 |
| gpt-5.6-luna | 89/117 (76 %) | 24 | 38/39 | 4,4 s | 0,71 |
| gpt-6-luna | 87/117 (74 %) | 30 | 38/39 | 4,4 s | 0,33 |
| gpt-5.6-terra | 87/117 (74 %) | 28 | 38-39/39 | 4,4 s | 5,82 |

Con `detail: high` en la imagen el orden no cambia: gpt-4.1-mini 71/78, gpt-5-mini 68/78, gpt-4o 64/78, gpt-6-luna 61/78, gpt-5.6-luna 59/78. Aquí los modelos «luna», tan buenos para texto, leen peor la letra manuscrita.

## Hoja en blanco

«Hoja en blanco» es el agente que maneja la pantalla en Windows (Responses API con capturas y las herramientas `map_*`), y su calidad depende de manejar un PC real. La batería que lo mide, `apps/windows/scripts/nivel4-voz/correr.ps1`, necesita ese PC con la app, la voz y el escritorio desbloqueado. Desde el sandbox no se puede, y una cifra sin esa prueba sería inventada. El modelo se queda en gpt-4.1 hasta correr esa batería con gpt-5.6-luna y gpt-4.1-mini en el PC.

## Límites

- Los evaluadores de calidad son un modelo y no médicos. La señal es fuerte: gpt-4.1-mini queda último en notas con 5,9 y los luna arriba con 8,3-8,4, pero la decisión final la valida un médico leyendo notas reales.
- La latencia se midió desde el sandbox, con varias llamadas en paralelo: sirve para comparar, no como cifra absoluta de producción.
- Las consultas y las hojas son sintéticas: no salió ningún dato de paciente.
