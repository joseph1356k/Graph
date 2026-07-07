const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const extensionRoot = path.join(root, 'chrome-extension-src', 'graph-trainer');

function createStorageArea(seed = {}) {
  const values = { ...seed };
  return {
    get(defaults, callback) {
      callback({ ...defaults, ...values });
    },
    set(next, callback) {
      Object.assign(values, next);
      callback?.();
    },
    remove(keys, callback) {
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete values[key]);
      callback?.();
    }
  };
}

function sendMessage(listener, message) {
  return new Promise((resolve, reject) => {
    const keepAlive = listener(message, {}, (result) => {
      if (!result?.ok) {
        reject(new Error(result?.error || 'message failed'));
        return;
      }
      resolve(result.payload);
    });
    assert.strictEqual(keepAlive, true);
  });
}

async function verifyBackground() {
  let listener = null;
  const fetchCalls = [];
  const chrome = {
    storage: {
      sync: createStorageArea({ backendUrl: 'https://graph-five-orpin.vercel.app' }),
      local: createStorageArea()
    },
    runtime: {
      lastError: null,
      onMessage: {
        addListener(next) {
          listener = next;
        }
      }
    }
  };
  const context = vm.createContext({
    chrome,
    URL,
    URLSearchParams,
    Headers,
    Response,
    fetch: async (url, init = {}) => {
      fetchCalls.push({ url: `${url}`, init });
      if (`${url}`.endsWith('/api/auth/local-admin/login')) {
        const body = JSON.parse(init.body || '{}');
        if (body.username === 'admin' && body.password === 'secret') {
          return new Response(JSON.stringify({
            accessToken: 'miracle-local-admin-v1.token.sig',
            expiresAt: Date.now() + 3_600_000,
            user: { id: 'local-admin:admin', email: 'admin' }
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({ error: 'Credenciales invalidas.' }), {
          status: 401,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (`${url}`.startsWith('https://graph-five-orpin.vercel.app/api/')) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    console,
    setTimeout,
    clearTimeout
  });
  context.globalThis = context;
  vm.runInContext(fs.readFileSync(path.join(extensionRoot, 'background.js'), 'utf8'), context);
  assert.ok(listener, 'background message listener should be registered');

  const unauthenticatedStatus = await sendMessage(listener, { type: 'graph:auth-status' });
  assert.strictEqual(unauthenticatedStatus.authenticated, false);

  // Requests proceed even without a session — the backend decides whether the
  // route requires a real account or tolerates an anonymous/local-dev caller.
  const unauthenticatedFetch = await sendMessage(listener, {
    type: 'graph:api-fetch',
    request: { url: 'https://graph-five-orpin.vercel.app/api/agent/chat', method: 'POST' }
  });
  assert.strictEqual(unauthenticatedFetch.status, 200);

  const blocked = await sendMessage(listener, {
    type: 'graph:api-fetch',
    request: { url: 'https://example.com/api/private', method: 'GET' }
  });
  assert.strictEqual(blocked.status, 403);
  assert.match(blocked.body, /bloqueo una solicitud/);

  const badLogin = await sendMessage(listener, { type: 'graph:auth-login', username: 'admin', password: 'wrong' })
    .catch((error) => error);
  assert.ok(badLogin instanceof Error, 'wrong credentials should reject');

  const loggedIn = await sendMessage(listener, { type: 'graph:auth-login', username: 'admin', password: 'secret' });
  assert.strictEqual(loggedIn.authenticated, true);
  assert.strictEqual(loggedIn.user.email, 'admin');

  const authenticatedFetch = await sendMessage(listener, {
    type: 'graph:api-fetch',
    request: { url: 'https://graph-five-orpin.vercel.app/api/workflows', method: 'GET' }
  });
  assert.strictEqual(authenticatedFetch.status, 200);
  const lastCall = fetchCalls.at(-1);
  assert.strictEqual(lastCall.init.headers.get('authorization'), 'Bearer miracle-local-admin-v1.token.sig');

  const loggedOut = await sendMessage(listener, { type: 'graph:auth-logout' });
  assert.strictEqual(loggedOut.authenticated, false);
}

async function verifyExtensionHost() {
  let sentMessage = null;
  const chrome = {
    runtime: {
      id: 'extension-id',
      lastError: null,
      sendMessage(message, callback) {
        sentMessage = message;
        callback({
          ok: true,
          payload: {
            transportOk: true,
            status: 503,
            statusText: '',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ error: 'Workflow storage is unavailable.' })
          }
        });
      }
    }
  };
  const storage = { getItem() { return ''; }, setItem() {}, removeItem() {} };
  const windowObject = {
    chrome,
    localStorage: storage,
    sessionStorage: storage
  };
  windowObject.window = windowObject;
  const context = vm.createContext({
    window: windowObject,
    chrome,
    Headers,
    Response,
    Promise,
    TypeError,
    Object
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'web', 'public', 'plugin', 'plugin-host.js'), 'utf8'), context);
  const host = windowObject.GraphPluginHost.createHost({
    appId: 'test',
    apiBaseUrl: 'https://graph-five-orpin.vercel.app'
  });
  assert.strictEqual(host.platform, 'chrome-extension');
  const response = await host.fetchImpl('https://graph-five-orpin.vercel.app/api/workflows', {
    headers: { 'Content-Type': 'application/json' }
  });
  assert.strictEqual(response.status, 503);
  assert.strictEqual(sentMessage.type, 'graph:api-fetch');
  assert.strictEqual(sentMessage.request.url, 'https://graph-five-orpin.vercel.app/api/workflows');
  assert.match(await response.text(), /Workflow storage is unavailable/);
}

async function verifyMiracleMedicalProxyDemoAccess() {
  const previousEnv = {
    VERCEL: process.env.VERCEL,
    NODE_ENV: process.env.NODE_ENV,
    MIRACLE_RUNTIME_URL: process.env.MIRACLE_RUNTIME_URL
  };
  const previousFetch = global.fetch;

  process.env.VERCEL = '1';
  process.env.NODE_ENV = 'production';
  process.env.MIRACLE_RUNTIME_URL = 'https://miracle-engine.test';

  global.fetch = async (url, init = {}) => {
    const target = `${url || ''}`;
    if (target === 'https://miracle-engine.test/api/voice/stream-session') {
      assert.strictEqual(init.method, 'POST');
      return new Response(JSON.stringify({
        websocket_url: 'wss://miracle-engine.test/voice',
        access_token: 'stream-token',
        auth_scheme: 'bearer'
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error(`unexpected fetch: ${target}`);
  };

  const app = require('../web/server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const streamResponse = await previousFetch(`${baseUrl}/api/voice/stream-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    assert.strictEqual(streamResponse.status, 200);
    const streamPayload = await streamResponse.json();
    assert.strictEqual(streamPayload.access_token, 'stream-token');

    const protectedResponse = await previousFetch(`${baseUrl}/api/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hola' })
    });
    assert.strictEqual(protectedResponse.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = previousFetch;
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  }
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
  assert.ok(!manifest.permissions.includes('identity'), 'the extension no longer needs the identity permission');
  assert.strictEqual(manifest.background.service_worker, 'background.js');
  const scripts = manifest.content_scripts[0].js;
  assert.strictEqual(scripts.at(-1), 'content.js');
  assert.ok(scripts.includes('assets/plugin/plugin-host.js'));

  const popup = fs.readFileSync(path.join(extensionRoot, 'popup.html'), 'utf8');
  assert.match(popup, /id="authLogin"/);
  assert.match(popup, /id="authUsername"/);
  assert.match(popup, /id="authPassword"/);

  await verifyBackground();
  await verifyExtensionHost();
  await verifyMiracleMedicalProxyDemoAccess();
  console.log('chrome extension auth and API proxy verification passed');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
