# Enseñanza: cómo un workflow entra al sistema

El botón **🎓 Enseñar** graba un workflow nuevo. Detrás hay dos grabadoras
**completamente independientes** corriendo en paralelo sobre la misma acción del
operador, que una sola clase (`WorkflowTeachSession`) sincroniza:

- **`WorkflowRecorder`** — los **pasos estructurados** (qué campo, qué valor, qué clic),
  vía UIA o SAP GUI según la ventana en primer plano.
- **`TeachSession`** — el **video de contexto** + lo que el operador explica de viva voz,
  que un LLM (Gemini) resume.

Son las dos primeras de las tres fuentes que alimentan el subconsciente (la tercera es
la ejecución consciente). El resultado es un `:Workflow` con sus `:Step` en Neo4j.

---

## La cuenta regresiva (no es cosmética)

Al iniciar hay 3 segundos de countdown. Es obligatorio: si detectáramos la superficie en
el instante del clic, resolvería a la **ventana de Ü**, no a la app que el operador va a
enseñar. El countdown le da tiempo a cambiar el foco a la app objetivo.

---

## El orden crítico al detener

`WorkflowRecorder.StopAsync` **ya cierra la sesión en Graph** (post-procesa y persiste el
workflow) como parte de sí misma. Por eso la secuencia al parar no se puede reordenar:

1. Detener el video y obtener su resumen (`TeachSession.ProcessAsync`).
2. Adjuntar ese resumen a la sesión (`AddContextAsync`) — **ANTES** del paso 3.
3. Recién entonces `recorder.StopAsync()`, que cierra y estructura.

Si el resumen llegara después, ya no habría sesión abierta a la que adjuntarlo. El video
es parte del requisito: si no arranca, no se deja una grabación de pasos huérfana — se
aborta todo y se reporta el motivo real.

---

## El grabador, por dentro

- **Hilos**: los eventos de la superficie llegan en un hilo que no es el nuestro y no se
  puede bloquear ahí (UIA se ahoga si el handler tarda; con SAP se arriesga la sesión del
  operador). Por eso el evento **solo encola**, y un worker aparte hace el HTTP.
- **El orden es el contrato**: Graph numera los pasos por orden de llegada, así que la
  cola es de un solo lector — mandarlos en paralelo los desordenaría.
- **Un paso perdido no aborta la grabación**: mejor un workflow con un hueco (que el
  post-procesado de Graph puede limpiar) que perder toda la sesión del operador.

---

## Título automático y clasificación

- El **título ya no es obligatorio**: si va vacío, Graph lo autogenera del resumen al
  terminar (`WorkflowLearner`).
- Al cerrar, el **LLM organizador** clasifica cada step en `fixed`/`dynamic`/`flexible`
  (ver el doc de los 3 escenarios) a partir de los pasos + lo que el operador dijo.

---

## Pendiente

- **Reinicio en caliente** (🔄): descartar lo grabado y volver a empezar sin cerrar la
  sesión (`RestartAsync`) aún no existe — hoy hay que detener y empezar de nuevo.
- **Grabación real de SAP**: el scripting ya está habilitado; falta ejercitar
  grabación/ejecución de workflows SAP en la máquina del cliente.
