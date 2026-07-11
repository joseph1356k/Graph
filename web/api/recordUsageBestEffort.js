function createUsageRecorder(usageDashboardService) {
  return function recordUsageBestEffort(payload, contextLabel) {
    if (!usageDashboardService) {
      return;
    }
    try {
      usageDashboardService.recordEvent(payload);
    } catch (error) {
      console.warn(`[Usage] Skipping ${contextLabel}: ${error.message}`);
    }
  };
}

module.exports = createUsageRecorder;
