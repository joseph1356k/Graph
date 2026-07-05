(function () {
    const CONTROL_SELECTOR = [
        'input',
        'textarea',
        'select',
        'button',
        'a',
        '[role="button"]',
        '[role="link"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[contenteditable="true"]'
    ].join(', ');
    const EXCLUDED_SURFACE_SELECTOR = [
        '#graph-assistant-shell',
        '#graph-assistant-bubble',
        '#graph-assistant-user-bubble',
        '#graph-assistant-chat-toggle',
        '#graph-assistant-chat-composer',
        '#graph-assistant-note-toggle',
        '#graph-assistant-note-panel',
        '#graph-assistant-spotlight',
        '#teaching-console',
        '#workflow-overlay',
        '#voice-toggle',
        '#miracle-auth-gate'
    ].join(', ');

    function resolveAdapter(config) {
        return window.GraphPluginAdapters?.resolve?.(config) || null;
    }

    function escapeAttributeSelectorValue(value) {
        return `${value || ''}`
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\r/g, '\\r')
            .replace(/\n/g, '\\n')
            .replace(/\f/g, '\\f');
    }

    function isCssSafeId(value) {
        return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(`${value || ''}`.trim());
    }

    function buildAttributeSelector(attributeName, attributeValue, tagName = '') {
        const name = `${attributeName || ''}`.trim();
        const value = `${attributeValue || ''}`;
        const tag = `${tagName || ''}`.trim().toLowerCase();
        if (!name || !value) {
            return tag;
        }
        return `${tag}[${name}="${escapeAttributeSelectorValue(value)}"]`;
    }

    function buildDomPathSelector(element) {
        const segments = [];
        let cursor = element;
        while (cursor instanceof Element && cursor !== document.body && segments.length < 5) {
            const tagName = cursor.tagName?.toLowerCase() || '';
            if (!tagName) break;
            if (cursor.id) {
                segments.unshift(isCssSafeId(cursor.id) ? `#${cursor.id}` : buildAttributeSelector('id', cursor.id));
                break;
            }
            const siblings = cursor.parentElement
                ? Array.from(cursor.parentElement.children).filter((candidate) => candidate.tagName === cursor.tagName)
                : [];
            const siblingIndex = siblings.indexOf(cursor);
            segments.unshift(siblings.length > 1 && siblingIndex >= 0
                ? `${tagName}:nth-of-type(${siblingIndex + 1})`
                : tagName);
            cursor = cursor.parentElement;
        }
        return segments.join(' > ');
    }

    function selectorForElement(element, fallback = '') {
        if (!(element instanceof Element)) {
            return fallback;
        }
        const tagName = element.tagName?.toLowerCase() || '';
        if (element.dataset?.testid) {
            return buildAttributeSelector('data-testid', element.dataset.testid);
        }
        if (element.dataset?.viewTarget) {
            return buildAttributeSelector('data-view-target', element.dataset.viewTarget, tagName);
        }
        if (element.id) {
            return isCssSafeId(element.id)
                ? `#${element.id}`
                : buildAttributeSelector('id', element.id);
        }
        if (element.getAttribute?.('name')) {
            return buildAttributeSelector('name', element.getAttribute('name'));
        }
        const href = element.getAttribute?.('href') || '';
        if (tagName === 'a' && href) {
            return buildAttributeSelector('href', href, 'a');
        }
        const role = element.getAttribute?.('role') || '';
        const ariaLabel = element.getAttribute?.('aria-label') || '';
        if (role && ariaLabel) {
            return `${buildAttributeSelector('role', role)}${buildAttributeSelector('aria-label', ariaLabel)}`;
        }
        return buildDomPathSelector(element) || fallback || tagName;
    }

    function labelForElement(element) {
        if (!(element instanceof Element)) {
            return '';
        }
        const explicitLabel = element.labels && element.labels.length > 0
            ? Array.from(element.labels).map((label) => label.textContent || '').join(' ').trim()
            : '';
        const labelledBy = `${element.getAttribute?.('aria-labelledby') || ''}`
            .split(/\s+/)
            .filter(Boolean)
            .map((id) => document.getElementById(id)?.textContent || '')
            .join(' ')
            .trim();
        const tagName = element.tagName?.toLowerCase() || '';
        const visibleText = ['button', 'a'].includes(tagName)
            || ['button', 'link', 'checkbox', 'radio'].includes(`${element.getAttribute?.('role') || ''}`.toLowerCase())
            ? `${element.textContent || ''}`.replace(/\s+/g, ' ').trim()
            : '';
        return (
            explicitLabel
            || element.getAttribute?.('aria-label')
            || labelledBy
            || element.getAttribute?.('title')
            || element.getAttribute?.('placeholder')
            || visibleText
            || element.getAttribute?.('name')
            || element.id
            || ''
        ).trim().slice(0, 180);
    }

    function getCurrentSurfaceSection() {
        const activeToggle = document.querySelector('[data-view-target].active');
        const activeTarget = `${activeToggle?.getAttribute?.('data-view-target') || ''}`.trim();
        if (activeTarget) {
            return activeTarget;
        }
        const visibleView = Array.from(document.querySelectorAll('[data-view]')).find((element) => {
            if (!(element instanceof Element) || element.hasAttribute('hidden')) {
                return false;
            }
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden';
        });
        return `${visibleView?.getAttribute?.('data-view') || ''}`.trim();
    }

    function inferSurfaceSection(element) {
        const nearest = `${element?.closest?.('[data-view]')?.getAttribute?.('data-view') || ''}`.trim();
        return nearest || getCurrentSurfaceSection();
    }

    function describeControlGroup(element) {
        const group = element?.closest?.(
            'fieldset, [data-control-group], [data-field-group], .form-card, .form-section-card, section'
        );
        if (!(group instanceof Element)) {
            return '';
        }
        const heading = group.querySelector?.(':scope > legend, :scope > h1, :scope > h2, :scope > h3, :scope > h4')
            || group.querySelector?.('legend, h1, h2, h3, h4');
        return (
            group.getAttribute?.('aria-label')
            || heading?.textContent
            || group.getAttribute?.('data-control-group')
            || group.getAttribute?.('data-field-group')
            || group.id
            || ''
        ).replace(/\s+/g, ' ').trim().slice(0, 180);
    }

    function isElementVisible(element) {
        if (!(element instanceof Element)) {
            return false;
        }
        if (element.closest('[hidden], [aria-hidden="true"]')) {
            return false;
        }
        if (element instanceof HTMLInputElement && element.type === 'hidden') {
            return false;
        }
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function isExcludedControl(element) {
        return Boolean(element instanceof Element && element.closest(EXCLUDED_SURFACE_SELECTOR));
    }

    function controlTypeForElement(element) {
        if (element instanceof HTMLSelectElement) return 'select';
        if (element instanceof HTMLTextAreaElement) return 'textarea';
        if (element instanceof HTMLInputElement) return element.type || 'input';
        if (element?.isContentEditable) return 'contenteditable';
        return `${element?.getAttribute?.('role') || element?.tagName || 'unknown'}`.toLowerCase();
    }

    function getAllowedOptions(element) {
        if (!(element instanceof HTMLSelectElement)) {
            return [];
        }
        return Array.from(element.options || []).slice(0, 80).map((option) => ({
            value: `${option.value || ''}`,
            label: (option.label || option.textContent || '').trim(),
            text: (option.textContent || option.label || '').trim()
        }));
    }

    function getControlMetadata(element) {
        const tagName = element?.tagName?.toLowerCase() || '';
        const inputType = element instanceof HTMLInputElement ? `${element.type || ''}`.toLowerCase() : '';
        const role = `${element?.getAttribute?.('role') || ''}`.toLowerCase();
        const checkable = ['checkbox', 'radio'].includes(inputType) || ['checkbox', 'radio'].includes(role);
        const selectedOption = element instanceof HTMLSelectElement
            ? element.options[element.selectedIndex]
            : null;
        const allowedOptions = getAllowedOptions(element);
        const value = element instanceof HTMLInputElement
            || element instanceof HTMLTextAreaElement
            || element instanceof HTMLSelectElement
            ? `${element.value || ''}`
            : (element?.isContentEditable ? `${element.textContent || ''}` : '');
        const checked = checkable
            ? Boolean(element.checked ?? element.getAttribute?.('aria-checked') === 'true')
            : false;
        const disabled = Boolean(element.disabled || element.getAttribute?.('aria-disabled') === 'true');
        const readOnly = Boolean(element.readOnly || element.getAttribute?.('aria-readonly') === 'true');
        const editableControl = element instanceof HTMLInputElement
            || element instanceof HTMLTextAreaElement
            || element instanceof HTMLSelectElement
            || Boolean(element?.isContentEditable);
        const clickableControl = element?.matches?.(
            'button, a, [role="button"], [role="link"], [role="checkbox"], [role="radio"], input[type="button"], input[type="submit"], input[type="reset"], input[type="checkbox"], input[type="radio"]'
        );

        return {
            controlType: controlTypeForElement(element),
            selectedValue: element instanceof HTMLSelectElement ? value : '',
            selectedLabel: selectedOption ? (selectedOption.label || selectedOption.textContent || '').trim() : '',
            allowedOptions,
            currentValue: checkable ? checked : value,
            checked,
            required: Boolean(element.required || element.getAttribute?.('aria-required') === 'true'),
            disabled,
            readOnly,
            editable: Boolean(editableControl && !disabled && !readOnly),
            clickable: Boolean(clickableControl && !disabled),
            visible: isElementVisible(element),
            tagName
        };
    }

    function buildControlSnapshot(element, index = 0) {
        const tagName = element.tagName?.toLowerCase() || '';
        const metadata = getControlMetadata(element);
        const options = metadata.allowedOptions.filter((option) => `${option.value || ''}`.trim());
        const value = typeof metadata.currentValue === 'string' ? metadata.currentValue : '';
        const nearestSurfaceSection = `${element?.closest?.('[data-view]')?.getAttribute?.('data-view') || ''}`.trim();
        const targetSurfaceSection = `${element?.getAttribute?.('data-view-target') || ''}`.trim();
        return {
            selector: selectorForElement(element, `${tagName}:nth-of-type(${index + 1})`),
            id: element.id || '',
            name: element.getAttribute?.('name') || '',
            testId: element.dataset?.testid || '',
            tagName,
            type: element.getAttribute?.('type') || '',
            role: element.getAttribute?.('role') || '',
            label: labelForElement(element),
            text: (element.textContent || element.value || '').replace(/\s+/g, ' ').trim().slice(0, 180),
            value,
            href: element.getAttribute?.('href') || '',
            optionCount: options.length,
            options,
            surfaceSection: nearestSurfaceSection || targetSurfaceSection,
            group: describeControlGroup(element),
            ...metadata
        };
    }

    function controlPriority(control, currentSurfaceSection) {
        if (control.visible && control.surfaceSection && control.surfaceSection === currentSurfaceSection) return 4;
        if (control.visible && !control.surfaceSection) return 3;
        if (control.visible) return 2;
        if (control.surfaceSection && control.surfaceSection === currentSurfaceSection) return 1;
        return 0;
    }

    function capturePageSnapshot() {
        const currentSurfaceSection = getCurrentSurfaceSection();
        const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
            .filter((node) => !isExcludedControl(node))
            .map((node) => (node.textContent || '').trim())
            .filter(Boolean)
            .slice(0, 12);
        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a, [role="button"]'))
            .filter((node) => !isExcludedControl(node))
            .map((node) => (node.textContent || node.value || node.getAttribute?.('aria-label') || '').trim())
            .filter(Boolean)
            .slice(0, 20);
        const fieldLabels = Array.from(document.querySelectorAll('label'))
            .filter((node) => !isExcludedControl(node))
            .map((node) => (node.textContent || '').trim())
            .filter(Boolean)
            .slice(0, 40);
        const allControls = Array.from(document.querySelectorAll(CONTROL_SELECTOR))
            .filter((element, index, entries) => entries.indexOf(element) === index)
            .filter((element) => !isExcludedControl(element))
            .map((element, index) => ({ ...buildControlSnapshot(element, index), __index: index }))
            .sort((left, right) => {
                const priorityDifference = controlPriority(right, currentSurfaceSection)
                    - controlPriority(left, currentSurfaceSection);
                return priorityDifference || left.__index - right.__index;
            });
        const controlLimit = 120;
        const controls = allControls.slice(0, controlLimit).map(({ __index, ...control }) => control);
        const selects = controls
            .filter((control) => control.tagName === 'select')
            .map((control) => ({
                selector: control.selector,
                label: control.label,
                value: control.value,
                optionCount: control.optionCount,
                options: control.options
            }));
        const forms = Array.from(document.querySelectorAll('form'))
            .filter((form) => !isExcludedControl(form))
            .slice(0, 8)
            .map((form, index) => ({
                id: form.id || '',
                action: form.getAttribute('action') || '',
                fieldCount: form.querySelectorAll('input, textarea, select').length,
                index
            }));

        return {
            pageTitle: document.title || '',
            currentSurfaceSection,
            headings,
            buttons,
            fieldLabels,
            selects,
            controls,
            totalControlCount: allControls.length,
            controlsTruncated: allControls.length > controlLimit,
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
        const merged = { ...baseContext, ...(overrides || {}) };
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
        filterWorkflows,
        selectorForElement,
        labelForElement,
        getCurrentSurfaceSection,
        inferSurfaceSection,
        controlTypeForElement,
        getAllowedOptions,
        getControlMetadata,
        buildControlSnapshot,
        isExcludedControl
    };
})();
