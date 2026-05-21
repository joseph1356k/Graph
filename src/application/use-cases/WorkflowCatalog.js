const Workflow = require('../../domain/entities/Workflow');
const Step = require('../../domain/entities/Step');

class WorkflowCatalog {
  constructor(repository, catalogWriter) {
    this.repository = repository;
    this.catalogWriter = catalogWriter; // In a 10/10 architecture, we would emit an event instead
  }

  groupWorkflowRows(rows) {
    const grouped = new Map();

    function parseContextNotes(rawValue) {
      if (Array.isArray(rawValue)) {
        return rawValue;
      }
      if (!rawValue) {
        return [];
      }
      try {
        const parsed = JSON.parse(rawValue);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        return [];
      }
    }

    for (const row of rows) {
      if (!grouped.has(row.id)) {
        grouped.set(row.id, {
          id: row.id,
          description: row.description,
          summary: row.summary,
          executionGuide: row.executionGuide,
          status: row.status,
          appId: row.appId,
          sourceUrl: row.sourceUrl,
          sourceOrigin: row.sourceOrigin,
          sourcePathname: row.sourcePathname,
          sourceTitle: row.sourceTitle,
          contextNotes: parseContextNotes(row.contextNotes),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          completedAt: row.completedAt,
          steps: []
        });
      }

      if (row.actionType || row.url || row.selector) {
        grouped.get(row.id).steps.push({
          actionType: row.actionType,
          selector: row.selector,
          value: row.value,
          url: row.url,
          explanation: row.explanation,
          label: row.label,
          controlType: row.controlType,
          selectedValue: row.selectedValue,
          selectedLabel: row.selectedLabel,
          semanticTarget: row.semanticTarget,
          surfaceHints: row.surfaceHints,
          allowedOptions: row.allowedOptions,
          stepOrder: row.stepOrder
        });
      }
    }

    return Array.from(grouped.values()).map(data => new Workflow(data).toJSON());
  }

  async getCatalog() {
    const rows = await this.repository.getWorkflowRows();
    return this.groupWorkflowRows(rows);
  }

  async getWorkflowById(workflowId) {
    const rows = await this.repository.getWorkflowRows(workflowId);
    const workflows = this.groupWorkflowRows(rows);
    return workflows[0] || null;
  }

  async saveWorkflow(workflowData) {
    const workflow = new Workflow(workflowData);
    const existing = await this.getWorkflowById(workflow.id);
    if (existing) {
      throw new Error(`Workflow ${workflow.id} already exists`);
    }
    
    await this.repository.createFullWorkflow(workflow.toJSON());
    
    if (this.catalogWriter) {
      this.catalogWriter.writeCatalog(await this.getCatalog());
    }
    return this.getWorkflowById(workflow.id);
  }

  async updateWorkflow(workflowData) {
    const workflow = new Workflow(workflowData);
    const existing = await this.getWorkflowById(workflow.id);
    if (!existing) {
      throw new Error('Workflow not found');
    }

    const mergedWorkflow = new Workflow({
      ...existing,
      ...workflowData,
      executionGuide: Object.prototype.hasOwnProperty.call(workflowData || {}, 'executionGuide')
        ? workflowData.executionGuide
        : existing.executionGuide,
      steps: Array.isArray(workflowData?.steps) ? workflowData.steps : existing.steps,
      contextNotes: Array.isArray(workflowData?.contextNotes) ? workflowData.contextNotes : existing.contextNotes
    });

    await this.repository.updateFullWorkflow(mergedWorkflow.toJSON());
    
    if (this.catalogWriter) {
      this.catalogWriter.writeCatalog(await this.getCatalog());
    }
    return this.getWorkflowById(workflow.id);
  }

  async deleteWorkflow(workflowId) {
    const existing = await this.getWorkflowById(workflowId);
    if (!existing) {
      throw new Error('Workflow not found');
    }
    await this.repository.deleteWorkflow(workflowId);
    
    if (this.catalogWriter) {
      this.catalogWriter.writeCatalog(await this.getCatalog());
    }
  }

  async rebuildCatalogFile() {
    if (this.catalogWriter) {
      const catalog = await this.getCatalog();
      this.catalogWriter.writeCatalog(catalog);
    }
  }
}

module.exports = WorkflowCatalog;
