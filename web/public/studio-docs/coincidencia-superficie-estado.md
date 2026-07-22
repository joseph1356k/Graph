# Coincidencia de superficie y estado: los 3 escenarios

Cuando un workflow se ejecuta, ¿debe estar en la MISMA pantalla/estado exacto que
cuando se enseñó? **Depende del caso.** No es una regla fija: la decisión la toma
el **LLM** interpretando lo que el usuario enseñó (instrucciones habladas + video).

La arquitectura debe permitir los tres escenarios, y el LLM elige el correcto.

---

## 1. Variable dinámica — consistencia entre pasos

El usuario dice algo como: *"en esta ventana, obligatoriamente tienes que estar en
el mismo nombre de paciente del paso anterior."*

No es un valor fijo: cambia en cada ejecución (un paciente distinto según el caso),
pero **debe ser consistente entre pasos**. El LLM fija una restricción de *binding*:
"el título del paso 7 debe ser igual al del paso 4".

- Ejemplo: historia clínica — siempre un paciente diferente, pero el mismo a lo
  largo del workflow.

## 2. Valor fijo del entrenamiento

Debe coincidir **siempre** con X, donde X es el valor **exacto que se enseñó** la
primera vez. Queda horneado en el workflow como variable fija (no cambiante).

- Se activa cuando el usuario lo pide explícitamente ("siempre este documento"),
  o cuando la superficie lo exige.
- Es lo que le pasó al ejemplo de Notepad con el comportamiento viejo: fijaba el
  documento exacto de la grabación y solo avanzaba si estabas en esa nota.

## 3. No importa — generalizado

Implícito en enseñanzas como: *"cada vez que abras el Bloc de notas, haz clic en el
botón + y escribe algo nuevo."* El documento concreto **da igual**; no hay variable
fija y no debe exigirse coincidencia exacta.

---

## Estado actual (implementado)

**Capa default por esquema de superficie:**

- `uia://` (apps nativas de Windows) → **generaliza** (escenario 3 por defecto). El
  `pathname` de una app nativa es el **título de la ventana = el documento abierto**:
  es instancia, no identidad. Un workflow de "escribir en Notepad" sirve en cualquier
  nota. (Misma razón por la que `SurfaceMismatch` siempre ignoró el título.)
- `web://` (navegador) → mantiene el `pathname` (la ruta de la URL es una superficie
  real: `/mail` ≠ `/settings`).
- `sapgui://` (SAP GUI) → mantiene el `pathname` (la transacción es una ruta estable).

Implementado en `WorkflowPlayer.SurfaceMismatch` (cliente Windows) y
`AgentWorkflowStore.matchesSurface` (backend, scoping por MCP).

## Pendiente (el build grande)

Que el **LLM organizador** —el que pule el workflow al final de la grabación— fije
**por-workflow y por-paso** los escenarios 1 y 2 a partir de la enseñanza: detectar
cuándo el usuario pidió consistencia entre pasos (binding dinámico), cuándo pidió un
valor fijo, y cuándo es implícitamente generalizado. La estructura del workflow debe
llevar esa configuración (p.ej. en `surfaceHints`/constraints por step), y el
ejecutor debe respetarla.
