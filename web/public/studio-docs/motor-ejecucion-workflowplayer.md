# WorkflowPlayer: el motor de ejecución subconsciente

El `WorkflowPlayer` es el corazón del modo subconsciente: **toma un workflow guardado y
lo ejecuta contra Windows**. Encarna el reparto que no se negocia — **Graph decide QUÉ,
la máquina decide CÓMO**: el player le pide el plan a Graph y Graph nunca toca la
máquina.

Corre sobre el SAP/Windows real de un cliente, así que sus dos decisiones de diseño son
conservadoras:

1. **Se verifica que estamos en la pantalla correcta ANTES de tocar nada.**
2. **Al primer paso que falla, se para.** Un formulario a medio llenar lo recupera un
   humano; uno llenado a ciegas con los campos corridos, no.

---

## El recorrido de una ejecución

1. **Pide el plan** a Graph (`GetPlanAsync`) para el `workflowId`. Graph devuelve los
   pasos ya filtrados (solo `input`/`select`/`click` con selector y `navigation` con
   url sobreviven) y con su `valueMode` por step.
2. **Colapsa runs de escritura** (`CollapseInputRuns`): varios `input` seguidos al mismo
   selector son snapshots del tecleo (SetValue reemplaza el valor); se deja solo el
   último. Efecto: escritura instantánea y logs limpios.
3. **Elige la superficie** a partir del primer paso REAL (no de una config): el workflow
   sabe dónde nació. Un workflow puede cruzar superficies (empieza en UIA, sigue en SAP)
   y se re-elige por paso.
4. **Pre-check de superficie** (`SurfaceMismatch`): ¿estamos donde se grabó? Si no, y hay
   un alineador, **se alinea conscientemente** (ver `SurfaceNavigator`) y se reintenta la
   comprobación. Si no se logra, se reporta el mismatch y no se ejecuta nada.
5. **Ejecuta paso a paso**: cada paso lo aplica la superficie (`IUiSurface.Execute`), que
   devuelve éxito o el motivo exacto del fallo. Al primer fallo, para y reporta el paso.

---

## Alineación y aprendizaje (consciente → subconsciente)

Si al arrancar no estamos en la superficie del workflow, el player delega en su
`Aligner` (el punto de extensión donde se enchufa el `SurfaceNavigator`): abrir/enfocar
la app y confirmar con el locator. Si tuvo que alinearse, **se lo enseña al workflow**:
antepone un paso de alineación (`app:<proceso>` en orden 0) vía Graph, para que la
próxima vez arranque solo desde el principio. Ese paso, al ejecutarse primero, lleva el
foco a la superficie — por eso los workflows que ya lo tienen no repiten el pre-check.

---

## El contrato con Graph es sagrado

- El player **nunca ejecuta lógica de negocio**: solo traduce el plan a acciones de UI.
- El shape del plan y los códigos de resultado son un contrato espejo
  (`windows-graph/Contracts.cs` ↔ rutas públicas de Graph). Si se toca un lado, se toca
  el otro.
- El `valueMode` de cada step viaja en el plan y el player lo respeta al sustituir
  valores (ver el doc de los 3 escenarios de coincidencia).

---

## Pendiente

- **Sustitución dinámica** (`dynamic` + `bindTo`): el player respeta `valueMode`, pero
  tomar el valor del contexto del chat o de otro step en tiempo de ejecución es la fase
  siguiente.
- **Alineación multi-paso**: hoy alinear = llegar a la app. Navegar DENTRO de la app
  hasta que el primer paso sea visible es la evolución (capa 2 del `SurfaceNavigator`).
