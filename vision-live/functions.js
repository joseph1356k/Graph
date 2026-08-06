/**
 * Registro de function callings disponibles para el modelo en vivo.
 *
 * Para agregar una función nueva: añade un objeto a `functions` con su
 * `declaration` (schema que ve el modelo) y su `handler` (lo que se ejecuta
 * localmente). No hay que tocar nada más — el servidor la expone y el cliente
 * la despacha automáticamente.
 *
 * handler(args, ctx) -> cualquier valor serializable, que se devuelve al modelo.
 *   args : los argumentos que el modelo pasó, ya parseados.
 *   ctx  : { session, saveReport } — ver server.js.
 */

export const functions = [
  {
    declaration: {
      name: "end_test",
      description:
        "Termina la prueba en curso y emite el veredicto final. Llama a esta función únicamente cuando la prueba haya concluido — porque se completó el flujo esperado, porque falló de forma irrecuperable, o porque el usuario pidió terminarla.",
      parameters: {
        type: "OBJECT",
        properties: {
          verdict: {
            type: "STRING",
            enum: ["passed", "failed", "inconclusive"],
            description: "Resultado final de la prueba.",
          },
          summary: {
            type: "STRING",
            description: "Resumen de lo que ocurrió durante la prueba, en 2-4 frases.",
          },
          reason: {
            type: "STRING",
            description:
              "Justificación concreta del veredicto, citando lo que se observó en pantalla.",
          },
        },
        required: ["verdict", "summary"],
      },
    },
    handler: async (args, ctx) => {
      ctx.session.verdict = args.verdict;
      ctx.session.summary = args.summary || "";
      ctx.session.reason = args.reason || "";
      ctx.session.endedAt = new Date().toISOString();
      const file = await ctx.saveReport();
      return { ok: true, report_saved_to: file, verdict: args.verdict };
    },
  },

  {
    declaration: {
      name: "log_finding",
      description:
        "Registra un hallazgo durante la prueba sin terminarla: un error visible, un comportamiento inesperado, un elemento que no respondió, o una observación relevante para depurar. Úsala en el momento en que lo observes.",
      parameters: {
        type: "OBJECT",
        properties: {
          severity: {
            type: "STRING",
            enum: ["info", "warning", "error"],
            description: "Gravedad del hallazgo.",
          },
          title: { type: "STRING", description: "Descripción breve del hallazgo." },
          detail: {
            type: "STRING",
            description: "Qué se vio exactamente en pantalla y por qué importa.",
          },
        },
        required: ["severity", "title"],
      },
    },
    handler: async (args, ctx) => {
      const finding = {
        at: new Date().toISOString(),
        elapsed_s: ctx.session.elapsed(),
        severity: args.severity,
        title: args.title,
        detail: args.detail || "",
      };
      ctx.session.findings.push(finding);
      return { ok: true, logged: finding.title, total_findings: ctx.session.findings.length };
    },
  },

  {
    declaration: {
      name: "mark_step",
      description:
        "Marca que un paso del flujo bajo prueba se completó y con qué resultado. Sirve para construir la línea de tiempo de la prueba.",
      parameters: {
        type: "OBJECT",
        properties: {
          step: { type: "STRING", description: "Qué paso se completó." },
          status: {
            type: "STRING",
            enum: ["ok", "failed", "skipped"],
            description: "Resultado del paso.",
          },
          note: { type: "STRING", description: "Detalle opcional sobre el paso." },
        },
        required: ["step", "status"],
      },
    },
    handler: async (args, ctx) => {
      const step = {
        at: new Date().toISOString(),
        elapsed_s: ctx.session.elapsed(),
        step: args.step,
        status: args.status,
        note: args.note || "",
      };
      ctx.session.steps.push(step);
      return { ok: true, step_number: ctx.session.steps.length };
    },
  },
];

/** Declaraciones planas para pasar a la Live API. */
export function declarations() {
  return functions.map((f) => f.declaration);
}

/** Busca el handler de una función por nombre. */
export function handlerFor(name) {
  const found = functions.find((f) => f.declaration.name === name);
  return found ? found.handler : null;
}
