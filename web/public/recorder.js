window.WorkflowRecorder = (() => {
  let isRecording = false;
  let statusId = null;
  let stepOrder = 0;
  let recordQueue = Promise.resolve();
  let recordedSteps = [];
  const lastFieldEvents = new Map();
  const focusedSelectValues = new Map();
  const PENDING_CLICK_STORAGE_KEY = 'graphTrainerPendingClickIntents';
  const warnedPendingClickIds = new Set();

  function emitExtensionLog(level, message, details = null) {
    const detail = {
      level,
      scope: 'recorder',
      message,
      details
    };
    try {
      document.dispatchEvent(new CustomEvent('graph-trainer-extension-log', { detail }));
      window.postMessage({
        source: 'graph-trainer-extension',
        type: 'log',
        detail
      }, '*');
    } catch (error) {
      // Ignore logging bridge issues.
    }
  }

  function pluginEvents() {
    return window.GraphPluginEvents || null;
  }

  function host() {
    return window.GraphPluginHost?.createHost?.(window.TrainerPlugin?.getConfig?.() || {}) || null;
  }

  function apiClient() {
    return window.GraphPluginApi?.createClient?.({
      baseUrl: host()?.apiBaseUrl || '',
      fetchImpl: host()?.fetchImpl || null
    }) || null;
  }

  function requireApiClient() {
    const client = apiClient();
    if (!client) {
      throw new Error('No API client configured for recorder.');
    }
    return client;
  }

  function explanationField() {
    return document.getElementById('step-explanation');
  }

  function statusField() {
    return document.getElementById('recording-status');
  }

  function stopButton() {
    return document.getElementById('btn-stop');
  }

  function startButton() {
    return document.getElementById('btn-start');
  }

  function toggleButton() {
    return document.getElementById('btn-record-toggle');
  }

  function updateRecordingUI(recording) {
    const toggle = toggleButton();
    if (!toggle) return;
    toggle.dataset.recording = recording ? 'true' : 'false';
    toggle.setAttribute('aria-pressed', recording ? 'true' : 'false');
    toggle.title = recording ? 'Stop recording' : 'Start recording';
    toggle.innerHTML = recording
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5-4-4L4 16v4zm12-13 2 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5-4-4L4 16v4zm12-13 2 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
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
    const normalizedAttributeName = `${attributeName || ''}`.trim();
    const normalizedAttributeValue = `${attributeValue || ''}`;
    const normalizedTagName = `${tagName || ''}`.trim().toLowerCase();
    if (!normalizedAttributeName || !normalizedAttributeValue) {
      return normalizedTagName || '';
    }

    const prefix = normalizedTagName || '';
    return `${prefix}[${normalizedAttributeName}="${escapeAttributeSelectorValue(normalizedAttributeValue)}"]`;
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

  function selectorForElement(element) {
    if (!element) return '';
    if (element.dataset && element.dataset.testid) {
      return buildAttributeSelector('data-testid', element.dataset.testid);
    }
    if (element.id) {
      return isCssSafeId(element.id)
        ? `#${element.id}`
        : buildAttributeSelector('id', element.id);
    }
    if (element.name) {
      return buildAttributeSelector('name', element.name);
    }
    if (element.tagName === 'A' && element.getAttribute('href')) {
      return buildAttributeSelector('href', element.getAttribute('href'), 'a');
    }
    if (element.tagName === 'BUTTON' && element.type) {
      return buildAttributeSelector('type', element.type, 'button');
    }
    return element.tagName ? element.tagName.toLowerCase() : '';
  }

  function labelForElement(element) {
    if (!element) return '';
    const explicitLabel = element.labels && element.labels.length > 0
      ? Array.from(element.labels).map((label) => label.textContent || '').join(' ').trim()
      : '';
    const ariaLabel = element.getAttribute && element.getAttribute('aria-label');
    const ariaLabelledBy = element.getAttribute && element.getAttribute('aria-labelledby')
      ? element.getAttribute('aria-labelledby')
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ')
        .trim()
      : '';
    const fallback = element.placeholder || element.name || element.id || '';
    return (explicitLabel || ariaLabel || ariaLabelledBy || fallback || '').trim().slice(0, 120);
  }

  function controlTypeForElement(element) {
    if (element instanceof HTMLSelectElement) return 'select';
    if (element instanceof HTMLTextAreaElement) return 'textarea';
    if (element instanceof HTMLInputElement) return element.type || 'input';
    return element.tagName ? element.tagName.toLowerCase() : 'unknown';
  }

  function isInteractiveCandidate(element) {
    return element instanceof Element
      && element.matches?.('a, button, input, textarea, select, option');
  }

  function collectInteractiveCandidatesFromEvent(event) {
    const path = typeof event?.composedPath === 'function' ? event.composedPath() : [];
    const candidates = [];

    path.forEach((entry) => {
      if (!isInteractiveCandidate(entry)) return;
      if (candidates.includes(entry)) return;
      candidates.push(entry);
    });

    const closestTarget = event?.target?.closest?.('a, button, input, textarea, select, option');
    if (isInteractiveCandidate(closestTarget) && !candidates.includes(closestTarget)) {
      candidates.push(closestTarget);
    }

    return candidates;
  }

  function isHashRouteAnchor(element) {
    if (!(element instanceof HTMLAnchorElement)) return false;
    const href = `${element.getAttribute('href') || ''}`.trim();
    return href.startsWith('#!');
  }

  function scoreClickLearningCandidate(element, eventTarget) {
    if (!(element instanceof Element)) return Number.NEGATIVE_INFINITY;

    let score = 0;
    const selector = selectorForElement(element);
    const label = labelForElement(element);
    const text = describeElementText(element);

    if (element === eventTarget) score += 20;
    if (element.contains?.(eventTarget)) score += 6;

    if (element.dataset?.testid) score += 80;
    if (element.id) score += 60;
    if (element.getAttribute?.('name')) score += 40;
    if (label) score += 10;
    if (text) score += 8;
    if (selector && selector !== (element.tagName || '').toLowerCase()) score += 8;

    if (element instanceof HTMLAnchorElement) {
      const href = `${element.getAttribute('href') || ''}`.trim();
      score += 50;
      if (href) score += 20;
      if (href.startsWith('#!')) score += 120;
      else if (href.startsWith('#')) score += 70;
    } else if (element instanceof HTMLButtonElement) {
      score += 35;
      if ((element.type || '').toLowerCase() !== 'submit') score += 8;
    } else if (element instanceof HTMLInputElement) {
      score += 12;
      const inputType = `${element.type || ''}`.trim().toLowerCase();
      if (inputType === 'button' || inputType === 'submit') score += 10;
    }

    return score;
  }

  function resolveClickLearningTarget(event) {
    const rawTarget = event?.target instanceof Element ? event.target : null;
    const candidates = collectInteractiveCandidatesFromEvent(event)
      .filter((candidate) => !candidate.closest?.('.console'))
      .filter((candidate) => !isAssistantSurface(candidate))
      .filter((candidate) => !isRecorderControl(candidate))
      .filter((candidate) => !(candidate instanceof HTMLSelectElement || candidate instanceof HTMLOptionElement));

    if (candidates.length === 0) {
      return null;
    }

    const sorted = candidates
      .map((candidate) => ({
        element: candidate,
        score: scoreClickLearningCandidate(candidate, rawTarget)
      }))
      .sort((left, right) => right.score - left.score);

    const best = sorted[0]?.element || null;
    const closest = rawTarget?.closest?.('a, button, input, textarea, select, option') || null;

    if (best && closest && best !== closest && isHashRouteAnchor(best)) {
      emitExtensionLog('info', 'Resolved click to ancestor hash-route anchor for learning.', {
        selectedSelector: selectorForElement(best),
        selectedLabel: labelForElement(best),
        selectedHref: best.getAttribute?.('href') || '',
        rawSelector: selectorForElement(closest),
        rawLabel: labelForElement(closest)
      });
    }

    return best || closest;
  }

  function safeSessionStorage() {
    try {
      return window.sessionStorage;
    } catch (error) {
      return null;
    }
  }

  function readPendingClickIntents() {
    const storage = safeSessionStorage();
    if (!storage) return [];
    try {
      const raw = storage.getItem(PENDING_CLICK_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function writePendingClickIntents(entries) {
    const storage = safeSessionStorage();
    if (!storage) return;
    try {
      storage.setItem(PENDING_CLICK_STORAGE_KEY, JSON.stringify(Array.isArray(entries) ? entries : []));
    } catch (error) {
      // Ignore storage persistence issues.
    }
  }

  function buildClickIntentId() {
    return `click-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function describeElementText(element) {
    return `${element?.textContent || element?.value || element?.getAttribute?.('aria-label') || ''}`
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
  }

  function normalizeSemanticTargetText(value) {
    return `${value || ''}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function isGenericSemanticTarget(value) {
    const normalized = normalizeSemanticTargetText(value);
    if (!normalized || normalized.length < 4) {
      return true;
    }

    return [
      'ver mas',
      'ver más',
      'detalle',
      'detalles',
      'abrir',
      'seleccionar',
      'comprar',
      'agregar',
      'agregar al carrito',
      'anadir al carrito',
      'añadir al carrito',
      'continuar',
      'siguiente',
      'menu',
      'inicio'
    ].some((token) => normalized === token || normalized.includes(token));
  }

  function firstMeaningfulSemanticTarget(candidates = []) {
    for (const candidate of candidates) {
      const value = `${candidate || ''}`.replace(/\s+/g, ' ').trim();
      if (!value || isGenericSemanticTarget(value)) {
        continue;
      }
      return value.slice(0, 180);
    }
    return '';
  }

  function collectSemanticTextCandidates(element) {
    if (!(element instanceof Element)) {
      return [];
    }

    const directHeading = element.querySelector?.('h1, h2, h3, h4, h5, h6');
    const directImage = element.querySelector?.('img[alt]');
    const closestContainer = element.closest?.(
      'article, li, [class*="card"], [class*="item"], [class*="product"], [data-testid], [data-product], section'
    );
    const containerHeading = closestContainer?.querySelector?.('h1, h2, h3, h4, h5, h6');
    const containerImage = closestContainer?.querySelector?.('img[alt]');

    return [
      labelForElement(element),
      element.getAttribute?.('title') || '',
      element.getAttribute?.('aria-label') || '',
      directHeading?.textContent || '',
      directImage?.getAttribute?.('alt') || '',
      describeElementText(element),
      containerHeading?.textContent || '',
      containerImage?.getAttribute?.('alt') || '',
      describeElementText(closestContainer)
    ];
  }

  function inferSemanticClickTarget(element) {
    return firstMeaningfulSemanticTarget(collectSemanticTextCandidates(element));
  }

  function buildPendingClickIntent(element) {
    const href = element?.getAttribute?.('href') || '';
    return {
      id: buildClickIntentId(),
      createdAt: Date.now(),
      pageUrl: window.location.href,
      pageTitle: document.title || '',
      selector: selectorForElement(element),
      label: labelForElement(element),
      semanticTarget: inferSemanticClickTarget(element),
      text: describeElementText(element),
      href,
      tagName: `${element?.tagName || ''}`.toLowerCase(),
      idAttribute: element?.id || '',
      name: element?.getAttribute?.('name') || '',
      type: element?.getAttribute?.('type') || '',
      role: element?.getAttribute?.('role') || '',
      className: typeof element?.className === 'string' ? element.className.trim().slice(0, 220) : ''
    };
  }

  function persistPendingClickIntent(intent) {
    if (!intent?.id) return;
    const entries = readPendingClickIntents()
      .filter((entry) => entry && entry.id !== intent.id)
      .concat(intent)
      .slice(-20);
    writePendingClickIntents(entries);
  }

  function clearPendingClickIntent(intentId) {
    if (!intentId) return;
    const next = readPendingClickIntents().filter((entry) => entry && entry.id !== intentId);
    writePendingClickIntents(next);
    warnedPendingClickIds.delete(intentId);
  }

  function summarizeClickIntentForWarning(intent, reason) {
    return {
      reason,
      selector: intent?.selector || '',
      label: intent?.label || '',
      text: intent?.text || '',
      semanticTarget: intent?.semanticTarget || '',
      href: intent?.href || '',
      pageUrl: intent?.pageUrl || '',
      pageTitle: intent?.pageTitle || '',
      tagName: intent?.tagName || '',
      id: intent?.idAttribute || '',
      name: intent?.name || '',
      type: intent?.type || '',
      role: intent?.role || '',
      className: intent?.className || '',
      ageMs: Math.max(0, Date.now() - Number(intent?.createdAt || Date.now()))
    };
  }

  function warnForUnlearnedPendingClicks(reason, predicate = null) {
    const entries = readPendingClickIntents();
    const staleEntries = entries.filter((entry) => {
      if (!entry?.id) return false;
      if (warnedPendingClickIds.has(entry.id)) return false;
      if (typeof predicate === 'function' && !predicate(entry)) return false;
      return true;
    });

    staleEntries.forEach((entry) => {
      warnedPendingClickIds.add(entry.id);
      emitExtensionLog('warn', 'Observed click that did not become a learned workflow step.', summarizeClickIntentForWarning(entry, reason));
    });
  }

  function schedulePendingClickVerification(intentId) {
    window.setTimeout(() => {
      const entry = readPendingClickIntents().find((candidate) => candidate && candidate.id === intentId);
      if (!entry) {
        return;
      }

      warnForUnlearnedPendingClicks('persistence_timeout', (candidate) =>
        candidate?.id === intentId && Date.now() - Number(candidate?.createdAt || 0) >= 2000
      );
    }, 2200);
  }

  function getAllowedOptions(element) {
    if (!(element instanceof HTMLSelectElement)) return [];
    return Array.from(element.options).map((option) => ({
      value: option.value,
      label: (option.label || option.textContent || '').trim(),
      text: (option.textContent || '').trim()
    }));
  }

  function getControlMetadata(element) {
    const metadata = {
      controlType: controlTypeForElement(element),
      selectedValue: '',
      selectedLabel: '',
      allowedOptions: []
    };

    if (element instanceof HTMLSelectElement) {
      const selectedOption = element.options[element.selectedIndex];
      metadata.selectedValue = element.value;
      metadata.selectedLabel = selectedOption ? (selectedOption.label || selectedOption.textContent || '').trim() : '';
      metadata.allowedOptions = getAllowedOptions(element);
      return metadata;
    }

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      metadata.selectedValue = element.value;
      return metadata;
    }

    return metadata;
  }

  function getExplanation() {
    const field = explanationField();
    if (!field) return '';
    const explanation = field.value.trim();
    field.value = '';
    return explanation;
  }

  function isRecorderControl(element) {
    return Boolean(
      element
      && ['btn-start', 'btn-stop', 'btn-record-toggle', 'step-explanation', 'wf-desc'].includes(element.id)
    );
  }

  function isAssistantSurface(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    return Boolean(element.closest(
      '#graph-assistant-shell, ' +
      '#graph-assistant-bubble, ' +
      '#graph-assistant-user-bubble, ' +
      '#graph-assistant-bubble-mic, ' +
      '#graph-assistant-chat-toggle, ' +
      '#graph-assistant-chat-composer, ' +
      '#graph-assistant-spotlight, ' +
      '#teaching-console, ' +
      '#workflow-overlay, ' +
      '#feedback-overlay, ' +
      '#voice-toggle, ' +
      '#phone-mic-pairing, ' +
      '#assistant-phone-mic-pairing'
    ));
  }

  function shouldSkipFieldEvent(element, actionType) {
    if (!element || isRecorderControl(element) || isAssistantSurface(element)) return true;
    const selector = selectorForElement(element);
    const signature = [
      actionType,
      selector,
      element.value,
      element instanceof HTMLSelectElement ? getAllowedOptions(element).map((option) => option.value).join('|') : ''
    ].join('::');
    const now = Date.now();
    const previous = lastFieldEvents.get(selector);

    if (previous && previous.signature === signature && now - previous.recordedAt < 900) {
      if (element instanceof HTMLSelectElement) {
        emitExtensionLog('info', 'Skipped duplicate select field event.', {
          selector,
          label: labelForElement(element),
          value: element.value || '',
          actionType
        });
      }
      return true;
    }

    lastFieldEvents.set(selector, {
      signature,
      recordedAt: now
    });
    return false;
  }

  function rememberFocusedSelect(element) {
    if (!(element instanceof HTMLSelectElement)) return;
    focusedSelectValues.set(selectorForElement(element), element.value || '');
  }

  function forgetFocusedSelect(element) {
    if (!(element instanceof HTMLSelectElement)) return;
    focusedSelectValues.delete(selectorForElement(element));
  }

  function didSelectValueChange(element) {
    if (!(element instanceof HTMLSelectElement)) return false;
    const key = selectorForElement(element);
    return focusedSelectValues.get(key) !== (element.value || '');
  }

  async function recordFieldState(element) {
    const actionType = element instanceof HTMLSelectElement ? 'select' : 'input';
    if (shouldSkipFieldEvent(element, actionType)) return;

    if (element instanceof HTMLSelectElement) {
      const metadata = getControlMetadata(element);
      const looksLikePlaceholder = isPlaceholderSelectValue(metadata.selectedValue) || isPlaceholderSelectValue(metadata.selectedLabel);
      if (looksLikePlaceholder) {
        emitExtensionLog('info', 'Skipped placeholder select state during learning.', {
          selector: selectorForElement(element),
          label: labelForElement(element),
          value: element.value || '',
          selectedLabel: metadata.selectedLabel || ''
        });
        return;
      }
      emitExtensionLog('info', 'Observed select field change.', {
        selector: selectorForElement(element),
        label: labelForElement(element),
        value: element.value || '',
        selectedLabel: metadata.selectedLabel || '',
        allowedOptionCount: Array.isArray(metadata.allowedOptions) ? metadata.allowedOptions.length : 0
      });
    }

    await recordStep({
      actionType,
      selector: selectorForElement(element),
      label: labelForElement(element),
      value: element.value,
      ...getControlMetadata(element)
    });
  }

  function appendActivity(step) {
    const list = document.getElementById('activity-log');
    if (!list) return;
    const item = document.createElement('li');
    const renderedValue = step.actionType === 'select'
      ? (step.selectedLabel || step.selectedValue || step.value || '')
      : (step.value || '');
    item.textContent = `${step.stepOrder}. ${step.actionType} ${step.selector || step.url}${renderedValue ? ` = ${renderedValue}` : ''}`;
    list.appendChild(item);
  }

  async function postStep(step) {
    if (!isRecording) return;

    stepOrder += 1;
    const payload = {
      ...step,
      sessionId: statusId,
      url: window.location.href,
      explanation: getExplanation(),
      stepOrder
    };

    await requireApiClient().appendWorkflowStep(payload, statusId);

    recordedSteps.push(payload);
    if (payload.__pendingClickIntentId) {
      clearPendingClickIntent(payload.__pendingClickIntentId);
    }
    appendActivity(payload);
    pluginEvents()?.emit?.('learning.step.captured', { step: payload });
    if (payload.actionType === 'select') {
      emitExtensionLog('info', 'Recorded select step.', {
        selector: payload.selector,
        label: payload.label,
        value: payload.value || '',
        selectedValue: payload.selectedValue || '',
        selectedLabel: payload.selectedLabel || '',
        allowedOptionCount: Array.isArray(payload.allowedOptions) ? payload.allowedOptions.length : 0,
        stepOrder: payload.stepOrder
      });
    } else if (payload.actionType === 'click') {
      emitExtensionLog('info', 'Recorded click step.', {
        selector: payload.selector,
        label: payload.label,
        semanticTarget: payload.semanticTarget || '',
        href: payload.href || '',
        stepOrder: payload.stepOrder
      });
    }
  }

  function recordStep(step) {
    recordQueue = recordQueue
      .then(() => postStep(step))
      .catch((error) => {
        console.error('Failed to record step', error);
        if (step?.__pendingClickIntentId) {
          warnForUnlearnedPendingClicks('record_step_failed', (candidate) => candidate?.id === step.__pendingClickIntentId);
        }
        emitExtensionLog('error', 'Failed to record step.', {
          selector: step?.selector || '',
          actionType: step?.actionType || '',
          message: error?.message || 'Unknown recorder error'
        });
      });

    return recordQueue;
  }

  async function syncStatus() {
    const status = await requireApiClient().getRecorderStatus();
    const recoveredPendingClicks = readPendingClickIntents();

    isRecording = status.recording;
    statusId = status.id;
    stepOrder = 0;
    recordedSteps = [];
    lastFieldEvents.clear();
    focusedSelectValues.clear();
    warnedPendingClickIds.clear();

    if (status.recording && recoveredPendingClicks.length > 0) {
      recoveredPendingClicks.forEach((entry) => {
        emitExtensionLog('warn', 'Recovered click that may have been lost before it became a learned step.', summarizeClickIntentForWarning(entry, 'recovered_after_surface_change'));
      });
    }
    writePendingClickIntents([]);

    if (status.recording) {
      if (startButton()) startButton().disabled = true;
      if (stopButton()) stopButton().disabled = false;
      if (stopButton()) stopButton().style.display = 'inline-block';
      if (statusField()) statusField().innerText = `Recording workflow ${status.id}`;
      updateRecordingUI(true);
      await recordStep({ actionType: 'navigation', selector: 'document', label: document.title, value: '' });
    } else if (statusField()) {
      statusField().innerText = 'Idle';
      updateRecordingUI(false);
    } else {
      updateRecordingUI(false);
    }
  }

  function installListeners() {
    window.addEventListener('hashchange', () => {
      warnForUnlearnedPendingClicks('surface_changed_before_learning', (entry) =>
        Date.now() - Number(entry?.createdAt || 0) >= 300
      );
    }, true);

    window.addEventListener('pagehide', () => {
      warnForUnlearnedPendingClicks('page_hiding_before_learning');
    }, true);

    document.addEventListener('click', async (event) => {
      if (!isRecording) return;
      const target = resolveClickLearningTarget(event);
      if (!target) return;

      const clickIntent = buildPendingClickIntent(target);
      persistPendingClickIntent(clickIntent);
      schedulePendingClickVerification(clickIntent.id);

      await recordStep({
        actionType: 'click',
        selector: selectorForElement(target),
        label: labelForElement(target),
        semanticTarget: inferSemanticClickTarget(target),
        value: '',
        href: target.getAttribute?.('href') || '',
        __pendingClickIntentId: clickIntent.id,
        ...getControlMetadata(target)
      });
    }, true);

    document.addEventListener('change', async (event) => {
      if (!isRecording) return;
      const target = event.target;
      const isField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
      if (!isField) return;
      if (isRecorderControl(target) || isAssistantSurface(target)) return;
      if (target instanceof HTMLSelectElement) {
        emitExtensionLog('info', 'Native select change event received.', {
          selector: selectorForElement(target),
          label: labelForElement(target),
          value: target.value || ''
        });
      }
      await recordFieldState(target);
    }, true);

    document.addEventListener('input', async (event) => {
      if (!isRecording) return;
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      if (isRecorderControl(target) || isAssistantSurface(target)) return;
      emitExtensionLog('info', 'Native select input event received.', {
        selector: selectorForElement(target),
        label: labelForElement(target),
        value: target.value || ''
      });
      await recordFieldState(target);
    }, true);

    document.addEventListener('focusin', (event) => {
      if (!isRecording) return;
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      if (isRecorderControl(target) || isAssistantSurface(target)) return;
      emitExtensionLog('info', 'Select focus observed.', {
        selector: selectorForElement(target),
        label: labelForElement(target),
        value: target.value || '',
        allowedOptionCount: getAllowedOptions(target).length
      });
      rememberFocusedSelect(target);
    }, true);

    document.addEventListener('focusout', async (event) => {
      if (!isRecording) return;
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      if (isRecorderControl(target) || isAssistantSurface(target)) return;
      const changed = didSelectValueChange(target);
      emitExtensionLog('info', 'Select blur observed.', {
        selector: selectorForElement(target),
        label: labelForElement(target),
        value: target.value || '',
        changed
      });
      if (target.value && changed) {
        await recordFieldState(target);
      }
      forgetFocusedSelect(target);
    }, true);
  }

  installListeners();

  function hasMeaningfulRecordedSteps() {
    return recordedSteps.some((step) => {
      const actionType = `${step?.actionType || ''}`.trim().toLowerCase();
      if (!actionType || actionType === 'navigation') {
        return false;
      }
      if (actionType === 'input' || actionType === 'select') {
        return Boolean(`${step?.value || step?.selectedValue || ''}`.trim());
      }
      if (actionType === 'click') {
        return Boolean(`${step?.selector || ''}`.trim());
      }
      return true;
    });
  }

  return {
    async startWorkflow(description, context = {}) {
      const desc = (description || '').trim();
      const pageState = window.PageState?.current || window.PageState || window.EMRState;
      if (pageState && typeof pageState.clearAll === 'function') {
        pageState.clearAll();
      }

      const startPayload = await requireApiClient().startWorkflow(desc, context);
      statusId = startPayload?.id || null;

      isRecording = true;
      stepOrder = 0;
      recordedSteps = [];
      lastFieldEvents.clear();
      focusedSelectValues.clear();
      writePendingClickIntents([]);
      warnedPendingClickIds.clear();
      recordQueue = Promise.resolve();
      if (startButton()) startButton().disabled = true;
      if (stopButton()) stopButton().disabled = false;
      if (statusField()) statusField().innerText = 'Recording live DOM actions';
      updateRecordingUI(true);
      const activity = document.getElementById('activity-log');
      if (activity) activity.innerHTML = '';
      pluginEvents()?.emit?.('learning.session.started', {
        sessionId: statusId,
        description: desc,
        context
      });
      await recordStep({ actionType: 'navigation', selector: 'document', label: document.title, value: '' });
    },

    async stopWorkflow(redirectTo) {
      const workflowId = statusId;
      await requireApiClient().stopWorkflow(workflowId);
      if (workflowId && !hasMeaningfulRecordedSteps()) {
        await requireApiClient().deleteWorkflow(workflowId).catch(() => {});
      }
      isRecording = false;
      statusId = null;
      stepOrder = 0;
      recordedSteps = [];
      lastFieldEvents.clear();
      focusedSelectValues.clear();
      writePendingClickIntents([]);
      warnedPendingClickIds.clear();
      if (statusField()) statusField().innerText = 'Saved';
      updateRecordingUI(false);
      pluginEvents()?.emit?.('learning.session.finished', {
        sessionId: workflowId,
        redirectTo: redirectTo || ''
      });
      if (redirectTo) {
        window.location.href = redirectTo;
        return;
      }
      window.location.reload();
    },

    async resetWorkflow() {
      await requireApiClient().resetWorkflow();
      isRecording = false;
      statusId = null;
      stepOrder = 0;
      recordedSteps = [];
      lastFieldEvents.clear();
      focusedSelectValues.clear();
      writePendingClickIntents([]);
      warnedPendingClickIds.clear();
      if (statusField()) statusField().innerText = 'Idle';
      if (startButton()) startButton().disabled = false;
      if (stopButton()) stopButton().disabled = true;
      updateRecordingUI(false);
      pluginEvents()?.emit?.('learning.session.reset', {});
    },

    syncStatus,
    isRecording: () => isRecording
  };
})();
