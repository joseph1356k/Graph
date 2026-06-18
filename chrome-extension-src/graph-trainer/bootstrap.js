(function () {
  function emitExtensionLog(level, message, details) {
    const detail = {
      level,
      scope: 'bootstrap',
      message,
      details: details || null
    };
    document.dispatchEvent(new CustomEvent('graph-trainer-extension-log', { detail }));
    window.postMessage({
      source: 'graph-trainer-extension',
      type: 'log',
      detail
    }, '*');
  }

  const root = document.documentElement;
  const backendUrl = `${root.dataset.graphTrainerBackendUrl || 'https://miracle-zeta.vercel.app'}`.trim() || 'https://miracle-zeta.vercel.app';
  const appId = `${root.dataset.graphTrainerAppId || 'chrome-extension-page'}`.trim() || 'chrome-extension-page';
  const storageKey = `${root.dataset.graphTrainerStorageKey || 'graph-extension-state-page'}`.trim() || 'graph-extension-state-page';
  const workflowDescription = `${root.dataset.graphTrainerWorkflowDescription || 'Workflow on current page'}`.trim() || 'Workflow on current page';

  window.__GRAPH_EXTENSION_SETTINGS__ = {
    backendUrl,
    appId
  };

  emitExtensionLog('info', 'Starting Miracle bootstrap.', {
    backendUrl,
    appId,
    storageKey,
    workflowDescription
  });

  try {
    window.PageState.init({ storageKey });
    emitExtensionLog('info', 'PageState initialized.', { storageKey });

    window.TrainerPlugin.mount({
      title: 'Miracle',
      workflowDescription,
      appId,
      apiBaseUrl: backendUrl,
      assistantRuntime: {
        name: 'Miracle',
        accentColor: '#0f5f8c',
        idleMessage: 'Puedo aprender y ejecutar tareas en esta pagina cuando quieras.'
      }
    });

    emitExtensionLog('info', 'Miracle plugin mounted.', {
      appId,
      backendUrl
    });
  } catch (error) {
    emitExtensionLog('error', 'Miracle bootstrap failed.', {
      message: error?.message || 'Unknown bootstrap error'
    });
    throw error;
  }
})();
