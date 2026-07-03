(function () {
    // Lightweight auth for PUBLIC DEMO surfaces (landing / pitch). Signs the visitor
    // in as a local guest (if ALLOW_LOCAL_ANONYMOUS is enabled) or leaves the request
    // unauthenticated, WITHOUT showing a login gate. Exposes the same window.MiracleAuth
    // shape as auth-gate.js so the existing token attachment (plugin-api.js,
    // trainer-plugin.js) works unchanged.
    let resolveReady;
    const ready = new Promise((resolve) => { resolveReady = resolve; });
    const LOCAL_SESSION_KEY = 'miracle-demo-local-anonymous-session';
    const state = { user: null, accessToken: '', authMode: '' };
    const LOCAL_USER = { id: 'local-dev-user', email: '', role: 'local-dev' };

    function applyLocalSession(session) {
        state.accessToken = session?.accessToken || '';
        state.user = {
            ...(session?.user || {}),
            role: 'local-anonymous',
            is_anonymous: true
        };
        state.authMode = 'local-anonymous';
        try { sessionStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(session)); } catch (error) { /* ignore */ }
    }

    async function createLocalSession() {
        const response = await fetch('/api/auth/local-anonymous', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Local anonymous sign-in failed.');
        return payload;
    }

    async function init() {
        const response = await fetch('/api/public-config', { cache: 'no-store' });
        const config = await response.json().catch(() => ({}));

        if (config?.authBypassEnabled) {
            state.accessToken = '';
            state.user = LOCAL_USER;
            state.authMode = 'local-dev';
            resolveReady(state.user);
            return;
        }

        if (config?.localAnonymousAccess) {
            try {
                applyLocalSession(await createLocalSession());
            } catch (error) {
                console.warn('[Miracle Demo Auth] Local anonymous sign-in failed:', error.message);
            }
            resolveReady(state.user);
            return;
        }

        // No guest mode configured: requests go out unauthenticated. Endpoints that
        // allow anonymous access still work (see requireAuth.js); the rest will 401.
        resolveReady(null);
    }

    window.MiracleAuth = {
        whenAuthenticated() { return ready; },
        getUser() { return state.user; },
        getAccessToken() { return state.accessToken || ''; },
        getMode() { return state.authMode || ''; },
        async signOut() {
            if (state.authMode === 'local-anonymous') {
                try { sessionStorage.removeItem(LOCAL_SESSION_KEY); } catch (error) { /* ignore */ }
                window.location.reload();
            }
        }
    };

    init();
})();
