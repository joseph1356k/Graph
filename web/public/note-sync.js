(function () {
    // Real-time mirror layered on top of window.PageState. Keeps a per-encounter note
    // (a flat { fieldId: value } map) in sync across every device signed into the same
    // account, using a Supabase Broadcast channel for low-latency deltas plus a debounced
    // upsert of the full note to the `encounters` table for durability.
    const ENCOUNTER_STORAGE_KEY = 'miracle-active-encounter';
    const UPSERT_DEBOUNCE_MS = 800;
    const senderId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const state = {
        client: null,
        user: null,
        manager: null,
        encounterId: null,
        channel: null,
        channelReady: false,
        loadedNote: null,
        appliedInitial: false,
        initialized: false,
        syncDisabled: false,
        upsertTimer: null,
        pendingRemote: {},
        lastValues: {},
        auditQueue: [],
        auditTimer: null,
        dirtyNote: false
    };

    function log() {
        console.log.apply(console, ['[Miracle Sync]'].concat(Array.prototype.slice.call(arguments)));
    }

    function resolveEncounterIdFromContext() {
        try {
            const fromUrl = (new URL(window.location.href).searchParams.get('encounter') || '').trim();
            if (fromUrl) return fromUrl;
        } catch (error) { /* ignore */ }
        try {
            return (localStorage.getItem(ENCOUNTER_STORAGE_KEY) || '').trim() || null;
        } catch (error) {
            return null;
        }
    }

    function persistEncounterId(id) {
        state.encounterId = id;
        try { localStorage.setItem(ENCOUNTER_STORAGE_KEY, id); } catch (error) { /* ignore */ }
        try {
            const url = new URL(window.location.href);
            if (url.searchParams.get('encounter') !== id) {
                url.searchParams.set('encounter', id);
                window.history.replaceState({}, '', url);
            }
        } catch (error) { /* ignore */ }
    }

    async function ensureEncounter() {
        const client = state.client;
        const existingId = resolveEncounterIdFromContext();

        if (existingId) {
            const { data, error } = await client
                .from('encounters')
                .select('id, note')
                .eq('id', existingId)
                .maybeSingle();
            if (!error && data) {
                persistEncounterId(data.id);
                return data.note || {};
            }
            log('Encuentro previo no disponible, creando uno nuevo.', (error && error.message) || '');
        }

        // A demo encounter does not require a patient. Create it in the background so
        // the expanded EMR is immediately usable when launched from Provider Studio.
        const label = 'Encuentro ' + new Date().toLocaleString();
        const { data, error } = await client
            .from('encounters')
            .insert({ label })
            .select('id, note')
            .single();
        if (error) {
            console.error('[Miracle Sync] No se pudo crear el encuentro:', error.message);
            return null;
        }
        persistEncounterId(data.id);
        return data.note || {};
    }

    function applyInbound(id, value) {
        if (state.manager) {
            state.manager.applyRemoteField(id, value);
        } else {
            state.pendingRemote[id] = value;
        }
    }

    function setupChannel(id) {
        const channel = state.client.channel('encounter:' + id, {
            config: {
                private: true,
                broadcast: { self: false }
            }
        });
        channel.on('broadcast', { event: 'field' }, (message) => {
            const payload = (message && message.payload) || {};
            if (typeof payload.id !== 'string') return;
            if (payload.senderId === senderId) return;
            applyInbound(payload.id, payload.value);
        });
        channel.subscribe((status) => {
            state.channelReady = status === 'SUBSCRIBED';
            if (state.channelReady) log('Canal en tiempo real listo para', id);
        });
        state.channel = channel;
    }

    function scheduleUpsert() {
        state.dirtyNote = true;
        if (state.upsertTimer) clearTimeout(state.upsertTimer);
        state.upsertTimer = setTimeout(flushUpsert, UPSERT_DEBOUNCE_MS);
    }

    async function flushUpsert() {
        state.upsertTimer = null;
        if (state.syncDisabled) return;
        if (!state.initialized || !state.encounterId || !state.manager) {
            // Still booting; try again shortly so early edits are not lost.
            scheduleUpsert();
            return;
        }
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            state.dirtyNote = true; // offline: keep dirty and flush on reconnect
            return;
        }
        const note = state.manager.getState();
        const { error } = await state.client
            .from('encounters')
            .update({ note, updated_at: new Date().toISOString() })
            .eq('id', state.encounterId);
        if (error) {
            state.dirtyNote = true;
            console.warn('[Miracle Sync] No se pudo guardar la nota:', error.message);
        } else {
            state.dirtyNote = false;
        }
    }

    function maybeApplyInitial() {
        if (state.appliedInitial || !state.manager || state.loadedNote === null) return;
        state.appliedInitial = true;

        const dbNote = state.loadedNote || {};
        state.lastValues = { ...dbNote };
        if (Object.keys(dbNote).length > 0) {
            // Server note is the shared source of truth — apply it over local.
            state.manager.applyRemoteState(dbNote);
        } else {
            // Server note is empty; seed it from whatever is already on this device.
            const localNote = state.manager.getState();
            if (Object.keys(localNote).length > 0) scheduleUpsert();
        }

        // Flush deltas that arrived before the manager was attached.
        const pending = state.pendingRemote;
        state.pendingRemote = {};
        Object.keys(pending).forEach((fieldId) => state.manager.applyRemoteField(fieldId, pending[fieldId]));

        renderBadge();
    }

    // ---- public hook consumed by page-state.js ----
    function attach(manager) {
        state.manager = manager;
        maybeApplyInitial();
    }

    function onLocalFieldChange(id, value, meta) {
        if (state.syncDisabled) return;
        if (state.channelReady && state.channel) {
            state.channel.send({ type: 'broadcast', event: 'field', payload: { id, value, senderId } });
        }
        scheduleUpsert();
        queueAudit(id, value, meta || { source: 'human' });
    }

    // Append-only audit: every local change (human or AI) becomes a row in
    // encounter_events with its origin, evidence and previous value.
    function queueAudit(id, value, meta) {
        const previous = state.lastValues[id];
        state.lastValues[id] = value;
        state.auditQueue.push({
            field_id: id,
            old_value: previous == null ? null : String(previous),
            new_value: value == null ? null : String(value),
            source: (meta && meta.source) || 'human',
            confidence: meta && typeof meta.confidence === 'number' ? meta.confidence : null,
            evidence: (meta && meta.evidence) || ''
        });
        if (state.auditTimer) clearTimeout(state.auditTimer);
        state.auditTimer = setTimeout(flushAudit, 1200);
    }

    async function flushAudit() {
        state.auditTimer = null;
        if (state.syncDisabled) { state.auditQueue = []; return; }
        if (!state.initialized || !state.encounterId || !state.client) {
            if (state.auditQueue.length) state.auditTimer = setTimeout(flushAudit, 1200);
            return;
        }
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            return; // offline: keep the queue and flush on reconnect
        }
        if (!state.auditQueue.length) return;
        const batch = state.auditQueue.splice(0, state.auditQueue.length)
            .map((row) => ({ ...row, encounter_id: state.encounterId }));
        const { error } = await state.client.from('encounter_events').insert(batch);
        if (error) console.warn('[Miracle Sync] No se pudo guardar la auditoria:', error.message);
    }

    window.MiracleNoteSync = {
        attach,
        onLocalFieldChange,
        getEncounterId() { return state.encounterId; }
    };

    // Offline resilience: when the device comes back online, flush whatever is pending.
    if (typeof window !== 'undefined') {
        window.addEventListener('online', () => {
            if (state.syncDisabled || !state.initialized) return;
            if (state.dirtyNote) flushUpsert();
            if (state.auditQueue.length) flushAudit();
        });
    }

    // ---- floating badge: copy the encounter link to open it on another device ----
    function renderBadge() {
        if (document.getElementById('miracle-sync-badge')) {
            updateBadge();
            return;
        }
        const badge = document.createElement('div');
        badge.id = 'miracle-sync-badge';
        badge.style.cssText = [
            'position:fixed', 'left:16px', 'bottom:16px', 'z-index:2147482000',
            'display:flex', 'align-items:center', 'gap:10px',
            'padding:8px 12px', 'border-radius:999px',
            'background:#0f172a', 'color:#e2e8f0', 'font:500 12px Inter,system-ui,sans-serif',
            'box-shadow:0 12px 28px rgba(15,23,42,0.25)'
        ].join(';');

        const label = document.createElement('span');
        label.id = 'miracle-sync-label';

        const copy = document.createElement('button');
        copy.type = 'button';
        copy.textContent = 'Copiar enlace';
        copy.style.cssText = 'border:0;border-radius:999px;padding:5px 10px;font:inherit;font-weight:700;background:#2f8cff;color:#fff;cursor:pointer';
        copy.addEventListener('click', () => {
            try {
                navigator.clipboard.writeText(window.location.href);
                copy.textContent = 'Copiado';
                setTimeout(() => { copy.textContent = 'Copiar enlace'; }, 1500);
            } catch (error) { /* ignore */ }
        });

        const signOut = document.createElement('button');
        signOut.type = 'button';
        signOut.textContent = 'Salir';
        signOut.style.cssText = 'border:0;border-radius:999px;padding:5px 10px;font:inherit;background:transparent;color:#94a3b8;cursor:pointer';
        signOut.addEventListener('click', () => window.MiracleAuth && window.MiracleAuth.signOut());

        badge.append(label, copy, signOut);
        (document.body || document.documentElement).appendChild(badge);
        updateBadge();
    }

    function renderLocalModeBadge() {
        if (document.getElementById('miracle-sync-badge')) return;
        const badge = document.createElement('div');
        badge.id = 'miracle-sync-badge';
        badge.style.cssText = [
            'position:fixed', 'left:16px', 'bottom:16px', 'z-index:2147482000',
            'display:flex', 'align-items:center', 'gap:10px',
            'padding:8px 12px', 'border-radius:999px',
            'background:#fff7ed', 'color:#9a3412', 'font:600 12px Inter,system-ui,sans-serif',
            'border:1px solid #fed7aa', 'box-shadow:0 12px 28px rgba(15,23,42,0.16)'
        ].join(';');
        const label = document.createElement('span');
        label.textContent = 'Modo invitado local - sin sincronizacion';
        const signOut = document.createElement('button');
        signOut.type = 'button';
        signOut.textContent = 'Salir';
        signOut.style.cssText = 'border:0;border-radius:999px;padding:5px 10px;font:inherit;background:#ffedd5;color:#9a3412;cursor:pointer';
        signOut.addEventListener('click', () => window.MiracleAuth && window.MiracleAuth.signOut());
        badge.append(label, signOut);
        (document.body || document.documentElement).appendChild(badge);
    }

    function updateBadge() {
        const label = document.getElementById('miracle-sync-label');
        if (!label) return;
        const email = (state.user && state.user.email) ? state.user.email : 'sesion activa';
        label.textContent = '🟢 Sincronizado · ' + email;
    }

    async function init() {
        const client = await window.MiracleSupabase.whenReady();
        state.user = await window.MiracleAuth.whenAuthenticated();
        if (state.user?.role === 'local-anonymous') {
            state.syncDisabled = true;
            renderLocalModeBadge();
            return;
        }
        if (!client) {
            state.syncDisabled = true; // not configured; page-state keeps working locally
            return;
        }
        state.client = client;

        const note = await ensureEncounter();
        if (note === null) {
            state.syncDisabled = true;
            return;
        }
        state.loadedNote = note;
        state.initialized = true;
        setupChannel(state.encounterId);
        maybeApplyInitial();
    }

    if (window.MiracleSupabase && window.MiracleAuth) {
        init();
    } else {
        console.error('[Miracle Sync] supabase-client.js and auth-gate.js must load before note-sync.js');
    }
})();
