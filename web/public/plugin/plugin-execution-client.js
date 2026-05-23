(function () {
    function create(deps = {}) {
        const getOptions = typeof deps.getOptions === 'function' ? deps.getOptions : () => ({});
        const getPluginHost = typeof deps.getPluginHost === 'function' ? deps.getPluginHost : () => null;
        const runtime = typeof deps.runtime === 'function' ? deps.runtime : () => null;
        const emitPluginEvent = typeof deps.emitPluginEvent === 'function' ? deps.emitPluginEvent : () => {};
        const updateWorkflowPanelStatus = typeof deps.updateWorkflowPanelStatus === 'function' ? deps.updateWorkflowPanelStatus : () => {};
        const requestRuntimeIntelligence = typeof deps.requestRuntimeIntelligence === 'function' ? deps.requestRuntimeIntelligence : null;
        const executionState = deps.executionState || { running: false, cancelRequested: false, workflowId: '' };
        const executionStoragePrefix = deps.executionStoragePrefix || 'graph-browser-workflow-execution-v1';
        const waitTimeoutMs = Number.isFinite(deps.waitTimeoutMs) ? deps.waitTimeoutMs : 15000;
        const stepDelayMs = Number.isFinite(deps.stepDelayMs) ? deps.stepDelayMs : 180;
        const emittedDiagnostics = new Set();

        function cloneJson(value) {
            return JSON.parse(JSON.stringify(value));
        }

        function getExecutionStorageKey() {
            return `${executionStoragePrefix}:${getOptions()?.appId || 'page'}`;
        }

        function readPendingExecution() {
            try {
                const raw = getPluginHost()?.sessionStore?.get(getExecutionStorageKey()) || '';
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                if (!parsed || !parsed.workflowId || !Array.isArray(parsed.steps)) {
                    return null;
                }
                return parsed;
            } catch (error) {
                return null;
            }
        }

        function persistPendingExecution(plan) {
            try {
                getPluginHost()?.sessionStore?.set(getExecutionStorageKey(), JSON.stringify(plan || {}));
            } catch (error) {
                // Ignore session storage failures.
            }
        }

        function clearPendingExecution() {
            getPluginHost()?.sessionStore?.remove(getExecutionStorageKey());
        }

        function normalizeExecutionUrl(rawUrl) {
            if (!rawUrl) {
                return '';
            }
            try {
                const parsed = new URL(rawUrl, window.location.href);
                return `${parsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
            } catch (error) {
                return `${rawUrl || ''}`.trim();
            }
        }

        function urlsMatch(left, right) {
            return normalizeExecutionUrl(left) === normalizeExecutionUrl(right);
        }

        function describeStep(step) {
            if (!step) return 'workflow';
            return step.label || step.selector || step.url || step.actionType || 'workflow';
        }

        function buildStepDiagnostics(step, extra = {}) {
            return {
                workflowId: extra.workflowId || '',
                trigger: extra.trigger || '',
                stepIndex: Number.isFinite(extra.stepIndex) ? extra.stepIndex : null,
                stepOrder: Number.isFinite(step?.stepOrder) ? step.stepOrder : null,
                actionType: step?.actionType || '',
                selector: step?.selector || '',
                label: step?.label || '',
                expectedUrl: step?.url || '',
                currentUrl: window.location.href,
                ...extra
            };
        }

        function buildDiagnosticKey(level, message, step, extra = {}) {
            return JSON.stringify({
                level: `${level || 'info'}`.trim().toLowerCase(),
                message: `${message || ''}`.trim(),
                workflowId: extra.workflowId || '',
                trigger: extra.trigger || '',
                stepOrder: Number.isFinite(step?.stepOrder) ? step.stepOrder : null,
                stepIndex: Number.isFinite(extra.stepIndex) ? extra.stepIndex : null,
                actionType: step?.actionType || '',
                selector: step?.selector || '',
                failureKind: extra.failureKind || '',
                resolution: extra.resolution || ''
            });
        }

        function emitStepDiagnosticOnce(level, message, step, extra = {}) {
            const key = buildDiagnosticKey(level, message, step, extra);
            if (emittedDiagnostics.has(key)) {
                return;
            }
            emittedDiagnostics.add(key);
            emitExtensionLog(level, message, buildStepDiagnostics(step, extra));
        }

        function safeQuerySelector(selector) {
            if (!selector) {
                return { element: null, error: null };
            }

            try {
                return {
                    element: document.querySelector(selector),
                    error: null
                };
            } catch (error) {
                return {
                    element: null,
                    error
                };
            }
        }

        function safeQuerySelectorAll(selector) {
            if (!selector) {
                return { elements: [], error: null };
            }

            try {
                return {
                    elements: Array.from(document.querySelectorAll(selector)),
                    error: null
                };
            } catch (error) {
                return {
                    elements: [],
                    error
                };
            }
        }

        function isElementVisible(element) {
            if (!element || !(element instanceof Element)) {
                return false;
            }

            const style = window.getComputedStyle(element);
            if (!style || style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
                return false;
            }

            const rect = element.getBoundingClientRect();
            if (!rect || rect.width <= 0 || rect.height <= 0) {
                return false;
            }

            return true;
        }

        function isElementActionable(element) {
            if (!isElementVisible(element)) {
                return false;
            }

            if ('disabled' in element && element.disabled) {
                return false;
            }

            if (element.getAttribute?.('aria-hidden') === 'true') {
                return false;
            }

            return true;
        }

        function normalizePlaceholderText(value) {
            return `${value || ''}`
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();
        }

        function isPlaceholderSelectValue(value) {
            const normalized = normalizePlaceholderText(value)
                .replace(/^-+/, '')
                .replace(/-+$/, '')
                .trim();

            if (!normalized) {
                return true;
            }

            return [
                'seleccionar',
                'select',
                'complemento',
                'escoge hora',
                'elige',
                'seleccione'
            ].some((token) => normalized === token || normalized.includes(token));
        }

        function isRequiredFieldLabel(label = '') {
            return `${label || ''}`.trim().startsWith('*');
        }

        function resetSurfaceStateForFreshExecution() {
            try {
                const pageState = window.PageState?.current || window.PageState || window.EMRState;
                if (pageState && typeof pageState.clearAll === 'function') {
                    pageState.clearAll();
                }
            } catch (error) {
                // Ignore state reset failures.
            }
        }

        function captureSurfaceSnapshot() {
            try {
                return window.GraphPluginContext?.capturePageSnapshot?.() || null;
            } catch (error) {
                return null;
            }
        }

        function normalizeSemanticTargetText(value) {
            return `${value || ''}`
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();
        }

        function getTransversalTargetOverride(step, variables = {}) {
            if (`${step?.actionType || ''}`.trim().toLowerCase() !== 'click') {
                return '';
            }

            const key = `target_${step?.stepOrder}`;
            const requested = `${variables?.[key] || ''}`.trim();
            const baseline = `${step?.transversalSourceTarget || step?.semanticTarget || step?.label || ''}`.trim();
            if (!requested || !baseline) {
                return '';
            }

            return normalizeSemanticTargetText(requested) === normalizeSemanticTargetText(baseline)
                ? ''
                : requested;
        }

        function getSemanticTextCandidates(element) {
            if (!element || !(element instanceof Element)) {
                return [];
            }

            const directHeading = element.querySelector?.('h1, h2, h3, h4, h5, h6');
            const directImage = element.querySelector?.('img[alt]');
            const closestContainer = element.closest?.('article, li, [class*="card"], [class*="item"], [class*="product"], [data-testid], [data-product], section');
            const containerHeading = closestContainer?.querySelector?.('h1, h2, h3, h4, h5, h6');
            const containerImage = closestContainer?.querySelector?.('img[alt]');
            const normalize = (value) => `${value || ''}`.replace(/\s+/g, ' ').trim();

            return [
                element.getAttribute?.('aria-label') || '',
                element.getAttribute?.('title') || '',
                directHeading?.textContent || '',
                directImage?.getAttribute?.('alt') || '',
                element.textContent || '',
                containerHeading?.textContent || '',
                containerImage?.getAttribute?.('alt') || '',
                closestContainer?.textContent || ''
            ].map(normalize).filter(Boolean);
        }

        function scoreTransversalTargetCandidate(element, targetText = '', preferredElement = null) {
            const target = normalizeSemanticTargetText(targetText);
            if (!target) {
                return -1;
            }

            let score = 0;
            const candidateTexts = getSemanticTextCandidates(element).map((entry) => normalizeSemanticTargetText(entry));
            const targetTokens = target.split(/\s+/).filter((token) => token.length >= 3);

            candidateTexts.forEach((candidateText, index) => {
                if (!candidateText) {
                    return;
                }
                if (candidateText === target) {
                    score = Math.max(score, 500 - (index * 10));
                    return;
                }
                if (candidateText.includes(target) || target.includes(candidateText)) {
                    score = Math.max(score, 320 - (index * 8));
                }
                const overlapCount = targetTokens.filter((token) => candidateText.includes(token)).length;
                score = Math.max(score, (overlapCount * 45) - (index * 6));
            });

            if (preferredElement) {
                if (preferredElement.tagName === element.tagName) {
                    score += 25;
                }

                const preferredClasses = new Set(Array.from(preferredElement.classList || []));
                const sharedClasses = Array.from(element.classList || []).filter((className) => preferredClasses.has(className)).length;
                score += sharedClasses * 8;
            }

            return score;
        }

        function resolveElementFromTransversalTarget(step, variables = {}) {
            const override = getTransversalTargetOverride(step, variables);
            if (!override) {
                return null;
            }

            const preferredElement = step?.selector
                ? (safeQuerySelectorAll(step.selector).elements || []).find(isElementActionable) || null
                : null;
            const candidates = Array.from(document.querySelectorAll('a, button, [role="button"], input[type="button"], input[type="submit"]'))
                .filter(isElementActionable);

            let bestElement = null;
            let bestScore = -1;
            candidates.forEach((candidate) => {
                const score = scoreTransversalTargetCandidate(candidate, override, preferredElement);
                if (score > bestScore) {
                    bestScore = score;
                    bestElement = candidate;
                }
            });

            if (bestElement && bestScore >= 90) {
                emitExtensionLog('info', 'Resolved workflow step by transversal target override.', buildStepDiagnostics(step, {
                    resolution: 'transversal_target',
                    transversalTarget: override,
                    transversalSourceTarget: `${step?.transversalSourceTarget || step?.semanticTarget || step?.label || ''}`.trim()
                }));
                return bestElement;
            }

            return null;
        }

        function resolveElementFromStep(step) {
            if (!step?.selector) {
                return null;
            }

            const directResult = safeQuerySelectorAll(step.selector);
            if (directResult.error) {
                emitStepDiagnosticOnce('error', 'Invalid selector while resolving workflow step.', step, {
                    failureKind: 'invalid_selector',
                    selectorError: directResult.error?.message || 'Invalid selector'
                });
            }

            const directMatch = (directResult.elements || []).find(isElementActionable) || null;
            if (directMatch) {
                emitExtensionLog('info', 'Resolved workflow step by selector.', buildStepDiagnostics(step, {
                    resolution: 'selector'
                }));
                return directMatch;
            }

            if (!step?.label) {
                return null;
            }

            const matches = Array.from(document.querySelectorAll('input, textarea, select, button, a'));
            const fallbackMatch = matches.find((element) => {
                if (!isElementActionable(element)) {
                    return false;
                }
                const text = (element.textContent || element.value || element.getAttribute('aria-label') || '').trim();
                return text === step.label;
            }) || null;

            if (fallbackMatch) {
                emitStepDiagnosticOnce('warn', 'Resolved workflow step by label fallback after selector miss.', step, {
                    failureKind: directResult.error ? 'invalid_selector' : 'selector_not_found',
                    resolution: 'label_fallback'
                });
            }

            return fallbackMatch;
        }

        function resolveStepSilently(step, variables = {}) {
            const transversalMatch = resolveElementFromTransversalTarget(step, variables);
            if (transversalMatch) {
                return transversalMatch;
            }

            if (!step?.selector) {
                return null;
            }

            const directResult = safeQuerySelectorAll(step.selector);
            const directMatch = (directResult.elements || []).find(isElementActionable) || null;
            if (directMatch) {
                return directMatch;
            }

            if (!step?.label) {
                return null;
            }

            const matches = Array.from(document.querySelectorAll('input, textarea, select, button, a'));
            return matches.find((element) => {
                if (!isElementActionable(element)) {
                    return false;
                }
                const text = (element.textContent || element.value || element.getAttribute('aria-label') || '').trim();
                return text === step.label;
            }) || null;
        }

        function canResolveStepImmediately(step, variables = {}) {
            return Boolean(resolveStepSilently(step, variables));
        }

        function getViewportHeight() {
            return Math.max(window.innerHeight || 0, document.documentElement?.clientHeight || 0, 640);
        }

        function getDocumentScrollHeight() {
            return Math.max(
                document.body?.scrollHeight || 0,
                document.documentElement?.scrollHeight || 0,
                getViewportHeight()
            );
        }

        async function nudgeSurfaceForStepDiscovery(step, options = {}) {
            const direction = options.direction === 'up' ? -1 : 1;
            const ratio = Number.isFinite(options.ratio) ? options.ratio : 0.75;
            const distance = Math.max(120, Math.round(getViewportHeight() * ratio)) * direction;

            window.scrollBy({
                top: distance,
                left: 0,
                behavior: 'auto'
            });
            await waitMs(180);

            const resolved = resolveStepSilently(step, options.variables || {});
            if (resolved) {
                try {
                    resolved.scrollIntoView({ block: 'center', inline: 'nearest' });
                } catch (error) {
                    // Ignore scroll alignment issues.
                }
                emitExtensionLog('info', 'Discovered workflow target after scrolling the surface.', buildStepDiagnostics(step, {
                    resolution: direction > 0 ? 'scroll_discovery_down' : 'scroll_discovery_up',
                    scrollY: window.scrollY || window.pageYOffset || 0
                }));
            }

            return resolved;
        }

        async function sweepSurfaceForStep(step, variables = {}) {
            const maxScroll = Math.max(0, getDocumentScrollHeight() - getViewportHeight());
            const initialScrollY = window.scrollY || window.pageYOffset || 0;
            const maxDownSweeps = Math.max(1, Math.ceil(maxScroll / Math.max(1, Math.round(getViewportHeight() * 0.75))));

            for (let index = 0; index < maxDownSweeps; index += 1) {
                const resolved = await nudgeSurfaceForStepDiscovery(step, { direction: 'down', variables });
                if (resolved) {
                    return resolved;
                }
                if ((window.scrollY || window.pageYOffset || 0) >= maxScroll) {
                    break;
                }
            }

            for (let index = 0; index < maxDownSweeps; index += 1) {
                const resolved = await nudgeSurfaceForStepDiscovery(step, { direction: 'up', variables });
                if (resolved) {
                    return resolved;
                }
                if ((window.scrollY || window.pageYOffset || 0) <= 0) {
                    break;
                }
            }

            try {
                window.scrollTo({ top: initialScrollY, left: 0, behavior: 'auto' });
            } catch (error) {
                // Ignore restoration issues.
            }

            return null;
        }

        async function waitForStepElement(step, variables = {}, timeoutMs = waitTimeoutMs) {
            const startedAt = Date.now();
            let scrollSweepAttempted = false;
            while (Date.now() - startedAt < timeoutMs) {
                throwIfExecutionCancelled();
                const transversalElement = resolveElementFromTransversalTarget(step, variables);
                if (transversalElement) {
                    return transversalElement;
                }
                const element = resolveElementFromStep(step);
                if (element) {
                    return element;
                }

                if (!scrollSweepAttempted && step?.actionType === 'click' && Date.now() - startedAt > Math.min(1200, timeoutMs / 3)) {
                    scrollSweepAttempted = true;
                    const discoveredAfterScroll = await sweepSurfaceForStep(step, variables);
                    if (discoveredAfterScroll) {
                        return discoveredAfterScroll;
                    }
                }
                await waitMs(120);
            }
            emitStepDiagnosticOnce('error', 'Workflow step target was not found on the page.', step, {
                failureKind: 'element_not_found',
                timeoutMs,
                scrollSweepAttempted
            });
            throw new Error(`No pude encontrar ${describeStep(step)} en esta pagina.`);
        }

        async function waitForPostClickProgress(step, nextStep, options = {}) {
            const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : waitTimeoutMs;
            const startedAt = Date.now();
            const baselineUrl = normalizeExecutionUrl(options.baselineUrl || window.location.href);
            const nextExpectedUrl = normalizeExecutionUrl(nextStep?.url || '');
            const currentExpectedUrl = normalizeExecutionUrl(step?.url || '');
            const shouldWaitForUrlChange = Boolean(nextExpectedUrl && nextExpectedUrl !== baselineUrl);

            while (Date.now() - startedAt < timeoutMs) {
                throwIfExecutionCancelled();
                const currentUrl = normalizeExecutionUrl(window.location.href);

                if (shouldWaitForUrlChange && currentUrl === nextExpectedUrl) {
                    return {
                        progress: 'next_expected_url_reached',
                        currentUrl
                    };
                }

                if (!nextExpectedUrl && currentUrl !== baselineUrl) {
                    return {
                        progress: 'url_changed',
                        currentUrl
                    };
                }

                if (nextStep?.selector && (!nextExpectedUrl || currentUrl === nextExpectedUrl) && canResolveStepImmediately(nextStep, options.variables || {})) {
                    return {
                        progress: 'next_step_available',
                        currentUrl
                    };
                }

                if (currentExpectedUrl && currentUrl !== currentExpectedUrl) {
                    return {
                        progress: 'left_current_step_url',
                        currentUrl
                    };
                }

                await waitMs(120);
            }

            return {
                progress: 'timeout',
                currentUrl: normalizeExecutionUrl(window.location.href)
            };
        }

        function fireDomEvent(element, eventName) {
            element.dispatchEvent(new Event(eventName, { bubbles: true }));
        }

        function notifyAutomationStep(step, message, options = {}) {
            const selector = options.selector || step?.selector || 'body';
            runtime()?.handleAutomationEvent?.({
                selector,
                label: step?.label || '',
                mode: options.mode || 'executing',
                spotlight: options.spotlight !== false,
                message: message || step?.label || step?.selector || 'Estoy trabajando en esta parte.'
            });
            updateWorkflowPanelStatus(message || step?.label || step?.selector || 'Estoy trabajando en esta parte.');
        }

        function emitExtensionLog(level, message, details = null) {
            const detail = {
                level,
                scope: 'execution',
                message,
                details
            };

            try {
                document.dispatchEvent(new CustomEvent('graph-trainer-extension-log', { detail }));
            } catch (error) {
                // Ignore.
            }

            try {
                window.postMessage({
                    source: 'graph-trainer-extension',
                    type: 'log',
                    detail
                }, '*');
            } catch (error) {
                // Ignore.
            }
        }

        async function applyInputStep(element, step, variables = {}) {
            const variableKey = `input_${step.stepOrder}`;
            const resolvedValue = Object.prototype.hasOwnProperty.call(variables, variableKey)
                ? variables[variableKey]
                : step.value;
            const value = resolvedValue == null ? '' : `${resolvedValue}`;

            element.focus();
            if ('value' in element) {
                element.value = '';
            }
            if (typeof element.select === 'function') {
                element.select();
            }

            const inputType = (element.type || '').toLowerCase();
            if (inputType === 'checkbox' || inputType === 'radio') {
                element.checked = Boolean(value);
                fireDomEvent(element, 'change');
                emitExtensionLog('info', 'Applied boolean input step.', buildStepDiagnostics(step, {
                    resolution: 'input_applied',
                    inputType,
                    appliedValue: Boolean(value)
                }));
                return;
            }

            if ('value' in element) {
                element.value = value;
            } else {
                element.textContent = value;
            }

            fireDomEvent(element, 'input');
            fireDomEvent(element, 'change');
            element.blur?.();
            emitExtensionLog('info', 'Applied input step.', buildStepDiagnostics(step, {
                resolution: 'input_applied',
                inputType,
                appliedValue: value
            }));
        }

        function normalizeChoiceText(value) {
            return `${value || ''}`
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();
        }

        function buildSelectCandidates(step, variables = {}, options = {}) {
            if (options.runtimeStrict) {
                return [
                    step.__runtimeSelectedValue,
                    step.__runtimeSelectedLabel
                ].map((value) => `${value || ''}`.trim()).filter(Boolean);
            }

            const variableKey = `input_${step.stepOrder}`;
            const variableValue = Object.prototype.hasOwnProperty.call(variables, variableKey)
                ? variables[variableKey]
                : '';

            return [
                variableValue,
                step.selectedValue,
                step.selectedLabel,
                step.value
            ].map((value) => `${value || ''}`.trim()).filter(Boolean);
        }

        function findMatchingSelectOption(optionsList, requestedValue) {
            const target = normalizeChoiceText(requestedValue);
            if (!target) {
                return null;
            }

            const getNormalizedOptionParts = (option) => ({
                value: normalizeChoiceText(option?.value),
                label: normalizeChoiceText(option?.label),
                text: normalizeChoiceText(option?.text),
                rawValue: `${option?.value || ''}`.trim()
            });

            const exact = optionsList.find((option) => {
                const parts = getNormalizedOptionParts(option);
                return parts.rawValue && (parts.value === target || parts.label === target || parts.text === target);
            });
            if (exact) {
                return exact;
            }

            return optionsList.find((option) => {
                const parts = getNormalizedOptionParts(option);
                if (!parts.rawValue) {
                    return false;
                }
                return parts.value.includes(target) || parts.label.includes(target) || parts.text.includes(target);
            }) || null;
        }

        function dispatchMouseLikeEvent(element, eventName) {
            element.dispatchEvent(new MouseEvent(eventName, {
                bubbles: true,
                cancelable: true,
                view: window
            }));
        }

        function dispatchKeyboardLikeEvent(element, eventName, key) {
            element.dispatchEvent(new KeyboardEvent(eventName, {
                key,
                bubbles: true,
                cancelable: true
            }));
        }

        function syncExecutionState(patch = {}) {
            Object.assign(executionState, patch);
        }

        function createCancellationError() {
            const error = new Error('La automatizacion se detuvo antes de terminar.');
            error.code = 'EXECUTION_CANCELLED';
            return error;
        }

        function throwIfExecutionCancelled() {
            if (executionState.cancelRequested) {
                throw createCancellationError();
            }
        }

        function waitMs(duration) {
            return new Promise((resolve, reject) => {
                const timer = window.setTimeout(() => {
                    try {
                        throwIfExecutionCancelled();
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                }, duration);

                if (!executionState.cancelRequested) {
                    return;
                }

                window.clearTimeout(timer);
                reject(createCancellationError());
            });
        }

        function cancelExecution() {
            if (!executionState.running) {
                return false;
            }

            syncExecutionState({ cancelRequested: true });
            updateWorkflowPanelStatus('Deteniendo la automatizacion...');
            emitExtensionLog('info', 'Workflow execution cancellation requested.', {
                workflowId: executionState.workflowId || '',
                currentUrl: window.location.href
            });
            emitPluginEvent('workflow.execution.cancellation_requested', {
                workflowId: executionState.workflowId || ''
            });
            return true;
        }

        async function performSelectInteractionSequence(element) {
            element.scrollIntoView({ block: 'center', inline: 'nearest' });
            element.focus();
            dispatchMouseLikeEvent(element, 'pointerdown');
            dispatchMouseLikeEvent(element, 'mousedown');
            dispatchMouseLikeEvent(element, 'pointerup');
            dispatchMouseLikeEvent(element, 'mouseup');
            dispatchMouseLikeEvent(element, 'click');
            await waitMs(50);
        }

        function getSelectedOptionSnapshot(element) {
            const selectedOption = element.options?.[element.selectedIndex] || null;
            return {
                value: `${element.value || ''}`,
                label: `${selectedOption?.label || selectedOption?.text || ''}`.trim()
            };
        }

        function applyNativeSelectValue(element, selected) {
            const optionsList = Array.from(element.options || []);
            const index = optionsList.findIndex((option) => option.value === selected.value);
            if (index < 0) {
                return false;
            }

            element.selectedIndex = index;
            optionsList[index].selected = true;
            return true;
        }

        async function dispatchSelectCommitEvents(element) {
            fireDomEvent(element, 'input');
            fireDomEvent(element, 'change');
            dispatchKeyboardLikeEvent(element, 'keydown', 'Enter');
            dispatchKeyboardLikeEvent(element, 'keyup', 'Enter');
            await waitMs(40);
            element.blur?.();
            await waitMs(40);
        }

        async function verifyNativeSelectApplied(element, selected, timeoutMs = 1200) {
            const startedAt = Date.now();
            const targetValue = `${selected?.value || ''}`;
            const targetLabel = normalizeChoiceText(selected?.label || selected?.text || '');

            while (Date.now() - startedAt < timeoutMs) {
                const snapshot = getSelectedOptionSnapshot(element);
                if (`${snapshot.value || ''}` === targetValue) {
                    return true;
                }
                if (targetLabel && normalizeChoiceText(snapshot.label) === targetLabel) {
                    return true;
                }
                await waitMs(60);
            }

            return false;
        }

        async function applyNativeSelectWithKeyboardFallback(element, selected) {
            await performSelectInteractionSequence(element);

            if (typeof element.showPicker === 'function') {
                try {
                    element.showPicker();
                    emitExtensionLog('info', 'Invoked showPicker() for native select.', {
                        selector: element.id ? `#${element.id}` : element.name || 'select'
                    });
                    await waitMs(80);
                } catch (error) {
                    emitExtensionLog('info', 'showPicker() was not allowed for native select.', {
                        selector: element.id ? `#${element.id}` : element.name || 'select',
                        message: error?.message || 'not allowed'
                    });
                }
            }

            const optionsList = Array.from(element.options || []);
            const targetIndex = optionsList.findIndex((option) => option.value === selected.value);
            if (targetIndex < 0) {
                return false;
            }

            const startingIndex = Math.max(0, element.selectedIndex);
            const directionKey = targetIndex >= startingIndex ? 'ArrowDown' : 'ArrowUp';
            const moveCount = Math.abs(targetIndex - startingIndex);

            for (let moveIndex = 0; moveIndex < moveCount; moveIndex += 1) {
                dispatchKeyboardLikeEvent(element, 'keydown', directionKey);
                dispatchKeyboardLikeEvent(element, 'keyup', directionKey);
                await waitMs(25);
            }

            applyNativeSelectValue(element, selected);
            await dispatchSelectCommitEvents(element);
            return verifyNativeSelectApplied(element, selected);
        }

        async function waitForMatchingSelectOption(element, candidates, timeoutMs = waitTimeoutMs) {
            const startedAt = Date.now();
            while (Date.now() - startedAt < timeoutMs) {
                const optionsList = Array.from(element.options || []).map((option) => ({
                    value: `${option.value || ''}`.trim(),
                    label: `${option.label || option.text || ''}`.trim(),
                    text: `${option.text || option.label || ''}`.trim()
                }));

                for (const candidate of candidates) {
                    const selected = findMatchingSelectOption(optionsList, candidate);
                    if (selected) {
                        return selected;
                    }
                }

                await waitMs(120);
            }

            return null;
        }

        async function applySelectStep(element, step, variables = {}, options = {}) {
            const candidates = buildSelectCandidates(step, variables, options);
            const meaningfulCandidates = candidates.filter((candidate) => !isPlaceholderSelectValue(candidate));
            emitExtensionLog('info', 'Applying select step.', buildStepDiagnostics(step, {
                candidates
            }));

            if (meaningfulCandidates.length === 0 && options.runtimeStrict) {
                emitExtensionLog('error', 'Runtime strict select step has no runtime-selected value.', buildStepDiagnostics(step, {
                    failureKind: 'runtime_strict_select_value_missing',
                    candidates
                }));
                throw new Error(`La inteligencia de ejecucion no eligio una opcion valida para ${describeStep(step)}.`);
            }

            if (meaningfulCandidates.length === 0) {
                const currentSnapshot = getSelectedOptionSnapshot(element);
                const currentLooksPlaceholder = isPlaceholderSelectValue(currentSnapshot.value) || isPlaceholderSelectValue(currentSnapshot.label);

                if (!isRequiredFieldLabel(step.label || '')) {
                    emitExtensionLog('info', 'Skipping optional select step learned as placeholder.', buildStepDiagnostics(step, {
                        resolution: 'optional_placeholder_select_skipped',
                        currentValue: currentSnapshot.value,
                        currentLabel: currentSnapshot.label
                    }));
                    return;
                }

                if (!currentLooksPlaceholder) {
                    emitExtensionLog('warn', 'Keeping current required select value because learned candidate is a placeholder.', buildStepDiagnostics(step, {
                        resolution: 'required_placeholder_select_kept_current',
                        currentValue: currentSnapshot.value,
                        currentLabel: currentSnapshot.label
                    }));
                    return;
                }

                emitExtensionLog('error', 'Required select step was learned with a placeholder value.', buildStepDiagnostics(step, {
                    failureKind: 'recorded_placeholder_value',
                    candidates
                }));
                throw new Error(`El workflow aprendio un valor placeholder para ${describeStep(step)}. Hay que reentrenar ese paso.`);
            }

            const selected = await waitForMatchingSelectOption(element, meaningfulCandidates);
            if (!selected) {
                emitExtensionLog('error', 'No matching option found for select step.', buildStepDiagnostics(step, {
                    failureKind: 'select_option_not_found',
                    candidates: meaningfulCandidates
                }));
                throw new Error(`No encontre una opcion valida para ${describeStep(step)}.`);
            }

            let applied = false;
            await performSelectInteractionSequence(element);
            if (applyNativeSelectValue(element, selected)) {
                await dispatchSelectCommitEvents(element);
                applied = await verifyNativeSelectApplied(element, selected);
            }

            if (!applied) {
                emitExtensionLog('warn', 'Semantic native select apply did not stick, trying keyboard fallback.', buildStepDiagnostics(step, {
                    targetValue: selected.value,
                    targetLabel: selected.label || selected.text || ''
                }));
                applied = await applyNativeSelectWithKeyboardFallback(element, selected);
            }

            if (!applied) {
                const snapshot = getSelectedOptionSnapshot(element);
                emitExtensionLog('error', 'Native select value did not persist after fallback.', buildStepDiagnostics(step, {
                    failureKind: 'select_value_not_persisted',
                    targetValue: selected.value,
                    targetLabel: selected.label || selected.text || '',
                    currentValue: snapshot.value,
                    currentLabel: snapshot.label
                }));
                throw new Error(`No pude confirmar la seleccion para ${describeStep(step)}.`);
            }

            emitExtensionLog('info', 'Applied select step.', buildStepDiagnostics(step, {
                resolution: 'select_applied',
                selectedValue: selected.value,
                resultingValue: element.value || '',
                selectedLabel: selected.label || selected.text || ''
            }));
        }

        function getRuntimeStepKey(step = {}, stepIndex = 0, reason = '') {
            const stepOrder = Number.isFinite(step?.stepOrder) ? step.stepOrder : stepIndex;
            return `${stepOrder}:${reason || 'runtime'}`;
        }

        function getRuntimeCallCount(plan = {}, step = {}, stepIndex = 0, reason = '') {
            const key = getRuntimeStepKey(step, stepIndex, reason);
            return Number(plan?.runtimeIntelligence?.callCounts?.[key] || 0);
        }

        function incrementRuntimeCallCount(plan = {}, step = {}, stepIndex = 0, reason = '') {
            const key = getRuntimeStepKey(step, stepIndex, reason);
            return {
                ...plan,
                runtimeIntelligence: {
                    ...(plan.runtimeIntelligence || {}),
                    callCounts: {
                        ...(plan.runtimeIntelligence?.callCounts || {}),
                        [key]: getRuntimeCallCount(plan, step, stepIndex, reason) + 1
                    }
                }
            };
        }

        function buildRuntimeIntelligencePayload(plan = {}, stepIndex = 0, reason = '', trigger = 'panel', failure = null) {
            const steps = Array.isArray(plan.steps) ? plan.steps : [];
            const currentStep = steps[stepIndex] || null;
            return {
                reason,
                trigger,
                workflowId: plan.workflowId || '',
                executionGuide: plan.executionGuide || '',
                currentUrl: window.location.href,
                stepIndex,
                currentStep,
                nextSteps: steps.slice(stepIndex + 1, stepIndex + 6),
                variables: plan.variables || {},
                executionIntent: plan.executionIntent || {},
                pageSnapshot: captureSurfaceSnapshot(),
                previousRuntimeDecisions: Array.isArray(plan.runtimeIntelligence?.decisions)
                    ? plan.runtimeIntelligence.decisions.slice(-6)
                    : [],
                failure
            };
        }

        function sanitizeStepPatch(patch = {}) {
            const allowed = [
                'selector',
                'value',
                'selectedValue',
                'selectedLabel',
                'label',
                'url',
                'actionType',
                'controlType',
                'explanation',
                '__runtimeSelectedValue',
                '__runtimeSelectedLabel'
            ];
            return allowed.reduce((output, key) => {
                if (Object.prototype.hasOwnProperty.call(patch, key)) {
                    output[key] = patch[key];
                }
                return output;
            }, {});
        }

        function applyRuntimeDecisionToPlan(plan = {}, decision = {}) {
            const nextPlan = {
                ...plan,
                variables: {
                    ...(plan.variables || {}),
                    ...(decision.variablePatch || {})
                },
                steps: Array.isArray(plan.steps) ? plan.steps.map((step) => ({ ...step })) : [],
                runtimeIntelligence: {
                    ...(plan.runtimeIntelligence || {}),
                    decisions: [
                        ...(Array.isArray(plan.runtimeIntelligence?.decisions) ? plan.runtimeIntelligence.decisions : []),
                        {
                            action: decision.action || 'continue',
                            reason: decision.reason || '',
                            at: Date.now()
                        }
                    ].slice(-20)
                }
            };

            const patches = Array.isArray(decision.stepPatches) ? decision.stepPatches : [];
            patches.forEach((patch) => {
                const stepOrder = Number(patch?.stepOrder);
                const index = Number.isFinite(stepOrder)
                    ? nextPlan.steps.findIndex((step) => Number(step.stepOrder) === stepOrder)
                    : -1;
                if (index < 0) {
                    return;
                }
                const sanitizedPatch = sanitizeStepPatch(patch);
                if (sanitizedPatch.selectedValue && !sanitizedPatch.__runtimeSelectedValue) {
                    sanitizedPatch.__runtimeSelectedValue = sanitizedPatch.selectedValue;
                }
                if (sanitizedPatch.selectedLabel && !sanitizedPatch.__runtimeSelectedLabel) {
                    sanitizedPatch.__runtimeSelectedLabel = sanitizedPatch.selectedLabel;
                }
                nextPlan.steps[index] = {
                    ...nextPlan.steps[index],
                    ...sanitizedPatch
                };
            });

            const skipOrders = new Set(
                (Array.isArray(decision.skipStepOrders) ? decision.skipStepOrders : [])
                    .map((value) => Number(value))
                    .filter((value) => Number.isFinite(value))
            );
            if (decision.action === 'skip_step' && Number.isFinite(Number(decision.stepOrder))) {
                skipOrders.add(Number(decision.stepOrder));
            }

            if (skipOrders.size > 0) {
                nextPlan.steps = nextPlan.steps.map((step) => skipOrders.has(Number(step.stepOrder))
                    ? { ...step, __runtimeSkipped: true }
                    : step);
            }

            return nextPlan;
        }

        function buildRuntimeAbortError(decision = {}, fallback = 'No pude continuar la automatizacion en esta pagina.') {
            const error = new Error(decision.userMessage || decision.reason || fallback);
            error.code = decision.action === 'ask_user' ? 'EXECUTION_NEEDS_USER' : 'EXECUTION_RUNTIME_ABORT';
            return error;
        }

        function scheduleRuntimeIntelligence(plan = {}, stepIndex = 0, reason = '', details = {}) {
            const nextRuntimeIntelligence = {
                ...(plan.runtimeIntelligence || {}),
                pending: {
                        stepIndex,
                        reason,
                    details,
                    scheduledAt: Date.now()
                }
            };
            if (reason === 'after_transversal_click') {
                nextRuntimeIntelligence.strictAfterTransversal = true;
            }
            return {
                ...plan,
                runtimeIntelligence: nextRuntimeIntelligence
            };
        }

        function clearPendingRuntimeIntelligence(plan = {}) {
            const runtimeIntelligence = { ...(plan.runtimeIntelligence || {}) };
            delete runtimeIntelligence.pending;
            return {
                ...plan,
                runtimeIntelligence
            };
        }

        function getPendingRuntimeIntelligence(plan = {}, stepIndex = 0) {
            const pending = plan.runtimeIntelligence?.pending || null;
            if (!pending || !Number.isFinite(Number(pending.stepIndex))) {
                return null;
            }
            return Number(pending.stepIndex) === stepIndex ? pending : null;
        }

        async function requestAndApplyRuntimeIntelligence(plan = {}, stepIndex = 0, reason = '', trigger = 'panel', failure = null) {
            if (!requestRuntimeIntelligence || !plan?.workflowId) {
                return { plan, decision: { action: 'continue', reason: 'runtime intelligence unavailable' } };
            }

            const step = Array.isArray(plan.steps) ? plan.steps[stepIndex] : null;
            const maxCallsPerStep = Number(plan.runtimeIntelligence?.maxCallsPerStep || 5);
            if (getRuntimeCallCount(plan, step, stepIndex, reason) >= maxCallsPerStep) {
                emitExtensionLog('warn', 'Runtime intelligence step limit reached.', buildStepDiagnostics(step, {
                    workflowId: plan.workflowId || '',
                    trigger,
                    stepIndex,
                    failureKind: 'runtime_intelligence_limit',
                    reason
                }));
                return { plan, decision: { action: 'continue', reason: 'runtime intelligence limit reached' } };
            }

            const countedPlan = incrementRuntimeCallCount(plan, step, stepIndex, reason);
            const payload = buildRuntimeIntelligencePayload(countedPlan, stepIndex, reason, trigger, failure);
            emitExtensionLog('info', 'Requesting runtime execution intelligence.', buildStepDiagnostics(step, {
                workflowId: countedPlan.workflowId || '',
                trigger,
                stepIndex,
                resolution: 'runtime_intelligence_requested',
                reason
            }));

            let response;
            try {
                response = await requestRuntimeIntelligence(countedPlan.workflowId, payload);
            } catch (error) {
                emitExtensionLog('warn', 'Runtime execution intelligence request failed.', buildStepDiagnostics(step, {
                    workflowId: countedPlan.workflowId || '',
                    trigger,
                    stepIndex,
                    failureKind: 'runtime_intelligence_request_failed',
                    errorMessage: error?.message || 'Unknown runtime intelligence error'
                }));
                return { plan: countedPlan, decision: { action: 'continue', reason: 'runtime intelligence request failed' } };
            }
            const decision = response?.decision || { action: 'continue', reason: 'empty runtime intelligence response' };
            const patchedPlan = applyRuntimeDecisionToPlan(countedPlan, decision);
            emitExtensionLog('info', 'Applied runtime execution intelligence decision.', buildStepDiagnostics(step, {
                workflowId: patchedPlan.workflowId || '',
                trigger,
                stepIndex,
                resolution: 'runtime_intelligence_applied',
                runtimeAction: decision.action || '',
                runtimeReason: decision.reason || '',
                runtimeStepPatches: Array.isArray(decision.stepPatches)
                    ? decision.stepPatches.map((patch) => ({
                        stepOrder: patch?.stepOrder,
                        selectedValue: patch?.selectedValue,
                        selectedLabel: patch?.selectedLabel
                    }))
                    : [],
                skipStepOrders: decision.skipStepOrders || []
            }));
            return { plan: patchedPlan, decision };
        }
        function updateExecutionProgress(plan, nextStepIndex) {
            const nextPlan = {
                ...plan,
                nextStepIndex,
                updatedAt: Date.now()
            };
            persistPendingExecution(nextPlan);
            return nextPlan;
        }

        async function executeWorkflowPlan(plan, trigger = 'panel') {
            if (!plan || !plan.workflowId || !Array.isArray(plan.steps) || plan.steps.length === 0) {
                throw new Error('No pude preparar la automatizacion para ayudarte en esta pagina.');
            }

            if (executionState.running) {
                throw new Error('Ya estoy completando una automatizacion en esta pagina.');
            }

            syncExecutionState({
                running: true,
                cancelRequested: false,
                workflowId: `${plan.workflowId || ''}`.trim()
            });
            emittedDiagnostics.clear();
            let currentPlan = null;

            try {
                if (!Number.isFinite(plan.nextStepIndex) || plan.nextStepIndex <= 0) {
                    resetSurfaceStateForFreshExecution();
                }
                currentPlan = updateExecutionProgress({
                    ...cloneJson(plan),
                    trigger,
                    nextStepIndex: Number.isFinite(plan.nextStepIndex) ? plan.nextStepIndex : 0,
                    startedAt: plan.startedAt || Date.now()
                }, Number.isFinite(plan.nextStepIndex) ? plan.nextStepIndex : 0);

                updateWorkflowPanelStatus('Completando la automatizacion en esta pagina...');
                emitPluginEvent('workflow.execution.started', {
                    workflowId: currentPlan.workflowId,
                    trigger,
                    stepCount: currentPlan.steps.length
                });
                emitExtensionLog('info', 'Workflow execution started on page.', {
                    workflowId: currentPlan.workflowId,
                    trigger,
                    stepCount: currentPlan.steps.length,
                    currentUrl: window.location.href
                });

                for (let stepIndex = currentPlan.nextStepIndex; stepIndex < currentPlan.steps.length; stepIndex += 1) {
                    throwIfExecutionCancelled();
                    const pendingRuntime = getPendingRuntimeIntelligence(currentPlan, stepIndex);
                    if (pendingRuntime) {
                        const pendingStep = currentPlan.steps[stepIndex] || null;
                        const runtimeResult = await requestAndApplyRuntimeIntelligence(
                            clearPendingRuntimeIntelligence(currentPlan),
                            stepIndex,
                            pendingRuntime.reason || 'runtime_pending',
                            trigger,
                            pendingRuntime.details || null
                        );
                        currentPlan = updateExecutionProgress(runtimeResult.plan, stepIndex);
                        if (runtimeResult.decision?.action === 'ask_user' || runtimeResult.decision?.action === 'abort') {
                            throw buildRuntimeAbortError(runtimeResult.decision);
                        }
                        emitExtensionLog('info', 'Resolved pending runtime execution intelligence before step.', buildStepDiagnostics(pendingStep, {
                            workflowId: currentPlan.workflowId,
                            trigger,
                            stepIndex,
                            resolution: 'pending_runtime_intelligence_resolved',
                            reason: pendingRuntime.reason || ''
                        }));
                        stepIndex -= 1;
                        continue;
                    }

                    const step = currentPlan.steps[stepIndex];
                    const nextStep = currentPlan.steps[stepIndex + 1] || null;
                    const expectedUrl = step.url ? normalizeExecutionUrl(step.url) : '';
                    emitPluginEvent('workflow.execution.step_started', {
                        workflowId: currentPlan.workflowId,
                        trigger,
                        stepIndex,
                        step
                    });
                    emitExtensionLog('info', 'Workflow execution step started.', buildStepDiagnostics(step, {
                        workflowId: currentPlan.workflowId,
                        trigger,
                        stepIndex
                    }));

                    if (step.__runtimeSkipped) {
                        emitExtensionLog('info', 'Skipping workflow step by runtime intelligence decision.', buildStepDiagnostics(step, {
                            workflowId: currentPlan.workflowId,
                            trigger,
                            stepIndex,
                            resolution: 'runtime_step_skipped'
                        }));
                        currentPlan = updateExecutionProgress(currentPlan, stepIndex + 1);
                        continue;
                    }

                    if (step.actionType === 'navigation') {
                        if (currentPlan.runtimeIntelligence?.strictAfterTransversal) {
                            currentPlan = {
                                ...currentPlan,
                                runtimeIntelligence: {
                                    ...(currentPlan.runtimeIntelligence || {}),
                                    strictAfterTransversal: false
                                }
                            };
                        }
                        const targetUrl = normalizeExecutionUrl(step.url);
                        notifyAutomationStep(step, `Abriendo ${step.label || targetUrl}.`, {
                            selector: 'body',
                            spotlight: false
                        });
                        if (!urlsMatch(window.location.href, targetUrl)) {
                            emitExtensionLog('info', 'Navigating to workflow step URL.', buildStepDiagnostics(step, {
                                workflowId: currentPlan.workflowId,
                                trigger,
                                stepIndex,
                                resolution: 'navigation_redirect',
                                targetUrl
                            }));
                            currentPlan = updateExecutionProgress(currentPlan, stepIndex + 1);
                            updateWorkflowPanelStatus(`Abriendo ${targetUrl}...`);
                            window.location.assign(targetUrl);
                            return;
                        }

                        currentPlan = updateExecutionProgress(currentPlan, stepIndex + 1);
                        continue;
                    }

                    if (expectedUrl && !urlsMatch(window.location.href, expectedUrl)) {
                        emitExtensionLog('warn', 'Workflow step requires a different page URL before execution.', buildStepDiagnostics(step, {
                            workflowId: currentPlan.workflowId,
                            trigger,
                            stepIndex,
                            failureKind: 'unexpected_page',
                            targetUrl: expectedUrl
                        }));
                        currentPlan = updateExecutionProgress(currentPlan, stepIndex);
                        updateWorkflowPanelStatus(`Cambiando a la pagina correcta para ${describeStep(step)}...`);
                        window.location.assign(expectedUrl);
                        return;
                    }

                    let element;
                    try {
                        element = await waitForStepElement(step, currentPlan.variables || {});
                    } catch (error) {
                        const runtimeResult = await requestAndApplyRuntimeIntelligence(currentPlan, stepIndex, 'element_not_found', trigger, {
                            message: error?.message || 'element not found',
                            failureKind: 'element_not_found'
                        });
                        currentPlan = updateExecutionProgress(runtimeResult.plan, stepIndex);
                        if (runtimeResult.decision?.action === 'ask_user' || runtimeResult.decision?.action === 'abort') {
                            throw buildRuntimeAbortError(runtimeResult.decision, error?.message);
                        }
                        if (currentPlan.steps?.[stepIndex]?.__runtimeSkipped) {
                            currentPlan = updateExecutionProgress(currentPlan, stepIndex + 1);
                            continue;
                        }
                        if (runtimeResult.decision?.retry || runtimeResult.decision?.action === 'patch_step' || runtimeResult.decision?.action === 'retry_step') {
                            stepIndex -= 1;
                            continue;
                        }
                        throw error;
                    }
                    throwIfExecutionCancelled();
                    if (step.actionType === 'click') {
                        const baselineUrl = window.location.href;
                        element.scrollIntoView({ block: 'center', inline: 'nearest' });
                        const transversalTarget = getTransversalTargetOverride(step, currentPlan.variables || {});
                        notifyAutomationStep(step, `Estoy interactuando con ${transversalTarget || step.semanticTarget || step.label || step.selector || 'este control'}.`);
                        if ('disabled' in element && element.disabled) {
                            emitExtensionLog('error', 'Workflow click target is disabled.', buildStepDiagnostics(step, {
                                workflowId: currentPlan.workflowId,
                                trigger,
                                stepIndex,
                                failureKind: 'element_disabled'
                            }));
                            throw new Error(`El elemento ${describeStep(step)} sigue deshabilitado.`);
                        }

                        const progressedPlan = transversalTarget
                            ? scheduleRuntimeIntelligence(currentPlan, stepIndex + 1, 'after_transversal_click', {
                                clickedStepOrder: Number.isFinite(step.stepOrder) ? step.stepOrder : null,
                                transversalTarget
                            })
                            : currentPlan;
                        currentPlan = updateExecutionProgress(progressedPlan, stepIndex + 1);
                        element.click();
                        emitExtensionLog('info', 'Applied click step.', buildStepDiagnostics(step, {
                            workflowId: currentPlan.workflowId,
                            trigger,
                            stepIndex,
                            resolution: 'click_applied'
                        }));

                        if (nextStep) {
                            const postClickProgress = await waitForPostClickProgress(step, nextStep, {
                                baselineUrl,
                                timeoutMs: waitTimeoutMs,
                                variables: currentPlan.variables || {}
                            });
                            emitExtensionLog(
                                postClickProgress.progress === 'timeout' ? 'warn' : 'info',
                                'Observed post-click workflow progress.',
                                buildStepDiagnostics(step, {
                                    workflowId: currentPlan.workflowId,
                                    trigger,
                                    stepIndex,
                                    resolution: postClickProgress.progress,
                                    nextStepOrder: Number.isFinite(nextStep.stepOrder) ? nextStep.stepOrder : null,
                                    nextStepSelector: nextStep.selector || '',
                                    progressedUrl: postClickProgress.currentUrl || ''
                                })
                            );
                        }
                    } else if (step.actionType === 'input') {
                        notifyAutomationStep(step, `Estoy completando ${step.label || step.selector || 'este campo'}.`);
                        await applyInputStep(element, step, currentPlan.variables || {});
                        currentPlan = updateExecutionProgress(currentPlan, stepIndex + 1);
                    } else if (step.actionType === 'select') {
                        notifyAutomationStep(step, `Estoy eligiendo una opcion en ${step.label || step.selector || 'este selector'}.`);
                        const runtimeStrict = Boolean(currentPlan.runtimeIntelligence?.strictAfterTransversal);
                        if (runtimeStrict && !step.__runtimeSelectedValue && !step.__runtimeSelectedLabel) {
                            const runtimeResult = await requestAndApplyRuntimeIntelligence(currentPlan, stepIndex, 'runtime_strict_select', trigger, {
                                failureKind: 'runtime_strict_select_value_missing'
                            });
                            currentPlan = updateExecutionProgress(runtimeResult.plan, stepIndex);
                            if (runtimeResult.decision?.action === 'ask_user' || runtimeResult.decision?.action === 'abort') {
                                throw buildRuntimeAbortError(runtimeResult.decision);
                            }
                            stepIndex -= 1;
                            continue;
                        }
                        await applySelectStep(element, step, currentPlan.variables || {}, { runtimeStrict });
                        currentPlan = updateExecutionProgress(currentPlan, stepIndex + 1);
                    } else {
                        currentPlan = updateExecutionProgress(currentPlan, stepIndex + 1);
                    }

                    await waitMs(stepDelayMs);
                }

                clearPendingExecution();
                runtime()?.clearSpotlight?.();
                updateWorkflowPanelStatus('Automatizacion completada en esta pagina.');
                runtime()?.speak('Listo, termine de completar la tarea aqui mismo.', { mode: 'idle' });
                emitExtensionLog('info', 'Workflow execution finished on page.', {
                    workflowId: currentPlan.workflowId,
                    trigger,
                    currentUrl: window.location.href
                });
                emitPluginEvent('workflow.execution.finished', {
                    workflowId: currentPlan.workflowId,
                    trigger
                });
            } catch (error) {
                if (error?.code === 'EXECUTION_CANCELLED') {
                    clearPendingExecution();
                    runtime()?.clearSpotlight?.();
                    updateWorkflowPanelStatus('Automatizacion detenida.');
                    runtime()?.speak('Detuve la automatizacion.', { mode: 'idle' });
                    emitExtensionLog('info', 'Workflow execution cancelled on page.', {
                        workflowId: currentPlan?.workflowId || executionState.workflowId || '',
                        trigger: currentPlan?.trigger || trigger,
                        currentUrl: window.location.href
                    });
                    emitPluginEvent('workflow.execution.cancelled', {
                        workflowId: currentPlan?.workflowId || executionState.workflowId || '',
                        trigger: currentPlan?.trigger || trigger
                    });
                    return;
                }

                if (currentPlan) {
                    const failingStepIndex = Number.isFinite(currentPlan.nextStepIndex) ? currentPlan.nextStepIndex : null;
                    const failingStep = failingStepIndex != null ? currentPlan.steps[failingStepIndex] : null;
                    emitExtensionLog('error', 'Workflow execution failed on page.', buildStepDiagnostics(failingStep, {
                        workflowId: currentPlan.workflowId,
                        trigger: currentPlan.trigger || trigger,
                        stepIndex: failingStepIndex,
                        failureKind: 'execution_error',
                        errorMessage: error?.message || 'Unknown execution error',
                        surfaceSnapshot: captureSurfaceSnapshot()
                    }));
                    emitPluginEvent('workflow.execution.failed', {
                        workflowId: currentPlan.workflowId,
                        trigger: currentPlan.trigger || trigger,
                        stepIndex: failingStepIndex,
                        errorMessage: error?.message || 'Unknown execution error'
                    });
                }
                throw error;
            } finally {
                syncExecutionState({
                    running: false,
                    cancelRequested: false,
                    workflowId: ''
                });
            }
        }

        return {
            cloneJson,
            getExecutionStorageKey,
            readPendingExecution,
            persistPendingExecution,
            clearPendingExecution,
            normalizeExecutionUrl,
            urlsMatch,
            describeStep,
            resolveElementFromStep,
            waitForStepElement,
            fireDomEvent,
            notifyAutomationStep,
            emitExtensionLog,
            applyInputStep,
            normalizeChoiceText,
            buildSelectCandidates,
            findMatchingSelectOption,
            dispatchMouseLikeEvent,
            dispatchKeyboardLikeEvent,
            waitMs,
            cancelExecution,
            performSelectInteractionSequence,
            getSelectedOptionSnapshot,
            applyNativeSelectValue,
            dispatchSelectCommitEvents,
            verifyNativeSelectApplied,
            applyNativeSelectWithKeyboardFallback,
            waitForMatchingSelectOption,
            applySelectStep,
            updateExecutionProgress,
            executeWorkflowPlan
        };
    }

    window.GraphPluginExecutionClient = {
        create
    };
})();
