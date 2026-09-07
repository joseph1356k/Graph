// Proveedor de chat completions FALSO, por HTTP: es lo que permite probar el
// escudo «por el cable». LLMProvider real apuntado a este servidor por env;
// el manejador recibe el cuerpo tal como habría llegado a OpenAI y decide qué
// contestar. Cada petición queda guardada para poder afirmar lo que salió.
const http = require('http');

function createFakeChatCompletions() {
  const state = { requests: [], handler: null };
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid json' }));
        return;
      }
      state.requests.push({ body, raw, authorization: req.headers.authorization || '' });
      let content;
      try {
        content = state.handler ? state.handler(body, raw) : '{}';
      } catch (error) {
        // Un assert dentro del manejador se devuelve como 500 con el mensaje,
        // para que el arnés lo vea en vez de un timeout.
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `fake provider assertion: ${error.message}` } }));
        return;
      }
      const text = typeof content === 'string' ? content : JSON.stringify(content);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: `chatcmpl-fake-${state.requests.length}`,
        model: body.model || 'fake-model',
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
      }));
    });
  });

  return {
    state,
    async start() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      this.baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
      return this.baseUrl;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
    lastRequest() {
      return state.requests[state.requests.length - 1] || null;
    }
  };
}

module.exports = createFakeChatCompletions;
