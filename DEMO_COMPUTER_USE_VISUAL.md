# Demo — Agente de Computer Use visual (guía operativa)

Guía para **preparar y ejecutar** la demo de las tres tareas (YouTube, ChatGPT, Calendar)
con el mismo runner general. Todo dentro de la página es **visual** (screenshot → modelo →
mouse/teclado); `chrome.tabs` solo transporta. Sin DOM, selectores, APIs de sitios ni
secuencias hardcodeadas.

> ⚠️ **Estado de validación (honesto).** El sistema está construido y probado con harnesses
> reales de CDP (coordenadas DPR 1/2, loop, sesión, anti-loop) **en entorno headless**. **NO
> se ha ejecutado con un modelo real contra YouTube/ChatGPT/Calendar** — eso requiere tu Chrome
> con sesiones iniciadas y un modelo con Computer Use. Esta guía te deja listo para hacerlo y
> **llenar tú la matriz de resultados reales** (sección 7). No declares "listo para inversionistas"
> hasta que esa matriz lo sostenga.

---

## 1. Variables de entorno (backend)
```
MIRACLE_CONSCIOUS_LLM_PROVIDER = openai            # ruta de referencia para computer-use
MIRACLE_CONSCIOUS_LLM_API_KEY  = <tu key OpenAI>
MIRACLE_CONSCIOUS_LLM_MODEL    = <modelo con Computer Use>   # p. ej. computer-use-preview
MIRACLE_API_KEYS               = demo:<clave-larga-aleatoria>   # gate X-API-Key de /api/v1
SESSION_SECRET                 = <secreto para firmar la sesión>
```
> Si el modelo real rechaza el tool `computer`, revisa el shape en
> `src/infrastructure/conscious-brain/openaiBrain.js` (en modo visual manda
> `{type:'computer', display_width, display_height, environment:'browser'}`). Ajusta `type` a lo
> que exija tu endpoint (algunas versiones usan `computer_use_preview`). Ver §9.

## 2. Backend
- Local: `npm install` y arranca el server (`web/server.js`) o despliega en Vercel.
- Anota la **Backend URL** (local `http://localhost:PORT` o la de Vercel).

## 3. Extensión
```
npm run build:chrome-extension
```
- Carpeta a cargar: **`generated/chrome-extension/graph-trainer`**.
- `chrome://extensions` → activa **Modo de desarrollador** → **Cargar descomprimida** → esa carpeta.

## 4. Cuentas y Chrome (para la demo real)
- Inicia sesión **antes** en el mismo perfil de Chrome: **Google/Calendar** y **ChatGPT**.
- **Zoom del navegador = 100 %** (Ctrl+0). El runner mide la escala igual, pero 100 % es lo más estable.
- **Ventana** grande/maximizada. El runner fuerza el viewport a 1280×800 @ DPR 1 por CDP, así que las
  coordenadas son deterministas independientemente del monitor.
- Deja el **Side Panel** abierto para ver el estado; la tarea corre en la pestaña de trabajo.

## 5. Ejecutar una tarea
1. Clic en el icono de Miracle → **"🤖 Abrir agente visual"** (abre el Side Panel).
2. En **Configuración**: Backend URL + **API key** (la de `MIRACLE_API_KEYS`, parte después de `demo:`).
3. Escribe la meta (o usa un botón de ejemplo **YouTube / ChatGPT / Calendar**).
4. **Iniciar**. Verás por turno: acciones, coords orig→css, tamaños, escala y la última captura.
5. **Detener** en cualquier momento. Al terminar, **Iniciar** otra sin recargar la extensión.
6. Si algo falla, **Copiar trace** y compártelo.

## 6. Limpiar / recuperar
- **Nueva tarea**: solo escribe otra meta e Inicia (el estado se reinicia y el debugger previo se libera).
- **Debugger colgado**: el runner reintenta reconectar; si la pestaña se cerró, muestra error — abre otra e Inicia.
- **Aviso "está depurando este navegador"**: es normal (chrome.debugger). No lo cierres durante la tarea.
- **Traces**: en el Side Panel (botón Copiar trace). Cada turno registra URL, tamaños, escala, acción,
  coords orig→transformadas, duración, resultado y error.

## 7. Matriz de pruebas (LLÉNALA con ejecuciones reales)
> No inventes tasas de éxito. Registra solo lo que corras de verdad.

| Tarea | Instrucción | Resultado | Turnos | Duración | ¿Intervención? | Punto de fallo | Trace |
|---|---|---|---|---|---|---|---|
| YouTube | "…cómo hacer pan…" |  |  |  |  |  |  |
| YouTube | "…explicación de IA…" |  |  |  |  |  |  |
| YouTube | "…música para estudiar…" |  |  |  |  |  |  |
| ChatGPT | imagen gato astronauta |  |  |  |  |  |  |
| ChatGPT | (otro prompt de imagen) |  |  |  |  |  |  |
| ChatGPT | (otro prompt de imagen) |  |  |  |  |  |  |
| Calendar | martes 3pm inversionistas |  |  |  |  |  |  |
| Calendar | (otra fecha/hora/título) |  |  |  |  |  |  |
| Calendar | (otra fecha/hora/título) |  |  |  |  |  |  |

Resumen por escenario: intentos / éxitos / éxito aprox / tiempo promedio / principal causa de fallo.

## 8. Guion de la demo (reunión)
1. Una frase: *"El modelo solo VE la pantalla (un screenshot) y usa mouse y teclado — sin leer el código de la página ni usar APIs."*
2. **YouTube** (prueba rápida, la más lineal).
3. **ChatGPT** (visualmente llamativa: escribe el prompt y espera la imagen).
4. **Calendar** (utilidad real: crea el evento y lo verifica).
5. Muestra el **trace** (Copiar trace): coords y screenshots, cero selectores/APIs.

**Variante corta (poco tiempo):** solo YouTube + mostrar el trace.

**Plan de recuperación:** si una tarea se atasca → Detener, Copiar trace, e ir a la más estable
(según tu matriz). Ten una pestaña con sesión ya iniciada por si hay que reintentar.

## 9. Limitaciones honestas (di esto)
- Aún **no validado con modelo real**; la robustez real (clicks exactos, esperas de generación) se
  confirma con tu matriz (§7).
- El shape del tool `computer` puede necesitar ajuste según el modelo/endpoint (§1).
- El service worker MV3 puede dormirse en tareas muy largas (aún sin `chrome.alarms`; se añadiría si una
  prueba real lo demuestra).
- El runner fuerza 1280×800 @ DPR1 para determinismo; si el sitio requiere más alto, se ajusta el viewport.

## 10. Siguiente paso tras la reunión
Con la matriz real en mano: afinar `settleMs`/caps por tarea y el `browserGoalPrompt` según los
fallos observados; luego, si se quiere producción, añadir keepalive del SW, confirmación de acciones
consecuentes y persistencia de traces.
