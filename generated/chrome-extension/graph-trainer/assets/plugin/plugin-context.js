(function () {
    function resolveAdapter(config) {
        return window.GraphPluginAdapters?.resolve?.(config) || null;
    }
    function buildSnapshotSelector(element, fallback = '') {
        if (!element) {
            return fallback;
        }
        if (element.id) {
            return `#${element.id}`;
        }
        if (element.name) {
            return `[name="${element.name}"]`;
        }
        const href = element.getAttribute?.('href') || '';
        if (element.tagName?.toLowerCase() === 'a' && href) {
            return `a[href="${href.replace(/"/g, '\\"')}"]`;
        }
        return fallback || element.tagName?.toLowerCase() || '';
    }

    function buildControlSnapshot(element, index = 0) {
        const tagName = element.tagName?.toLowerCase() || '';
        const selector = buildSnapshotSelector(element, `${tagName}:nth-of-type(${index + 1})`);
        const label = element.id
            ? document.querySelector(`label[for="${element.id}"]`)?.textContent?.trim()
            : '';
        const options = tagName === 'select'
            ? Array.from(element.options || [])
                .filter((option) => `${option.value || ''}`.trim())
                .slice(0, 20)
                .map((option) => ({
                    value: `${option.value || ''}`.trim(),
                    label: (option.label || option.text || '').trim(),
                    text: (option.text || option.label || '').trim()
                }))
            : [];

        return {
            selector,
            tagName,
            type: element.getAttribute?.('type') || '',
            role: element.getAttribute?.('role') || '',
            label: label
                || element.getAttribute?.('aria-label')
                || element.getAttribute?.('placeholder')
                || element.name
                || element.id
                || '',
            text: (element.textContent || element.value || '').trim().slice(0, 180),
            value: tagName === 'select' || tagName === 'input' || tagName === 'textarea' ? `${element.value || ''}` : '',
            href: element.getAttribute?.('href') || '',
            optionCount: options.length,
            options
        };
    }

    function capturePageSnapshot() {
        const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
            .map((node) => (node.textContent || '').trim())
            .filter(Boolean)
            .slice(0, 8);

        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a'))
            .map((node) => (node.textContent || node.value || node.getAttribute?.('aria-label') || '').trim())
            .filter(Boolean)
            .slice(0, 12);

        const fieldLabels = Array.from(document.querySelectorAll('label'))
            .map((node) => (node.textContent || '').trim())
            .filter(Boolean)
            .slice(0, 16);

        const selects = Array.from(document.querySelectorAll('select'))
            .slice(0, 10)
            .map((element) => ({
                selector: element.id ? `#${element.id}` : (element.name ? `[name="${element.name}"]` : 'select'),
                label: document.querySelector(`label[for="${element.id}"]`)?.textContent?.trim()
                    || element.getAttribute('aria-label')
                    || element.name
                    || element.id
                    || '',
                value: element.value || '',
                optionCount: Array.from(element.options || []).filter((option) => `${option.value || ''}`.trim()).length,
                options: Array.from(element.options || [])
                    .filter((option) => `${option.value || ''}`.trim())
                    .slice(0, 20)
                    .map((option) => ({
                        value: `${option.value || ''}`.trim(),
                        label: (option.label || option.text || '').trim(),
                        text: (option.text || option.label || '').trim()
                    }))
            }));

        const controls = Array.from(document.querySelectorAll('input, textarea, select, button, a, [role="button"]'))
            .slice(0, 40)
            .map((element, index) => buildControlSnapshot(element, index));

        const forms = Array.from(document.querySelectorAll('form'))
            .slice(0, 6)
            .map((form, index) => ({
                id: form.id || '',
                action: form.getAttribute('action') || '',
                fieldCount: form.querySelectorAll('input, textarea, select').length,
                index
            }));

        return {
            pageTitle: document.title || '',
            headings,
            buttons,
            fieldLabels,
            selects,
            controls,
            forms
        };
    }

    function buildPageContext(config, overrides) {
        const adapter = resolveAdapter(config);
        const normalizePathname = window.GraphPluginAdapters?.normalizePathname;
        const baseContext = {
            appId: config?.appId || '',
            sourceUrl: window.location.href,
            sourceOrigin: window.location.origin,
            sourcePathname: typeof normalizePathname === 'function'
                ? normalizePathname(window.location.pathname)
                : window.location.pathname,
            sourceTitle: document.title,
            browserLocale: navigator.language || '',
            browserLanguages: Array.isArray(navigator.languages) ? navigator.languages.slice(0, 5) : [],
            assistantProfile: config?.assistantProfile || null,
            assistantPrompt: config?.assistantPrompt || '',
            surfaceProfileId: config?.surfaceProfile?.id || '',
            surfaceProfileScope: config?.surfaceProfile?.scope || 'global',
            ownerId: config?.surfaceProfile?.ownerId || '',
            languageCode: config?.surfaceProfile?.languageCode || (navigator.language || 'es').split(/[-_]/)[0].toLowerCase()
        };

        const merged = {
            ...baseContext,
            ...(overrides || {})
        };

        if (!adapter || typeof adapter.decorateContext !== 'function') {
            return merged;
        }

        return adapter.decorateContext(merged);
    }

    function filterWorkflows(workflows, config, contextOverrides) {
        const adapter = resolveAdapter(config);
        const context = buildPageContext(config, contextOverrides);
        if (!adapter || typeof adapter.filterWorkflows !== 'function') {
            return workflows || [];
        }
        return adapter.filterWorkflows(workflows || [], context);
    }

    window.GraphPluginContext = {
        buildPageContext,
        capturePageSnapshot,
        filterWorkflows
    };
})();
