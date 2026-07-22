class Neo4jWorkflowRepository {
  constructor(db) {
    this.db = db;
  }

  serializeAllowedOptions(rawValue) {
    if (Array.isArray(rawValue)) {
      return JSON.stringify(rawValue);
    }
    if (typeof rawValue === 'string') {
      return rawValue;
    }
    return '[]';
  }

  serializeJsonObject(rawValue) {
    if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      return JSON.stringify(rawValue);
    }
    if (typeof rawValue === 'string') {
      return rawValue;
    }
    return '';
  }

  parseJsonArray(rawValue) {
    if (Array.isArray(rawValue)) {
      return rawValue;
    }
    if (!rawValue || typeof rawValue !== 'string') {
      return [];
    }
    try {
      const parsed = JSON.parse(rawValue);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  parseJsonObject(rawValue) {
    if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      return rawValue;
    }
    if (!rawValue || typeof rawValue !== 'string') {
      return null;
    }
    try {
      const parsed = JSON.parse(rawValue);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  serializeJsonArray(rawValue) {
    if (Array.isArray(rawValue)) {
      return JSON.stringify(rawValue);
    }
    if (typeof rawValue === 'string') {
      return rawValue;
    }
    return '[]';
  }

  buildSurfaceProfileId(appId, sourceOrigin, sourcePathname, scope = 'global', ownerId = '', languageCode = 'es') {
    const normalizedAppId = `${appId || 'page'}`.trim() || 'page';
    const normalizedOrigin = `${sourceOrigin || 'unknown-origin'}`.trim() || 'unknown-origin';
    const normalizedPath = `${sourcePathname || '/'}`.trim() || '/';
    const normalizedScope = `${scope || 'global'}`.trim() || 'global';
    const normalizedOwnerId = `${ownerId || ''}`.trim() || 'shared';
    const normalizedLanguage = `${languageCode || 'es'}`.trim() || 'es';
    return `surface:${normalizedScope}:${normalizedAppId}:${normalizedOrigin}:${normalizedPath}:${normalizedOwnerId}:${normalizedLanguage}`;
  }

  toNativeNumber(value) {
    if (value && typeof value.toNumber === 'function') return value.toNumber();
    return Number(value);
  }

  normalizeWorkflowAccess(access = null) {
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

  buildWorkflowVisibilityClause(alias = 'w', access = null, params = {}) {
    const normalized = this.normalizeWorkflowAccess(access);
    if (!normalized.restricted) {
      return '';
    }
    params.accessOwnerId = normalized.ownerId;
    const ownedClause = `${alias}.ownerId = $accessOwnerId`;
    if (!normalized.includeGlobal) {
      return ownedClause;
    }
    return `(${ownedClause} OR ${alias}.scope = 'global' OR coalesce(${alias}.ownerId, '') = '')`;
  }

  buildMutableWorkflowClause(alias = 'w', access = null, params = {}) {
    const normalized = this.normalizeWorkflowAccess(access);
    if (!normalized.restricted) {
      return '';
    }
    params.accessOwnerId = normalized.ownerId;
    if (normalized.canManageGlobalWorkflows) {
      return `((${alias}.ownerId = $accessOwnerId AND coalesce(${alias}.scope, 'private') <> 'global') OR ${alias}.scope = 'global')`;
    }
    return `(${alias}.ownerId = $accessOwnerId AND coalesce(${alias}.scope, 'private') <> 'global')`;
  }

  async getWorkflowRows(workflowId = null, access = null) {
    const params = {};
    const clauses = [];
    if (workflowId) {
      params.id = workflowId;
      clauses.push('w.id = $id');
    }
    const visibilityClause = this.buildWorkflowVisibilityClause('w', access, params);
    if (visibilityClause) {
      clauses.push(visibilityClause);
    }
    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    return this.db.run(`
      MATCH (w:Workflow)
      ${whereClause}
      OPTIONAL MATCH (w)-[:HAS_STEP]->(s:Step)
      RETURN w.id as id,
             w.description as description,
             w.summary as summary,
             w.executionGuide as executionGuide,
             w.status as status,
             w.scope as scope,
             w.ownerId as ownerId,
             w.appId as appId,
             w.sourceUrl as sourceUrl,
             w.sourceOrigin as sourceOrigin,
             w.sourcePathname as sourcePathname,
             w.sourceTitle as sourceTitle,
             w.contextNotes as contextNotes,
             w.createdAt as createdAt,
             w.updatedAt as updatedAt,
             w.completedAt as completedAt,
             w.publishedFromWorkflowId as publishedFromWorkflowId,
             w.publishedByOwnerId as publishedByOwnerId,
             w.publishedAt as publishedAt,
             s.actionType as actionType,
             s.selector as selector,
             s.value as value,
             s.url as url,
             s.explanation as explanation,
             s.label as label,
             s.controlType as controlType,
             s.selectedValue as selectedValue,
             s.selectedLabel as selectedLabel,
             s.semanticTarget as semanticTarget,
             s.surfaceSection as surfaceSection,
             s.surfaceHints as surfaceHints,
             s.allowedOptions as allowedOptions,
             s.valueMode as valueMode,
             s.bindTo as bindTo,
             s.stepOrder as stepOrder
      ORDER BY w.id ASC, s.stepOrder ASC
    `, params);
  }

  async listWorkflowBranches(workflowId, access = null) {
    const params = { workflowId };
    const visibilityClause = this.buildWorkflowVisibilityClause('w', access, params);
    const whereClause = visibilityClause ? `WHERE ${visibilityClause}` : '';
    const rows = await this.db.run(`
      MATCH (w:Workflow {id: $workflowId})
      ${whereClause}
      MATCH (w)-[:HAS_BRANCH]->(b:WorkflowBranch)
      RETURN b.id as id,
             b.workflowId as workflowId,
             b.branchPointStepOrder as branchPointStepOrder,
             b.branchKey as branchKey,
             b.affordanceTarget as affordanceTarget,
             b.sourceAffordanceTarget as sourceAffordanceTarget,
             b.skippedBaseStepOrders as skippedBaseStepOrders,
             b.stepPatches as stepPatches,
             b.insertedSteps as insertedSteps,
             b.replacementSteps as replacementSteps,
             b.notes as notes,
             b.evidence as evidence,
             b.status as status,
             b.createdAt as createdAt,
             b.updatedAt as updatedAt
      ORDER BY b.branchPointStepOrder ASC, b.affordanceTarget ASC
    `, params);

    return rows.map((row) => ({
      id: row.id || '',
      workflowId: row.workflowId || workflowId,
      branchPointStepOrder: this.toNativeNumber(row.branchPointStepOrder),
      branchKey: row.branchKey || '',
      affordanceTarget: row.affordanceTarget || '',
      sourceAffordanceTarget: row.sourceAffordanceTarget || '',
      skippedBaseStepOrders: this.parseJsonArray(row.skippedBaseStepOrders).map((value) => Number(value)).filter((value) => Number.isFinite(value)),
      stepPatches: this.parseJsonArray(row.stepPatches),
      insertedSteps: this.parseJsonArray(row.insertedSteps),
      replacementSteps: this.parseJsonArray(row.replacementSteps),
      notes: this.parseJsonArray(row.notes),
      evidence: this.parseJsonObject(row.evidence) || {},
      status: row.status || 'active',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  }

  async upsertWorkflowBranch(branch = {}, access = null) {
    const branchId = `${branch.id || ''}`.trim();
    const workflowId = `${branch.workflowId || ''}`.trim();
    const branchKey = `${branch.branchKey || ''}`.trim();
    if (!branchId || !workflowId || !branchKey) {
      throw new Error('Workflow branch requires id, workflowId, and branchKey');
    }

    const params = {
      id: branchId,
      workflowId,
      branchPointStepOrder: Number(branch.branchPointStepOrder),
      branchKey,
      affordanceTarget: `${branch.affordanceTarget || ''}`.trim(),
      sourceAffordanceTarget: `${branch.sourceAffordanceTarget || ''}`.trim(),
      skippedBaseStepOrders: this.serializeJsonArray(branch.skippedBaseStepOrders),
      stepPatches: this.serializeJsonArray(branch.stepPatches),
      insertedSteps: this.serializeJsonArray(branch.insertedSteps),
      replacementSteps: this.serializeJsonArray(branch.replacementSteps),
      notes: this.serializeJsonArray(branch.notes),
      evidence: this.serializeJsonObject(branch.evidence),
      status: `${branch.status || 'active'}`.trim() || 'active'
    };
    const mutableClause = this.buildMutableWorkflowClause('w', access, params);
    const whereClause = mutableClause ? `WHERE ${mutableClause}` : '';

    await this.db.run(`
      MATCH (w:Workflow {id: $workflowId})
      ${whereClause}
      MERGE (b:WorkflowBranch {id: $id})
      ON CREATE SET b.createdAt = timestamp()
      SET b.workflowId = $workflowId,
          b.branchPointStepOrder = $branchPointStepOrder,
          b.branchKey = $branchKey,
          b.affordanceTarget = $affordanceTarget,
          b.sourceAffordanceTarget = $sourceAffordanceTarget,
          b.skippedBaseStepOrders = $skippedBaseStepOrders,
          b.stepPatches = $stepPatches,
          b.insertedSteps = $insertedSteps,
          b.replacementSteps = $replacementSteps,
          b.notes = $notes,
          b.evidence = $evidence,
          b.status = $status,
          b.updatedAt = timestamp()
      MERGE (w)-[:HAS_BRANCH]->(b)
    `, params);

    const branches = await this.listWorkflowBranches(workflowId, access);
    return branches.find((entry) => entry.id === branchId) || branch;
  }

  async startWorkflow(id, description, context = {}, access = null) {
    const normalizedAccess = this.normalizeWorkflowAccess(access);
    const ownerId = normalizedAccess.restricted
      ? normalizedAccess.ownerId
      : `${context.ownerId || ''}`.trim();
    const scope = ownerId ? 'private' : `${context.scope || 'global'}`.trim() || 'global';
    await this.db.run(
      `CREATE (w:Workflow {
        id: $id,
        description: $desc,
        status: "recording",
        scope: $scope,
        ownerId: $ownerId,
        appId: $appId,
        sourceUrl: $sourceUrl,
        sourceOrigin: $sourceOrigin,
        sourcePathname: $sourcePathname,
        sourceTitle: $sourceTitle,
        contextNotes: $contextNotes,
        createdAt: timestamp()
      })`,
      {
        id,
        desc: description,
        scope,
        ownerId,
        appId: context.appId || '',
        sourceUrl: context.sourceUrl || '',
        sourceOrigin: context.sourceOrigin || '',
        sourcePathname: context.sourcePathname || '',
        sourceTitle: context.sourceTitle || '',
        contextNotes: JSON.stringify(Array.isArray(context.contextNotes) ? context.contextNotes : [])
      }
    );
  }

  async getStepCount(workflowId, access = null) {
    const params = { wfId: workflowId };
    const mutableClause = this.buildMutableWorkflowClause('w', access, params);
    const whereClause = mutableClause ? `WHERE ${mutableClause}` : '';
    const countResult = await this.db.run(`
      MATCH (w:Workflow {id: $wfId})-[:HAS_STEP]->(s:Step)
      ${whereClause}
      RETURN count(s) as total
    `, params);
    return this.toNativeNumber(countResult[0]?.total || 0);
  }

  async addStep(workflowId, step, nextStepOrder, access = null) {
    const params = {
      wfId: workflowId,
      ...step,
      surfaceHints: this.serializeJsonObject(step.surfaceHints),
      allowedOptions: this.serializeAllowedOptions(step.allowedOptions),
      stepOrder: nextStepOrder
    };
    const mutableClause = this.buildMutableWorkflowClause('w', access, params);
    const whereClause = mutableClause ? `WHERE ${mutableClause}` : '';
    await this.db.run(`
      MATCH (w:Workflow {id: $wfId})
      ${whereClause}
      CREATE (s:Step {
        actionType: $actionType,
        selector: $selector,
        value: $value,
        url: $url,
        explanation: $explanation,
        label: $label,
        controlType: $controlType,
        selectedValue: $selectedValue,
        selectedLabel: $selectedLabel,
        semanticTarget: $semanticTarget,
        surfaceSection: $surfaceSection,
        surfaceHints: $surfaceHints,
        allowedOptions: $allowedOptions,
        stepOrder: $stepOrder,
        timestamp: timestamp()
      })
      CREATE (w)-[:HAS_STEP]->(s)
    `, params);
  }

  async addContextNote(workflowId, note, access = null) {
    const params = { id: workflowId };
    const mutableClause = this.buildMutableWorkflowClause('w', access, params);
    const whereClause = mutableClause ? `WHERE ${mutableClause}` : '';
    const existing = await this.db.run(
      `MATCH (w:Workflow {id: $id}) ${whereClause} RETURN w.contextNotes as contextNotes`,
      params
    );
    if (this.normalizeWorkflowAccess(access).restricted && existing.length === 0) {
      throw new Error('Workflow not found');
    }

    const raw = existing[0]?.contextNotes || '[]';
    let currentNotes = [];
    if (Array.isArray(raw)) {
      currentNotes = raw;
    } else {
      try {
        currentNotes = JSON.parse(raw);
        if (!Array.isArray(currentNotes)) {
          currentNotes = [];
        }
      } catch (error) {
        currentNotes = [];
      }
    }

    currentNotes.push({
      transcript: `${note.transcript || ''}`.trim(),
      role: `${note.role || 'user'}`.trim() || 'user',
      mode: `${note.mode || 'unknown'}`.trim() || 'unknown',
      capturedAt: Number(note.capturedAt) || Date.now()
    });

    await this.db.run(
      `MATCH (w:Workflow {id: $id}) ${whereClause} SET w.contextNotes = $contextNotes, w.updatedAt = timestamp()`,
      {
        ...params,
        contextNotes: JSON.stringify(currentNotes)
      }
    );
  }

  async getSurfaceProfile(appId, sourceOrigin, sourcePathname, scope = 'global', ownerId = '', languageCode = 'es') {
    const rows = await this.db.run(`
      MATCH (p:SurfaceProfile {
        appId: $appId,
        sourceOrigin: $sourceOrigin,
        sourcePathname: $sourcePathname,
        scope: $scope,
        ownerId: $ownerId,
        languageCode: $languageCode
      })
      RETURN p.id as id,
             p.appId as appId,
             p.sourceOrigin as sourceOrigin,
             p.sourcePathname as sourcePathname,
             p.sourceTitle as sourceTitle,
             p.scope as scope,
             p.ownerId as ownerId,
             p.browserLocale as browserLocale,
             p.languageCode as languageCode,
             p.workflowDescription as workflowDescription,
             p.assistantProfile as assistantProfile,
             p.assistantRuntime as assistantRuntime,
             p.welcomeMessage as welcomeMessage,
             p.systemPromptAddendum as systemPromptAddendum,
             p.pageSummary as pageSummary,
             p.createdAt as createdAt,
             p.updatedAt as updatedAt,
             p.lastSeenAt as lastSeenAt
      LIMIT 1
    `, {
      appId: `${appId || ''}`.trim(),
      sourceOrigin: `${sourceOrigin || ''}`.trim(),
      sourcePathname: `${sourcePathname || '/'}`.trim() || '/',
      scope: `${scope || 'global'}`.trim() || 'global',
      ownerId: `${ownerId || ''}`.trim(),
      languageCode: `${languageCode || 'es'}`.trim() || 'es'
    });

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      appId: row.appId || '',
      sourceOrigin: row.sourceOrigin || '',
      sourcePathname: row.sourcePathname || '/',
      sourceTitle: row.sourceTitle || '',
      scope: row.scope || 'global',
      ownerId: row.ownerId || '',
      browserLocale: row.browserLocale || '',
      languageCode: row.languageCode || 'es',
      workflowDescription: row.workflowDescription || '',
      assistantProfile: this.parseJsonObject(row.assistantProfile) || null,
      assistantRuntime: this.parseJsonObject(row.assistantRuntime) || null,
      welcomeMessage: row.welcomeMessage || '',
      systemPromptAddendum: row.systemPromptAddendum || '',
      pageSummary: row.pageSummary || '',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastSeenAt: row.lastSeenAt
    };
  }

  async upsertSurfaceProfile(profile = {}) {
    const appId = `${profile.appId || ''}`.trim();
    const sourceOrigin = `${profile.sourceOrigin || ''}`.trim();
    const sourcePathname = `${profile.sourcePathname || '/'}`.trim() || '/';
    const scope = `${profile.scope || 'global'}`.trim() || 'global';
    const ownerId = `${profile.ownerId || ''}`.trim();
    const browserLocale = `${profile.browserLocale || ''}`.trim();
    const languageCode = `${profile.languageCode || 'es'}`.trim() || 'es';
    const id = profile.id || this.buildSurfaceProfileId(appId, sourceOrigin, sourcePathname, scope, ownerId, languageCode);

    await this.db.run(`
      MERGE (p:SurfaceProfile {id: $id})
      ON CREATE SET p.createdAt = timestamp()
      SET p.appId = $appId,
          p.sourceOrigin = $sourceOrigin,
          p.sourcePathname = $sourcePathname,
          p.sourceTitle = $sourceTitle,
          p.scope = $scope,
          p.ownerId = $ownerId,
          p.browserLocale = $browserLocale,
          p.languageCode = $languageCode,
          p.workflowDescription = $workflowDescription,
          p.assistantProfile = $assistantProfile,
          p.assistantRuntime = $assistantRuntime,
          p.welcomeMessage = $welcomeMessage,
          p.systemPromptAddendum = $systemPromptAddendum,
          p.pageSummary = $pageSummary,
          p.updatedAt = timestamp(),
          p.lastSeenAt = timestamp()
    `, {
      id,
      appId,
      sourceOrigin,
      sourcePathname,
      sourceTitle: `${profile.sourceTitle || ''}`.trim(),
      scope,
      ownerId,
      browserLocale,
      languageCode,
      workflowDescription: `${profile.workflowDescription || ''}`.trim(),
      assistantProfile: JSON.stringify(profile.assistantProfile || null),
      assistantRuntime: JSON.stringify(profile.assistantRuntime || null),
      welcomeMessage: `${profile.welcomeMessage || ''}`.trim(),
      systemPromptAddendum: `${profile.systemPromptAddendum || ''}`.trim(),
      pageSummary: `${profile.pageSummary || ''}`.trim()
    });

    return this.getSurfaceProfile(appId, sourceOrigin, sourcePathname, scope, ownerId, languageCode);
  }

  async touchSurfaceProfile(id) {
    if (!id) {
      return;
    }
    await this.db.run(
      'MATCH (p:SurfaceProfile {id: $id}) SET p.lastSeenAt = timestamp(), p.updatedAt = coalesce(p.updatedAt, timestamp())',
      { id }
    );
  }

  async getWorkflowSteps(workflowId, access = null) {
    const params = { id: workflowId };
    const visibilityClause = this.buildWorkflowVisibilityClause('w', access, params);
    const whereClause = visibilityClause ? `WHERE ${visibilityClause}` : '';
    return this.db.run(`
      MATCH (w:Workflow {id: $id})-[:HAS_STEP]->(s:Step)
      ${whereClause}
      RETURN s.actionType as actionType,
             s.selector as selector,
             s.value as value,
             s.url as url,
             s.explanation as explanation,
             s.label as label,
             s.controlType as controlType,
             s.selectedValue as selectedValue,
             s.selectedLabel as selectedLabel,
             s.semanticTarget as semanticTarget,
             s.surfaceSection as surfaceSection,
             s.surfaceHints as surfaceHints,
             s.allowedOptions as allowedOptions,
             s.valueMode as valueMode,
             s.bindTo as bindTo,
             s.stepOrder as stepOrder
      ORDER BY s.stepOrder ASC
    `, params);
  }

  // Fija los modos de valor (fixed/dynamic/flexible + bindTo) por step, sin reescribir el workflow.
  // Lo llama WorkflowLearner tras clasificar con el LLM al terminar la grabación.
  async setStepValueModes(workflowId, modes = [], access = null) {
    if (!Array.isArray(modes) || modes.length === 0) return;
    const params = { id: workflowId, modes };
    const mutableClause = this.buildMutableWorkflowClause('w', access, params);
    const whereClause = mutableClause ? `WHERE ${mutableClause}` : '';
    await this.db.run(`
      MATCH (w:Workflow {id: $id}) ${whereClause}
      WITH w
      UNWIND $modes AS m
      MATCH (w)-[:HAS_STEP]->(s:Step {stepOrder: m.stepOrder})
      SET s.valueMode = m.valueMode, s.bindTo = m.bindTo
    `, params);
  }

  async getWorkflowDescription(workflowId, access = null) {
    const params = { id: workflowId };
    const visibilityClause = this.buildWorkflowVisibilityClause('w', access, params);
    const whereClause = visibilityClause ? `WHERE ${visibilityClause}` : '';
    const wf = await this.db.run(
      `MATCH (w:Workflow {id: $id}) ${whereClause} RETURN w.description as desc`,
      params
    );
    return wf.length > 0 ? wf[0].desc : 'No description';
  }

  async completeWorkflow(workflowId, summary, executionGuide = '', access = null) {
    const params = { id: workflowId, summary, executionGuide };
    const mutableClause = this.buildMutableWorkflowClause('w', access, params);
    const whereClause = mutableClause ? `WHERE ${mutableClause}` : '';
    await this.db.run(
      `MATCH (w:Workflow {id: $id}) ${whereClause} SET w.status = "done", w.summary = $summary, w.executionGuide = $executionGuide, w.completedAt = timestamp()`,
      params
    );
  }

  async createFullWorkflow(workflow) {
    await this.db.run(`
      CREATE (w:Workflow {
        id: $id,
        description: $description,
        summary: $summary,
        executionGuide: $executionGuide,
        status: $status,
        scope: $scope,
        ownerId: $ownerId,
        appId: $appId,
        sourceUrl: $sourceUrl,
        sourceOrigin: $sourceOrigin,
        sourcePathname: $sourcePathname,
        sourceTitle: $sourceTitle,
        contextNotes: $contextNotes,
        publishedFromWorkflowId: $publishedFromWorkflowId,
        publishedByOwnerId: $publishedByOwnerId,
        publishedAt: $publishedAt,
        createdAt: timestamp(),
        updatedAt: timestamp()
      })
      WITH w
      UNWIND $steps AS step
      CREATE (s:Step {
        actionType: step.actionType,
        selector: step.selector,
        value: step.value,
        url: step.url,
        explanation: step.explanation,
        label: step.label,
        controlType: step.controlType,
        selectedValue: step.selectedValue,
        selectedLabel: step.selectedLabel,
        semanticTarget: step.semanticTarget,
        surfaceSection: step.surfaceSection,
        surfaceHints: step.surfaceHints,
        allowedOptions: step.allowedOptions,
        stepOrder: step.stepOrder,
        timestamp: timestamp()
      })
      CREATE (w)-[:HAS_STEP]->(s)
    `, {
      ...workflow,
      publishedFromWorkflowId: `${workflow.publishedFromWorkflowId || ''}`.trim(),
      publishedByOwnerId: `${workflow.publishedByOwnerId || ''}`.trim(),
      publishedAt: Number.isFinite(Number(workflow.publishedAt)) ? Number(workflow.publishedAt) : 0,
      steps: Array.isArray(workflow.steps)
        ? workflow.steps.map((step) => ({
            ...step,
            surfaceHints: this.serializeJsonObject(step.surfaceHints),
            allowedOptions: this.serializeAllowedOptions(step.allowedOptions)
          }))
        : []
    });
  }

  async updateFullWorkflow(workflow) {
    await this.db.run(`
      MATCH (w:Workflow {id: $id})
      SET w.description = $description,
          w.summary = $summary,
          w.executionGuide = $executionGuide,
          w.status = $status,
          w.scope = $scope,
          w.ownerId = $ownerId,
          w.appId = $appId,
          w.sourceUrl = $sourceUrl,
          w.sourceOrigin = $sourceOrigin,
          w.sourcePathname = $sourcePathname,
          w.sourceTitle = $sourceTitle,
          w.contextNotes = $contextNotes,
          w.publishedFromWorkflowId = $publishedFromWorkflowId,
          w.publishedByOwnerId = $publishedByOwnerId,
          w.publishedAt = $publishedAt,
          w.updatedAt = timestamp()
      WITH w
      OPTIONAL MATCH (w)-[rel:HAS_STEP]->(old:Step)
      WITH w, collect({rel: rel, old: old}) AS removals
      FOREACH (item IN [entry IN removals WHERE entry.old IS NOT NULL] | DELETE item.rel, item.old)
      WITH w
      UNWIND $steps AS step
      CREATE (s:Step {
        actionType: step.actionType,
        selector: step.selector,
        value: step.value,
        url: step.url,
        explanation: step.explanation,
        label: step.label,
        controlType: step.controlType,
        selectedValue: step.selectedValue,
        selectedLabel: step.selectedLabel,
        semanticTarget: step.semanticTarget,
        surfaceSection: step.surfaceSection,
        surfaceHints: step.surfaceHints,
        allowedOptions: step.allowedOptions,
        stepOrder: step.stepOrder,
        timestamp: timestamp()
      })
      CREATE (w)-[:HAS_STEP]->(s)
    `, {
      ...workflow,
      publishedFromWorkflowId: `${workflow.publishedFromWorkflowId || ''}`.trim(),
      publishedByOwnerId: `${workflow.publishedByOwnerId || ''}`.trim(),
      publishedAt: Number.isFinite(Number(workflow.publishedAt)) ? Number(workflow.publishedAt) : 0,
      steps: Array.isArray(workflow.steps)
        ? workflow.steps.map((step) => ({
            ...step,
            surfaceHints: this.serializeJsonObject(step.surfaceHints),
            allowedOptions: this.serializeAllowedOptions(step.allowedOptions)
          }))
        : []
    });
  }

  async deleteWorkflow(workflowId, access = null) {
    const params = { id: workflowId };
    const mutableClause = this.buildMutableWorkflowClause('w', access, params);
    const whereClause = mutableClause ? `WHERE ${mutableClause}` : '';
    await this.db.run(`
      MATCH (w:Workflow {id: $id})
      ${whereClause}
      OPTIONAL MATCH (w)-[:HAS_STEP]->(s:Step)
      OPTIONAL MATCH (w)-[:HAS_BRANCH]->(b:WorkflowBranch)
      WITH w, collect(s) AS steps, collect(b) AS branches
      FOREACH (step IN [item IN steps WHERE item IS NOT NULL] | DETACH DELETE step)
      FOREACH (branch IN [item IN branches WHERE item IS NOT NULL] | DETACH DELETE branch)
      DETACH DELETE w
    `, params);
  }

  async getGraphVisualization(access = null) {
    const normalized = this.normalizeWorkflowAccess(access);
    if (!normalized.restricted) {
      const rawNodes = await this.db.run('MATCH (n) RETURN labels(n)[0] as type, properties(n) as props, id(n) as id');
      const rawEdges = await this.db.run('MATCH (a)-[r]->(b) RETURN id(a) as from, id(b) as to, type(r) as label');
      return { rawNodes, rawEdges };
    }

    const params = {};
    const visibilityClause = this.buildWorkflowVisibilityClause('w', access, params);
    const rawNodes = await this.db.run(`
      MATCH (w:Workflow)
      WHERE ${visibilityClause}
      OPTIONAL MATCH (w)-[:HAS_STEP|HAS_BRANCH]->(related)
      WITH collect(DISTINCT w) + collect(DISTINCT related) AS nodes
      UNWIND nodes AS n
      WITH DISTINCT n
      WHERE n IS NOT NULL
      RETURN labels(n)[0] as type, properties(n) as props, id(n) as id
    `, params);
    const rawEdges = await this.db.run(`
      MATCH (w:Workflow)-[r:HAS_STEP|HAS_BRANCH]->(b)
      WHERE ${visibilityClause}
      RETURN id(w) as from, id(b) as to, type(r) as label
    `, params);
    return { rawNodes, rawEdges };
  }
}

module.exports = Neo4jWorkflowRepository;
