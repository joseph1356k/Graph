(function () {
    // Google login gate for the EMR surface. While there is no authenticated user it
    // shows a blocking overlay; once signed in it resolves window.MiracleAuth.whenAuthenticated().
    let resolveAuthed;
    const authed = new Promise((resolve) => { resolveAuthed = resolve; });
    const LOCAL_SESSION_KEY = 'miracle-local-anonymous-session';
    const state = {
        client: null,
        user: null,
        overlay: null,
        accessToken: '',
        authMode: '',
        localAnonymousAccess: false
    };
    const LOCAL_USER = { id: 'local-dev-user', email: '', role: 'local-dev' };

    function buildOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'miracle-auth-gate';
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:2147483000',
            'display:grid', 'place-items:center',
            'background:rgba(15,23,42,0.55)', 'backdrop-filter:blur(6px)',
            'font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif'
        ].join(';');

        const card = document.createElement('div');
        card.style.cssText = [
            'width:min(420px,calc(100vw - 40px))', 'background:#ffffff', 'color:#0f172a',
            'border-radius:20px', 'padding:32px', 'box-shadow:0 32px 90px rgba(15,23,42,0.25)',
            'text-align:center', 'display:grid', 'gap:16px'
        ].join(';');

        const title = document.createElement('h2');
        title.textContent = 'Inicia sesion en Miracle';
        title.style.cssText = 'margin:0;font-size:22px;font-weight:800';

        const subtitle = document.createElement('p');
        subtitle.id = 'miracle-auth-subtitle';
        subtitle.textContent = 'Conecta tu cuenta para que tus notas se sincronicen en tiempo real entre tus dispositivos.';
        subtitle.style.cssText = 'margin:0;color:#475569;line-height:1.5;font-size:14px';

        const button = document.createElement('button');
        button.id = 'miracle-auth-button';
        button.type = 'button';
        button.textContent = 'Continuar con Google';
        button.style.cssText = [
            'border:0', 'border-radius:999px', 'padding:14px 18px', 'font:inherit', 'font-weight:700',
            'background:#2f8cff', 'color:#fff', 'cursor:pointer'
        ].join(';');
        button.addEventListener('click', signIn);

        const guestButton = document.createElement('button');
        guestButton.id = 'miracle-auth-guest-button';
        guestButton.type = 'button';
        guestButton.textContent = 'Entrar como invitado';
        guestButton.style.cssText = [
            'border:1px solid #cbd5e1', 'border-radius:999px', 'padding:13px 18px', 'font:inherit', 'font-weight:700',
            'background:#fff', 'color:#334155', 'cursor:pointer'
        ].join(';');
        guestButton.addEventListener('click', signInAnonymously);

        const notice = document.createElement('p');
        notice.id = 'miracle-auth-notice';
        notice.textContent = 'El modo invitado guarda los cambios solo en este navegador y no habilita funciones administrativas.';
        notice.style.cssText = 'display:none;margin:0;color:#64748b;line-height:1.45;font-size:12px';

        card.append(title, subtitle, button, guestButton, notice);
        overlay.appendChild(card);
        return overlay;
    }

    function showOverlay(message) {
        if (!state.overlay) {
            state.overlay = buildOverlay();
        }
        if (!state.overlay.isConnected) {
            (document.body || document.documentElement).appendChild(state.overlay);
        }
        const subtitle = state.overlay.querySelector('#miracle-auth-subtitle');
        const button = state.overlay.querySelector('#miracle-auth-button');
        const guestButton = state.overlay.querySelector('#miracle-auth-guest-button');
        const notice = state.overlay.querySelector('#miracle-auth-notice');
        if (message) {
            if (subtitle) subtitle.textContent = message;
        }
        if (button) button.style.display = state.client ? '' : 'none';
        if (guestButton) guestButton.style.display = state.localAnonymousAccess || state.client ? '' : 'none';
        if (notice) notice.style.display = state.localAnonymousAccess ? '' : 'none';
        state.overlay.style.display = 'grid';
    }

    function hideOverlay() {
        if (state.overlay) {
            state.overlay.style.display = 'none';
        }
    }

    function enableLocalMode() {
        state.accessToken = '';
        state.authMode = 'local-dev';
        setUser(LOCAL_USER);
        console.warn('[Miracle Auth] Supabase no esta configurado. EMR continua en modo local sin login ni sync.');
    }

    function buildOAuthRedirectUrl() {
        const current = new URL(window.location.href);
        const redirect = new URL(current.pathname, current.origin);
        const encounterId = `${current.searchParams.get('encounter') || ''}`.trim();
        if (encounterId) {
            redirect.searchParams.set('encounter', encounterId);
        }
        return redirect.toString();
    }

    function consumeOAuthError() {
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const queryParams = new URL(window.location.href).searchParams;
        const errorCode = `${
            hashParams.get('error_code')
            || hashParams.get('error')
            || queryParams.get('error_code')
            || queryParams.get('error')
            || ''
        }`.trim();
        const description = `${
            hashParams.get('error_description')
            || queryParams.get('error_description')
            || ''
        }`.trim();
        if (!errorCode && !description) return '';

        const cleanUrl = new URL(window.location.href);
        cleanUrl.hash = '';
        cleanUrl.searchParams.delete('error');
        cleanUrl.searchParams.delete('error_code');
        cleanUrl.searchParams.delete('error_description');
        window.history.replaceState({}, '', cleanUrl);
        return description || `Google OAuth fallo (${errorCode}).`;
    }

    async function signIn() {
        if (!state.client) return;
        setButtonsBusy(true, 'Abriendo Google...');
        try {
            const statusResponse = await fetch('/api/auth/status', { cache: 'no-store' });
            const statusPayload = await statusResponse.json().catch(() => ({}));
            if (!statusResponse.ok || statusPayload?.supabase?.status !== 'ok') {
                throw new Error('El proyecto Supabase configurado no esta disponible.');
            }
            const { error } = await state.client.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: buildOAuthRedirectUrl() }
            });
            if (error) throw error;
        } catch (error) {
            console.error('[Miracle Auth] Sign-in failed:', error);
            showOverlay('No fue posible contactar el proyecto de autenticacion. Puedes entrar como invitado mientras se corrige Supabase.');
            setButtonsBusy(false);
        }
    }

    function setButtonsBusy(busy, label = '') {
        if (!state.overlay) return;
        const googleButton = state.overlay.querySelector('#miracle-auth-button');
        const guestButton = state.overlay.querySelector('#miracle-auth-guest-button');
        if (googleButton) googleButton.disabled = busy;
        if (guestButton) {
            guestButton.disabled = busy;
            guestButton.textContent = busy && label ? label : 'Entrar como invitado';
        }
    }

    function persistLocalSession(session) {
        try {
            sessionStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
        } catch (error) { /* ignore */ }
    }

    function readLocalSession() {
        try {
            const session = JSON.parse(sessionStorage.getItem(LOCAL_SESSION_KEY) || 'null');
            if (!session || !session.accessToken || !session.user || Number(session.expiresAt || 0) <= Date.now()) {
                sessionStorage.removeItem(LOCAL_SESSION_KEY);
                return null;
            }
            return session;
        } catch (error) {
            return null;
        }
    }

    function applyLocalAnonymousSession(session) {
        state.accessToken = session.accessToken || '';
        state.authMode = 'local-anonymous';
        persistLocalSession(session);
        setUser({
            ...(session.user || {}),
            role: 'local-anonymous',
            is_anonymous: true
        });
    }

    async function requestLocalAnonymousSession() {
        const response = await fetch('/api/auth/local-anonymous', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || 'No se pudo iniciar la sesion invitada local.');
        }
        return payload;
    }

    async function signInAnonymously() {
        setButtonsBusy(true, 'Entrando...');
        try {
            if (state.localAnonymousAccess) {
                applyLocalAnonymousSession(await requestLocalAnonymousSession());
                return;
            }

            if (state.client) {
                try {
                    const { data, error } = await state.client.auth.signInAnonymously();
                    if (!error && data && data.session) {
                        state.authMode = 'supabase-anonymous';
                        state.accessToken = data.session.access_token || '';
                        setUser(data.session.user);
                        return;
                    }
                    if (error) {
                        console.warn('[Miracle Auth] Supabase anonymous sign-in unavailable:', error.message);
                    }
                } catch (error) {
                    console.warn('[Miracle Auth] Supabase anonymous sign-in failed:', error.message);
                }
            }

            throw new Error('El acceso invitado debe activarse en Supabase.');
        } catch (error) {
            console.error('[Miracle Auth] Anonymous sign-in failed:', error);
            showOverlay(error.message || 'No se pudo iniciar como invitado.');
        } finally {
            setButtonsBusy(false);
        }
    }

    function setUser(user) {
        const previous = state.user;
        state.user = user || null;
        if (state.user) {
            hideOverlay();
            resolveAuthed(state.user);
            if (!previous) {
                window.dispatchEvent(new CustomEvent('miracle-auth-changed', { detail: { user: state.user } }));
            }
        } else {
            showOverlay();
        }
    }

    async function init() {
        const client = await window.MiracleSupabase.whenReady();
        state.client = client;
        state.localAnonymousAccess = Boolean(window.MiracleSupabase.getConfig?.()?.localAnonymousAccess);
        const oauthError = consumeOAuthError();
        if (oauthError) {
            showOverlay(`Google no pudo iniciar sesion: ${oauthError}`);
            return;
        }

        const localSession = state.localAnonymousAccess ? readLocalSession() : null;
        if (localSession) {
            try {
                applyLocalAnonymousSession(await requestLocalAnonymousSession());
                return;
            } catch (error) {
                try { sessionStorage.removeItem(LOCAL_SESSION_KEY); } catch (storageError) { /* ignore */ }
            }
        }

        if (!client) {
            if (state.localAnonymousAccess) {
                showOverlay('Supabase no esta disponible. Entra como invitado para probar el EMR sin sincronizacion.');
            } else {
                enableLocalMode();
            }
            return;
        }

        try {
            const { data, error } = await client.auth.getSession();
            if (error) throw error;
            state.accessToken = (data && data.session && data.session.access_token) || '';
            state.authMode = data && data.session
                ? (data.session.user?.is_anonymous ? 'supabase-anonymous' : 'supabase')
                : '';
            setUser(data && data.session ? data.session.user : null);
        } catch (error) {
            console.warn('[Miracle Auth] Session lookup failed:', error.message);
            showOverlay('No fue posible contactar Supabase. Entra como invitado para continuar localmente.');
        }

        client.auth.onAuthStateChange((_event, session) => {
            state.accessToken = (session && session.access_token) || '';
            state.authMode = session ? (session.user?.is_anonymous ? 'supabase-anonymous' : 'supabase') : '';
            setUser(session ? session.user : null);
        });
    }

    window.MiracleAuth = {
        whenAuthenticated() { return authed; },
        getUser() { return state.user; },
        getAccessToken() { return state.accessToken || ''; },
        getMode() { return state.authMode || ''; },
        async signOut() {
            if (state.authMode === 'local-anonymous') {
                try { sessionStorage.removeItem(LOCAL_SESSION_KEY); } catch (error) { /* ignore */ }
                window.location.reload();
                return;
            }
            try { await state.client?.auth.signOut(); } catch (error) { console.warn('[Miracle Auth] Sign-out failed:', error); }
        }
    };

    if (window.MiracleSupabase) {
        init();
    } else {
        console.error('[Miracle Auth] supabase-client.js must load before auth-gate.js');
    }
})();
