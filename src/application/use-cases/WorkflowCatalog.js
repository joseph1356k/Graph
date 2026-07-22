const Workflow = require('../../domain/entities/Workflow');
const Step = require('../../domain/entities/Step');

class WorkflowCatalog {
  constructor(repository, catalogWriter) {
    this.repository = repository;
    this.catalogWriter = catalogWriter; // In a 10/10 architecture, we would emit an event instead
  }

  normalizeAccess(access = null) {
    if (!access || typeof access !== 'object') {
      return { restricted: false, ownerId: '', includeGlobal: true };
    }
    const ownerId = `${access.ownerId || ''}`.trim();
    return {
      restricted: Boolean(ownerId),
      ownerId,
      includeGlobal: access.includeGlobal !== false,
      canManageGlobalWorkflows: Boolean(access.canManageGlobalWorkflows)
    };
  }

  isRestrictedAccess(access = null) {
    return this.normalizeAccess(access).restricted;
  }

  canMutateWorkflow(workflow = {}, access = null) {
    const normalized = this.normalizeAccess(access);
    if (!normalized.restricted) {
      return true;
    }
    const workflowOwnerId = `${workflow.ownerId || ''}`.trim();
    const workflowScope = `${workflow.scope || (workflowOwnerId ? 'private' : 'global')}`.trim() || 'global';
    if (normalized.canManageGlobalWorkflows && workflowScope === 'global') {
      return true;
    }
    return workflowOwnerId === normalized.ownerId && workflowScope !== 'global';
  }

  assertMutableWorkflow(workflow = {}, access = null) {
    if (!this.canMutateWorkflow(workflow, access)) {
      throw new Error('Workflow not found');
    }
  }

  async writeCatalogIfUnrestricted(access = null) {
    if (this.catalogWriter && !this.isRestrictedAccess(access)) {
      this.catalogWriter.writeCatalog(await this.getCatalog(access));
    }
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
          scope: row.scope || (row.ownerId ? 'private' : 'global'),
          ownerId: row.ownerId || '',
          appId: row.appId,
          sourceUrl: row.sourceUrl,
          sourceOrigin: row.sourceOrigin,
          sourcePathname: row.sourcePathname,
          sourceTitle: row.sourceTitle,
          contextNotes: parseContextNotes(row.contextNotes),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          completedAt: row.completedAt,
          publishedFromWorkflowId: row.publishedFromWorkflowId,
          publishedByOwnerId: row.publishedByOwnerId,
          publishedAt: row.publishedAt,
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
          surfaceSection: row.surfaceSection,
          surfaceHints: row.surfaceHints,
          allowedOptions: row.allowedOptions,
          valueMode: row.valueMode,
          bindTo: row.bindTo,
          stepOrder: row.stepOrder
        });
      }
    }

    return Array.from(grouped.values()).map(data => {
      const workflow = new Workflow(data).toJSON();
      workflow.branches = Array.isArray(data.branches) ? data.branches : [];
      return workflow;
    });
  }

  async getCatalog(access = null) {
    const rows = await this.repository.getWorkflowRows(null, access);
    const workflows = this.groupWorkflowRows(rows);
    if (typeof this.repository.listWorkflowBranches !== 'function') {
      return workflows;
    }
    for (const workflow of workflows) {
      workflow.branches = await this.repository.listWorkflowBranches(workflow.id, access);
    }
    return workflows;
  }

  async getWorkflowById(workflowId, access = null) {
    const rows = await this.repository.getWorkflowRows(workflowId, access);
    const workflows = this.groupWorkflowRows(rows);
    const workflow = workflows[0] || null;
    if (!workflow) {
      return null;
    }
    if (typeof this.repository.listWorkflowBranches === 'function') {
      workflow.branches = await this.repository.listWorkflowBranches(workflowId, access);
    }
    return workflow;
  }

  async saveWorkflow(workflowData, access = null) {
    const normalized = this.normalizeAccess(access);
    const ownedWorkflowData = normalized.restricted
      ? { ...workflowData, scope: 'private', ownerId: normalized.ownerId }
      : workflowData;
    const workflow = new Workflow(ownedWorkflowData);
    const existing = await this.getWorkflowById(workflow.id);
    if (existing) {
      throw new Error(`Workflow ${workflow.id} already exists`);
    }
    
    await this.repository.createFullWorkflow(workflow.toJSON());
    
    await this.writeCatalogIfUnrestricted(access);
    return this.getWorkflowById(workflow.id, access);
  }

  buildGlobalWorkflowId(workflowId) {
    const normalized = `${workflowId || ''}`.trim();
    if (!normalized) {
      throw new Error('Workflow id is required');
    }
    return normalized.startsWith('global_') ? normalized : `global_${normalized}`;
  }

  async publishWorkflowGlobal(workflowId, access = null) {
    const normalized = this.normalizeAccess(access);
    if (!normalized.restricted || !normalized.canManageGlobalWorkflows) {
      throw new Error('Workflow not found');
    }

    const source = await this.getWorkflowById(workflowId, {
      ...normalized,
      includeGlobal: false
    });
    if (!source) {
      throw new Error('Workflow not found');
    }

    const sourceOwnerId = `${source.ownerId || ''}`.trim();
    const sourceScope = `${source.scope || (sourceOwnerId ? 'private' : 'global')}`.trim() || 'global';
    if (sourceScope === 'global' || sourceOwnerId !== normalized.ownerId) {
      throw new Error('Workflow not found');
    }

    const globalWorkflowId = this.buildGlobalWorkflowId(source.id);
    const publishedAt = Date.now();
    const globalWorkflow = new Workflow({
      ...source,
      id: globalWorkflowId,
      scope: 'global',
      ownerId: '',
      status: source.status || 'done',
      publishedFromWorkflowId: source.id,
      publishedByOwnerId: normalized.ownerId,
      publishedAt,
      createdAt: undefined,
      updatedAt: undefined
    }).toJSON();

    const existingGlobal = await this.getWorkflowById(globalWorkflowId, {
      ownerId: normalized.ownerId,
      includeGlobal: true,
      canManageGlobalWorkflows: true
    });

    if (existingGlobal) {
      await this.repository.updateFullWorkflow({
        ...existingGlobal,
        ...globalWorkflow,
        createdAt: existingGlobal.createdAt,
        completedAt: existingGlobal.completedAt || globalWorkflow.completedAt
      });
    } else {
      await this.repository.createFullWorkflow(globalWorkflow);
    }

    await this.writeCatalogIfUnrestricted(access);
    return this.getWorkflowById(globalWorkflowId, {
      ownerId: normalized.ownerId,
      includeGlobal: true,
      canManageGlobalWorkflows: true
    });
  }

  async updateWorkflow(workflowData, access = null) {
    const workflow = new Workflow(workflowData);
    const existing = await this.getWorkflowById(workflow.id, access);
    if (!existing) {
      throw new Error('Workflow not found');
    }
    this.assertMutableWorkflow(existing, access);

    const mergedWorkflow = new Workflow({
      ...existing,
      ...workflowData,
      scope: existing.scope,
      ownerId: existing.ownerId,
      publishedFromWorkflowId: existing.publishedFromWorkflowId,
      publishedByOwnerId: existing.publishedByOwnerId,
      publishedAt: existing.publishedAt,
      executionGuide: Object.prototype.hasOwnProperty.call(workflowData || {}, 'executionGuide')
        ? workflowData.executionGuide
        : existing.executionGuide,
      steps: Array.isArray(workflowData?.steps) ? workflowData.steps : existing.steps,
      contextNotes: Array.isArray(workflowData?.contextNotes) ? workflowData.contextNotes : existing.contextNotes
    });

    await this.repository.updateFullWorkflow(mergedWorkflow.toJSON());
    
    await this.writeCatalogIfUnrestricted(access);
    return this.getWorkflowById(workflow.id, access);
  }

  async deleteWorkflow(workflowId, access = null) {
    const existing = await this.getWorkflowById(workflowId, access);
    if (!existing) {
      throw new Error('Workflow not found');
    }
    this.assertMutableWorkflow(existing, access);
    await this.repository.deleteWorkflow(workflowId, access);
    
    await this.writeCatalogIfUnrestricted(access);
  }

  async rebuildCatalogFile(access = null) {
    if (this.catalogWriter && !this.isRestrictedAccess(access)) {
      const catalog = await this.getCatalog(access);
      this.catalogWriter.writeCatalog(catalog);
    }
  }
}

module.exports = WorkflowCatalog;
