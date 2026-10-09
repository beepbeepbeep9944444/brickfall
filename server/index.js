// Brickfall server entry point: serves the game and the accounts/leaderboard API.
// No dependencies — needs Node 22.5+ (built-in node:sqlite).
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { log } from './log.js';
import { q, closeDb } from './db.js';
import { HttpError, sendJSON, setSecurityHeaders, isSameOrigin, applyCors, pruneBuckets } from './http.js';
import { closeChat } from './chat.js';
import { handleUpgrade, closeGameConnections } from './game/connect.js';
import { findRoute, pathExists } from './routes.js';
import { serveStatic } from './static.js';

async function handle(req, res) {
  const started = performance.now();
  const url = new URL(req.url, 'http://localhost');
  setSecurityHeaders(req, res);
  const cors = url.pathname.startsWith('/api/') && applyCors(req, res);
  try {
    if (req.method === 'OPTIONS') { // CORS preflight
      res.writeHead(cors ? 204 : 403);
      return res.end();
    }
    const route = findRoute(req.method, url.pathname);
    if (route) {
      if (req.method === 'POST' && !isSameOrigin(req)) throw new HttpError(403, 'Cross-site request blocked.');
      await route(req, res, url);
    } else if (url.pathname.startsWith('/api/')) {
      throw new HttpError(pathExists(url.pathname) ? 405 : 404, pathExists(url.pathname) ? 'Method not allowed.' : 'Not found.');
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      await serveStatic(req, res, url);
    } else {
      throw new HttpError(405, 'Method not allowed.');
    }
  } catch (err) {
    if (!(err instanceof HttpError)) log.error('request failed', { method: req.method, path: url.pathname, error: err.stack || String(err) });
    if (!res.headersSent) sendJSON(res, err.status || 500, { error: err instanceof HttpError ? err.message : 'Something went wrong on our side.' });
    else res.end();
  } finally {
    if (config.logRequests && (url.pathname.startsWith('/api/') || res.statusCode >= 400)) {
      log.info(`${req.method} ${url.pathname} ${res.statusCode}`, { ms: Math.round(performance.now() - started) });
    }
  }
}

export function createServer() {
  const server = http.createServer(handle);
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    try { handleUpgrade(req, socket, head); } catch (err) { log.error('upgrade failed', { error: String(err) }); socket.destroy(); }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}

function housekeeping() {
  const now = Date.now();
  q.purgeSessions.run(now);
  q.purgeMatches.run(now - 12 * 3600e3);
  pruneBuckets(now);
}

export function start() {
  const server = createServer();
  housekeeping();
  const timer = setInterval(housekeeping, 3600e3);
  timer.unref();

  server.listen(config.port, config.host, () => {
    log.info(`Brickfall v${config.version} running at http://localhost:${server.address().port}`, { env: config.isProduction ? 'production' : 'development' });
  });

  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    log.info(`${signal} received, shutting down`);
    clearInterval(timer);
    closeChat(); // open chat streams and game connections would otherwise keep the server from closing
    closeGameConnections();
    server.close(() => { closeDb(); process.exit(0); });
    server.closeIdleConnections?.();
    setTimeout(() => { closeDb(); process.exit(0); }, 8000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) start();
