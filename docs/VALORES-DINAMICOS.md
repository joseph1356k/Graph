# Valores dinámicos: cómo un workflow usa los datos de ESTA ejecución

> Verificado en vivo el 2026-07-26 contra `graph-eight-pied.vercel.app` (ver evidencia al final).

## Qué resuelve

Antes, "crea un paciente llamado Ana, documento 111222333" reproducía **los valores grabados** al
enseñar el workflow. Ahora, al pedir el plan (`POST /api/v1/workflows/:id/plan`) con
`variables.context`, los pasos marcados `valueMode: 'dynamic'` salen con los valores extraídos del
contexto. El cliente Windows no cambió: ya mandaba el `context` (`WorkflowMcpRunner`).

## Las reglas (deliberadas)

1. **Sin `context`, nada cambia.** El plan sale con los valores grabados — el botón "Ejecutar
   ahora" y todos los workflows existentes se comportan igual que siempre.
2. **Con `context`, un campo dinámico sin dato FALLA el plan** listando qué falta
   (`«Nombre del paciente»`). Nunca se rellena en silencio con el valor grabado: en un sistema
   clínico, crear al paciente equivocado es peor que fallar. El agente recibe el error y puede
   pedirle el dato al usuario.
3. **`bindTo` comparte valor**: dos pasos atados a la misma variable ("documento" en dos
   pantallas) reciben el mismo valor.
4. **En selects se sustituye la clave** (`selectedValue`, eligiendo de `allowedOptions`), no el
   texto visible.

## Cómo se marca un campo como dinámico — "el que autora manda"

- **Explícito** (autoría manual o cliente): el step llega al learning API con
  `valueMode: 'dynamic'` (+ `bindTo`) y se persiste **tal cual**. El clasificador jamás lo pisa.
- **Automático** (grabación normal): los steps llegan sin modo; el clasificador LLM del `finish`
  los rellena. Solo rellena — `coalesce` — nunca sobreescribe lo explícito.

## Cómo verificar CUALQUIER workflow, sin ejecutar nada

```bash
GRAPH_API_KEY=miracle_… node scripts/verify-live-plan.js <workflowId> "paciente Ana Rojas, documento 111222333"
```

Muestra los pasos grabados con su modo, y el plan resultante con la sustitución aplicada. Es el
paso previo obligado antes de probar en la máquina con SAP: si aquí no sale bien, no hay nada que
depurar en el cliente.

La prueba completa automatizada (autora un workflow de prueba y verifica todo el ciclo):

```bash
GRAPH_API_KEY=miracle_… npm run test:e2e-live
```

## Errores y su significado

| Error del plan | Significa | Acción |
|---|---|---|
| `No pude resolver del contexto los campos dinámicos: «X»` | El context no trae ese dato | Incluirlo en la petición (el agente puede preguntar) |
| `…no hay LLM configurado para resolverlos` | Falta `GRAPH_LLM_API_KEY` en el backend | Configurarla en Vercel / Provider Studio |
| Plan OK pero con valores grabados | Los steps no están `dynamic` | Ver modos con `verify-live-plan.js`; marcar explícito o revisar el clasificador |

## Prueba física en la máquina SAP (cuando el cliente esté listo)

1. `verify-live-plan.js` del workflow con un context de prueba → confirmar sustitución.
2. Ejecutarlo desde la librería de workflows (los valores del plan ya van sustituidos).
3. Pedirlo por el cerebro: "crea el paciente con documento 111222333" → el modelo llama
   `workflow_…(context)` → mismo plan sustituido.
4. Siempre contra el ambiente de calidad.

## Evidencia de la verificación en vivo (2026-07-26)

```
1) Autorando workflow de prueba…            wf_1785097992574 · 4 pasos · finish OK
2) valueMode explícitos sobrevivieron       ✅ dynamic + bindTo intactos tras el finish
3) context "paciente Ana María Rojas, documento 111222333"
     «Nº documento»:        70103027 → 111222333          ✅
     «Nombre del paciente»: Cristian Felipe → Ana María Rojas  ✅
4) context incompleto (sin nombre)          ✅ falla listando «Nombre del paciente»
```
