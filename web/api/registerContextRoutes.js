const { statusForError, publicErrorMessage } = require('./httpErrors');

function buildSurfaceContext(body = {}, access = null) {
  const ownerId = `${access?.ownerId || ''}`.trim();
  return {
    appId: body?.appId || body?.context?.appId || '',
    sourceUrl: body?.sourceUrl || body?.context?.sourceUrl || '',
    sourceOrigin: body?.sourceOrigin || body?.context?.sourceOrigin || '',
    sourcePathname: body?.sourcePathname || body?.context?.sourcePathname || '',
    sourceTitle: body?.sourceTitle || body?.context?.sourceTitle || '',
    workflowDescription: body?.workflowDescription || '',
    assistantProfile: body?.assistantProfile || null,
    scope: ownerId ? 'private' : (body?.context?.scope || 'global'),
    ownerId: ownerId || body?.context?.ownerId || '',
    browserLocale: body?.context?.browserLocale || '',
    languageCode: body?.context?.languageCode || ''
  };
}

function registerContextRoutes(app, deps = {}) {
  const surfaceProfileService = deps.surfaceProfileService;

  if (!app || !surfaceProfileService) {
    throw new Error('registerContextRoutes requires app and surfaceProfileService');
  }

  app.post('/api/surface-profile/ensure', async (req, res) => {
    try {
      const context = buildSurfaceContext(req.body || {}, req.workflowAccess || null);
      const result = await surfaceProfileService.ensureGlobalProfile(
        {
          appId: context.appId,
          sourceUrl: context.sourceUrl,
          sourceOrigin: context.sourceOrigin,
          sourcePathname: context.sourcePathname,
          sourceTitle: context.sourceTitle,
          scope: context.scope,
          ownerId: context.ownerId,
          browserLocale: context.browserLocale,
          languageCode: context.languageCode
        },
        req.body?.pageSnapshot || {}
      );
      res.json(result);
    } catch (err) {
      console.error(`[Surface Profile] Ensure Error: ${err.message}`);
      res.status(statusForError(err)).json({ error: publicErrorMessage(err) });
    }
  });
}

module.exports = registerContextRoutes;
