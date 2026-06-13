(function () {
    // Lightweight auth for PUBLIC DEMO surfaces (landing / pitch). Signs the visitor
    // in ANONYMOUSLY so the protected voice/LLM endpoints accept the request, WITHOUT
    // showing a login gate. Requires "Anonymous sign-ins" enabled in the Supabase
    // dashboard (Authentication → Sign In / Providers → Anonymous).
    //
    // Exposes the same window.MiracleAuth shape as auth-gate.js so the existing token
    // attachment (plugin-api.js, trainer-plugin.js) works unchanged.
    let resolveReady;
    const ready = new Promise((resolve) => { resolveReady = resolve; });
    const LOCAL_SESSION_KEY = 'miracle-demo-local-anonymous-session';
    const state = { client: null, user: null, accessToken: '', authMode: '' };

    function setSession(session) {
        state.accessToken = (session && session.access_token) || '';
        state.user = (session && session.user) || null;
        state.authMode = state.user?.is_anonymous ? 'supabase-anonymous' : (state.user ? 'supabase' : '');
    }

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
        const client = await window.MiracleSupabase.whenReady();
        state.client = client;
        const localAnonymousAccess = Boolean(window.MiracleSupabase.getConfig?.()?.localAnonymousAccess);

        if (localAnonymousAccess) {
            try {
                applyLocalSession(await createLocalSession());
            } catch (error) {
                console.warn('[Miracle Demo Auth] Local anonymous sign-in failed:', error.message);
            }
            resolveReady(state.user);
            return;
        }

        if (!client) { resolveReady(null); return; }

        const { data } = await client.auth.getSession();
        if (data && data.session) {
            setSession(data.session);
        } else {
            try {
                const { data: anon, error } = await client.auth.signInAnonymously();
                if (error) {
                    console.warn('[Miracle Demo Auth] Anonymous sign-in failed — enable "Anonymous sign-ins" in Supabase:', error.message);
                } else {
                    setSession(anon.session);
                }
            } catch (error) {
                console.warn('[Miracle Demo Auth] Anonymous sign-in threw:', error.message);
            }
        }

        client.auth.onAuthStateChange((_event, session) => setSession(session));
        resolveReady(state.user);
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
                return;
            }
            try { await state.client && state.client.auth.signOut(); } catch (error) { /* ignore */ }
        }
    };

    if (window.MiracleSupabase) {
        init();
    } else {
        console.error('[Miracle Demo Auth] supabase-client.js must load before demo-auth.js');
    }
})();
