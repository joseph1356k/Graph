// Verifica la "hoja en blanco" para quien NO es médico: configuración inicial
// por voz (+ capturas de ejemplo), consulta del perfil, aprendizaje de nuevas
// capturas y organización de una transcripción con el system prompt generado.
// Corre contra un Supabase fake en memoria y un LLM fake, levantando las rutas
// reales de /api/v1/organizer/*.
//   node scripts/verify-organizer-profiles.js
const assert = require('assert');
const crypto = require('crypto');
const express = require('express');
const http = require('http');

const SupabaseOrganizerProfileRepository = require('../src/infrastructure/repositories/SupabaseOrganizerProfileRepository');
const OrganizerProfileService = require('../src/application/use-cases/OrganizerProfileService');
const registerOrganizerRoutes = require('../web/api/registerOrganizerRoutes');

const DEVICE = 'device-supervisor-001';
const OTHER_DEVICE = 'device-vendedor-002';
const SPOKEN = 'Soy supervisor de planta. Cada hora tengo que reportar cuántas unidades salieron, si hubo paradas de máquina y cualquier novedad de seguridad. Lo mando por WhatsApp al grupo de producción.';
const TRANSCRIPT = 'En esta hora salieron trescientas veinte unidades. La máquina cuatro se paró doce minutos por cambio de rollo. Sin novedades de seguridad, todo el mundo con casco.';
const PNG_PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

// PostgREST en memoria, con lo justo que usa el repositorio: select con
// filtros eq, insert con return=representation y patch por filtro.
function createFakeSupabaseRestClient() {
  const rows = [];

  function parseParams(query) {
    return `${query || ''}`.split('&').filter(Boolean).map((pair) => {
      const eq = pair.indexOf('=');
      return [pair.slice(0, eq), decodeURIComponent(pair.slice(eq + 1))];
    });
  }

  function applyFilters(list, params) {
    let result = list.slice();
    for (const [name, value] of params) {
      if (['select', 'order', 'limit'].includes(name)) continue;
      const match = value.match(/^eq\.(.*)$/);
      if (!match) continue;
      result = result.filter((row) => `${row[name]}` === match[1]);
    }
    return result;
  }

  return {
    isConfigured: () => true,
    async select(table, query) {
      assert.strictEqual(table, 'graph_organizer_profiles');
      return applyFilters(rows, parseParams(query));
    },
    async insert(table, row) {
      assert.strictEqual(table, 'graph_organizer_profiles');
      const now = new Date().toISOString();
      const stored = {
        id: crypto.randomUUID(),
        status: 'active',
        created_at: now,
        updated_at: now,
        ...row
      };
      rows.push(stored);
      return stored;
    },
    async update(table, query, patch) {
      assert.strictEqual(table, 'graph_organizer_profiles');
      const targets = applyFilters(rows, parseParams(query));
      targets.forEach((row) => Object.assign(row, patch));
      return targets[0] || null;
    },
    // Solo para las aserciones del test.
    _rows: rows
  };
}

// LLM fake: responde según el system prompt que recibe, y deja registro de
// cada llamada para poder afirmar QUÉ prompt se usó al organizar.
function createFakeLlmProvider() {
  const calls = [];
  return {
    calls,
    hasApiKey: () => true,
    parseJsonObject: (content) => JSON.parse(content),
    async chatExpectingJson(messages) {
      const system = messages[0]?.content || '';
      const user = messages[1]?.content;
      calls.push({ system, user });

      if (system.includes('diseñador de asistentes')) {
        const sawSamples = `${user}`.includes('EJEMPLOS DE CÓMO YA ORGANIZA');
        return JSON.stringify({
          occupation: 'supervisor de planta',
          summary: 'Voy a organizar tu reporte de producción por hora.',
          confirmation: 'Listo, ya sé cómo organizar tus reportes.',
          sections: [
            { key: 'Producción', label: 'Producción', instruction: 'Unidades producidas en el turno.' },
            { key: 'paradas', label: 'Paradas de máquina', instruction: 'Equipo, duración y causa.' },
            { key: 'paradas', label: 'Seguridad', instruction: 'Novedades de seguridad.' }
          ],
          system_prompt: `Eres un asistente de un supervisor de planta.${sawSamples ? ' FORMATO-DE-CAPTURA' : ''}`
        });
      }

      if (system.includes('captura de pantalla')) {
        return JSON.stringify({
          format_notes: 'Mensaje corto de WhatsApp con títulos en negrilla y viñetas.',
          sections: [{ label: 'Producción', instruction: 'unidades del turno' }],
          warnings: []
        });
      }

      // Organización de una transcripción con el prompt del usuario.
      return JSON.stringify({
        title: 'Reporte de producción',
        sections: [
          { key: 'produccion', label: 'Producción', content: '320 unidades.' },
          { key: 'paradas', label: 'Paradas de máquina', content: 'Máquina 4: 12 min por cambio de rollo.' },
          { key: 'inventado', label: 'Sección fantasma', content: 'no debería sobrevivir' }
        ],
        warnings: ['No mencionaste el turno.']
      });
    }
  };
}

function buildApp(service) {
  const app = express();
  app.use(express.json({ limit: '16mb' }));
  registerOrganizerRoutes(app, { organizerProfileService: service });
  return app;
}

function request(server, method, path, body) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers: payload ? { 'Content-Type': 'application/json' } : {} },
      (res) => {
        let text = '';
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Casos
// ---------------------------------------------------------------------------
async function main() {
  const supabase = createFakeSupabaseRestClient();
  const llm = createFakeLlmProvider();
  const service = new OrganizerProfileService({
    repository: new SupabaseOrganizerProfileRepository(supabase),
    llmProvider: llm,
    visionLlmProvider: llm
  });
  const server = http.createServer(buildApp(service)).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    // 1. Sin configurar todavía: 404 explícito, no un 500.
    const missing = await request(server, 'GET', `/api/v1/organizer/profiles/${DEVICE}`);
    assert.strictEqual(missing.status, 404);
    assert.strictEqual(missing.body.error.code, 'ORGANIZER_PROFILE_NOT_FOUND');

    // 2. Organizar sin perfil falla con el mismo código (y no llama al modelo
    //    para organizar: no hay prompt con qué hacerlo).
    const orphan = await request(server, 'POST', '/api/v1/organizer/organize', {
      device_id: DEVICE, transcript: TRANSCRIPT
    });
    assert.strictEqual(orphan.status, 404);
    assert.strictEqual(orphan.body.error.code, 'ORGANIZER_PROFILE_NOT_FOUND');

    // 3. Falta lo que dictó la persona: mensaje accionable, no un genérico.
    const empty = await request(server, 'POST', '/api/v1/organizer/profiles', { device_id: DEVICE, description: '  ' });
    assert.strictEqual(empty.status, 400);
    assert.strictEqual(empty.body.error.code, 'ORGANIZER_DESCRIPTION_REQUIRED');

    // 4. Configuración inicial solo con voz, sin capturas.
    const created = await request(server, 'POST', '/api/v1/organizer/profiles', {
      device_id: DEVICE, profession: 'otra', description: SPOKEN
    });
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.body.profile.occupation, 'supervisor de planta');
    assert.ok(created.body.confirmation.length > 0, 'debe volver la frase de confirmación para decir en voz alta');
    // Las claves duplicadas que devolvió el modelo se desambiguan.
    const keys = created.body.profile.sections.map((section) => section.key);
    assert.strictEqual(new Set(keys).size, keys.length, `las keys deben ser únicas: ${keys.join(',')}`);
    assert.deepStrictEqual(keys[0], 'produccion', 'la key se normaliza a slug sin acentos');
    // El system prompt NUNCA sale al cliente.
    assert.strictEqual(created.body.profile.system_prompt, undefined);

    // 5. La app pregunta por su perfil y lo encuentra.
    const found = await request(server, 'GET', `/api/v1/organizer/profiles/${DEVICE}`);
    assert.strictEqual(found.status, 200);
    assert.strictEqual(found.body.profile.id, created.body.profile.id);

    // 6. Organizar: se usa EL system prompt del usuario, y las secciones se
    //    alinean al perfil (la sección fantasma del modelo se descarta).
    const organized = await request(server, 'POST', '/api/v1/organizer/organize', {
      device_id: DEVICE, transcript: TRANSCRIPT
    });
    assert.strictEqual(organized.status, 200);
    const lastCall = llm.calls[llm.calls.length - 1];
    assert.ok(
      lastCall.system.startsWith('Eres un asistente de un supervisor de planta.'),
      'organizar debe usar el system prompt generado para ESTE usuario'
    );
    assert.ok(
      lastCall.system.includes('FORMATO DE RESPUESTA'),
      'el contrato de salida se anexa siempre, aunque el prompt del usuario no lo pida'
    );
    const reportKeys = organized.body.report.sections.map((section) => section.key);
    assert.deepStrictEqual(reportKeys, keys, 'el reporte sigue las secciones del perfil');
    assert.ok(!reportKeys.includes('inventado'), 'una sección que no está en el perfil no sobrevive');
    assert.strictEqual(organized.body.report.sections[2].content, '', 'una sección sin datos queda vacía, no inventada');
    assert.ok(
      organized.body.report.markdown.includes('320 unidades.'),
      'el markdown listo para pegar en WhatsApp trae el contenido'
    );
    assert.deepStrictEqual(organized.body.report.warnings, ['No mencionaste el turno.']);

    // 7. Capturas de ejemplo después: reescriben el prompt con el formato real.
    const learned = await request(server, 'POST', `/api/v1/organizer/profiles/${DEVICE}/samples`, {
      screenshots: [PNG_PIXEL]
    });
    assert.strictEqual(learned.status, 200);
    assert.strictEqual(learned.body.profile.sample_count, 1);
    const afterSamples = await request(server, 'POST', '/api/v1/organizer/organize', {
      device_id: DEVICE, transcript: TRANSCRIPT
    });
    assert.strictEqual(afterSamples.status, 200);
    assert.ok(
      llm.calls[llm.calls.length - 1].system.includes('FORMATO-DE-CAPTURA'),
      'tras aprender de una captura, el prompt usado al organizar es el nuevo'
    );

    // 8. Imagen en un formato que no soportamos: 400 claro antes de gastar tokens.
    const badImage = await request(server, 'POST', `/api/v1/organizer/profiles/${DEVICE}/samples`, {
      screenshots: ['data:image/tiff;base64,AAAA']
    });
    assert.strictEqual(badImage.status, 400);
    assert.strictEqual(badImage.body.error.code, 'ORGANIZER_IMAGE_UNSUPPORTED');

    // 9. Demasiadas capturas de golpe: se rechaza en el borde.
    const tooMany = await request(server, 'POST', `/api/v1/organizer/profiles/${DEVICE}/samples`, {
      screenshots: new Array(OrganizerProfileService.MAX_SCREENSHOTS + 1).fill(PNG_PIXEL)
    });
    assert.strictEqual(tooMany.status, 413);
    assert.strictEqual(tooMany.body.error.code, 'ORGANIZER_TOO_MANY_IMAGES');

    // 10. Rehacer la configuración archiva la anterior: un solo perfil activo.
    const redone = await request(server, 'POST', '/api/v1/organizer/profiles', {
      device_id: DEVICE, description: 'Ahora soy jefe de bodega y reporto entradas y salidas.'
    });
    assert.strictEqual(redone.status, 201);
    assert.notStrictEqual(redone.body.profile.id, created.body.profile.id);
    const active = supabase._rows.filter((row) => row.device_id === DEVICE && row.status === 'active');
    assert.strictEqual(active.length, 1, 'solo puede quedar un perfil activo por dispositivo');

    // 11. Aislamiento entre instalaciones: otro teléfono no ve este perfil.
    const foreign = await request(server, 'GET', `/api/v1/organizer/profiles/${OTHER_DEVICE}`);
    assert.strictEqual(foreign.status, 404);

    console.log('OK verify-organizer-profiles: 11 casos');
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
