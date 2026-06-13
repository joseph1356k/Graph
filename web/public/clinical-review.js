(function () {
    // Clinical safety layer. Every value the AI writes into the note arrives as a
    // 'miracle-field-change' event with source:'ai' (see page-state.js). We mark those
    // fields as "proposed / unconfirmed" with their evidence, let the clinician confirm
    // (or edit) them, and block finalizing the note while any remain unconfirmed.
    const LOW_CONFIDENCE = 0.85;
    const unconfirmed = new Map(); // fieldId -> { evidence, confidence }
    let stepIndex = 0;

    function injectStyles() {
        if (document.getElementById('miracle-review-styles')) return;
        const style = document.createElement('style');
        style.id = 'miracle-review-styles';
        style.textContent = [
            '.miracle-unconfirmed{outline:2px solid #f59e0b !important;outline-offset:1px;background-color:rgba(245,158,11,0.10) !important;transition:outline-color .2s;}',
            '.miracle-unconfirmed.miracle-lowconf{outline-color:#ef4444 !important;background-color:rgba(239,68,68,0.12) !important;}',
            '#miracle-review-chip{position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:2147482500;display:none;align-items:center;gap:10px;padding:10px 14px;border-radius:999px;background:#7c2d12;color:#fff;font:600 13px Inter,system-ui,sans-serif;box-shadow:0 14px 30px rgba(0,0,0,.28);}',
            '#miracle-review-chip button{border:0;border-radius:999px;padding:6px 12px;font:inherit;font-weight:700;cursor:pointer;}',
            '#miracle-review-next{background:#fff;color:#7c2d12;}',
            '#miracle-review-all{background:#22c55e;color:#06230f;}'
        ].join('');
        document.head.appendChild(style);
    }

    function buildChip() {
        let chip = document.getElementById('miracle-review-chip');
        if (chip) return chip;
        chip = document.createElement('div');
        chip.id = 'miracle-review-chip';
        const label = document.createElement('span');
        label.id = 'miracle-review-label';
        const next = document.createElement('button');
        next.id = 'miracle-review-next';
        next.type = 'button';
        next.textContent = 'Revisar';
        next.addEventListener('click', stepToNext);
        const all = document.createElement('button');
        all.id = 'miracle-review-all';
        all.type = 'button';
        all.textContent = 'Confirmar todo';
        all.addEventListener('click', confirmAll);
        chip.append(label, next, all);
        (document.body || document.documentElement).appendChild(chip);
        return chip;
    }

    function updateChip() {
        const chip = buildChip();
        const label = document.getElementById('miracle-review-label');
        if (unconfirmed.size === 0) {
            chip.style.display = 'none';
            return;
        }
        if (label) label.textContent = `⚠️ ${unconfirmed.size} campo(s) sin confirmar`;
        chip.style.display = 'flex';
    }

    function describe(meta) {
        const parts = ['Propuesto por IA'];
        if (meta.evidence) parts.push(meta.evidence);
        if (typeof meta.confidence === 'number') parts.push(`confianza ${Math.round(meta.confidence * 100)}%`);
        return `${parts.join(' · ')}. Revisa y confirma.`;
    }

    function mark(id, meta) {
        const element = document.getElementById(id);
        if (!element) return;
        element.classList.add('miracle-unconfirmed');
        if (typeof meta.confidence === 'number' && meta.confidence < LOW_CONFIDENCE) {
            element.classList.add('miracle-lowconf');
        } else {
            element.classList.remove('miracle-lowconf');
        }
        element.title = describe(meta);
        unconfirmed.set(id, meta);
        updateChip();
    }

    function unmark(id) {
        const element = document.getElementById(id);
        if (element) {
            element.classList.remove('miracle-unconfirmed', 'miracle-lowconf');
            if (element.title && element.title.startsWith('Propuesto por IA')) element.title = '';
        }
        unconfirmed.delete(id);
        updateChip();
    }

    function confirmAll() {
        Array.from(unconfirmed.keys()).forEach(unmark);
    }

    function stepToNext() {
        const ids = Array.from(unconfirmed.keys());
        if (ids.length === 0) return;
        stepIndex = stepIndex % ids.length;
        const element = document.getElementById(ids[stepIndex]);
        stepIndex += 1;
        if (!element) return;
        element.scrollIntoView({ block: 'center', behavior: 'smooth' });
        try { element.focus({ preventScroll: true }); } catch (error) { /* ignore */ }
    }

    // Block finalizing the note while there are unconfirmed AI values.
    function looksLikeFinalize(target) {
        const el = target.closest && target.closest('button, [role="button"], input[type="submit"]');
        if (!el) return false;
        const text = `${el.id || ''} ${el.textContent || ''} ${el.value || ''}`.toLowerCase();
        return /finaliz|firmar|cerrar\s*caso|guardar\s*nota|enviar\s*nota|enviar\s*orden/.test(text);
    }

    document.addEventListener('miracle-field-change', (event) => {
        const detail = event.detail || {};
        if (!detail.id) return;
        if (detail.source === 'ai') {
            const hasValue = detail.value !== '' && detail.value != null && detail.value !== false;
            if (hasValue) {
                mark(detail.id, { evidence: detail.evidence || '', confidence: detail.confidence });
            } else {
                unmark(detail.id);
            }
        } else if (detail.source === 'human') {
            // A human edited the field -> treat as reviewed/confirmed.
            if (unconfirmed.has(detail.id)) unmark(detail.id);
        }
    });

    document.addEventListener('click', (event) => {
        if (unconfirmed.size === 0) return;
        if (looksLikeFinalize(event.target)) {
            event.preventDefault();
            event.stopPropagation();
            const chip = buildChip();
            chip.animate(
                [{ transform: 'translateX(-50%) scale(1)' }, { transform: 'translateX(-50%) scale(1.08)' }, { transform: 'translateX(-50%) scale(1)' }],
                { duration: 320 }
            );
            stepToNext();
        }
    }, true);

    window.MiracleReview = {
        hasUnconfirmed() { return unconfirmed.size > 0; },
        getUnconfirmed() { return Array.from(unconfirmed.keys()); },
        confirmAll
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectStyles, { once: true });
    } else {
        injectStyles();
    }
})();
