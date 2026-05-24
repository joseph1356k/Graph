# Self-Improvement Architecture

This document defines the long-term architecture for Graph self-improvement.

Graph should not only replay what a user taught once. It should keep improving the same workflow as it observes executions, receives user feedback, and watches users recover from blocked points. The goal is a durable learning core, not isolated fixes for individual pages.

## Product Vision

Graph is a page-attached assistant that learns operational rails for a website.

Those rails start as a recorded workflow, but they must evolve into a graph:

- a default route learned from the original demonstration
- transversal branch points where the same interaction pattern can apply to similar visible entities
- route extensions that document how a specific transversal case differs
- feedback corrections that repair a blocked execution at the exact point where it failed
- observed user recoveries that can be converted into reusable route extensions

The assistant should improve through three sources:

1. **Self-observation**: runtime intelligence detects that a path differs from the base workflow and records the successful adjustment.
2. **User feedback**: when blocked, the user explains what is true for the current page or variant, and Graph stores that correction at the exact graph point.
3. **User takeover observation**: when the user manually completes the blocked action, Graph captures those interactions and turns them into a reusable route extension.

The important constraint is architectural: self-improvement must become its own core, with its own domain concepts and services. It should connect to existing learning, execution, chat, and runtime intelligence, but it should not collapse into them.

## Standard Term

Use **Workflow Route Extension** as the standard name.

A Workflow Route Extension is a learned branch of an existing workflow from a specific graph point. It does not replace the base workflow. It extends it for a known condition, usually a transversal target or page variant.

Examples:

- Base workflow: order a pizza.
- Transversal point: click product card.
- Route extension: for `PIzza Burrata`, skip `id_talla` and `combinada` because this product has no size or half-and-half selectors.

Related terms:

- **Workflow Graph**: the full executable graph for one learned task.
- **Base Route**: the original linear demonstration.
- **Transversal Branch Point**: a step where the user can choose a similar visible entity and continue the same pattern.
- **Route Extension**: a branch learned from a branch point.
- **Blocked Execution**: a running workflow that cannot safely continue without runtime reasoning or user feedback.
- **Recovery Trace**: user or assistant actions that solve a blocked execution and can be promoted into a route extension.

## Current Architecture Assessment

Current readiness: **6.5/10**.

What is strong:

- `Workflow` already acts as the aggregate root for learned page behavior.
- `Step` stores selectors, labels, selected values, allowed options, and semantic targets.
- `WorkflowLearner` records real page interaction.
- `WorkflowExecutor` builds browser execution plans.
- `TransversalWorkflowComposer` already recognizes target substitutions.
- Runtime intelligence can reason during execution.
- The browser plugin already persists pending execution state in session storage.
- Neo4j is a natural fit for workflow graph persistence.

What is missing:

- Workflows are still modeled as an ordered list, not as a graph.
- Branches are not first-class domain objects.
- A blocked execution is not a first-class resumable object.
- User feedback after a failed execution is treated as a new chat request.
- Runtime adjustments are not promoted into durable learning.
- Transversal variants are not stored as reusable route extensions.

## Architecture Boundary

Self-improvement must not be implemented inside `AgentChat`, `WorkflowExecutor`, or runtime intelligence as ad hoc behavior.

Those services should keep narrow responsibilities:

- `AgentChat`: understands conversation and routes intent.
- `WorkflowExecutor`: builds executable plans from workflow graph state.
- `ExecutionIntelligenceService`: makes local runtime decisions for the current page.
- Browser execution client: applies plans and reports observations.
- `WorkflowLearner`: records explicit learning sessions.

The new core should own improvement-specific concepts:

- route extension creation
- branch matching
- blocked execution interpretation
- feedback-to-graph promotion
- recovery trace promotion
- confidence and provenance of learned improvements

## Core Domain Model

### WorkflowGraph

Logical view of a workflow as routes and graph points.

It can be backed initially by the existing `Workflow` plus new route extension records. We do not need to rewrite the whole workflow entity immediately.

Responsibilities:

- expose base route steps
- expose known branch points
- expose route extensions
- provide a graph view for planning and documentation

### WorkflowGraphPoint

A stable point in the workflow graph.

Fields:

- `workflowId`
- `stepOrder`
- `selector`
- `actionType`
- `label`
- `semanticTarget`
- `urlPattern`

Graph points let route extensions attach to a stable concept rather than a brittle list index.

### TransversalBranchPoint

A graph point where a visible entity can be substituted.

It is usually created from a click step with `semanticTarget` and `surfaceHints.alternativeTargets`.

Fields:

- `workflowId`
- `sourceStepOrder`
- `sourceTarget`
- `selector`
- `knownTargets`
- `branchPolicy`

### WorkflowRouteExtension

The first component to implement.

A route extension captures how the workflow behaves after a branch point under a specific condition.

Fields:

- `id`
- `workflowId`
- `branchPointStepOrder`
- `branchKey`
- `condition`
- `transversalTarget`
- `sourceTarget`
- `urlPattern`
- `stepOverrides`
- `skipStepOrders`
- `insertedSteps`
- `replacementSteps`
- `notes`
- `evidence`
- `confidence`
- `status`
- `createdAt`
- `updatedAt`

Example:

```json
{
  "workflowId": "wf_1779564608562",
  "branchPointStepOrder": 2,
  "branchKey": "step:2|target:pizza-burrata",
  "condition": {
    "type": "transversal_target",
    "target": "PIzza Burrata"
  },
  "skipStepOrders": [4, 5],
  "notes": [
    "For this product there is no size selector and no half-and-half selector."
  ],
  "evidence": {
    "source": "user_feedback",
    "blockedStepOrder": 5,
    "feedback": "para este producto no existe ni talla ni mitad y mitad"
  },
  "confidence": 0.85,
  "status": "active"
}
```

### BlockedExecutionContext

A resumable execution state created when a workflow cannot continue safely.

Fields:

- `runId`
- `workflowId`
- `status`
- `trigger`
- `variables`
- `executionIntent`
- `pendingPlan`
- `failedStepIndex`
- `failedStep`
- `failureKind`
- `errorMessage`
- `transversalContext`
- `pageSnapshot`
- `createdAt`
- `updatedAt`

This object gives chat continuity. The next user message can be interpreted as feedback for this specific blocked run instead of as a brand-new request.

### RecoveryTrace

A record of how the blocked execution was resolved.

Sources:

- assistant runtime intelligence
- user text feedback
- user manual takeover
- explicit learning session

Fields:

- `blockedRunId`
- `workflowId`
- `branchKey`
- `source`
- `beforeState`
- `actions`
- `feedback`
- `result`
- `promotedRouteExtensionId`

## First Component: Workflow Route Extensions

The immediate implementation target is not the whole self-improvement system.

The first target is:

> Allow an existing workflow to be extended from a transversal branch point, turning the linear workflow into an executable graph with route-specific differences.

### Functional Scope

V1 should support:

- create route extension for an existing workflow
- identify branch point from transversal click
- compute stable `branchKey`
- store route extension in persistence
- load route extensions with workflow
- apply matching route extension while building an execution plan
- support `skipStepOrders` as the first override type
- expose route extension evidence and notes
- keep base workflow unchanged

V1 should not yet support:

- full user takeover capture
- arbitrary graph editing UI
- complex condition language
- automatic branch generalization across product families
- confidence promotion workflows

## Execution Flow With Route Extensions

### Current Flow

1. `AgentChat` selects workflow and variables.
2. `WorkflowExecutor` builds a linear execution plan.
3. Browser plugin executes steps.
4. Runtime intelligence may patch steps during execution.

### Target Flow

1. `AgentChat` selects workflow and variables.
2. `WorkflowGraphService` loads base workflow plus route extensions.
3. `WorkflowRoutePlanner` detects active branch context from variables and transversal targets.
4. Matching route extensions are applied to produce an execution plan.
5. Browser plugin executes the plan.
6. If runtime blocks, a `BlockedExecutionContext` is created.
7. User feedback or recovery trace can create or update a route extension.

## Route Extension Application Rules

Route extensions should be applied before browser execution starts whenever possible.

Order:

1. Start from base route.
2. Apply transversal composition.
3. Compute active branch key.
4. Load active route extensions.
5. Apply route extension overrides.
6. Produce execution plan.

For V1, supported override:

```json
{
  "skipStepOrders": [4, 5]
}
```

Later overrides:

```json
{
  "stepPatches": [
    { "stepOrder": 4, "selector": "#new_size" }
  ],
  "insertedSteps": [
    { "afterStepOrder": 4, "actionType": "click", "selector": "#confirm" }
  ],
  "replacementSteps": [
    {
      "replaceStepOrder": 5,
      "steps": [
        { "actionType": "select", "selector": "#variant", "selectedLabel": "Complete" }
      ]
    }
  ]
}
```

## Persistence Model

Initial Neo4j shape:

```cypher
(w:Workflow)-[:HAS_ROUTE_EXTENSION]->(r:WorkflowRouteExtension)
(r)-[:EXTENDS_FROM]->(s:Step)
```

Route extension properties:

- `id`
- `workflowId`
- `branchPointStepOrder`
- `branchKey`
- `condition`
- `transversalTarget`
- `sourceTarget`
- `urlPattern`
- `stepOverrides`
- `skipStepOrders`
- `notes`
- `evidence`
- `confidence`
- `status`
- `createdAt`
- `updatedAt`

Use JSON strings for nested fields initially, matching current repository conventions for `surfaceHints`, `allowedOptions`, and `contextNotes`.

## Application Services

### WorkflowGraphService

Owns workflow graph loading.

Responsibilities:

- load base workflow
- load route extensions
- return graph-ready aggregate

### WorkflowRouteExtensionService

Owns route extension creation and updates.

Responsibilities:

- create extension from feedback
- create extension from recovery trace
- merge repeated evidence
- activate/deactivate route extensions
- validate that extension targets an existing workflow and branch point

### WorkflowRoutePlanner

Owns graph-to-plan transformation.

Responsibilities:

- compute active branch key
- choose matching route extension
- apply overrides
- return executable steps

This should sit between `WorkflowExecutor` and `TransversalWorkflowComposer`.

### BlockedExecutionService

Owns blocked run state and chat continuity.

Responsibilities:

- create blocked execution context on failure
- expose blocked context to chat
- resolve next user message as feedback when appropriate
- resume or stop pending execution

This service is part of self-improvement, but it is not V1 if the first implementation is limited to route extensions.

## Chat Continuity Contract

When execution fails, the assistant message must be pushed into conversation history.

The next user message should include blocked context:

```json
{
  "message": "para este producto no existe ni talla ni mitad y mitad",
  "history": [...],
  "blockedExecution": {
    "workflowId": "wf_1779564608562",
    "failedStepOrder": 5,
    "transversalTarget": "PIzza Burrata",
    "errorMessage": "No pude encontrar combinada en esta pagina."
  }
}
```

`AgentChat` should route this to self-improvement instead of normal workflow selection.

## Promotion Rules

Not every runtime decision should become durable learning.

Promote to route extension when:

- execution happened after a transversal click
- the page variant is identifiable
- the same deviation affects concrete workflow steps
- there is user feedback or successful recovery evidence

Do not promote when:

- the page was temporarily broken
- the element was slow to load
- the user cancelled
- the assistant guessed without evidence
- the change applies globally to the base workflow

## Architectural Invariants

- The base workflow remains stable unless the user explicitly edits/relearns it.
- Route extensions are additive and can be disabled.
- Runtime intelligence can suggest changes, but persistence belongs to self-improvement services.
- Browser plugin reports observations; it does not own workflow graph semantics.
- Chat can route feedback, but it does not directly mutate workflow graph state.
- Workflow execution consumes a planned graph route; it does not decide persistence.

## Implementation Milestones

### Milestone 1: Route Extension Domain

- Add `WorkflowRouteExtension` entity.
- Add repository methods to create/list route extensions.
- Add `WorkflowGraphService`.
- Add `WorkflowRoutePlanner`.
- Keep existing linear workflow behavior unchanged when no extension exists.

### Milestone 2: Apply Extensions During Planning

- Detect active branch key after transversal composition.
- Apply `skipStepOrders`.
- Include applied extension metadata in execution plan.
- Log which route extension was used.

### Milestone 3: Feedback-To-Extension

- Persist blocked execution context.
- Send blocked context with next chat message.
- Add `ExecutionFeedbackResolver`.
- Convert feedback like "this product has no size or half-and-half" into `skipStepOrders`.
- Save extension and resume pending plan.

### Milestone 4: Recovery Trace Learning

- Detect when user manually completes blocked steps.
- Record recovery trace.
- Ask or infer whether to promote recovery into a route extension.

### Milestone 5: Graph Catalog and Visualization

- Extend `WORKFLOWS.md` to show route extensions.
- Add workflow graph visualization with base route and branches.
- Mark branch points and learned extensions.

## First Acceptance Criteria

The first implementation is complete when:

- an existing workflow can have one route extension from a transversal branch point
- the extension can skip one or more base steps
- the extension is persisted separately from base steps
- execution planning applies the extension only when the matching transversal target is active
- base route execution remains unchanged when no extension matches
- logs show which route extension was applied
- `WORKFLOWS.md` or equivalent catalog output can represent the route extension

## Design Bias

Prefer a small, explicit graph model over hidden runtime mutation.

The assistant should feel adaptive, but the system should remain inspectable:

- what branch was chosen
- why it was chosen
- what steps changed
- what evidence created the branch
- how confident the system is

That inspectability is what lets self-improvement remain safe and maintainable as it becomes one of Graph's core systems.
