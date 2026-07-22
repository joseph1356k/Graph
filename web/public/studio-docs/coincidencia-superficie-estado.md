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

## El mecanismo: `valueMode` por step

Los tres escenarios se implementan con **un solo campo por step**, transversal a
cualquier app, reutilizando el sistema de variables que Graph ya deriva de los steps
(`input_N` para inputs/selects, `target_N` para clicks sobre entidades nombradas):

```
step.valueMode ∈ "fixed" | "dynamic" | "flexible"   (default: "fixed")
step.bindTo    (opcional) → nombre de otra variable (ej. "input_4")
```

- **`fixed`** (escenario 2): usa el valor exacto enseñado. Nunca se sustituye.
- **`dynamic`** (escenario 1): valor por-ejecución (del contexto/usuario); con `bindTo`
  se ata a otra variable para exigir consistencia ("el del paso 5 = el del paso 4").
- **`flexible`** (escenario 3): el valor exacto no importa. En ejecución se intenta
  exacto → aproximado; si no resuelve, **el step se salta sin romper el workflow**.

Es un *gate* triple sobre la sustitución que **ya ocurre**: no cambia el formato del
plan ni el runtime; solo condiciona si se usa el valor fijo, se pide uno nuevo, o se
relaja. `valueMode` viaja en el step del plan y el ejecutor (Windows: `UiaSurface`;
web: plugin) lo respeta.

## Quién lo fija: el LLM organizador

Al terminar la grabación, el LLM que construye el `executionGuide`
(`WorkflowExecutionGuideBuilder`) —el único punto que ya razona "dónde se permiten
sustituciones"— clasifica **cada step** en `fixed`/`dynamic`/`flexible` a partir de la
enseñanza (los pasos + lo que el usuario dijo por voz/video). Se persiste en el Step.
Así el usuario puede decir "aquí siempre el mismo paciente del paso anterior" (dynamic
+ bindTo), "siempre este documento" (fixed), o enseñar implícitamente algo general
("cada vez que abras Notepad…", flexible) y el sistema lo configura solo.
