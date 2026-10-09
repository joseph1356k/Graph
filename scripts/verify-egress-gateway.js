// Prueba ESTRUCTURAL del gateway de salida: ningún archivo de Graph puede
// hablar con un proveedor de IA fuera de los transportes conocidos, y los
// transportes que llevan texto clínico tienen que pasar por el escudo.
//
// Es lo que impide que una ruta nueva «se olvide» del escudo: el test lee el
// árbol de fuentes, no una lista escrita a mano de lo que creemos que existe.
//   node scripts/verify-egress-gateway.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCAN_DIRS = ['src', path.join('web', 'api')];
const SCAN_FILES = [path.join('web', 'server.js')];

// Hosts de proveedores de IA. Cualquier mención fuera de la lista de abajo
// falla el test.
const PROVIDER_HOSTS = /(api\.openai\.com|openrouter\.ai|generativelanguage\.googleapis\.com|api\.deepgram\.com|stt-rt\.soniox\.com|api\.soniox\.com|anthropic\.com|services\.ai\.azure\.com|openai\.azure\.com|api\.typesafe\.ai)/;

// Transportes que SÍ mandan datos a un proveedor, con la condición que cumplen.
const TRANSPORTS = {
  'src/infrastructure/LLMProvider.js': { shielded: true, kind: 'texto' },
  'src/infrastructure/conscious-brain/openaiBrain.js': { shielded: false, kind: 'capturas+texto', exception: 'E4' },
  'src/infrastructure/conscious-brain/geminiBrain.js': { shielded: false, kind: 'capturas+texto', exception: 'E4' },
  'src/infrastructure/conscious-brain/config.js': { shielded: false, kind: 'config', exception: 'E4' },
  // Voz en tiempo real del celular (OpenAI): el relé lleva audio y eventos de la
  // sesión; el servicio solo emite el token efímero (sin datos del usuario).
  'web/api/liveVoiceProxy.js': { shielded: false, kind: 'audio+eventos (relé WebSocket)', exception: 'E12' },
  'src/application/use-cases/RealtimeSessionService.js': { shielded: false, kind: 'token efímero (sin datos)', exception: 'E13' },
  'src/infrastructure/teach/GeminiVideoClient.js': { shielded: false, kind: 'video+texto', exception: 'E10' },
  'src/application/use-cases/ClinicalRawTranscriptionService.js': { shielded: false, kind: 'audio', exception: 'E8' },
  'src/application/use-cases/DecisorService.js': { shielded: false, kind: 'paquete+etiquetas+objetivo', exception: 'E11' }
};

// Archivos que nombran un proveedor sin mandarle nada (catálogos de precios,
// configuración de Provider Studio, telemetría).
const NON_EGRESS = new Set([
  'src/domain/usage/pricing.js',
  'src/domain/usage/vocabulary.js',
  'src/domain/usage/providerUsage.js',
  'src/application/use-cases/GraphProviderConfigService.js',
  'src/application/use-cases/MiracleAssistantProviderConfigService.js',
  'src/application/use-cases/BiopsyPhotoProviderConfigService.js',
  'src/application/use-cases/MiracleProductLlmProviderConfigService.js',
  'src/application/use-cases/MiracleSttProviderConfigService.js',
  'src/application/use-cases/ConsciousProviderConfigService.js',
  'src/application/use-cases/TeachVideoProviderConfigService.js',
  'src/application/use-cases/VercelProjectEnvService.js',
  'src/application/use-cases/AiUsageRecorder.js',
  'src/application/use-cases/UsageDashboardService.js',
  'src/infrastructure/usage/SupabaseUsageEventStore.js',
  'web/api/registerProviderRoutes.js',
  'web/api/registerUsageRoutes.js',
  'web/server.js'
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && /\.(js|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function main() {
  const files = [
    ...SCAN_DIRS.flatMap((dir) => walk(path.join(ROOT, dir))),
    ...SCAN_FILES.map((file) => path.join(ROOT, file))
  ];
  const hits = new Map();
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      if (PROVIDER_HOSTS.test(line)) {
        const key = rel(file);
        if (!hits.has(key)) hits.set(key, []);
        hits.get(key).push(index + 1);
      }
    });
  }

  let passed = 0;
  const ok = (name) => { passed += 1; console.log(`  ok ${passed}. ${name}`); };

  // 1. Nadie fuera de la lista habla con un proveedor.
  const unknown = [...hits.keys()].filter((file) => !TRANSPORTS[file] && !NON_EGRESS.has(file));
  assert.deepStrictEqual(unknown, [], `archivos que nombran un proveedor sin estar en la lista de transportes: ${unknown.map((f) => `${f}:${hits.get(f).join(',')}`).join(' · ')}`);
  ok(`solo los transportes conocidos nombran un proveedor (${hits.size} archivos con menciones)`);

  // 2. Los transportes de texto pasan por el escudo, ANTES de medir y con
  //    rehidratación dentro de la llamada.
  const llm = fs.readFileSync(path.join(ROOT, 'src/infrastructure/LLMProvider.js'), 'utf8');
  assert.ok(/setPrivacyShield/.test(llm), 'LLMProvider expone setPrivacyShield');
  const protectAt = llm.indexOf('protectChatPayload');
  const measureAt = llm.indexOf('usageRecorder.measure(');
  const restoreAt = llm.indexOf('restoreChatResponse');
  const postAt = llm.indexOf("axios.post(`${this.baseUrl}/chat/completions`");
  assert.ok(protectAt > 0 && measureAt > protectAt, 'protect corre antes de measure');
  assert.ok(postAt > protectAt, 'el POST sale después de proteger');
  assert.ok(restoreAt > postAt, 'la respuesta se rehidrata después del POST');
  assert.ok(/axios\.post\(`\$\{this\.baseUrl\}\/chat\/completions`, outbound/.test(llm), 'lo que sale es la copia tapada (outbound), no el payload original');
  ok('LLMProvider: protect → POST (copia tapada) → restore, en ese orden');

  // 3. El salto Node → Python está tapado en las dos rutas que lo cruzan con texto clínico:
  //    la etapa `note` del pipeline y el proxy del orquestador de voz (el editor de la
  //    extensión y web/public/miracle). /api/medical/notes/organized se borró el 2026-10-01.
  const pipeline = fs.readFileSync(path.join(ROOT, 'web/api/registerPublicApiRoutes.js'), 'utf8');
  assert.ok(/privacyShield\.protectTexts/.test(pipeline) && /privacyShield\.restoreText/.test(pipeline), 'el pipeline tapa y rehidrata el salto al runtime Python');
  const server = fs.readFileSync(path.join(ROOT, 'web/server.js'), 'utf8');
  const proxyAt = server.indexOf("app.post('/api/voice/orchestrator/events'");
  assert.ok(proxyAt >= 0, 'server.js registra el proxy del orquestador de voz');
  const proxyEnd = server.indexOf('\n});', proxyAt);
  const proxy = server.slice(proxyAt, proxyEnd);
  assert.ok(/privacyShield\.protectTexts/.test(proxy), 'el proxy del orquestador pasa transcripción y nota por el escudo antes de llamar al runtime');
  // E14: con un runtime que guarda historial y un mapa por llamada, tapar cambia el
  // paciente entre segmentos. Hasta que haya mapa por sesión, el techo es shadow y
  // la excepción está escrita en el registro.
  assert.ok(/maxMode: ORCHESTRATOR_SHIELD_MAX_MODE/.test(proxy)
    && /const ORCHESTRATOR_SHIELD_MAX_MODE = PrivacyShieldService\.MODES\.SHADOW;/.test(server),
    'el proxy del orquestador declara su techo de shadow (E14) en vez de tapar con un mapa por llamada');
  assert.ok(/\| \*\*E14\*\* \|/.test(fs.readFileSync(path.join(ROOT, 'docs/privacy-egress-gateway.md'), 'utf8')),
    'y la excepción E14 está en el registro');
  assert.ok(!/proxyMiracleRuntimeRequest/.test(proxy), 'el proxy del orquestador no reenvía el cuerpo original');
  assert.ok(/restoreOrchestratorPayload\(/.test(proxy), 'el proxy del orquestador rehidrata lo que vuelve');
  const proxyRestoreAt = server.indexOf('function restoreOrchestratorPayload(');
  assert.ok(proxyRestoreAt >= 0 && /privacyShield\.restoreText/.test(server.slice(proxyRestoreAt, server.indexOf('\n}', proxyRestoreAt))), 'la rehidratación del proxy usa el escudo');
  ok('el salto Node → runtime Python pasa por el escudo (pipeline tapado; proxy /api/voice/orchestrator/events medido, E14)');

  // 4. Las excepciones declaradas están escritas en el registro de excepciones.
  const doc = fs.readFileSync(path.join(ROOT, 'docs/privacy-egress-gateway.md'), 'utf8');
  for (const [file, spec] of Object.entries(TRANSPORTS)) {
    if (spec.exception) {
      assert.ok(doc.includes(spec.exception), `la excepción ${spec.exception} (${file}) está declarada en docs/privacy-egress-gateway.md`);
    }
  }
  ok('cada transporte sin escudo está declarado como excepción en la documentación');

  // 5. Guardas de marcadores antes de que un valor llegue a SAP.
  const matcher = fs.readFileSync(path.join(ROOT, 'src/application/use-cases/NoteFieldMatcher.js'), 'utf8');
  const resolver = fs.readFileSync(path.join(ROOT, 'src/application/use-cases/DynamicValueResolver.js'), 'utf8');
  assert.ok(/containsToken\(m\.value\)/.test(matcher), 'NoteFieldMatcher descarta valores con marcador');
  assert.ok(/containsToken\(value\)/.test(resolver), 'DynamicValueResolver descarta valores con marcador');
  ok('ningún valor con marcador puede devolverse al ejecutor de Operations');

  console.log(`\n✅ Gateway de salida: ${passed} comprobaciones OK.`);
}

try {
  main();
} catch (error) {
  console.error(`\n❌ ${error.message}`);
  process.exit(1);
}
