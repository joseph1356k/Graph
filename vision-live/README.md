# Vision Live

Capa de visión en tiempo real: Gemini Live API observa la pantalla mientras corre una
prueba de UI y **piensa en voz alta** — narra lo que ve y lo que razona, sin intervención
del usuario. Si hablas, te escucha (interrumpe automáticamente) y sigue desde ahí.

Todavía **no** está conectado al sistema que aprende de apps. Es solo la capa de visión
que las ventanas de contexto pueden capturar para hacer sus pruebas.

## Arranque

```bash
npm install
npm start
```

Abre <http://localhost:5178> en Chrome o Edge (necesita `getDisplayMedia`).

## Cómo funciona una prueba

1. Ponle nombre a la prueba y describe **qué debería pasar** (panel derecho).
2. **Iniciar prueba** → el navegador te pide qué pantalla o ventana compartir.
3. El modelo empieza a narrar lo que observa, con voz y texto en paralelo.
4. Activa el **micrófono** si quieres corregirlo o darle contexto hablando.
   También puedes escribirle desde la caja de texto.
5. La prueba termina cuando el modelo llama a `end_test`, o cuando pulsas **Detener**.
6. El reporte queda en `reports/<id>.json` con línea de tiempo, hallazgos y narración.

## Configuración

El panel izquierdo edita el modelo en caliente. **Guardar** lo persiste en `config.json`;
sin guardar, los valores del formulario igual se aplican a la siguiente prueba.

| Ajuste | Nota |
|---|---|
| Modelo | `gemini-3.1-flash-live-preview` por defecto |
| Voz / idioma | Voces nativas de la Live API |
| FPS | La API acepta ~1 FPS de forma fiable. Más FPS = más tokens |
| Ancho máx. de frame | Se reescala antes de enviar; baja esto para reducir costo |
| Resolución de medios | `LOW` / `MEDIUM` / `HIGH` |
| Diálogo afectivo | El modelo detecta emoción en tu voz |
| Proactividad | Puede decidir quedarse callado |
| Instrucción de sistema | Lo que define el "pensar en voz alta" |

## Agregar function callings

Todo vive en [`functions.js`](functions.js). Añade una entrada al array `functions`:

```js
{
  declaration: {
    name: "mi_funcion",
    description: "Cuándo debe llamarla el modelo.",
    parameters: {
      type: "OBJECT",
      properties: { campo: { type: "STRING", description: "…" } },
      required: ["campo"],
    },
  },
  handler: async (args, ctx) => {
    // ctx.session — estado de la prueba en curso
    // ctx.saveReport() — vuelca el reporte a disco
    return { ok: true };
  },
}
```

No hay que tocar el servidor ni el cliente: la declaración se expone automáticamente
al modelo y el despacho de la llamada ya está cableado.

Funciones incluidas: `end_test`, `log_finding`, `mark_step`.

## Notas técnicas

- El navegador **nunca ve la API key**: el servidor emite un token efímero por sesión
  (`POST /api/token`) y el cliente conecta con eso.
- Audio de entrada: PCM 16 bits, 16 kHz mono. Salida: PCM 16 bits, 24 kHz.
- Las sesiones con audio + vídeo se cortan a ~2 min sin compresión, por eso va activado
  `contextWindowCompression` con ventana deslizante, más `sessionResumption`.
- La interrupción por voz (barge-in) la detecta el servidor de Gemini; el cliente solo
  vacía la cola de audio al recibir la señal `interrupted`.

## Configuración sensible

`secrets.json` guarda la API key de Gemini y está en `.gitignore` — igual que
`config.json` y `reports/`. Como alternativa se puede exportar `GEMINI_API_KEY`
en el entorno, que tiene prioridad sobre el archivo.
