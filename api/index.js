const app = require('../web/server');

module.exports = function vercelApiHandler(req, res) {
  const rewrittenUrl = new URL(req.url, 'http://localhost');
  const originalPath = `${rewrittenUrl.searchParams.get('path') || ''}`
    .split('/')
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
    .join('/');

  rewrittenUrl.searchParams.delete('path');
  const query = rewrittenUrl.searchParams.toString();
  req.url = `/api${originalPath ? `/${originalPath}` : ''}${query ? `?${query}` : ''}`;

  return app(req, res);
};
