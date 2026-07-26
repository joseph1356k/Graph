# RunTimings: medición de tiempos de respuesta

Para afinar el sistema hay que ver **dónde se va el tiempo** al ejecutar un workflow —
milimétricamente, fase por fase. `RunTimings` es el sistema de medición: no decide nada,
solo **cronometra** y emite un resumen al terminar.

---

## Qué mide

Por cada ejecución de un workflow:

- **Total** del run (de principio a fin).
- **Alineación** inicial (llegar a la superficie del workflow, si hizo falta).
- Por cada **paso**:
  - **espera-carga** — cuánto esperó el motor de carga (`SurfaceReadiness`) a que el paso
    estuviera listo.
  - **acción** — cuánto tardó la acción en sí (`IUiSurface.Execute`: resolver + clic/escribir).
  - **total** del paso (la suma).
- **Sumas** — espera-carga total vs acciones total, y **cuál paso fue el más lento**.

---

## Cómo se ve

Al terminar (éxito o fallo) se loguea un resumen bajo el tag `workflow`:

```
⏱ TIEMPOS · total=8420 ms · alineación=1200 ms · 22 paso(s) medido(s)
   paso 1 [click] «1001»: espera-carga=40 ms · acción=210 ms · total=250 ms
   paso 3 [input] «n»: espera-carga=15 ms · acción=95 ms · total=110 ms
   ...
   sumas: espera-carga=1830 ms · acciones=4100 ms · más lento = paso 18 (620 ms)
```

Así de un vistazo se ve si el tiempo se va en **esperar que la UI cargue** (afinar el
motor de carga), en **resolver/actuar** (afinar selectores o el clic), o en la
**alineación** (afinar el navegador).

---

## Cómo está hecho (aislado y mantenible)

`RunTimings` es un colector puro: recibe dos `Stopwatch` por paso (uno para la
espera, otro para la acción) desde el `WorkflowPlayer` y arma el resumen. No conoce la
ejecución; apagarlo o cambiar el formato no toca nada del comportamiento. El player lo
alimenta en las costuras que ya existen (la espera del motor de carga y la llamada a
`Execute`) y loguea el resumen en **cada** salida del run.

---

## Pendiente

- **Persistir las mediciones** (hoy solo van al log): guardarlas por workflow para ver
  tendencias entre corridas y detectar regresiones de velocidad.
- **Percentiles / promedios** entre ejecuciones repetidas del mismo workflow.
