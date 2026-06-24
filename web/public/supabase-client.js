(function () {
    // Loads the Supabase JS SDK on demand, pulls the public config from the server,
    // and exposes a single shared client at window.MiracleSupabase.
    //
    // The anon/publishable key is public by design (browser-side), but we still serve
    // it from /api/public-config so it lives in .env instead of being hardcoded here.
    const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.108.1';

    let resolveReady;
    const ready = new Promise((resolve) => { resolveReady = resolve; });
    const state = { client: null, config: null, error: null };

    function loadSdk() {
        if (window.supabase && typeof window.supabase.createClient === 'function') {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const existing = document.querySelector('script[data-supabase-sdk]');
            if (existing) {
                existing.addEventListener('load', () => resolve(), { once: true });
                existing.addEventListener('error', () => reject(new Error('No se pudo cargar el SDK de Supabase.')), { once: true });
                return;
            }
            const script = document.createElement('script');
            script.src = SDK_URL;
            script.async = true;
            script.dataset.supabaseSdk = 'true';
            script.addEventListener('load', () => resolve(), { once: true });
            script.addEventListener('error', () => reject(new Error('No se pudo cargar el SDK de Supabase.')), { once: true });
            document.head.appendChild(script);
        });
    }

    async function init() {
        try {
            const response = await fetch('/api/public-config', { cache: 'no-store' });
            const config = await response.json();
            state.config = config;

            if (config && config.authBypassEnabled) {
                state.error = 'Supabase auth bypass enabled.';
                console.warn('[Miracle Supabase] ' + state.error);
                resolveReady(null);
                return;
            }

            if (!config || !config.supabaseUrl || !config.supabaseAnonKey) {
                state.error = 'Supabase no esta configurado (faltan SUPABASE_URL / SUPABASE_ANON_KEY en .env).';
                console.warn('[Miracle Supabase] ' + state.error);
                resolveReady(null);
                return;
            }

            await loadSdk();
            state.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true
                }
            });
            resolveReady(state.client);
        } catch (error) {
            state.error = error.message || String(error);
            console.error('[Miracle Supabase] Init failed:', error);
            resolveReady(null);
        }
    }

    window.MiracleSupabase = {
        // Resolves to the Supabase client, or null if not configured / failed to load.
        whenReady() { return ready; },
        getClient() { return state.client; },
        getConfig() { return state.config; },
        getError() { return state.error; }
    };

    init();
})();
