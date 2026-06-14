(function () {
    const state = {
        account: null,
        mounted: false,
        root: null
    };

    function getAccessToken() {
        return window.MiracleAuth && typeof window.MiracleAuth.getAccessToken === 'function'
            ? window.MiracleAuth.getAccessToken()
            : '';
    }

    function isAnonymousUser(user) {
        if (!user) return true;
        if (user.role === 'local-dev') return false;
        if (user.is_anonymous === true) return true;
        const provider = `${user.app_metadata?.provider || user.user_metadata?.provider || ''}`.trim().toLowerCase();
        const providers = Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers : [];
        return provider === 'anonymous'
            || providers.some((value) => `${value || ''}`.trim().toLowerCase() === 'anonymous');
    }

    async function authenticatedFetch(url, init = {}) {
        if (window.MiracleAuth && typeof window.MiracleAuth.whenAuthenticated === 'function') {
            await window.MiracleAuth.whenAuthenticated();
        }
        const token = getAccessToken();
        return fetch(url, {
            ...init,
            cache: 'no-store',
            headers: {
                ...(init.headers || {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            }
        });
    }

    function installStyles() {
        if (document.getElementById('miracle-admin-workspace-styles')) return;
        const style = document.createElement('style');
        style.id = 'miracle-admin-workspace-styles';
        style.textContent = `
            .miracle-admin-workspace {
                position: fixed;
                right: 18px;
                bottom: 18px;
                z-index: 2147482500;
                width: min(330px, calc(100vw - 32px));
                padding: 12px;
                border: 1px solid rgba(15, 23, 42, 0.16);
                border-radius: 14px;
                background: rgba(255, 255, 255, 0.96);
                box-shadow: 0 18px 48px rgba(15, 23, 42, 0.18);
                color: #0f172a;
                font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
                display: grid;
                gap: 10px;
            }
            .miracle-admin-workspace[aria-expanded="false"] {
                width: auto;
                padding: 8px 10px;
            }
            .miracle-admin-workspace[aria-expanded="false"] .miracle-admin-body,
            .miracle-admin-workspace[aria-expanded="false"] .miracle-admin-meta {
                display: none;
            }
            .miracle-admin-top {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
            }
            .miracle-admin-title {
                display: grid;
                gap: 2px;
                min-width: 0;
            }
            .miracle-admin-title strong {
                font-size: 13px;
                line-height: 1.1;
            }
            .miracle-admin-meta {
                color: #64748b;
                font-size: 11px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .miracle-admin-toggle {
                width: 30px;
                height: 30px;
                border: 1px solid rgba(15, 23, 42, 0.14);
                border-radius: 999px;
                background: #f8fafc;
                color: #0f172a;
                cursor: pointer;
                font-weight: 800;
            }
            .miracle-admin-body {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
            }
            .miracle-admin-action {
                border: 0;
                border-radius: 10px;
                padding: 10px 11px;
                background: #0f172a;
                color: #ffffff;
                cursor: pointer;
                font: inherit;
                font-size: 12px;
                font-weight: 700;
                text-align: center;
                text-decoration: none;
            }
            .miracle-admin-action.secondary {
                background: #eef2f7;
                color: #0f172a;
            }
            .miracle-admin-action.warning {
                background: #f59e0b;
                color: #111827;
            }
            .miracle-admin-action:disabled {
                cursor: not-allowed;
                opacity: 0.55;
            }
            @media (max-width: 680px) {
                .miracle-admin-workspace {
                    right: 12px;
                    bottom: 12px;
                }
                .miracle-admin-body {
                    grid-template-columns: 1fr;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function actionButton(label, className, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `miracle-admin-action ${className || ''}`.trim();
        button.textContent = label;
        button.addEventListener('click', onClick);
        return button;
    }

    function actionLink(label, href, className) {
        const link = document.createElement('a');
        link.className = `miracle-admin-action ${className || ''}`.trim();
        link.textContent = label;
        link.href = href;
        return link;
    }

    function openWorkflowPanel() {
        if (window.TrainerPlugin && typeof window.TrainerPlugin.openWorkflowPanel === 'function') {
            window.TrainerPlugin.openWorkflowPanel();
            return;
        }
        window.location.href = '/visualize.html';
    }

    async function startWorkflowRecording() {
        if (!window.TrainerPlugin || typeof window.TrainerPlugin.startWorkflow !== 'function') {
            window.location.href = '/visualize.html';
            return;
        }

        const input = document.getElementById('wf-desc');
        const fallback = document.title ? `Workflow ${document.title}` : `Workflow ${new Date().toISOString()}`;
        const description = window.prompt('Nombre del workflow privado', input?.value || fallback);
        if (description === null) return;
        if (input) {
            input.value = description.trim() || fallback;
        }
        await window.TrainerPlugin.startWorkflow();
    }

    async function signOut() {
        if (window.MiracleAuth && typeof window.MiracleAuth.signOut === 'function') {
            await window.MiracleAuth.signOut();
        }
        window.location.reload();
    }

    function render(account) {
        installStyles();
        document.body.classList.add('miracle-admin-account');
        if (state.root) {
            state.root.remove();
        }

        const root = document.createElement('aside');
        root.className = 'miracle-admin-workspace';
        root.setAttribute('aria-label', 'Developer workspace');
        root.setAttribute('aria-expanded', window.localStorage.getItem('miracle-admin-workspace-collapsed') === 'true' ? 'false' : 'true');

        const top = document.createElement('div');
        top.className = 'miracle-admin-top';

        const title = document.createElement('div');
        title.className = 'miracle-admin-title';
        const label = document.createElement('strong');
        label.textContent = 'Developer workspace';
        const meta = document.createElement('span');
        meta.className = 'miracle-admin-meta';
        meta.textContent = account?.user?.email || 'admin';
        title.append(label, meta);

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'miracle-admin-toggle';
        toggle.textContent = root.getAttribute('aria-expanded') === 'true' ? '-' : '+';
        toggle.title = 'Mostrar u ocultar workspace admin';
        toggle.addEventListener('click', () => {
            const expanded = root.getAttribute('aria-expanded') !== 'false';
            const next = expanded ? 'false' : 'true';
            root.setAttribute('aria-expanded', next);
            toggle.textContent = next === 'true' ? '-' : '+';
            window.localStorage.setItem('miracle-admin-workspace-collapsed', next === 'false' ? 'true' : 'false');
        });

        top.append(title, toggle);

        const body = document.createElement('div');
        body.className = 'miracle-admin-body';
        body.append(
            actionButton('Crear workflow', 'warning', () => {
                startWorkflowRecording().catch((error) => window.alert(error.message || 'No se pudo iniciar la grabacion.'));
            }),
            actionButton('Mis workflows', 'secondary', openWorkflowPanel),
            actionLink('Grafo y globales', '/visualize.html', ''),
            actionButton('Cerrar sesion', 'secondary', () => {
                signOut().catch(() => window.location.reload());
            })
        );

        root.append(top, body);
        document.body.appendChild(root);
        state.root = root;
        state.mounted = true;
    }

    async function loadAccount() {
        const response = await authenticatedFetch('/api/account/me');
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || 'No se pudo cargar la cuenta.');
        }
        return payload;
    }

    async function init() {
        if (!window.MiracleAuth || typeof window.MiracleAuth.whenAuthenticated !== 'function') {
            return;
        }

        try {
            await window.MiracleAuth.whenAuthenticated();
            const user = window.MiracleAuth.getUser?.() || null;
            if (isAnonymousUser(user)) {
                return;
            }
            const account = await loadAccount();
            state.account = account;
            window.dispatchEvent(new CustomEvent('miracle-account-ready', { detail: account }));
            if (account?.permissions?.canManageGlobalWorkflows) {
                render(account);
            }
        } catch (error) {
            console.warn('[Miracle Admin] Workspace unavailable:', error.message || error);
        }
    }

    window.MiracleAdminWorkspace = {
        getAccount() {
            return state.account;
        },
        refresh() {
            return init();
        }
    };

    init();
})();
