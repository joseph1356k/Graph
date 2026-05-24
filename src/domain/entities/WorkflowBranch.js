function normalizeText(value = '') {
  return `${value || ''}`.replace(/\s+/g, ' ').trim();
}

function normalizeKeyText(value = '') {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeNumberArray(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry));
}

function normalizeObjectArray(value) {
  return (Array.isArray(value) ? value : [])
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({ ...entry }));
}

function normalizeNotes(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

class WorkflowBranch {
  constructor(data = {}) {
    this.id = normalizeText(data.id);
    this.workflowId = normalizeText(data.workflowId);
    this.branchPointStepOrder = Number(data.branchPointStepOrder);
    this.branchKey = normalizeText(data.branchKey);
    this.affordanceTarget = normalizeText(data.affordanceTarget || data.target);
    this.sourceAffordanceTarget = normalizeText(data.sourceAffordanceTarget || data.sourceTarget);
    this.skippedBaseStepOrders = normalizeNumberArray(data.skippedBaseStepOrders || data.skipStepOrders);
    this.stepPatches = normalizeObjectArray(data.stepPatches);
    this.insertedSteps = normalizeObjectArray(data.insertedSteps);
    this.replacementSteps = normalizeObjectArray(data.replacementSteps);
    this.notes = normalizeNotes(data.notes);
    this.evidence = data.evidence && typeof data.evidence === 'object' && !Array.isArray(data.evidence)
      ? { ...data.evidence }
      : {};
    this.status = normalizeText(data.status) || 'active';
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  static buildBranchKey(workflowId, branchPointStepOrder, affordanceTarget) {
    const target = normalizeKeyText(affordanceTarget);
    if (!workflowId || !Number.isFinite(Number(branchPointStepOrder)) || !target) {
      return '';
    }
    return `workflow:${workflowId}|step:${Number(branchPointStepOrder)}|target:${target}`;
  }

  ensureIdentity() {
    if (!this.branchKey) {
      this.branchKey = WorkflowBranch.buildBranchKey(
        this.workflowId,
        this.branchPointStepOrder,
        this.affordanceTarget
      );
    }
    if (!this.id && this.branchKey) {
      this.id = `branch_${Buffer.from(this.branchKey).toString('base64url')}`;
    }
  }

  toJSON() {
    this.ensureIdentity();
    return {
      id: this.id,
      workflowId: this.workflowId,
      branchPointStepOrder: this.branchPointStepOrder,
      branchKey: this.branchKey,
      affordanceTarget: this.affordanceTarget,
      sourceAffordanceTarget: this.sourceAffordanceTarget,
      skippedBaseStepOrders: this.skippedBaseStepOrders,
      stepPatches: this.stepPatches,
      insertedSteps: this.insertedSteps,
      replacementSteps: this.replacementSteps,
      notes: this.notes,
      evidence: this.evidence,
      status: this.status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = WorkflowBranch;
