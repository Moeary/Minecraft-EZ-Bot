const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { URL } = require('node:url');

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': 'http://localhost:5173',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  response.end(body);
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; if (body.length > 1024 * 1024) request.destroy(); });
    request.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (error) { reject(new Error(`Invalid JSON body: ${error.message}`)); }
    });
    request.on('error', reject);
  });
}

function createWebServer(manager) {
  const config = manager.config;
  const staticDir = path.resolve(config.rootDir, 'apps/web/dist');
  const server = http.createServer(async (request, response) => {
    if (request.method === 'OPTIONS') return json(response, 204, {});
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    try {
      if (pathname === '/api/health' && request.method === 'GET') return json(response, 200, { ok: true, service: 'mc-bot-self', time: new Date().toISOString() });
      if (pathname === '/api/bots' && request.method === 'GET') return json(response, 200, { bots: manager.list() });

      const match = pathname.match(/^\/api\/bots\/([^/]+)(?:\/(start|stop|command))?$/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        const action = match[2];
        if (request.method === 'POST' && action === 'start') return json(response, 200, manager.start(id));
        if (request.method === 'POST' && action === 'stop') return json(response, 200, manager.stop(id));
        if (request.method === 'POST' && action === 'command') {
          const body = await parseBody(request);
          const result = body.command ? manager.executeLine(id, body.command, 'web') : { ok: false, message: 'Missing command.' };
          return json(response, result.ok ? 200 : 400, result);
        }
      }

      if (pathname === '/' || pathname.startsWith('/assets/')) {
        return serveStatic(response, staticDir, pathname);
      }
      return json(response, 404, { ok: false, message: 'Not found.' });
    } catch (error) {
      return json(response, 500, { ok: false, message: error.message });
    }
  });

  return server;
}

function serveStatic(response, rootDir, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const filePath = path.resolve(rootDir, requested);
  if (!filePath.startsWith(rootDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return json(response, 404, { ok: false, message: 'Web UI is not built. Run `pixi run build` first.' });
  }
  const contentType = requested.endsWith('.html') ? 'text/html; charset=utf-8' : requested.endsWith('.js') ? 'text/javascript; charset=utf-8' : requested.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream';
  response.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(response);
}

function startWebServer(manager) {
  const server = createWebServer(manager);
  const { host, port } = manager.config.web;
  server.listen(port, host, () => console.log(`Control server listening on http://${host}:${port}`));
  return server;
}

module.exports = { startWebServer };
