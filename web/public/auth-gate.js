(function () {
    let resolveAuthed;
    const authed = new Promise((resolve) => { resolveAuthed = resolve; });
    const STORAGE_KEY = 'miracle-admin-session-v1';
    const state = {
        user: null,
        accessToken: '',
        authMode: '',
        overlay: null,
        errorText: '',
        busy: false
    };

    function readStoredSession() {
        try {
            return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
        } catch (error) {
            return null;
        }
    }

    function writeStoredSession(session) {
        try {
            if (!session) {
                window.localStorage.removeItem(STORAGE_KEY);
                return;
            }
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
        } catch (error) {
            // Ignore storage failures and continue with the in-memory session.
        }
    }

    function buildOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'miracle-auth-gate';
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:2147483000',
            'display:grid', 'place-items:center',
            'padding:24px',
            'background:radial-gradient(circle at top left, rgba(71, 85, 140, 0.28), transparent 26%), linear-gradient(180deg, rgba(5, 8, 20, 0.92), rgba(4, 7, 18, 0.97))',
            'backdrop-filter:blur(12px)',
            'font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif'
        ].join(';');

        const card = document.createElement('div');
        card.style.cssText = [
            'width:min(460px,calc(100vw - 36px))',
            'padding:32px',
            'border-radius:28px',
            'border:1px solid rgba(177,193,232,0.12)',
            'background:linear-gradient(180deg, rgba(10,16,34,0.98), rgba(8,13,30,0.98))',
            'box-shadow:0 32px 90px rgba(0,0,0,0.45)',
            'color:#f4f7ff',
            'display:grid',
            'gap:18px'
        ].join(';');

        const eyebrow = document.createElement('span');
        eyebrow.textContent = 'Miracle Console';
        eyebrow.style.cssText = [
            'display:inline-flex',
            'align-items:center',
            'width:max-content',
            'min-height:28px',
            'padding:0 10px',
            'border-radius:999px',
            'background:rgba(177,193,232,0.08)',
            'color:#b7c3e4',
            'font-size:12px',
            'font-weight:800',
            'letter-spacing:0.08em',
            'text-transform:uppercase'
        ].join(';');

        const title = document.createElement('h2');
        title.textContent = 'Inicia sesion para entrar a Graph';
        title.style.cssText = 'margin:0;font-size:32px;line-height:1;letter-spacing:-0.05em';

        const subtitle = document.createElement('p');
        subtitle.textContent = 'El acceso al dashboard, al EMR expandido y al workspace integrado de Miracle requiere autenticacion obligatoria.';
        subtitle.style.cssText = 'margin:0;color:#8f9bbb;line-height:1.65;font-size:14px';

        const form = document.createElement('form');
        form.id = 'miracle-auth-form';
        form.autocomplete = 'off';
        form.style.cssText = 'display:grid;gap:14px';

        const usernameWrap = document.createElement('label');
        usernameWrap.style.cssText = 'display:grid;gap:8px';
        const usernameLabel = document.createElement('span');
        usernameLabel.textContent = 'Usuario';
        usernameLabel.style.cssText = 'color:#b7c3e4;font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase';
        const usernameInput = document.createElement('input');
        usernameInput.id = 'miracle-auth-username';
        usernameInput.name = 'username';
        usernameInput.type = 'text';
        usernameInput.autocomplete = 'off';
        usernameInput.autocapitalize = 'none';
        usernameInput.spellcheck = false;
        usernameInput.placeholder = 'Tu usuario autorizado';
        usernameInput.style.cssText = [
            'min-height:52px',
            'padding:0 16px',
            'border-radius:16px',
            'border:1px solid rgba(177,193,232,0.16)',
            'background:#0d1429',
            'color:#f4f7ff',
            'outline:none'
        ].join(';');
        usernameWrap.append(usernameLabel, usernameInput);

        const passwordWrap = document.createElement('label');
        passwordWrap.style.cssText = 'display:grid;gap:8px';
        const passwordLabel = document.createElement('span');
        passwordLabel.textContent = 'Clave';
        passwordLabel.style.cssText = usernameLabel.style.cssText;
        const passwordInput = document.createElement('input');
        passwordInput.id = 'miracle-auth-password';
        passwordInput.name = 'password';
        passwordInput.type = 'password';
        passwordInput.autocomplete = 'new-password';
        passwordInput.placeholder = 'Tu clave';
        passwordInput.style.cssText = usernameInput.style.cssText;
        passwordWrap.append(passwordLabel, passwordInput);

        const error = document.createElement('p');
        error.id = 'miracle-auth-error';
        error.style.cssText = 'margin:0;min-height:20px;color:#e49c9c;font-size:13px;line-height:1.5';

        const button = document.createElement('button');
        button.id = 'miracle-auth-submit';
        button.type = 'submit';
        button.textContent = 'Entrar';
        button.style.cssText = [
            'min-height:52px',
            'border:0',
            'border-radius:16px',
            'padding:0 18px',
            'font:inherit',
            'font-weight:800',
            'background:#eef2fb',
            'color:#111629',
            'cursor:pointer'
        ].join(';');

        const note = document.createElement('div');
        note.style.cssText = [
            'padding:14px 16px',
            'border-radius:18px',
            'background:rgba(255,255,255,0.03)',
            'border:1px solid rgba(177,193,232,0.08)',
            'color:#8f9bbb',
            'font-size:13px',
            'line-height:1.6'
        ].join(';');
        note.textContent = 'Usa una de las cuentas autorizadas para operar providers, Graph y las superficies clinicas.';

        form.append(usernameWrap, passwordWrap, error, button);
        card.append(eyebrow, title, subtitle, form, note);
        overlay.appendChild(card);
        return overlay;
    }

    function ensureOverlay() {
        if (!state.overlay) {
            state.overlay = buildOverlay();
            const form = state.overlay.querySelector('#miracle-auth-form');
            form.addEventListener('submit', (event) => {
                event.preventDefault();
                signIn().catch((error) => {
                    setError(error.message || 'No fue posible iniciar sesion.');
                    setBusy(false);
                });
            });
        }
        if (!state.overlay.isConnected) {
            (document.body || document.documentElement).appendChild(state.overlay);
        }
        return state.overlay;
    }

    function setBusy(busy) {
        state.busy = Boolean(busy);
        const overlay = ensureOverlay();
        const button = overlay.querySelector('#miracle-auth-submit');
        const username = overlay.querySelector('#miracle-auth-username');
        const password = overlay.querySelector('#miracle-auth-password');
        button.disabled = state.busy;
        username.disabled = state.busy;
        password.disabled = state.busy;
        button.textContent = state.busy ? 'Entrando...' : 'Entrar';
    }

    function setError(message) {
        state.errorText = `${message || ''}`.trim();
        const overlay = ensureOverlay();
        const error = overlay.querySelector('#miracle-auth-error');
        error.textContent = state.errorText;
    }

    function showOverlay() {
        const overlay = ensureOverlay();
        overlay.style.display = 'grid';
        const username = overlay.querySelector('#miracle-auth-username');
        const password = overlay.querySelector('#miracle-auth-password');
        username.value = '';
        password.value = '';
        window.setTimeout(() => username.focus(), 0);
    }

    function hideOverlay() {
        if (state.overlay) {
            state.overlay.style.display = 'none';
        }
    }

    function setUser(user) {
        state.user = user || null;
        if (state.user) {
            hideOverlay();
            resolveAuthed(state.user);
            window.dispatchEvent(new CustomEvent('miracle-auth-changed', { detail: { user: state.user } }));
            return;
        }
        showOverlay();
    }

    async function validateSession(token) {
        const response = await fetch('/api/account/me', {
            cache: 'no-store',
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || 'La sesion ya no es valida.');
        }
        return payload;
    }

    async function signIn() {
        const overlay = ensureOverlay();
        const username = overlay.querySelector('#miracle-auth-username').value.trim();
        const password = overlay.querySelector('#miracle-auth-password').value;
        if (!username || !password) {
            setError('Ingresa usuario y clave.');
            return;
        }

        setBusy(true);
        setError('');
        const response = await fetch('/api/auth/local-admin/login', {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || 'Credenciales invalidas.');
        }

        state.accessToken = payload.accessToken || '';
        state.authMode = 'local-admin';
        writeStoredSession({
            accessToken: state.accessToken,
            user: payload.user || null
        });
        setUser(payload.user || null);
        setBusy(false);
    }

    async function init() {
        const stored = readStoredSession();
        if (stored?.accessToken) {
            try {
                const account = await validateSession(stored.accessToken);
                state.accessToken = stored.accessToken;
                state.authMode = 'local-admin';
                setUser({
                    ...(stored.user || {}),
                    ...(account.user || {}),
                    username: stored.user?.username || account.user?.email || ''
                });
                return;
            } catch (error) {
                writeStoredSession(null);
            }
        }

        state.accessToken = '';
        state.authMode = '';
        setUser(null);
    }

    window.MiracleAuth = {
        whenAuthenticated() { return authed; },
        getUser() { return state.user; },
        getAccessToken() { return state.accessToken || ''; },
        getMode() { return state.authMode || ''; },
        async signOut() {
            writeStoredSession(null);
            state.accessToken = '';
            state.authMode = '';
            try {
                await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' });
            } catch (error) {
                // Ignore network failures on logout.
            }
            window.location.reload();
        }
    };

    init().catch((error) => {
        setError(error.message || 'No fue posible inicializar el login.');
        showOverlay();
    });
})();
