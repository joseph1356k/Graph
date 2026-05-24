const fs = require('fs');
const path = require('path');

class MarkdownCatalogWriter {
  constructor(filePath) {
    this.filePath = filePath || path.join(process.cwd(), 'WORKFLOWS.md');
  }

  formatCliExample(workflowId, variables) {
    const parts = [`node index.js "run ${workflowId}"`];

    for (const variable of variables) {
      parts.push(`--${variable.name}="..."`);
    }

    return parts.join(' ');
  }

  renderWorkflowCatalog(workflows) {
    const lines = ['# Registered Workflows', ''];

    for (const workflow of workflows) {
      lines.push(`## ${workflow.id}`);
      lines.push('');
      lines.push(`- Purpose: ${workflow.summary || workflow.description || 'No summary available.'}`);
      lines.push(`- Status: ${workflow.status || 'unknown'}`);
      lines.push(`- Context notes: ${Array.isArray(workflow.contextNotes) ? workflow.contextNotes.length : 0}`);
      lines.push(`- CLI: \`${this.formatCliExample(workflow.id, workflow.variables)}\``);
      lines.push('');
      lines.push('### Execution Guide');
      lines.push('');
      lines.push(workflow.executionGuide || 'No execution guide available.');
      lines.push('');
      lines.push('### Variables');

      if (!workflow.variables || workflow.variables.length === 0) {
        lines.push('- None');
      } else {
        for (const variable of workflow.variables) {
          const fieldLabel = variable.fieldLabel ? ` field="${variable.fieldLabel}"` : '';
          lines.push(`- \`${variable.name}\`:${fieldLabel} ${variable.prompt} (default: \`${variable.defaultValue || ''}\`)`);
        }
      }

      lines.push('');
      lines.push('### Steps');

      for (const step of workflow.steps) {
        const base = `${step.stepOrder}. ${step.actionType.toUpperCase()} ${step.selector || step.url || '(no target)'}`;
        const extras = [];

        if (step.value) extras.push(`value="${step.value}"`);
        if (step.label) extras.push(`label="${step.label}"`);
        if (step.controlType) extras.push(`control=${step.controlType}`);
        if (step.selectedLabel && step.selectedLabel !== step.value) extras.push(`selected="${step.selectedLabel}"`);
        if (step.semanticTarget) extras.push(`semanticTarget="${step.semanticTarget}"`);
        if (Array.isArray(step.surfaceHints?.alternativeTargets) && step.surfaceHints.alternativeTargets.length > 0) {
          extras.push(`alternatives=${step.surfaceHints.alternativeTargets.join(', ')}`);
        }
        if (Array.isArray(step.allowedOptions) && step.allowedOptions.length > 0) {
          extras.push(`options=${step.allowedOptions.filter((option) => option.value).map((option) => `${option.value}:${option.label || option.text || option.value}`).join(', ')}`);
        }
        if (step.url) extras.push(`url=${step.url}`);
        if (step.explanation) extras.push(`note="${step.explanation}"`);

        lines.push(`- ${base}${extras.length ? ` | ${extras.join(' | ')}` : ''}`);
      }

      if (Array.isArray(workflow.branches) && workflow.branches.length > 0) {
        lines.push('');
        lines.push('### Branches');

        for (const branch of workflow.branches) {
          lines.push(`- Branch from step ${branch.branchPointStepOrder}: target="${branch.affordanceTarget || ''}" key=\`${branch.branchKey || ''}\``);
          if (branch.sourceAffordanceTarget) {
            lines.push(`  - Source target: ${branch.sourceAffordanceTarget}`);
          }
          if (Array.isArray(branch.skippedBaseStepOrders) && branch.skippedBaseStepOrders.length > 0) {
            lines.push(`  - Skips base steps: ${branch.skippedBaseStepOrders.join(', ')}`);
          }
          if (Array.isArray(branch.stepPatches) && branch.stepPatches.length > 0) {
            lines.push(`  - Step patches: ${branch.stepPatches.length}`);
          }
          if (Array.isArray(branch.insertedSteps) && branch.insertedSteps.length > 0) {
            lines.push(`  - Inserted steps: ${branch.insertedSteps.length}`);
          }
          if (Array.isArray(branch.replacementSteps) && branch.replacementSteps.length > 0) {
            lines.push(`  - Replacement groups: ${branch.replacementSteps.length}`);
          }
          if (Array.isArray(branch.notes) && branch.notes.length > 0) {
            branch.notes.forEach((note) => lines.push(`  - Note: ${note}`));
          }
        }
      }

      lines.push('');
    }

    return lines.join('\n').trimEnd() + '\n';
  }

  writeCatalog(catalog) {
    const content = this.renderWorkflowCatalog(catalog);
    fs.writeFileSync(this.filePath, content);
  }
}

module.exports = MarkdownCatalogWriter;
