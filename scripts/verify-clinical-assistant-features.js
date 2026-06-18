const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const NoteFieldMatcher = require('../src/application/use-cases/NoteFieldMatcher');
const ClinicalDiagnosisSuggestionService = require('../src/application/use-cases/ClinicalDiagnosisSuggestionService');
const registerClinicalRoutes = require('../web/api/registerClinicalRoutes');

const repoRoot = path.resolve(__dirname, '..');
const publicRoot = path.join(repoRoot, 'web', 'public');

function createJsonProvider(handler) {
  return {
    hasApiKey: () => true,
    async chatExpectingJson(messages) {
      return JSON.stringify(handler(messages));
    },
    async chatExpectingJsonWithUsage(messages) {
      return {
        content: JSON.stringify(handler(messages)),
        usage: null,
        provider: 'test',
        model: 'test'
      };
    },
    parseJsonObject(content) {
      return JSON.parse(content);
    }
  };
}

function createResponseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

async function verifyDiagnosisServiceAndRoute() {
  const note = 'Paciente con fiebre y odinofagia de tres dias, sin disnea.';
  const provider = createJsonProvider(() => ({
    suggestions: [
      {
        title: 'Faringitis aguda',
        rationale: 'Compatible con fiebre y odinofagia, pendiente de confirmacion clinica.',
        supportingEvidence: 'fiebre y odinofagia de tres dias'
      },
      {
        title: 'Hallazgo inventado',
        rationale: 'No debe pasar el filtro de evidencia.',
        supportingEvidence: 'radiografia con infiltrado'
      }
    ]
  }));
  const service = new ClinicalDiagnosisSuggestionService(provider);
  const result = await service.suggest(note);

  assert.strictEqual(result.suggestions.length, 1, 'only evidence-grounded suggestions should remain');
  assert.strictEqual(result.suggestions[0].title, 'Faringitis aguda');
  assert.strictEqual(
    result.reviewNotice,
    'Sugerencias de IA para revisión médica. No constituyen diagnósticos confirmados.'
  );

  let routeHandler = null;
  registerClinicalRoutes({
    post(route, handler) {
      assert.strictEqual(route, '/api/clinical/diagnosis-suggestions');
      routeHandler = handler;
    }
  }, { diagnosisSuggestionService: service });
  assert(routeHandler, 'clinical diagnosis route must be registered');

  let response = createResponseRecorder();
  await routeHandler({ body: { noteContent: '' } }, response);
  assert.strictEqual(response.statusCode, 400);

  response = createResponseRecorder();
  await routeHandler({ body: { noteContent: 'x'.repeat(20001) } }, response);
  assert.strictEqual(response.statusCode, 413);

  response = createResponseRecorder();
  await routeHandler({ body: { noteContent: note } }, response);
  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.payload.suggestions.length, 1);

  const unavailableService = new ClinicalDiagnosisSuggestionService(null);
  registerClinicalRoutes({
    post(_route, handler) {
      routeHandler = handler;
    }
  }, { diagnosisSuggestionService: unavailableService });
  response = createResponseRecorder();
  await routeHandler({ body: { noteContent: note } }, response);
  assert.strictEqual(response.statusCode, 503);
}

async function verifyRelatedFieldMatcher() {
  const provider = createJsonProvider((messages) => {
    const request = JSON.parse(messages[1].content);
    assert(request.noteContent.includes('cedula 1023456789'));
    assert(request.fields.some((field) => field.label === 'Tipo de documento'));
    return {
      matches: [
        {
          stepOrder: 1,
          value: '1023456789',
          confidence: 0.99,
          evidence: 'cedula 1023456789'
        },
        {
          stepOrder: 2,
          value: 'cc',
          confidence: 0.98,
          evidence: 'cedula 1023456789'
        }
      ],
      readyToSubmit: false,
      submitReason: ''
    };
  });
  const matcher = new NoteFieldMatcher(provider);
  const fields = [
    {
      stepOrder: 1,
      actionType: 'input',
      label: 'Numero de documento',
      selector: '#intake-document-number',
      controlType: 'text',
      currentValue: ''
    },
    {
      stepOrder: 2,
      actionType: 'select',
      label: 'Tipo de documento',
      selector: '#intake-document-type',
      controlType: 'select',
      currentValue: '',
      allowedOptions: [
        { value: 'cc', label: 'Cedula' },
        { value: 'passport', label: 'Pasaporte' }
      ]
    }
  ];
  const result = await matcher.match({
    noteContent: 'Paciente identificado con cedula 1023456789.',
    fields,
    alreadyFulfilled: [],
    pageUrl: 'http://127.0.0.1/emr-workspace.html'
  });

  assert.deepStrictEqual(
    result.matches.map((match) => [match.stepOrder, match.value]),
    [[1, '1023456789'], [2, 'cc']]
  );
  return result;
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.js') return 'application/javascript; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  if (extension === '.json' || extension === '.webmanifest') return 'application/json; charset=utf-8';
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.png') return 'image/png';
  return 'application/octet-stream';
}

async function startStaticServer() {
  const state = {
    diagnosisMode: 'success',
    diagnosisRequests: 0
  };
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    if (requestUrl.pathname === '/api/public-config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ supabaseUrl: '', supabaseAnonKey: '' }));
      return;
    }
    if (requestUrl.pathname === '/api/clinical/diagnosis-suggestions' && req.method === 'POST') {
      state.diagnosisRequests += 1;
      req.resume();
      req.on('end', () => {
        setTimeout(() => {
          if (state.diagnosisMode === 'error') {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No fue posible generar sugerencias diagnosticas.' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            suggestions: [{
              title: 'Faringitis aguda',
              rationale: 'Compatible con fiebre y odinofagia; requiere confirmacion medica.',
              supportingEvidence: 'fiebre y odinofagia'
            }],
            reviewNotice: 'Sugerencias de IA para revisión médica. No constituyen diagnósticos confirmados.'
          }));
        }, 180);
      });
      return;
    }
    if (requestUrl.pathname.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ workflows: [] }));
      return;
    }

    const relativePath = requestUrl.pathname === '/'
      ? 'index.html'
      : decodeURIComponent(requestUrl.pathname.replace(/^\/+/, ''));
    const resolvedPath = path.resolve(publicRoot, relativePath);
    if (!resolvedPath.startsWith(publicRoot) || !fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).isDirectory()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypeFor(resolvedPath) });
    fs.createReadStream(resolvedPath).pipe(res);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    state,
    baseUrl: `http://127.0.0.1:${server.address().port}`
  };
}

async function verifyDynamicFillDom(browser, matchResult) {
  const page = await browser.newPage();
  await page.setContent(`
    <!doctype html>
    <html>
      <body>
        <label for="intake-document-number">Numero de documento</label>
        <input id="intake-document-number">
        <label for="intake-document-type">Tipo de documento</label>
        <select id="intake-document-type">
          <option value="">Seleccionar</option>
          <option value="cc">Cedula</option>
          <option value="passport">Pasaporte</option>
        </select>
      </body>
    </html>
  `);
  await page.addScriptTag({ path: path.join(publicRoot, 'plugin', 'plugin-execution-client.js') });
  await page.evaluate((matches) => {
    window.__dynamicFillSummary = null;
    window.__dynamicFillUndoState = null;
    window.__dynamicFillRuntime = {
      speech: [],
      indicators: []
    };
    const client = window.GraphPluginExecutionClient.create({
      getOptions: () => ({ appId: 'test' }),
      getPluginHost: () => null,
      runtime: () => ({
        handleAutomationEvent() {},
        speak(text, options) {
          window.__dynamicFillRuntime.speech.push({ text, mode: options?.mode || '' });
        },
        clearSpotlight() {},
        setActivityIndicators(indicators) {
          window.__dynamicFillRuntime.indicators.push(indicators);
        }
      }),
      waitTimeoutMs: 1000,
      stepDelayMs: 0
    });
    const session = client.createDynamicFillSession({
      workflowId: 'wf-related-fields',
      variables: {},
      steps: [
        {
          stepOrder: 1,
          actionType: 'input',
          selector: '#intake-document-number',
          label: 'Numero de documento'
        },
        {
          stepOrder: 2,
          actionType: 'select',
          selector: '#intake-document-type',
          label: 'Tipo de documento',
          allowedOptions: [
            { value: 'cc', label: 'Cedula' },
            { value: 'passport', label: 'Pasaporte' }
          ]
        }
      ]
    }, {
      requestNoteFieldMatches: async () => ({
        matches,
        readyToSubmit: false,
        submitReason: ''
      }),
      debounceMs: 0,
      interMatchDelayMs: 0,
      visualHoldMs: 0,
      onFillSummary: (detail) => {
        window.__dynamicFillSummary = detail;
      },
      onUndoStateChanged: (detail) => {
        window.__dynamicFillUndoState = detail;
      }
    });
    window.__dynamicFillSession = session;
    session.ingestNoteContent('Paciente identificado con cedula 1023456789.');
  }, matchResult.matches);
  await page.waitForFunction(() => (
    document.getElementById('intake-document-number').value === '1023456789'
    && document.getElementById('intake-document-type').value === 'cc'
  ));
  assert.strictEqual(await page.locator('#intake-document-number').inputValue(), '1023456789');
  assert.strictEqual(await page.locator('#intake-document-type').inputValue(), 'cc');
  await page.waitForFunction(() => Boolean(window.__dynamicFillSummary));
  const summary = await page.evaluate(() => window.__dynamicFillSummary);
  assert.strictEqual(summary.completedCount, 2);
  assert.strictEqual(await page.evaluate(() => window.__dynamicFillSession.canUndoLastFill()), true);
  const speechModes = await page.evaluate(() => window.__dynamicFillRuntime.speech.map((entry) => entry.mode));
  assert(speechModes.includes('organizing'));
  assert(speechModes.includes('filling'));
  assert(speechModes.includes('review'));
  const undoResult = await page.evaluate(() => window.__dynamicFillSession.undoLastFill());
  assert.strictEqual(undoResult.undoneCount, 2);
  assert.strictEqual(await page.locator('#intake-document-number').inputValue(), '');
  assert.strictEqual(await page.locator('#intake-document-type').inputValue(), '');
  assert.strictEqual(await page.evaluate(() => window.__dynamicFillSession.canUndoLastFill()), false);
  await page.close();
}

async function verifyMetadata(browser, baseUrl) {
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/emr-workspace.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.GraphPluginContext?.capturePageSnapshot));
  const emrSnapshot = await page.evaluate(() => window.GraphPluginContext.capturePageSnapshot());

  assert(emrSnapshot.totalControlCount > 40, 'expanded EMR snapshot must exceed the former 40-control limit');
  assert.strictEqual(emrSnapshot.controlsTruncated, false);
  assert(emrSnapshot.controls.some((control) => control.selector === '#closure-complete'));
  const documentType = emrSnapshot.controls.find((control) => control.selector === '[data-testid="intake-document-type"]');
  assert(documentType, 'document type selector must be exposed');
  assert(documentType.allowedOptions.some((option) => option.value === 'cc'));
  assert(emrSnapshot.controls.every((control) => !control.selector.includes('graph-assistant')));

  await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.GraphPluginContext?.capturePageSnapshot));
  const landingSnapshot = await page.evaluate(() => window.GraphPluginContext.capturePageSnapshot());
  assert(landingSnapshot.controls.length > 0);
  assert(landingSnapshot.controls.some((control) => control.selector === '[data-testid="intake-document-type"]'));

  await page.setContent(`
    <!doctype html>
    <html>
      <body>
        <section data-view="fixture">
          <h2>Consentimiento</h2>
          <label><input id="consent" type="checkbox" checked required> Autoriza</label>
          <label><input id="priority-a" type="radio" name="priority" value="a"> Prioridad A</label>
        </section>
      </body>
    </html>
  `);
  await page.addScriptTag({ path: path.join(publicRoot, 'plugin', 'plugin-context.js') });
  const fixtureSnapshot = await page.evaluate(() => window.GraphPluginContext.capturePageSnapshot());
  const checkbox = fixtureSnapshot.controls.find((control) => control.selector === '#consent');
  const radio = fixtureSnapshot.controls.find((control) => control.selector === '#priority-a');
  assert.strictEqual(checkbox.controlType, 'checkbox');
  assert.strictEqual(checkbox.checked, true);
  assert.strictEqual(checkbox.required, true);
  assert.strictEqual(checkbox.editable, true);
  assert.strictEqual(radio.controlType, 'radio');
  assert.strictEqual(radio.checked, false);
  await page.close();
}

async function verifyDiagnosisUi(browser, baseUrl, serverState) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${baseUrl}/emr-workspace.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#graph-assistant-shell');
  assert.strictEqual(
    await page.evaluate(() => document.body.dataset.assistantExpanded),
    'false'
  );
  await page.click('.graph-assistant-avatar');
  await page.waitForFunction(() => document.body.dataset.assistantExpanded === 'true');
  await page.waitForFunction(() => (
    document.getElementById('graph-assistant-bubble-text')?.textContent === 'Dicta la consulta y yo preparo la nota.'
  ));
  await page.waitForSelector('#graph-assistant-note-toggle');
  await page.click('#graph-assistant-note-toggle');

  const diagnosisButton = page.locator('#graph-assistant-note-diagnosis-button');
  assert.strictEqual(await diagnosisButton.isDisabled(), true);
  assert.strictEqual(await page.locator('.graph-assistant-note-diagnosis-card').count(), 0);

  const editor = page.locator('#graph-assistant-note-editor');
  const noteText = 'Paciente con fiebre y odinofagia de tres dias.';
  await editor.fill(noteText);
  assert.strictEqual(await diagnosisButton.isEnabled(), true);

  await diagnosisButton.click();
  await page.waitForFunction(() => document.getElementById('graph-assistant-note-diagnosis-button').disabled);
  await page.waitForSelector('.graph-assistant-note-diagnosis-card');
  assert.strictEqual(await editor.innerText(), noteText);
  assert.strictEqual(await page.locator('.graph-assistant-note-diagnosis-card').count(), 1);
  assert.strictEqual(
    await page.locator('#graph-assistant-note-diagnosis-notice').innerText(),
    'Sugerencias de IA para revisión médica. No constituyen diagnósticos confirmados.'
  );

  await editor.fill(`${noteText} Sin disnea.`);
  assert.strictEqual(await page.locator('.graph-assistant-note-diagnosis-card').count(), 0);
  assert.strictEqual(await page.locator('#graph-assistant-note-diagnosis-notice').isHidden(), true);

  serverState.diagnosisMode = 'error';
  await diagnosisButton.click();
  await page.waitForFunction(() => (
    document.getElementById('graph-assistant-note-diagnosis-status').dataset.error === 'true'
  ));
  assert((await page.locator('#graph-assistant-note-diagnosis-status').innerText()).includes('No fue posible'));
  assert.strictEqual(await editor.innerText(), `${noteText} Sin disnea.`);
  assert.strictEqual(serverState.diagnosisRequests, 2);
  await page.close();
}

async function main() {
  await verifyDiagnosisServiceAndRoute();
  const matchResult = await verifyRelatedFieldMatcher();
  const staticServer = await startStaticServer();
  const browser = await chromium.launch({ headless: true });

  try {
    await verifyDynamicFillDom(browser, matchResult);
    await verifyMetadata(browser, staticServer.baseUrl);
    await verifyDiagnosisUi(browser, staticServer.baseUrl, staticServer.state);
  } finally {
    await browser.close();
    await new Promise((resolve) => staticServer.server.close(resolve));
  }

  console.log('clinical assistant feature verification passed');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
