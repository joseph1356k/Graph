const WorkflowBranch = require('../../domain/entities/WorkflowBranch');

class WorkflowBranchLearning {
  constructor(repository, catalogService = null) {
    this.repository = repository;
    this.catalogService = catalogService;
  }

  normalizeObservation(workflowId, observation = {}) {
    const branchContext = observation.branchContext || {};
    const branchPointStepOrder = Number(
      observation.branchPointStepOrder || branchContext.branchPointStepOrder
    );
    const affordanceTarget = `${observation.affordanceTarget || branchContext.affordanceTarget || ''}`.trim();
    const sourceAffordanceTarget = `${observation.sourceAffordanceTarget || branchContext.sourceAffordanceTarget || ''}`.trim();
    const branchKey = observation.branchKey
      || branchContext.branchKey
      || WorkflowBranch.buildBranchKey(workflowId, branchPointStepOrder, affordanceTarget);

    const skippedBaseStepOrders = (Array.isArray(observation.skippedBaseStepOrders)
      ? observation.skippedBaseStepOrders
      : observation.skipStepOrders || [])
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry));

    const stepPatches = Array.isArray(observation.stepPatches) ? observation.stepPatches : [];
    const insertedSteps = Array.isArray(observation.insertedSteps) ? observation.insertedSteps : [];
    const replacementSteps = Array.isArray(observation.replacementSteps) ? observation.replacementSteps : [];
    const notes = Array.isArray(observation.notes) ? observation.notes : [];

    return new WorkflowBranch({
      workflowId,
      branchPointStepOrder,
      branchKey,
      affordanceTarget,
      sourceAffordanceTarget,
      skippedBaseStepOrders,
      stepPatches,
      insertedSteps,
      replacementSteps,
      notes,
      evidence: {
        source: observation.source || 'runtime_observation',
        trigger: observation.trigger || '',
        completed: Boolean(observation.completed),
        observedAt: Date.now(),
        decisions: Array.isArray(observation.decisions) ? observation.decisions : []
      },
      status: 'active'
    }).toJSON();
  }

  hasReusableLearning(branch = {}) {
    return Boolean(
      branch.branchKey
      && (
        branch.skippedBaseStepOrders?.length > 0
        || branch.stepPatches?.length > 0
        || branch.insertedSteps?.length > 0
        || branch.replacementSteps?.length > 0
        || branch.notes?.length > 0
      )
    );
  }

  async recordObservation(workflowId, observation = {}) {
    if (!workflowId) {
      throw new Error('workflowId is required');
    }

    const branch = this.normalizeObservation(workflowId, observation);
    if (!this.hasReusableLearning(branch)) {
      return {
        saved: false,
        reason: 'observation has no reusable branch learning',
        branch
      };
    }

    const savedBranch = await this.repository.upsertWorkflowBranch(branch);
    if (this.catalogService && typeof this.catalogService.rebuildCatalogFile === 'function') {
      await this.catalogService.rebuildCatalogFile();
    }
    return {
      saved: true,
      branch: savedBranch
    };
  }
}

module.exports = WorkflowBranchLearning;
