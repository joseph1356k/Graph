function hasValidInternalKey(req) {
  const expected = `${process.env.GRAPH_USAGE_INGEST_KEY || ''}`.trim();
  if (!expected) {
    return false;
  }
  const provided = `${req.get('x-graph-usage-key') || ''}`.trim();
  return Boolean(provided) && provided === expected;
}

function registerUsageRoutes(app, deps = {}) {
  const usageDashboardService = deps.usageDashboardService;

  if (!app || !usageDashboardService) {
    throw new Error('registerUsageRoutes requires app and usageDashboardService');
  }

  app.post('/api/internal/usage/events', async (req, res) => {
    if (!hasValidInternalKey(req)) {
      return res.status(401).json({ error: 'Invalid usage ingest key.' });
    }

    try {
      const event = usageDashboardService.recordEvent(req.body || {});
      res.status(201).json({ ok: true, event });
    } catch (error) {
      console.error(`[Usage] Internal ingest error: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/usage/events', async (req, res) => {
    try {
      const event = usageDashboardService.recordEvent(req.body || {});
      res.status(201).json({ ok: true, event });
    } catch (error) {
      console.warn(`[Usage] Client ingest skipped: ${error.message}`);
      res.status(202).json({ ok: false, skipped: true });
    }
  });

  app.get('/api/usage/pricing', async (req, res) => {
    res.json({
      sourceUrl: 'https://developers.openai.com/api/docs/pricing',
      capturedAt: '2026-06-17',
      pricing: usageDashboardService.getPricingCatalog()
    });
  });

  app.get('/api/usage/summary', async (req, res) => {
    try {
      const summary = usageDashboardService.buildSummary({
        from: req.query?.from || '',
        to: req.query?.to || '',
        sourceRepo: req.query?.sourceRepo || '',
        provider: req.query?.provider || '',
        eventType: req.query?.eventType || '',
        model: req.query?.model || ''
      });
      res.json(summary);
    } catch (error) {
      console.error(`[Usage] Summary error: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });
}

module.exports = registerUsageRoutes;
