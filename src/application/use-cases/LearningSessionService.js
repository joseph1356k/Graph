class LearningSessionService {
  constructor(workflowLearner) {
    this.workflowLearner = workflowLearner;
    this.activeSession = null;
    this.sessions = new Map();
  }

  getAccessOwnerId(access = null) {
    return `${access?.ownerId || ''}`.trim();
  }

  getOwnedActiveSession(access = null) {
    const ownerId = this.getAccessOwnerId(access);
    if (!ownerId) {
      return this.activeSession;
    }
    return Array.from(this.sessions.values())
      .filter((session) => session.ownerId === ownerId)
      .sort((left, right) => Number(right.startedAt || 0) - Number(left.startedAt || 0))[0] || null;
  }

  assertSessionAccess(session, access = null) {
    const ownerId = this.getAccessOwnerId(access);
    if (!session || !ownerId) {
      return;
    }
    if (session.ownerId && session.ownerId !== ownerId) {
      throw new Error('Workflow session not found');
    }
  }

  getStatus(options = {}) {
    const session = this.getOwnedActiveSession(options.access || null);
    return {
      recording: Boolean(session?.id),
      id: session?.id || null
    };
  }

  resolveSessionId(candidateId = '', options = {}) {
    const normalizedCandidate = `${candidateId || ''}`.trim();
    if (normalizedCandidate) {
      const session = this.sessions.get(normalizedCandidate);
      this.assertSessionAccess(session, options.access || null);
      return normalizedCandidate;
    }

    return `${this.getOwnedActiveSession(options.access || null)?.id || ''}`.trim();
  }

  async startSession(description, context = {}, options = {}) {
    const access = options.access || null;
    const workflowId = await this.workflowLearner.startSession(description, context, { access });
    const session = {
      id: workflowId,
      ownerId: this.getAccessOwnerId(access),
      description: `${description || ''}`.trim(),
      context: context && typeof context === 'object' ? { ...context } : {},
      startedAt: Date.now()
    };
    this.activeSession = session;
    this.sessions.set(workflowId, session);
    return workflowId;
  }

  async recordStep(stepData, options = {}) {
    const access = options.access || null;
    const workflowId = this.resolveSessionId(options.sessionId, { access });
    if (!workflowId) {
      throw new Error('No active learning session');
    }

    return this.workflowLearner.recordStep(workflowId, stepData, { access });
  }

  async addContextNote(note, options = {}) {
    const access = options.access || null;
    const workflowId = this.resolveSessionId(options.sessionId, { access });
    if (!workflowId) {
      throw new Error('No active learning session');
    }

    return this.workflowLearner.addContextNote(workflowId, note, { access });
  }

  async finishSession(options = {}) {
    const access = options.access || null;
    const workflowId = this.resolveSessionId(options.sessionId, { access });
    if (!workflowId) {
      throw new Error('No active learning session');
    }

    const summary = await this.workflowLearner.finishSession(workflowId, { access });
    if (!options.preserveActive && workflowId === this.activeSession?.id) {
      this.activeSession = null;
    }
    if (!options.preserveActive) {
      this.sessions.delete(workflowId);
    }
    return {
      workflowId,
      summary
    };
  }

  reset(options = {}) {
    const ownerId = this.getAccessOwnerId(options.access || null);
    if (ownerId) {
      for (const [id, session] of this.sessions.entries()) {
        if (session.ownerId === ownerId) {
          this.sessions.delete(id);
        }
      }
      if (this.activeSession?.ownerId === ownerId) {
        this.activeSession = null;
      }
      return;
    }
    this.activeSession = null;
    this.sessions.clear();
  }
}

module.exports = LearningSessionService;
