(function () {
    function canUseChromeRuntime() {
        return typeof window !== 'undefined'
            && typeof window.chrome !== 'undefined'
            && typeof window.chrome.runtime !== 'undefined'
            && Boolean(window.chrome.runtime.id);
    }

    function detectPlatform() {
        return canUseChromeRuntime() ? 'chrome-extension' : 'web-page';
    }

    function safeRead(storageLike, key) {
        try {
            return storageLike?.getItem?.(key) || '';
        } catch (error) {
            return '';
        }
    }

    function safeWrite(storageLike, key, value) {
        try {
            if (value === null || value === undefined || value === '') {
                storageLike?.removeItem?.(key);
                return;
            }
            storageLike?.setItem?.(key, value);
        } catch (error) {
            // Ignore restricted environments.
        }
    }

    function createStorage(scope, storageLike) {
        const prefix = `graph:${scope}:`;
        return {
            get(key) {
                return safeRead(storageLike, `${prefix}${key}`);
            },
            set(key, value) {
                safeWrite(storageLike, `${prefix}${key}`, value);
            },
            remove(key) {
                safeWrite(storageLike, `${prefix}${key}`, '');
            }
        };
    }

    function normalizeRequestHeaders(headers) {
        if (!headers) return {};
        if (typeof Headers !== 'undefined' && headers instanceof Headers) {
            return Object.fromEntries(headers.entries());
        }
        if (Array.isArray(headers)) {
            return Object.fromEntries(headers);
        }
        return { ...headers };
    }

    function createExtensionFetch() {
        return function extensionFetch(input, init = {}) {
            const url = typeof input === 'string' ? input : input?.url || '';
            const request = {
                url,
                method: init.method || 'GET',
                headers: normalizeRequestHeaders(init.headers),
                body: init.body === undefined || init.body === null ? null : `${init.body}`
            };

            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ type: 'graph:api-fetch', request }, (result) => {
                    const runtimeError = chrome.runtime.lastError;
                    if (runtimeError) {
                        reject(new TypeError(runtimeError.message || 'Graph Trainer no pudo contactar su service worker.'));
                        return;
                    }
                    if (!result?.ok || !result.payload?.transportOk) {
                        reject(new TypeError(result?.error || 'Graph Trainer no pudo completar la solicitud.'));
                        return;
                    }
                    resolve(new Response(result.payload.body || '', {
                        status: Number(result.payload.status || 500),
                        statusText: result.payload.statusText || '',
                        headers: result.payload.headers || {}
                    }));
                });
            });
        };
    }

    function createHost(config = {}) {
        const platform = detectPlatform();
        const appId = `${config.appId || 'page'}`.trim() || 'page';
        const apiBaseUrl = `${config.apiBaseUrl || ''}`.replace(/\/+$/, '');

        return {
            platform,
            appId,
            apiBaseUrl,
            fetchImpl: platform === 'chrome-extension'
                ? createExtensionFetch()
                : (typeof window !== 'undefined' ? window.fetch.bind(window) : null),
            localStore: createStorage(`${platform}:${appId}:local`, window.localStorage),
            sessionStore: createStorage(`${platform}:${appId}:session`, window.sessionStorage)
        };
    }

    window.GraphPluginHost = {
        createHost,
        detectPlatform
    };
})();
