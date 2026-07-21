// Servidor MCP REAL de Graph: expone los workflows aprendidos como herramientas
// descubribles vía Model Context Protocol (JSON-RPC 2.0 sobre Streamable HTTP,
// modo stateless — cada POST es autocontenido, como exige serverless).
//
// POST /api/v1/mcp   (gated por X-API-Key, igual que todo /api/v1)
//   - initialize                → capacidades + info del servidor
//   - notifications/initialized → 202 (sin cuerpo)
//   - ping                      → {}
//   - tools/list                → herramientas workflow_* SCOPEADAS por superficie
//   - tools/call                → devuelve el PLAN de ejecución del workflow
//
// La superficie (el "URL de Windows" del SurfaceLocator) viaja en headers
// `X-Surface-Origin` / `X-Surface-Pathname` o en query `?surface_origin=&surface_pathname=`.
// Un cliente MCP por superficie se conecta con su URL/headers propios y descubre
// SOLO los workflows del lugar donde está parado.
//
// Decisión de diseño (el reparto de Graph, no se negocia): Graph decide QUÉ
// hacer, la superficie decide CÓMO tocarla. Por eso tools/call devuelve el plan
// ejecutable, nunca ejecuta: Graph no controla la máquina del usuario. El
// cliente de la superficie (p.ej. WorkflowPlayer en Windows) ejecuta el plan.

const { sanitize, workflowToMcp } = require('../../src/domain/agent/learning');

const PROTOCOL_VERSION = '2025-03-26';

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function surfaceFrom(req) {
  const origin = `${req.headers['x-surface-origin'] || req.query.surface_origin || ''}`.trim();
  const pathname = `${req.headers['x-surface-pathname'] || req.query.surface_pathname || ''}`.trim();
  return { origin, pathname, id: origin ? `${origin}${pathname}` : '' };
}

/** Workflow del agente → herramienta MCP con inputSchema JSON-Schema (el shape del protocolo). */
function toMcpToolDeclaration(agentWorkflow) {
  const tool = workflowToMcp(agentWorkflow);
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: {
      type: 'object',
      properties: {
        context: {
          type: 'string',
          description: 'Datos variables de ESTA ejecución (nombres, textos, cantidades); "" si no aplica.'
        }
      }
    }
  };
}

function registerMcpRoutes(app, deps = {}) {
  const { agentWorkflowStore, workflowExecutor } = deps;
  if (!app || !agentWorkflowStore || !workflowExecutor) {
    throw new Error('registerMcpRoutes requiere app, agentWorkflowStore y workflowExecutor');
  }

  async function scopedWorkflows(req) {
    const surface = surfaceFrom(req);
    if (!surface.origin) return { surface, workflows: [] };
    const workflows = await agentWorkflowStore.workflows('mcp', [], surface);
    return { surface, workflows };
  }

  async function handleRequest(req, message) {
    const { id, method, params } = message || {};

    if (method === 'initialize') {
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'graph-workflows', version: '1.0.0' },
        instructions:
          'Workflows aprendidos, scopeados por superficie (X-Surface-Origin/X-Surface-Pathname). '
          + 'tools/call devuelve el plan ejecutable; la superficie cliente lo ejecuta.'
      });
    }

    if (method === 'ping') {
      return rpcResult(id, {});
    }

    if (method === 'tools/list') {
      const { workflows } = await scopedWorkflows(req);
      return rpcResult(id, { tools: workflows.map(toMcpToolDeclaration) });
    }

    if (method === 'tools/call') {
      const name = `${params?.name || ''}`.trim();
      const args = params?.arguments || {};
      const { workflows } = await scopedWorkflows(req);
      const match = workflows.find((wf) => `workflow_${sanitize(wf.name)}` === name);
      if (!match) {
        return rpcError(id, -32602, `herramienta desconocida para esta superficie: ${name}`);
      }
      try {
        const executionPlan = await workflowExecutor.getExecutionPlanById(
          match.id,
          {},
          { source: 'mcp', surface: 'native', context: `${args.context || ''}` },
          null
        );
        return rpcResult(id, {
          content: [{
            type: 'text',
            text: JSON.stringify({ workflow_id: match.id, execution_plan: executionPlan })
          }]
        });
      } catch (error) {
        return rpcResult(id, {
          isError: true,
          content: [{ type: 'text', text: `no se pudo construir el plan: ${error.message}` }]
        });
      }
    }

    return rpcError(id, -32601, `método no soportado: ${method}`);
  }

  app.post('/api/v1/mcp', async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json(rpcError(null, -32700, 'cuerpo JSON-RPC inválido'));
    }

    // Notificaciones (sin id): se aceptan y no llevan respuesta, como manda el protocolo.
    const isNotification = (msg) => msg && msg.id === undefined && `${msg.method || ''}`.startsWith('notifications/');

    try {
      if (Array.isArray(body)) {
        const requests = body.filter((m) => !isNotification(m));
        if (requests.length === 0) return res.status(202).end();
        const responses = [];
        for (const msg of requests) responses.push(await handleRequest(req, msg));
        return res.json(responses);
      }
      if (isNotification(body)) return res.status(202).end();
      return res.json(await handleRequest(req, body));
    } catch (error) {
      return res.status(500).json(rpcError(body?.id ?? null, -32603, `error interno: ${error.message}`));
    }
  });

  // Streamable HTTP permite servidores sin stream SSE: GET explícitamente no soportado.
  app.get('/api/v1/mcp', (_req, res) => res.status(405).json({ error: 'Este servidor MCP es stateless: usa POST.' }));
}

module.exports = registerMcpRoutes;
