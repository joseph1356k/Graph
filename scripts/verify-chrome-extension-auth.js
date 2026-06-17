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
  let networkCalls = 0;
  const chrome = {
    storage: {
      sync: createStorageArea({ backendUrl: 'https://miracle-zeta.vercel.app' }),
      local: createStorageArea()
    },
    identity: {
      getRedirectURL: () => 'https://extension-id.chromiumapp.org/supabase',
      launchWebAuthFlow() {}
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
    fetch: async () => {
      networkCalls += 1;
      throw new Error('unexpected network call');
    },
    console,
    setTimeout,
    clearTimeout
  });
  context.globalThis = context;
  vm.runInContext(fs.readFileSync(path.join(extensionRoot, 'background.js'), 'utf8'), context);
  assert.ok(listener, 'background message listener should be registered');

  const parsed = context.GraphTrainerBackgroundInternals.parseSessionFromUrl(
    'https://extension-id.chromiumapp.org/supabase#access_token=access&refresh_token=refresh&expires_in=3600'
  );
  assert.strictEqual(parsed.accessToken, 'access');
  assert.strictEqual(parsed.refreshToken, 'refresh');

  const unauthenticated = await sendMessage(listener, {
    type: 'graph:api-fetch',
    request: { url: 'https://miracle-zeta.vercel.app/api/agent/chat', method: 'POST' }
  });
  assert.strictEqual(unauthenticated.status, 401);
  assert.match(unauthenticated.body, /Inicia sesion con Google/);
  assert.strictEqual(networkCalls, 0);

  const blocked = await sendMessage(listener, {
    type: 'graph:api-fetch',
    request: { url: 'https://example.com/api/private', method: 'GET' }
  });
  assert.strictEqual(blocked.status, 403);
  assert.match(blocked.body, /bloqueo una solicitud/);
  assert.strictEqual(networkCalls, 0);
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
    apiBaseUrl: 'https://miracle-zeta.vercel.app'
  });
  assert.strictEqual(host.platform, 'chrome-extension');
  const response = await host.fetchImpl('https://miracle-zeta.vercel.app/api/workflows', {
    headers: { 'Content-Type': 'application/json' }
  });
  assert.strictEqual(response.status, 503);
  assert.strictEqual(sentMessage.type, 'graph:api-fetch');
  assert.strictEqual(sentMessage.request.url, 'https://miracle-zeta.vercel.app/api/workflows');
  assert.match(await response.text(), /Workflow storage is unavailable/);
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
  assert.ok(manifest.permissions.includes('identity'));
  assert.strictEqual(manifest.background.service_worker, 'background.js');
  const scripts = manifest.content_scripts[0].js;
  assert.strictEqual(scripts.at(-1), 'content.js');
  assert.ok(scripts.includes('assets/plugin/plugin-host.js'));

  const popup = fs.readFileSync(path.join(extensionRoot, 'popup.html'), 'utf8');
  assert.match(popup, /id="authLogin"/);
  assert.match(popup, /Continuar con Google/);

  const callback = fs.readFileSync(path.join(root, 'web', 'public', 'extension-auth.html'), 'utf8');
  assert.match(callback, /chromiumapp\.org/);

  await verifyBackground();
  await verifyExtensionHost();
  console.log('chrome extension auth and API proxy verification passed');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
