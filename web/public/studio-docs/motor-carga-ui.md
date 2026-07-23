# SurfaceReadiness: el motor de carga de UI

Uno de los problemas más molestos al ejecutar workflows: tras navegar (por ejemplo un
Enter que cambia de pantalla en SAP), la interfaz tarda **milisegundos o segundos** en
pintar y **habilitar** sus elementos. Si el sistema actúa antes de tiempo, el paso falla
(*"no se permite la operación en un elemento que no se puede habilitar"*).

El `SurfaceReadiness` es la **"barra de carga" interna** que resuelve esto — análoga al
sistema de URLs de Windows, pero para el **estado de carga** de una pantalla.

---

## La idea (esperar hasta que lo que buscamos esté listo)

Señal **primaria** — el elemento objetivo: antes de cada paso se mira si el elemento que
ese paso va a tocar **ya está presente y habilitado** (`IsStepReady`). En cuanto lo está,
**se ejecuta YA**. Es la razón real de esperar, así que no tiene sentido esperar más.

Señal **de respaldo** — el % de carga: para pasos que no van a un elemento resoluble (o
mientras el elemento aún no aparece), se usa una barra de carga aprendida:
- Al **GRABAR** se guarda **cuántos elementos interactivos hay listos** en esa ruta (la
  **meta**, el 100% de ese nodo).
- Al **EJECUTAR** se compara el conteo actual contra la meta; si supera un umbral (**80%**)
  se procede.

Es **resiliente**: si nada se confirma dentro de un techo (4 s), se intenta igual.

En los logs se ve la barra: `carga UI [████████░░] 80% (24/30)`, o directamente
`elemento objetivo listo → ejecutar`.

> Por qué el elemento manda sobre el %: el conteo total es **inestable** (una lista de SAP
> tiene distinto nº de filas entre grabación y ejecución), así que esperar un % exacto es
> frágil y lento. El elemento concreto que necesitamos, en cambio, o está o no está.

---

## La métrica: elementos listos, no píxeles

"Cuánto está cargada" una pantalla se mide con el **número de elementos interactivos
VISIBLES y HABILITADOS** (`IUiSurface.ReadinessCount`). Es el mismo recorrido que ya usa
la lectura de campos: cuenta lo que está `!IsOffscreen && interactivo && IsEnabled`.

- Mientras la UI carga, pocos elementos están en pantalla/habilitados → conteo bajo → %
  bajo.
- Ya cargada, todos → conteo = meta → 100%.

No hace falta reconocer elementos concretos: el **conteo** sube de forma monótona con la
carga, así que es un proxy simple y robusto de "¿ya está lista la pantalla?".

---

## Cómo viaja el dato (aditivo, sin tocar el backend)

La meta se guarda **por paso**, en `surfaceHints.readiness` (el mismo canal que ya lleva
`observedSurface` y `alternativeTargets`). Como `surfaceHints` se persiste como JSON
completo, el dato viaja de la grabación al plan **sin cambios de esquema**. Los workflows
viejos (sin `readiness`) simplemente no se gatean — el motor los deja pasar como antes.

Para no recorrer el árbol en cada paso al grabar, el conteo se **cachea por pantalla**
(se recalcula solo al cambiar de ruta).

---

## Arquitectura (aislada y mantenible)

`SurfaceReadiness` es un motor **independiente**: no sabe de workflows ni de Graph. Solo
depende de dos cosas —la métrica de la superficie y la meta guardada del paso— y expone
un único método, `WaitAsync`. El `WorkflowPlayer` lo invoca **antes de cada paso**:

```
await SurfaceReadiness.WaitAsync(surface, step.ReadinessCount(), log, ct);
```

Así, cada mejora del motor (mejores señales de carga, umbrales adaptativos, etc.) se hace
en un solo lugar sin tocar el resto del sistema.

---

## Pendiente

- **Indicador visual**: mostrar la barra de carga **debajo del badge de la URL de
  Windows** (arriba a la derecha), encendida/apagada con el mismo botón "ID visible". Hoy
  el motor ya funciona y la barra se ve en los logs; falta llevarla a la carita.
- **Métrica para SAP GUI Scripting** (hoy devuelve 0 → no se gatea): la navegación por
  scripting es síncrona, pero una señal de "pantalla lista" propia de SAP la haría fina.
- **Firma por elementos** (no solo conteo): guardar QUÉ elementos, no solo cuántos, para
  distinguir "cargó otra cosa" de "cargó lo mismo". Solo si las pruebas lo piden.
