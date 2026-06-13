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
  const generatePitchArtifacts = deps.generatePitchArtifacts;
  const conversationInsights = deps.conversationInsights;
  const catalogService = deps.catalogService;
  const surfaceProfileService = deps.surfaceProfileService;

  if (!app || !generatePitchArtifacts || !conversationInsights || !catalogService || !surfaceProfileService) {
    throw new Error('registerContextRoutes requires app, generatePitchArtifacts, conversationInsights, catalogService, and surfaceProfileService');
  }

  app.post('/api/pitch/generate', async (req, res) => {
    try {
      const context = buildSurfaceContext(req.body || {}, req.workflowAccess || null);
      const result = await generatePitchArtifacts.execute(context, req.workflowAccess || null);
      res.status(201).json(result);
    } catch (err) {
      console.error(`[Pitch] Generate Error: ${err.message}`);
      res.status(statusForError(err)).json({ error: publicErrorMessage(err) });
    }
  });

  app.post('/api/pitch/improvements', async (req, res) => {
    try {
      const context = buildSurfaceContext(req.body || {}, req.workflowAccess || null);
      const result = await generatePitchArtifacts.previewImprovements(context, req.workflowAccess || null);
      res.json(result);
    } catch (err) {
      console.error(`[Pitch] Improvement Preview Error: ${err.message}`);
      res.status(statusForError(err)).json({ error: publicErrorMessage(err) });
    }
  });

  app.post('/api/voice/complaints/process', async (req, res) => {
    try {
      const context = buildSurfaceContext(req.body || {}, req.workflowAccess || null);
      const workflows = generatePitchArtifacts.filterWorkflowsForContext(
        await catalogService.getCatalog(req.workflowAccess || null),
        context
      );
      const result = await conversationInsights.processComplaints(context, workflows);
      res.json(result);
    } catch (err) {
      console.error(`[Voice Complaints] Process Error: ${err.message}`);
      res.status(statusForError(err)).json({ error: publicErrorMessage(err) });
    }
  });

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
const { statusForError, publicErrorMessage } = require('./httpErrors');
