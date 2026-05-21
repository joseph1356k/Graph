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

  async getWorkflowRows(workflowId = null) {
    const params = {};
    const whereClause = workflowId ? 'WHERE w.id = $id' : '';
    if (workflowId) {
      params.id = workflowId;
    }

    return this.db.run(`
      MATCH (w:Workflow)
      ${whereClause}
      OPTIONAL MATCH (w)-[:HAS_STEP]->(s:Step)
      RETURN w.id as id,
             w.description as description,
             w.summary as summary,
             w.executionGuide as executionGuide,
             w.status as status,
             w.appId as appId,
             w.sourceUrl as sourceUrl,
             w.sourceOrigin as sourceOrigin,
             w.sourcePathname as sourcePathname,
             w.sourceTitle as sourceTitle,
             w.contextNotes as contextNotes,
             w.createdAt as createdAt,
             w.updatedAt as updatedAt,
             w.completedAt as completedAt,
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
             s.surfaceHints as surfaceHints,
             s.allowedOptions as allowedOptions,
             s.stepOrder as stepOrder
      ORDER BY w.id ASC, s.stepOrder ASC
    `, params);
  }

  async startWorkflow(id, description, context = {}) {
    await this.db.run(
      `CREATE (w:Workflow {
        id: $id,
        description: $desc,
        status: "recording",
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
        appId: context.appId || '',
        sourceUrl: context.sourceUrl || '',
        sourceOrigin: context.sourceOrigin || '',
        sourcePathname: context.sourcePathname || '',
        sourceTitle: context.sourceTitle || '',
        contextNotes: JSON.stringify(Array.isArray(context.contextNotes) ? context.contextNotes : [])
      }
    );
  }

  async getStepCount(workflowId) {
    const countResult = await this.db.run(`
      MATCH (w:Workflow {id: $wfId})-[:HAS_STEP]->(s:Step)
      RETURN count(s) as total
    `, { wfId: workflowId });
    return this.toNativeNumber(countResult[0]?.total || 0);
  }

  async addStep(workflowId, step, nextStepOrder) {
    await this.db.run(`
      MATCH (w:Workflow {id: $wfId})
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
        surfaceHints: $surfaceHints,
        allowedOptions: $allowedOptions,
        stepOrder: $stepOrder,
        timestamp: timestamp()
      })
      CREATE (w)-[:HAS_STEP]->(s)
    `, {
      wfId: workflowId,
      ...step,
      surfaceHints: this.serializeJsonObject(step.surfaceHints),
      allowedOptions: this.serializeAllowedOptions(step.allowedOptions),
      stepOrder: nextStepOrder
    });
  }

  async addContextNote(workflowId, note) {
    const existing = await this.db.run(
      'MATCH (w:Workflow {id: $id}) RETURN w.contextNotes as contextNotes',
      { id: workflowId }
    );

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
      'MATCH (w:Workflow {id: $id}) SET w.contextNotes = $contextNotes, w.updatedAt = timestamp()',
      {
        id: workflowId,
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

  async getWorkflowSteps(workflowId) {
    return this.db.run(`
      MATCH (w:Workflow {id: $id})-[:HAS_STEP]->(s:Step)
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
             s.surfaceHints as surfaceHints,
             s.allowedOptions as allowedOptions,
             s.stepOrder as stepOrder
      ORDER BY s.stepOrder ASC
    `, { id: workflowId });
  }

  async getWorkflowDescription(workflowId) {
    const wf = await this.db.run(
      'MATCH (w:Workflow {id: $id}) RETURN w.description as desc',
      { id: workflowId }
    );
    return wf.length > 0 ? wf[0].desc : 'No description';
  }

  async completeWorkflow(workflowId, summary, executionGuide = '') {
    await this.db.run(
      'MATCH (w:Workflow {id: $id}) SET w.status = "done", w.summary = $summary, w.executionGuide = $executionGuide, w.completedAt = timestamp()',
      { id: workflowId, summary, executionGuide }
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
        appId: $appId,
        sourceUrl: $sourceUrl,
        sourceOrigin: $sourceOrigin,
        sourcePathname: $sourcePathname,
        sourceTitle: $sourceTitle,
        contextNotes: $contextNotes,
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
        surfaceHints: step.surfaceHints,
        allowedOptions: step.allowedOptions,
        stepOrder: step.stepOrder,
        timestamp: timestamp()
      })
      CREATE (w)-[:HAS_STEP]->(s)
    `, {
      ...workflow,
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
          w.appId = $appId,
          w.sourceUrl = $sourceUrl,
          w.sourceOrigin = $sourceOrigin,
          w.sourcePathname = $sourcePathname,
          w.sourceTitle = $sourceTitle,
          w.contextNotes = $contextNotes,
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
        surfaceHints: step.surfaceHints,
        allowedOptions: step.allowedOptions,
        stepOrder: step.stepOrder,
        timestamp: timestamp()
      })
      CREATE (w)-[:HAS_STEP]->(s)
    `, {
      ...workflow,
      steps: Array.isArray(workflow.steps)
        ? workflow.steps.map((step) => ({
            ...step,
            surfaceHints: this.serializeJsonObject(step.surfaceHints),
            allowedOptions: this.serializeAllowedOptions(step.allowedOptions)
          }))
        : []
    });
  }

  async deleteWorkflow(workflowId) {
    await this.db.run(`
      MATCH (w:Workflow {id: $id})
      OPTIONAL MATCH (w)-[:HAS_STEP]->(s:Step)
      WITH w, collect(s) AS steps
      FOREACH (step IN [item IN steps WHERE item IS NOT NULL] | DETACH DELETE step)
      DETACH DELETE w
    `, { id: workflowId });
  }

  async getGraphVisualization() {
    const rawNodes = await this.db.run('MATCH (n) RETURN labels(n)[0] as type, properties(n) as props, id(n) as id');
    const rawEdges = await this.db.run('MATCH (a)-[r]->(b) RETURN id(a) as from, id(b) as to, type(r) as label');
    return { rawNodes, rawEdges };
  }
}

module.exports = Neo4jWorkflowRepository;
