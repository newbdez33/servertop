import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { verifyWsToken } from './auth.js';
import { Collector } from './collector.js';
import { config } from './config.js';
import { createRouter } from './routes.js';
import { HistoryStore } from './store.js';
import type { MetricsSnapshot, WsMessage } from '../../shared/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist =
  [
    process.env.WEB_DIST,
    path.resolve(here, '../../../../web/dist'), // compiled: server/dist/server/src → repo root
    path.resolve(here, '../../web/dist'),       // tsx dev:  server/src → repo root
  ]
    .filter((p): p is string => Boolean(p))
    .find(p => fs.existsSync(path.join(p, 'index.html'))) ?? null;

async function main(): Promise<void> {
  const capacity = Math.max(60, Math.floor((config.historyWindowSec * 1000) / config.sampleIntervalMs));
  const history = new HistoryStore(capacity);
  const collector = new Collector();

  collector.on('metrics', (m: MetricsSnapshot) => {
    const primary = m.net[0];
    history.push({
      ts: m.ts,
      cpu: m.cpu.usage,
      mem: m.mem.total ? Math.round((m.mem.used / m.mem.total) * 1000) / 10 : 0,
      rx: primary?.rxSec ?? 0,
      tx: primary?.txSec ?? 0,
    });
  });

  await collector.start();

  const app = express();
  app.disable('x-powered-by');
  // The HTTPS overlay proxies from local Caddy — trust X-Forwarded-For from
  // loopback only, so the login rate limiter keys on the real client IP
  // (never `true`: that would let clients spoof their IP)
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '10kb' }));

  // CORS for a separately hosted frontend (ALLOWED_ORIGIN env); off by default
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use('/api', createRouter(collector, history));

  if (webDist) {
    // Hashed assets can be cached long; index.html must revalidate so new
    // deploys are picked up immediately
    app.use(
      express.static(webDist, {
        index: 'index.html',
        maxAge: '7d',
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    // SPA fallback
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(path.join(webDist, 'index.html'), {
        headers: { 'Cache-Control': 'no-cache' },
      });
    });
  } else {
    console.warn('[servertop] web/dist not found — serving API only (build the web app first)');
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();
  const alive = new WeakMap<WebSocket, boolean>();

  // Browser WS is not CORS-enforced — check Origin ourselves: same-host or allow-listed
  const wsOriginAllowed = (req: http.IncomingMessage): boolean => {
    const origin = req.headers.origin;
    if (!origin) return true; // non-browser clients
    try {
      if (new URL(origin).host === req.headers.host) return true;
    } catch {
      return false;
    }
    return config.allowedOrigins.includes(origin.replace(/\/+$/, ''));
  };

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    if (!wsOriginAllowed(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!verifyWsToken(url.searchParams.get('token'))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

  const send = (ws: WebSocket, msg: WsMessage): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  const broadcast = (msg: WsMessage): void => {
    const payload = JSON.stringify(msg);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  };

  wss.on('connection', ws => {
    clients.add(ws);
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => ws.terminate());
    // Push current state immediately so the UI paints without waiting a tick
    if (collector.snapshot) send(ws, { type: 'metrics', data: collector.snapshot });
    send(ws, { type: 'processes', data: collector.processes });
    send(ws, { type: 'containers', data: collector.containers });
  });

  collector.on('metrics', data => broadcast({ type: 'metrics', data }));
  collector.on('processes', data => broadcast({ type: 'processes', data }));
  collector.on('containers', data => broadcast({ type: 'containers', data }));

  const heartbeat = setInterval(() => {
    for (const ws of clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        clients.delete(ws);
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, 30_000);

  server.listen(config.port, () => {
    console.log(
      `[servertop] v${config.agentVersion} listening on :${config.port} ` +
        `(auth ${config.authRequired ? 'enabled' : 'DISABLED'}, ` +
        `host root ${config.hostRoot ?? 'native'}, web ${webDist ? 'ok' : 'missing'})`,
    );
  });

  const shutdown = (): void => {
    clearInterval(heartbeat);
    collector.stop();
    for (const ws of clients) ws.terminate();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void main().catch(err => {
  console.error('[servertop] fatal:', err);
  process.exit(1);
});
