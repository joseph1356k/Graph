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

    let rafId = null;
    let particleField = null;

    function ensureStyle() {
        if (document.getElementById('miracle-auth-style')) return;
        const style = document.createElement('style');
        style.id = 'miracle-auth-style';
        style.textContent = `
            @import url("https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap");
            #miracle-auth-gate {
                position: fixed;
                inset: 0;
                z-index: 2147483000;
                display: grid;
                place-items: center;
                padding: 24px;
                background: #000;
                font-family: "Manrope", "Segoe UI", sans-serif;
                overflow: hidden;
            }
            #miracle-auth-gate .miracle-auth-glow {
                position: absolute;
                inset: -20%;
                z-index: 0;
                pointer-events: none;
                background:
                    radial-gradient(ellipse 34% 26% at 50% 24%, rgba(255,255,255,0.14), transparent 72%),
                    radial-gradient(ellipse 40% 30% at 18% 78%, rgba(255,255,255,0.05), transparent 75%),
                    radial-gradient(ellipse 40% 30% at 84% 82%, rgba(255,255,255,0.05), transparent 75%);
                animation: miracle-auth-drift 16s ease-in-out infinite alternate;
            }
            @keyframes miracle-auth-drift {
                0% { transform: translate3d(-1.5%, -1%, 0) scale(1); }
                100% { transform: translate3d(1.5%, 1.5%, 0) scale(1.06); }
            }
            #miracle-auth-canvas {
                position: absolute;
                inset: 0;
                z-index: 1;
                width: 100%;
                height: 100%;
                pointer-events: none;
                opacity: 0.9;
            }
            .miracle-auth-card {
                position: relative;
                z-index: 2;
                width: min(420px, calc(100vw - 36px));
                display: grid;
                justify-items: center;
                gap: 30px;
                text-align: center;
            }
            .miracle-auth-card h1 {
                margin: 0;
                color: #f4f4f2;
                font-size: clamp(2.6rem, 7vw, 4.2rem);
                font-weight: 500;
                line-height: 0.95;
                letter-spacing: -0.05em;
                text-shadow: 0 0 9px rgba(255,255,255,0.45), 0 0 30px rgba(255,255,255,0.14);
            }
            #miracle-auth-form {
                width: 100%;
                display: grid;
                gap: 14px;
                justify-items: center;
            }
            #miracle-auth-form input {
                width: 100%;
                height: 54px;
                padding: 0 20px;
                border: 1px solid rgba(255,255,255,0.16);
                border-radius: 999px;
                outline: none;
                color: #f4f4f2;
                background-color: rgba(18,18,18,0.85);
                box-shadow: inset 0 1px 0 rgba(255,255,255,0.025);
                font: inherit;
                font-size: 0.95rem;
                font-weight: 500;
                text-align: center;
                transition: border-color 140ms ease, background-color 140ms ease, box-shadow 140ms ease;
            }
            #miracle-auth-form input::placeholder {
                color: rgba(244,244,242,0.4);
            }
            #miracle-auth-form input:hover {
                border-color: rgba(255,255,255,0.3);
                background-color: rgba(24,24,24,0.92);
            }
            #miracle-auth-form input:focus {
                border-color: rgba(255,255,255,0.72);
                background-color: #161616;
                box-shadow: 0 0 0 1px rgba(255,255,255,0.2), 0 0 22px rgba(255,255,255,0.08);
            }
            #miracle-auth-form input:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            #miracle-auth-error {
                margin: 0;
                min-height: 0;
                color: #ff9a8b;
                font-size: 0.8rem;
                line-height: 1.4;
            }
            #miracle-auth-error:empty {
                display: none;
            }
            #miracle-auth-submit {
                width: 62px;
                height: 62px;
                margin-top: 4px;
                border: 1.5px solid rgba(255,255,255,0.7);
                border-radius: 50%;
                display: grid;
                place-items: center;
                background: rgba(255,255,255,0.06);
                color: #fff;
                cursor: pointer;
                box-shadow: 0 0 16px rgba(255,255,255,0.13), inset 0 0 18px rgba(255,255,255,0.025);
                transition: border-color 140ms ease, transform 140ms ease, box-shadow 140ms ease, opacity 140ms ease;
            }
            #miracle-auth-submit:hover:not(:disabled) {
                transform: translateY(-2px);
                border-color: #fff;
                box-shadow: 0 0 24px rgba(255,255,255,0.22), inset 0 0 18px rgba(255,255,255,0.04);
            }
            #miracle-auth-submit:disabled {
                cursor: progress;
                opacity: 0.55;
            }
            #miracle-auth-submit svg {
                width: 24px;
                height: 24px;
                fill: none;
                stroke: currentColor;
                stroke-width: 1.8;
                stroke-linecap: round;
                stroke-linejoin: round;
            }
            #miracle-auth-submit.is-busy svg {
                animation: miracle-auth-spin 0.9s linear infinite;
            }
            @keyframes miracle-auth-spin {
                to { transform: rotate(360deg); }
            }
            @media (prefers-reduced-motion: reduce) {
                #miracle-auth-gate .miracle-auth-glow,
                #miracle-auth-submit.is-busy svg {
                    animation: none;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function createParticleField(canvas) {
        const ctx = canvas.getContext('2d');
        let width = 0;
        let height = 0;
        let dpr = Math.min(window.devicePixelRatio || 1, 2);
        let particles = [];
        const pointer = { x: -9999, y: -9999 };

        function resize() {
            width = window.innerWidth;
            height = window.innerHeight;
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            canvas.style.width = width + 'px';
            canvas.style.height = height + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const count = Math.max(36, Math.min(110, Math.floor((width * height) / 16000)));
            particles = Array.from({ length: count }, () => ({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                r: Math.random() * 1.4 + 0.6
            }));
        }

        function onPointerMove(event) {
            const point = event.touches ? event.touches[0] : event;
            if (!point) return;
            pointer.x = point.clientX;
            pointer.y = point.clientY;
        }

        function onPointerLeave() {
            pointer.x = -9999;
            pointer.y = -9999;
        }

        function step() {
            ctx.clearRect(0, 0, width, height);

            for (const p of particles) {
                p.x += p.vx;
                p.y += p.vy;
                if (p.x <= 0 || p.x >= width) p.vx *= -1;
                if (p.y <= 0 || p.y >= height) p.vy *= -1;
                const dxp = p.x - pointer.x;
                const dyp = p.y - pointer.y;
                const distPointer = Math.sqrt(dxp * dxp + dyp * dyp);
                if (distPointer < 140) {
                    const push = (140 - distPointer) / 140;
                    p.x += (dxp / (distPointer || 1)) * push * 0.6;
                    p.y += (dyp / (distPointer || 1)) * push * 0.6;
                }
            }

            for (let i = 0; i < particles.length; i++) {
                const a = particles[i];
                for (let j = i + 1; j < particles.length; j++) {
                    const b = particles[j];
                    const dx = a.x - b.x;
                    const dy = a.y - b.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 120) {
                        ctx.strokeStyle = `rgba(255,255,255,${0.16 * (1 - dist / 120)})`;
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(a.x, a.y);
                        ctx.lineTo(b.x, b.y);
                        ctx.stroke();
                    }
                }
                const dxm = a.x - pointer.x;
                const dym = a.y - pointer.y;
                const distMouse = Math.sqrt(dxm * dxm + dym * dym);
                if (distMouse < 180) {
                    ctx.strokeStyle = `rgba(255,255,255,${0.28 * (1 - distMouse / 180)})`;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(pointer.x, pointer.y);
                    ctx.stroke();
                }
            }

            for (const p of particles) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255,255,255,0.55)';
                ctx.shadowColor = 'rgba(255,255,255,0.5)';
                ctx.shadowBlur = 6;
                ctx.fill();
                ctx.shadowBlur = 0;
            }
        }

        resize();
        window.addEventListener('resize', resize);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerleave', onPointerLeave);

        return { step };
    }

    function startAnimation(overlay) {
        if (rafId) return;
        const canvas = overlay.querySelector('#miracle-auth-canvas');
        if (!canvas) return;
        if (!particleField) {
            particleField = createParticleField(canvas);
        }
        const loop = () => {
            particleField.step();
            rafId = window.requestAnimationFrame(loop);
        };
        rafId = window.requestAnimationFrame(loop);
    }

    function stopAnimation() {
        if (rafId) {
            window.cancelAnimationFrame(rafId);
            rafId = null;
        }
    }

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
        ensureStyle();

        const overlay = document.createElement('div');
        overlay.id = 'miracle-auth-gate';

        const glow = document.createElement('div');
        glow.className = 'miracle-auth-glow';

        const canvas = document.createElement('canvas');
        canvas.id = 'miracle-auth-canvas';

        const card = document.createElement('div');
        card.className = 'miracle-auth-card';

        const title = document.createElement('h1');
        title.textContent = 'Inicia sesion';

        const form = document.createElement('form');
        form.id = 'miracle-auth-form';
        form.autocomplete = 'on';

        const usernameInput = document.createElement('input');
        usernameInput.id = 'miracle-auth-username';
        usernameInput.name = 'username';
        usernameInput.type = 'text';
        usernameInput.autocomplete = 'username';
        usernameInput.autocapitalize = 'none';
        usernameInput.spellcheck = false;
        usernameInput.placeholder = 'Correo';
        usernameInput.setAttribute('aria-label', 'Correo');

        const passwordInput = document.createElement('input');
        passwordInput.id = 'miracle-auth-password';
        passwordInput.name = 'password';
        passwordInput.type = 'password';
        passwordInput.autocomplete = 'current-password';
        passwordInput.placeholder = 'Contrasena';
        passwordInput.setAttribute('aria-label', 'Contrasena');

        const error = document.createElement('p');
        error.id = 'miracle-auth-error';

        const button = document.createElement('button');
        button.id = 'miracle-auth-submit';
        button.type = 'submit';
        button.setAttribute('aria-label', 'Entrar');
        button.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M13 5l7 7-7 7"/></svg>';

        form.append(usernameInput, passwordInput, error, button);
        card.append(title, form);
        overlay.append(glow, canvas, card);
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
        button.classList.toggle('is-busy', state.busy);
        username.disabled = state.busy;
        password.disabled = state.busy;
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
        startAnimation(overlay);
    }

    function hideOverlay() {
        if (state.overlay) {
            state.overlay.style.display = 'none';
        }
        stopAnimation();
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
            setError('Ingresa correo y contrasena.');
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
