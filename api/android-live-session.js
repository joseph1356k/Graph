// Función Vercel DEDICADA para el proxy de voz Live (gpt-live-1) del cliente
// Android. NO pasa por el api/index.js compartido (que corta todo /api/*
// a los 60s vía su maxDuration en vercel.json) — un WebSocket de voz
// necesita vivir mucho más que eso. El rewrite puntual que manda
// /api/android/live/session acá (antes del catch-all genérico) vive en
// vercel.json, junto con el maxDuration real de esta función.
//
// DURACIÓN REAL: con Fluid compute (default desde 2025-04-23 para proyectos
// nuevos — confirmado contra la doc de Vercel 2026-09-18), el plan Hobby
// tiene 300s (5 min) como default Y como máximo — no hay "extended
// duration" en Hobby, eso es sólo Pro/Enterprise. maxDuration=300 en
// vercel.json es literalmente el techo de la cuenta, no una elección
// nuestra. web/api/liveVoiceProxy.js se autocierra unos segundos antes
// (MAX_DURATION_MS) con un código de cierre propio para que el cliente
// Android reconecte limpio en vez de ver un corte abrupto a los 300s.
//
// DELIBERADAMENTE LIVIANA: a diferencia de api/index.js, esta función NO
// reutiliza el Express app completo de web/server.js (Neo4j, los seis
// LLMProvider, etc.) — sólo necesita el chequeo de whitelist contra
// Supabase y el relay hacia OpenAI. Menos superficie, cold start más
// rápido, y un bug acá no puede tumbar el resto de la API.
//
// PATRÓN: el oficial de la doc de Vercel para WebSockets sobre Express/Node
// (`http.createServer(app)` + `WebSocketServer` de la librería `ws`), sin
// inventar uno distinto.
const path = require('path');
const http = require('http');
const express = require('express');

require('dotenv').config({
  path: path.resolve(__dirname, '..', '.env.local'),
  quiet: true
});
require('dotenv').config({ quiet: true });

const SupabaseRestClient = require('../src/infrastructure/SupabaseRestClient');
const LiveVoiceDeviceAuthorizer = require('../src/application/use-cases/LiveVoiceDeviceAuthorizer');
const attachLiveVoiceProxy = require('../web/api/liveVoiceProxy');

const app = express();
// Cualquier request HTTP normal a esta función (no debería llegar tráfico
// que no sea el upgrade de /api/android/live/session, ver vercel.json) se
// contesta sin intentar interpretarla.
app.use((req, res) => {
  res.status(400).json({ error: 'Esta función sólo acepta upgrade a WebSocket en /api/android/live/session.' });
});

const server = http.createServer(app);

const supabaseRestClient = new SupabaseRestClient();
const authorizer = new LiveVoiceDeviceAuthorizer(supabaseRestClient);

// OJO ACÁ: Vercel entrega a la función el path de DESTINO del rewrite
// (/api/android-live-session), no el de origen que pidió el celular
// (/api/android/live/session) — mismo motivo por el que api/index.js
// reconstruye a mano el path original desde ?path=. Sin este override,
// attachLiveVoiceProxy compararía contra su default (el path de origen) y
// rechazaría con 404 todo upgrade legítimo en producción.
attachLiveVoiceProxy(server, { authorizer, path: '/api/android-live-session' });

module.exports = server;
