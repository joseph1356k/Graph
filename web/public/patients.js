(function () {
    // Patient / encounter picker for the EMR. When no ?encounter= is selected,
    // note-sync defers to this module: the clinician picks or creates a patient and
    // an encounter, and we reload with ?encounter=<id> so note-sync loads that note.
    const state = { client: null, user: null, overlay: null, patients: [], expanded: null };

    async function ensureContext() {
        if (state.client && state.user) return true;
        state.client = await window.MiracleSupabase.whenReady();
        if (!state.client) return false;
        state.user = await window.MiracleAuth.whenAuthenticated();
        return Boolean(state.user);
    }

    function el(tag, props, children) {
        const node = document.createElement(tag);
        Object.assign(node, props || {});
        if (props && props.style) node.style.cssText = props.style;
        (children || []).forEach((child) => node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child));
        return node;
    }

    function openEncounter(id) {
        const url = new URL(window.location.href);
        url.searchParams.set('encounter', id);
        window.location.href = url.toString();
    }

    async function loadPatients() {
        const { data, error } = await state.client
            .from('patients')
            .select('id, name, mrn, created_at')
            .order('created_at', { ascending: false });
        state.patients = (!error && Array.isArray(data)) ? data : [];
    }

    async function loadEncounters(patientId) {
        const { data } = await state.client
            .from('encounters')
            .select('id, label, updated_at')
            .eq('patient_id', patientId)
            .order('updated_at', { ascending: false });
        return Array.isArray(data) ? data : [];
    }

    async function createPatient(name, mrn) {
        const { data, error } = await state.client
            .from('patients')
            .insert({ name, mrn: mrn || null })
            .select('id')
            .single();
        if (error) { alert('No se pudo crear el paciente: ' + error.message); return null; }
        return data.id;
    }

    async function createEncounter(patientId) {
        const label = 'Encuentro ' + new Date().toLocaleString();
        const { data, error } = await state.client
            .from('encounters')
            .insert({ label, patient_id: patientId })
            .select('id')
            .single();
        if (error) { alert('No se pudo crear el encuentro: ' + error.message); return null; }
        return data.id;
    }

    function buttonStyle(bg, fg) {
        return `border:0;border-radius:10px;padding:9px 12px;font:inherit;font-weight:700;cursor:pointer;background:${bg};color:${fg};`;
    }

    async function renderEncounters(patient, container) {
        container.textContent = 'Cargando…';
        const encounters = await loadEncounters(patient.id);
        container.textContent = '';
        if (encounters.length === 0) {
            container.appendChild(el('div', { style: 'color:#64748b;font-size:13px;padding:4px 0;' }, ['Sin encuentros previos.']));
        }
        encounters.forEach((enc) => {
            const row = el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid #eef2f7;' }, [
                el('span', { style: 'font-size:13px;color:#334155;' }, [enc.label || 'Encuentro']),
                el('button', { type: 'button', style: buttonStyle('#eef2ff', '#2f4fff'), onclick: () => openEncounter(enc.id) }, ['Abrir'])
            ]);
            container.appendChild(row);
        });
        const newBtn = el('button', { type: 'button', style: buttonStyle('#2f8cff', '#fff') + 'margin-top:8px;width:100%;', onclick: async () => {
            const id = await createEncounter(patient.id);
            if (id) openEncounter(id);
        } }, ['+ Nuevo encuentro']);
        container.appendChild(newBtn);
    }

    function renderPatients(listNode) {
        listNode.textContent = '';
        if (state.patients.length === 0) {
            listNode.appendChild(el('div', { style: 'color:#64748b;font-size:13px;' }, ['Aún no tienes pacientes. Crea el primero abajo.']));
            return;
        }
        state.patients.forEach((patient) => {
            const encWrap = el('div', { style: 'margin-top:8px;display:none;' }, []);
            const header = el('button', {
                type: 'button',
                style: 'width:100%;text-align:left;border:1px solid #e2e8f0;border-radius:12px;padding:12px;background:#fff;cursor:pointer;font:inherit;',
                onclick: async () => {
                    const isOpen = encWrap.style.display !== 'none';
                    encWrap.style.display = isOpen ? 'none' : 'block';
                    if (!isOpen) await renderEncounters(patient, encWrap);
                }
            }, [
                el('div', { style: 'font-weight:700;color:#0f172a;' }, [patient.name || 'Paciente']),
                el('div', { style: 'font-size:12px;color:#64748b;' }, [patient.mrn ? ('HC: ' + patient.mrn) : 'Toca para ver / crear encuentros'])
            ]);
            listNode.appendChild(el('div', {}, [header, encWrap]));
        });
    }

    function buildOverlay() {
        const overlay = el('div', { id: 'miracle-patient-picker', style: [
            'position:fixed', 'inset:0', 'z-index:2147482800', 'display:grid', 'place-items:center',
            'background:rgba(15,23,42,0.55)', 'backdrop-filter:blur(6px)',
            'font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif'
        ].join(';') }, []);

        const card = el('div', { style: [
            'width:min(460px,calc(100vw - 32px))', 'max-height:calc(100vh - 48px)', 'overflow:auto',
            'background:#fff', 'color:#0f172a', 'border-radius:20px', 'padding:24px',
            'box-shadow:0 32px 90px rgba(15,23,42,0.25)', 'display:grid', 'gap:14px'
        ].join(';') }, []);

        card.appendChild(el('h2', { style: 'margin:0;font-size:20px;font-weight:800;' }, ['Elige un paciente']));
        card.appendChild(el('p', { style: 'margin:0;color:#64748b;font-size:13px;line-height:1.5;' }, ['Abre un encuentro para empezar la nota. Todo queda guardado y sincronizado por paciente.']));

        const list = el('div', { id: 'miracle-patient-list', style: 'display:grid;gap:10px;' }, []);
        renderPatients(list);
        card.appendChild(list);

        // New patient form
        const nameInput = el('input', { type: 'text', placeholder: 'Nombre del paciente', style: 'border:1px solid #e2e8f0;border-radius:10px;padding:11px;font:inherit;' });
        const mrnInput = el('input', { type: 'text', placeholder: 'N.º de historia (opcional)', style: 'border:1px solid #e2e8f0;border-radius:10px;padding:11px;font:inherit;' });
        const createBtn = el('button', { type: 'button', style: buttonStyle('#13795b', '#fff'), onclick: async () => {
            const name = nameInput.value.trim();
            if (!name) { nameInput.focus(); return; }
            createBtn.disabled = true; createBtn.textContent = 'Creando…';
            const patientId = await createPatient(name, mrnInput.value.trim());
            if (patientId) {
                const encId = await createEncounter(patientId);
                if (encId) { openEncounter(encId); return; }
            }
            createBtn.disabled = false; createBtn.textContent = 'Crear paciente y abrir encuentro';
        } }, ['Crear paciente y abrir encuentro']);

        const form = el('div', { style: 'display:grid;gap:8px;border-top:1px solid #eef2f7;padding-top:14px;' }, [
            el('div', { style: 'font-weight:700;font-size:14px;' }, ['Nuevo paciente']),
            nameInput, mrnInput, createBtn
        ]);
        card.appendChild(form);

        overlay.appendChild(card);
        return overlay;
    }

    async function open() {
        if (!(await ensureContext())) return;
        await loadPatients();
        if (state.overlay && state.overlay.isConnected) state.overlay.remove();
        state.overlay = buildOverlay();
        (document.body || document.documentElement).appendChild(state.overlay);
    }

    function close() {
        if (state.overlay) state.overlay.style.display = 'none';
    }

    window.MiraclePatients = { open, close };
})();
