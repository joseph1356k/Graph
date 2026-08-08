import express from "express";
import { GoogleGenAI } from "@google/genai";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { declarations, handlerFor } from "./functions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5178;
const CONFIG_PATH = path.join(__dirname, "config.json");
const SECRETS_PATH = path.join(__dirname, "secrets.json");
const REPORTS_DIR = path.join(__dirname, "reports");

/* ------------------------------------------------------------------ */
/* API key                                                             */
/* ------------------------------------------------------------------ */

function readApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (fsSync.existsSync(SECRETS_PATH)) {
    try {
      return JSON.parse(fsSync.readFileSync(SECRETS_PATH, "utf8")).GEMINI_API_KEY || null;
    } catch {
      return null;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const DEFAULT_CONFIG = {
  model: "gemini-3.1-flash-live-preview",
  voice: "Puck",
  temperature: 0.7,
  fps: 1,
  jpegQuality: 0.7,
  maxFrameWidth: 1152,
  mediaResolution: "MEDIA_RESOLUTION_MEDIUM",
  languageCode: "es-ES",
  enableAffectiveDialog: false,
  proactive: false,
  systemInstruction: `Eres un analista de QA observando en tiempo real la pantalla de una aplicación de escritorio Windows mientras se ejecuta una prueba automatizada. Hablas en español.

TU FORMA DE TRABAJAR — pensar en voz alta:
Narra continuamente lo que observas y lo que estás razonando, como un analista que va comentando su trabajo mientras lo hace. No esperes a tener conclusiones: di lo que ves, lo que esperabas ver, y lo que te genera duda, en el momento. Frases cortas y concretas. Menciona elementos concretos de la interfaz (nombres de botones, títulos de ventana, mensajes) en vez de descripciones vagas.

Si durante varios segundos no cambia nada en pantalla, dilo brevemente y señala si eso es esperado (una carga) o sospechoso (algo se quedó colgado). No te quedes en silencio largo rato ni repitas lo mismo una y otra vez: si no hay novedad, guarda silencio unos segundos y retoma cuando algo cambie.

AUTONOMÍA:
Ejecuta el seguimiento de la prueba completo sin pedir permiso ni hacer preguntas de confirmación. El usuario puede no estar mirando. Nunca preguntes "¿quieres que continúe?" — continúa.

HERRAMIENTAS:
- Llama a mark_step cuando un paso identificable del flujo se complete.
- Llama a log_finding en el momento en que veas un error, un mensaje inesperado, un elemento que no responde, o algo que valga la pena depurar.
- Llama a end_test únicamente cuando la prueba haya concluido: se completó el flujo, falló de forma irrecuperable, o el usuario pidió terminar. Emite el veredicto con la justificación de lo que viste.

CUANDO EL USUARIO HABLA:
Te interrumpe con prioridad. Escucha, incorpora lo que te diga (contexto sobre qué debía pasar, una corrección a tu interpretación, o una instrucción) y sigue desde ahí. Si te corrige, acéptalo sin discutir y ajusta tu análisis.

HONESTIDAD:
Si no puedes determinar algo con certeza por la resolución o porque la ventana está tapada, dilo explícitamente. No inventes lo que no ves.`,
};

async function readConfig() {
  try {
    const raw = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function writeConfig(cfg) {
  const merged = { ...DEFAULT_CONFIG, ...cfg };
  await fs.writeFile(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

/* ------------------------------------------------------------------ */
/* Sesiones de prueba en memoria                                       */
/* ------------------------------------------------------------------ */

const sessions = new Map();

function newSession(meta = {}) {
  const id = `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const startedAt = new Date();
  const session = {
    id,
    label: meta.label || "Prueba sin nombre",
    context: meta.context || "",
    startedAt: startedAt.toISOString(),
    endedAt: null,
    verdict: null,
    summary: "",
    reason: "",
    steps: [],
    findings: [],
    narration: [],
    elapsed: () => Math.round((Date.now() - startedAt.getTime()) / 1000),
  };
  sessions.set(id, session);
  return session;
}

async function saveReport(session) {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const file = path.join(REPORTS_DIR, `${session.id}.json`);
  const { elapsed, ...serializable } = session;
  await fs.writeFile(
    file,
    JSON.stringify({ ...serializable, duration_s: session.elapsed() }, null, 2)
  );
  return file;
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// El SDK va empaquetado en public/vendor/genai.bundle.js (script `build`),
// porque el bundle "web" que publica @google/genai deja imports sin resolver.
app.get("/api/health", (req, res) => {
  res.json({ ok: true, hasApiKey: !!readApiKey() });
});

app.get("/api/config", async (req, res) => {
  res.json({ config: await readConfig(), defaults: DEFAULT_CONFIG });
});

app.post("/api/config", async (req, res) => {
  try {
    res.json({ ok: true, config: await writeConfig(req.body || {}) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/functions", (req, res) => {
  res.json({ declarations: declarations() });
});

/** Token efímero: el navegador nunca ve la API key real. */
app.post("/api/token", async (req, res) => {
  const apiKey = readApiKey();
  if (!apiKey) {
    return res
      .status(400)
      .json({ error: "Falta GEMINI_API_KEY (variable de entorno o secrets.json)." });
  }
  try {
    const ai = new GoogleGenAI({ apiKey });
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      },
    });
    res.json({ token: token.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Reporta al ledger central lo que consumió una sesión de visión en vivo.
 *
 * POR QUÉ HACE FALTA. Esta capa habla por WebSocket DIRECTO con la Live API de
 * Gemini desde el navegador: el servidor solo firma el token efímero y nunca ve
 * la conversación. Sin este reporte, el gasto existe en la factura de Google y
 * no existe en el panel — y un panel que no cuadra con la factura deja de
 * usarse a la tercera vez que no cuadra.
 *
 * SIN CONFIGURAR, NO HACE NADA. `vision-live` se ejecuta suelto, en la máquina
 * de quien prueba, y no tiene por qué conocer el ledger. Si faltan las dos
 * variables, se calla — pero lo dice UNA vez al arrancar, para que «no aparece
 * nada» no se confunda con «no se ha usado».
 *
 * ATRIBUCIÓN: `system`. No hay un médico detrás, hay una herramienta interna.
 * Inventarle un usuario sería peor que dejarlo sin usuario, y descartarlo sería
 * perder gasto real. `system` es exactamente lo que es.
 */
let avisoLedgerDado = false;
async function reportSessionUsage(session) {
  const base = (process.env.GRAPH_BASE_URL || "").replace(/\/+$/, "");
  const key = (process.env.GRAPH_USAGE_INGEST_KEY || "").trim();
  if (!base || !key) {
    if (!avisoLedgerDado) {
      avisoLedgerDado = true;
      console.warn(
        "[uso] GRAPH_BASE_URL / GRAPH_USAGE_INGEST_KEY sin definir: " +
        "el consumo de esta sesión NO se reporta al panel de costos."
      );
    }
    return;
  }
  const usage = session.usage;
  if (!usage || !(usage.totalTokens > 0)) return;

  try {
    await fetch(`${base}/api/internal/usage/events`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-graph-usage-key": key },
      body: JSON.stringify({
        provider: "google",
        apiFamily: "live",
        requestedModel: usage.model || "",
        servedModel: usage.model || "",
        inputTokens: usage.inputTokens || 0,
        outputTokens: usage.outputTokens || 0,
        totalTokens: usage.totalTokens || 0,
        status: "ok",
        actorType: "system",
        attributionSource: "internal",
        app: "system",
        feature: "live_vision",
        sessionId: session.id,
        metadata: { usageSource: "client_reported" },
      }),
      signal: AbortSignal.timeout(4000),
    });
  } catch (error) {
    // La telemetría no puede impedir que se guarde el informe de la prueba.
    console.warn(`[uso] no se pudo reportar el consumo: ${error.message}`);
  }
}

app.post("/api/session/start", (req, res) => {
  const s = newSession(req.body || {});
  res.json({ id: s.id, startedAt: s.startedAt, label: s.label });
});

app.post("/api/session/:id/narration", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "Sesión no encontrada" });
  s.narration.push({
    at: new Date().toISOString(),
    elapsed_s: s.elapsed(),
    speaker: req.body.speaker || "model",
    text: req.body.text || "",
  });
  res.json({ ok: true });
});

// El navegador manda aquí lo que la Live API le fue reportando. Se guarda en la
// sesión y se envía al ledger al terminar, en un solo evento: una conversación
// de voz no son N llamadas, es una sesión con un consumo acumulado.
app.post("/api/session/:id/usage", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "Sesión no encontrada" });
  const intOf = (value) => {
    const n = Math.trunc(Number(value));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  // La Live API reporta TOTALES ACUMULADOS de la sesión, no incrementos: se
  // queda el último, no se suman. Sumarlos multiplicaría el consumo por el
  // número de mensajes recibidos.
  s.usage = {
    model: `${req.body?.model || ""}`.trim(),
    inputTokens: intOf(req.body?.inputTokens),
    outputTokens: intOf(req.body?.outputTokens),
    totalTokens: intOf(req.body?.totalTokens),
  };
  res.json({ ok: true });
});

app.post("/api/session/:id/stop", async (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "Sesión no encontrada" });
  await reportSessionUsage(s);
  if (!s.endedAt) {
    s.endedAt = new Date().toISOString();
    s.verdict = s.verdict || "aborted";
    s.reason = s.reason || "Detenida manualmente por el usuario.";
  }
  const file = await saveReport(s);
  res.json({ ok: true, report: file, session: { ...s, elapsed: undefined } });
});

/** Ejecuta un function calling emitido por el modelo. */
app.post("/api/call", async (req, res) => {
  const { name, args, sessionId } = req.body || {};
  const handler = handlerFor(name);
  if (!handler) {
    return res.status(404).json({ error: `Función desconocida: ${name}` });
  }
  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: "Sesión no encontrada" });
  }
  try {
    const result = await handler(args || {}, {
      session,
      saveReport: () => saveReport(session),
    });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/reports", async (req, res) => {
  try {
    await fs.mkdir(REPORTS_DIR, { recursive: true });
    const files = (await fs.readdir(REPORTS_DIR)).filter((f) => f.endsWith(".json"));
    const items = await Promise.all(
      files.map(async (f) => {
        const data = JSON.parse(await fs.readFile(path.join(REPORTS_DIR, f), "utf8"));
        return {
          id: data.id,
          label: data.label,
          verdict: data.verdict,
          startedAt: data.startedAt,
          duration_s: data.duration_s,
          findings: (data.findings || []).length,
        };
      })
    );
    items.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    res.json({ reports: items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  const keyStatus = readApiKey() ? "configurada" : "FALTA (ver README)";
  console.log(`\n  vision-live escuchando en http://localhost:${PORT}`);
  console.log(`  GEMINI_API_KEY: ${keyStatus}\n`);
});
