const assert = require('assert');

const WorkflowCatalog = require('../src/application/use-cases/WorkflowCatalog');
const LearningSessionService = require('../src/application/use-cases/LearningSessionService');
const {
  requireAuth,
  requireAccountAuth,
  attachWorkflowAccess,
  isSupabasePayloadAnonymous,
  createLocalAnonymousSession
} = require('../web/api/requireAuth');

const accessA = { ownerId: 'user-a', includeGlobal: true };
const accessB = { ownerId: 'user-b', includeGlobal: true };
const adminAccess = { ownerId: 'admin-user', includeGlobal: true, canManageGlobalWorkflows: true };

class FakeWorkflowRepository {
  constructor(workflows = []) {
    this.workflows = workflows.map((workflow) => ({
      steps: [],
      branches: [],
      ...workflow
    }));
  }

  isVisible(workflow, access = null) {
    const ownerId = `${access?.ownerId || ''}`.trim();
    if (!ownerId) return true;
    if (`${workflow.ownerId || ''}`.trim() === ownerId) return true;
    return access.includeGlobal !== false && (`${workflow.scope || ''}` === 'global' || !workflow.ownerId);
  }

  toRows(workflow) {
    const steps = Array.isArray(workflow.steps) && workflow.steps.length > 0 ? workflow.steps : [null];
    return steps.map((step) => ({
      id: workflow.id,
      description: workflow.description || '',
      summary: workflow.summary || '',
      executionGuide: workflow.executionGuide || '',
      status: workflow.status || 'done',
      scope: workflow.scope || (workflow.ownerId ? 'private' : 'global'),
      ownerId: workflow.ownerId || '',
      appId: workflow.appId || '',
      sourceUrl: workflow.sourceUrl || '',
      sourceOrigin: workflow.sourceOrigin || '',
      sourcePathname: workflow.sourcePathname || '',
      sourceTitle: workflow.sourceTitle || '',
      contextNotes: JSON.stringify(workflow.contextNotes || []),
      createdAt: workflow.createdAt || 1,
      updatedAt: workflow.updatedAt || 1,
      completedAt: workflow.completedAt || 1,
      publishedFromWorkflowId: workflow.publishedFromWorkflowId || '',
      publishedByOwnerId: workflow.publishedByOwnerId || '',
      publishedAt: workflow.publishedAt || 0,
      actionType: step?.actionType || '',
      selector: step?.selector || '',
      value: step?.value || '',
      url: step?.url || '',
      explanation: step?.explanation || '',
      label: step?.label || '',
      controlType: step?.controlType || '',
      selectedValue: step?.selectedValue || '',
      selectedLabel: step?.selectedLabel || '',
      semanticTarget: step?.semanticTarget || '',
      surfaceSection: step?.surfaceSection || '',
      surfaceHints: step?.surfaceHints || '',
      allowedOptions: step?.allowedOptions || '[]',
      stepOrder: step?.stepOrder || null
    }));
  }

  async getWorkflowRows(workflowId = null, access = null) {
    return this.workflows
      .filter((workflow) => !workflowId || workflow.id === workflowId)
      .filter((workflow) => this.isVisible(workflow, access))
      .flatMap((workflow) => this.toRows(workflow));
  }

  async listWorkflowBranches() {
    return [];
  }

  async createFullWorkflow(workflow) {
    this.workflows.push({
      ...workflow,
      steps: Array.isArray(workflow.steps) ? workflow.steps : []
    });
  }

  async updateFullWorkflow(workflow) {
    const index = this.workflows.findIndex((entry) => entry.id === workflow.id);
    if (index !== -1) this.workflows[index] = { ...this.workflows[index], ...workflow };
  }

  async deleteWorkflow(workflowId) {
    this.workflows = this.workflows.filter((workflow) => workflow.id !== workflowId);
  }
}

class FakeWorkflowLearner {
  constructor() {
    this.nextId = 1;
  }

  async startSession() {
    return `wf_fake_${this.nextId++}`;
  }

  async recordStep() {
    return 1;
  }
}

function createResponse(resolve) {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      resolve({ statusCode: this.statusCode, payload });
    }
  };
}

function invokeMiddleware(middleware, req) {
  return new Promise((resolve) => {
    const res = createResponse(resolve);
    middleware(req, res, () => resolve({ statusCode: 200, req }));
  });
}

async function verifyCatalogIsolation() {
  const repository = new FakeWorkflowRepository([
    { id: 'wf_a', ownerId: 'user-a', scope: 'private', description: 'A private' },
    { id: 'wf_b', ownerId: 'user-b', scope: 'private', description: 'B private' },
    { id: 'wf_admin', ownerId: 'admin-user', scope: 'private', description: 'Admin private' },
    { id: 'wf_global', ownerId: '', scope: 'global', description: 'Legacy global' },
    { id: 'wf_legacy', description: 'Legacy without owner' }
  ]);
  const catalog = new WorkflowCatalog(repository, null);

  const visibleToA = await catalog.getCatalog(accessA);
  assert.deepStrictEqual(visibleToA.map((workflow) => workflow.id).sort(), ['wf_a', 'wf_global', 'wf_legacy']);
  assert.strictEqual(await catalog.getWorkflowById('wf_b', accessA), null);
  assert.strictEqual((await catalog.getWorkflowById('wf_a', accessA)).ownerId, 'user-a');

  await assert.rejects(() => catalog.updateWorkflow({ id: 'wf_b', description: 'stolen' }, accessA), /Workflow not found/);
  await assert.rejects(() => catalog.deleteWorkflow('wf_global', accessA), /Workflow not found/);

  const created = await catalog.saveWorkflow({
    id: 'wf_new',
    ownerId: 'user-b',
    scope: 'global',
    description: 'malicious owner ignored'
  }, accessA);
  assert.strictEqual(created.ownerId, 'user-a');
  assert.strictEqual(created.scope, 'private');

  await assert.rejects(() => catalog.publishWorkflowGlobal('wf_a', accessA), /Workflow not found/);
  const published = await catalog.publishWorkflowGlobal('wf_admin', adminAccess);
  assert.strictEqual(published.id, 'global_wf_admin');
  assert.strictEqual(published.scope, 'global');
  assert.strictEqual(published.ownerId, '');
  assert.strictEqual(published.publishedFromWorkflowId, 'wf_admin');
  assert.strictEqual(published.publishedByOwnerId, 'admin-user');

  const visibleToB = await catalog.getCatalog(accessB);
  assert(visibleToB.some((workflow) => workflow.id === 'global_wf_admin'));
  await assert.rejects(() => catalog.updateWorkflow({ id: 'global_wf_admin', description: 'normal edit' }, accessB), /Workflow not found/);
  await assert.rejects(() => catalog.deleteWorkflow('global_wf_admin', accessB), /Workflow not found/);

  const updatedGlobal = await catalog.updateWorkflow({ id: 'global_wf_admin', description: 'admin edit' }, adminAccess);
  assert.strictEqual(updatedGlobal.description, 'admin edit');
  await catalog.deleteWorkflow('global_wf_admin', adminAccess);
  assert.strictEqual(await catalog.getWorkflowById('global_wf_admin', adminAccess), null);
}

async function verifyLearningSessionIsolation() {
  const service = new LearningSessionService(new FakeWorkflowLearner());
  const sessionId = await service.startSession('Private session', {}, { access: accessA });
  assert.deepStrictEqual(service.getStatus({ access: accessA }), { recording: true, id: sessionId });
  assert.deepStrictEqual(service.getStatus({ access: accessB }), { recording: false, id: null });
  await assert.rejects(
    () => service.recordStep({ actionType: 'click' }, { sessionId, access: accessB }),
    /Workflow session not found/
  );
}

async function verifyAuthMiddleware() {
  assert.strictEqual(isSupabasePayloadAnonymous({ is_anonymous: true }), true);
  assert.strictEqual(isSupabasePayloadAnonymous({ app_metadata: { provider: 'anonymous' } }), true);
  assert.strictEqual(isSupabasePayloadAnonymous({ app_metadata: { providers: ['google'] } }), false);

  const previousSupabaseUrl = process.env.SUPABASE_URL;
  const previousLocalAdmin = process.env.ALLOW_LOCAL_GLOBAL_WORKFLOW_ADMIN;
  const previousLocalAnonymous = process.env.ALLOW_LOCAL_ANONYMOUS;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAdminEmails = process.env.GLOBAL_WORKFLOW_ADMIN_EMAILS;
  delete process.env.SUPABASE_URL;
  delete process.env.ALLOW_LOCAL_GLOBAL_WORKFLOW_ADMIN;
  delete process.env.GLOBAL_WORKFLOW_ADMIN_EMAILS;
  const localReq = { headers: {}, get() { return ''; }, url: '/api/workflows' };
  const localResult = await invokeMiddleware(requireAccountAuth, localReq);
  assert.strictEqual(localResult.statusCode, 200);
  assert.strictEqual(localReq.user.id, 'local-dev-user');
  await invokeMiddleware(attachWorkflowAccess, localReq);
  assert.deepStrictEqual(localReq.workflowAccess, {
    ownerId: 'local-dev-user',
    includeGlobal: true,
    canManageGlobalWorkflows: false
  });

  process.env.ALLOW_LOCAL_GLOBAL_WORKFLOW_ADMIN = 'true';
  const localAdminReq = { headers: {}, get() { return ''; }, url: '/api/workflows' };
  await invokeMiddleware(requireAccountAuth, localAdminReq);
  await invokeMiddleware(attachWorkflowAccess, localAdminReq);
  assert.strictEqual(localAdminReq.workflowAccess.canManageGlobalWorkflows, true);

  process.env.GLOBAL_WORKFLOW_ADMIN_EMAILS = 'Felipemaldonado2255@gmail.com,isaabel.garcia10@gmail.com,josedavid135642@gmail.com';
  const emailAdminReq = {
    user: { id: 'supabase-admin', email: 'FELIPEMALDONADO2255@GMAIL.COM' },
    headers: {},
    get() { return ''; },
    url: '/api/workflows'
  };
  await invokeMiddleware(attachWorkflowAccess, emailAdminReq);
  assert.strictEqual(emailAdminReq.workflowAccess.canManageGlobalWorkflows, true);

  const normalReq = {
    user: { id: 'normal-user', email: 'normal@example.com' },
    headers: {},
    get() { return ''; },
    url: '/api/workflows'
  };
  await invokeMiddleware(attachWorkflowAccess, normalReq);
  assert.strictEqual(normalReq.workflowAccess.canManageGlobalWorkflows, false);

  process.env.SUPABASE_URL = 'https://example.supabase.co';
  const missingTokenReq = { headers: {}, get() { return ''; }, url: '/api/workflows' };
  const missingTokenResult = await invokeMiddleware(requireAccountAuth, missingTokenReq);
  assert.strictEqual(missingTokenResult.statusCode, 401);

  process.env.NODE_ENV = 'development';
  process.env.ALLOW_LOCAL_ANONYMOUS = 'true';
  const localAnonymousSession = createLocalAnonymousSession();
  const localAnonymousReq = {
    headers: { authorization: `Bearer ${localAnonymousSession.accessToken}` },
    get(name) { return this.headers[`${name || ''}`.toLowerCase()] || ''; },
    url: '/api/clinical/diagnosis-suggestions'
  };
  const localAnonymousResult = await invokeMiddleware(requireAuth, localAnonymousReq);
  assert.strictEqual(localAnonymousResult.statusCode, 200);
  assert.strictEqual(localAnonymousReq.user.id, localAnonymousSession.user.id);
  assert.strictEqual(localAnonymousReq.user.isAnonymous, true);

  const accountAnonymousReq = {
    headers: { authorization: `Bearer ${localAnonymousSession.accessToken}` },
    get(name) { return this.headers[`${name || ''}`.toLowerCase()] || ''; },
    url: '/api/workflows'
  };
  const accountAnonymousResult = await invokeMiddleware(requireAccountAuth, accountAnonymousReq);
  assert.strictEqual(accountAnonymousResult.statusCode, 401);
  assert.match(accountAnonymousResult.payload.error, /Google/);

  if (previousSupabaseUrl === undefined) {
    delete process.env.SUPABASE_URL;
  } else {
    process.env.SUPABASE_URL = previousSupabaseUrl;
  }
  if (previousLocalAdmin === undefined) {
    delete process.env.ALLOW_LOCAL_GLOBAL_WORKFLOW_ADMIN;
  } else {
    process.env.ALLOW_LOCAL_GLOBAL_WORKFLOW_ADMIN = previousLocalAdmin;
  }
  if (previousLocalAnonymous === undefined) {
    delete process.env.ALLOW_LOCAL_ANONYMOUS;
  } else {
    process.env.ALLOW_LOCAL_ANONYMOUS = previousLocalAnonymous;
  }
  if (previousNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = previousNodeEnv;
  }
  if (previousAdminEmails === undefined) {
    delete process.env.GLOBAL_WORKFLOW_ADMIN_EMAILS;
  } else {
    process.env.GLOBAL_WORKFLOW_ADMIN_EMAILS = previousAdminEmails;
  }
}

async function main() {
  await verifyCatalogIsolation();
  await verifyLearningSessionIsolation();
  await verifyAuthMiddleware();
  console.log('workflow account isolation verification passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
