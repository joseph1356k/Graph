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
            '.miracle-unconfirmed.miracle-lowconf{outline-color:#ef4444 !important;background-color:rgba(239,68,68,0.12) !important;}'
        ].join('');
        document.head.appendChild(style);
    }

    function updateChip() {
        // Bottom review chip removed by design: the note panel already reports how
        // many fields need confirmation, so no floating bar is shown anymore.
        const chip = document.getElementById('miracle-review-chip');
        if (chip) chip.remove();
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
