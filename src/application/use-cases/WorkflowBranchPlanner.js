const WorkflowBranch = require('../../domain/entities/WorkflowBranch');
const TransversalWorkflowComposer = require('./TransversalWorkflowComposer');

class WorkflowBranchPlanner {
  constructor(transversalComposer = new TransversalWorkflowComposer()) {
    this.transversalComposer = transversalComposer;
  }

  detectActiveBranch(workflow = {}, variables = {}) {
    const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
    for (const step of steps) {
      if (!this.transversalComposer.hasTargetOverride(step, variables)) {
        continue;
      }
      const target = this.transversalComposer.getRequestedTarget(step, variables);
      const sourceTarget = this.transversalComposer.getBaselineTarget(step);
      const branchPointStepOrder = Number(step.stepOrder);
      const branchKey = WorkflowBranch.buildBranchKey(workflow.id, branchPointStepOrder, target);
      if (!branchKey) {
        continue;
      }
      return {
        workflowId: workflow.id || '',
        branchPointStepOrder,
        branchKey,
        affordanceTarget: target,
        sourceAffordanceTarget: sourceTarget
      };
    }
    return null;
  }

  findMatchingBranch(branches = [], activeBranch = null) {
    if (!activeBranch?.branchKey) {
      return null;
    }
    return (Array.isArray(branches) ? branches : []).find((branch) => {
      return branch?.status !== 'disabled' && branch?.branchKey === activeBranch.branchKey;
    }) || null;
  }

  applyStepPatches(steps = [], patches = []) {
    if (!Array.isArray(patches) || patches.length === 0) {
      return steps;
    }
    return steps.map((step) => {
      const patch = patches.find((entry) => Number(entry?.stepOrder) === Number(step.stepOrder));
      if (!patch) {
        return step;
      }
      return {
        ...step,
        ...patch,
        stepOrder: step.stepOrder
      };
    });
  }

  applyReplacementSteps(steps = [], replacements = []) {
    if (!Array.isArray(replacements) || replacements.length === 0) {
      return steps;
    }

    const replacementsByOrder = new Map();
    replacements.forEach((entry) => {
      const order = Number(entry?.replaceStepOrder || entry?.stepOrder);
      const replacementSteps = Array.isArray(entry?.steps) ? entry.steps : [];
      if (Number.isFinite(order) && replacementSteps.length > 0) {
        replacementsByOrder.set(order, replacementSteps.map((step) => ({ ...step })));
      }
    });

    if (replacementsByOrder.size === 0) {
      return steps;
    }

    return steps.flatMap((step) => {
      const replacement = replacementsByOrder.get(Number(step.stepOrder));
      return replacement || [step];
    });
  }

  applyInsertedSteps(steps = [], insertedSteps = []) {
    if (!Array.isArray(insertedSteps) || insertedSteps.length === 0) {
      return steps;
    }

    const insertsByOrder = new Map();
    insertedSteps.forEach((entry) => {
      const afterStepOrder = Number(entry?.afterStepOrder);
      if (!Number.isFinite(afterStepOrder)) {
        return;
      }
      const inserted = { ...entry };
      delete inserted.afterStepOrder;
      const current = insertsByOrder.get(afterStepOrder) || [];
      current.push(inserted);
      insertsByOrder.set(afterStepOrder, current);
    });

    return steps.flatMap((step) => {
      const inserts = insertsByOrder.get(Number(step.stepOrder)) || [];
      return [step, ...inserts];
    });
  }

  applyBranch(steps = [], branch = null) {
    if (!branch) {
      return steps;
    }

    const skipped = new Set(
      (Array.isArray(branch.skippedBaseStepOrders) ? branch.skippedBaseStepOrders : [])
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry))
    );

    let plannedSteps = steps.filter((step) => !skipped.has(Number(step.stepOrder)));
    plannedSteps = this.applyStepPatches(plannedSteps, branch.stepPatches || []);
    plannedSteps = this.applyReplacementSteps(plannedSteps, branch.replacementSteps || []);
    plannedSteps = this.applyInsertedSteps(plannedSteps, branch.insertedSteps || []);
    return plannedSteps;
  }

  plan(workflow = {}, variables = {}, branches = []) {
    const composedSteps = this.transversalComposer.composeSteps(workflow.steps || [], variables);
    const activeBranch = this.detectActiveBranch(workflow, variables);
    const matchingBranch = this.findMatchingBranch(branches, activeBranch);
    const steps = this.applyBranch(composedSteps, matchingBranch);

    return {
      steps,
      branchContext: activeBranch
        ? {
            ...activeBranch,
            appliedBranchId: matchingBranch?.id || '',
            applied: Boolean(matchingBranch)
          }
        : null
    };
  }
}

module.exports = WorkflowBranchPlanner;
