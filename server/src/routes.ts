import { Router } from 'express';
import { login, loginLimiter, requireAuth } from './auth.js';
import { config } from './config.js';
import type { Collector } from './collector.js';
import type { HistoryStore } from './store.js';

const RANGES: Record<string, number> = { '3m': 180, '5m': 300, '15m': 900, '1h': 3600 };

export function createRouter(collector: Collector, history: HistoryStore): Router {
  const r = Router();

  r.get('/auth/status', (_req, res) => {
    res.json({ required: config.authRequired });
  });
  r.post('/auth/login', loginLimiter, login);

  r.use(requireAuth);

  r.get('/system', (_req, res) => {
    res.json(collector.system);
  });

  r.get('/metrics', (_req, res) => {
    res.json(collector.snapshot);
  });

  r.get('/metrics/history', (req, res) => {
    const raw = String(req.query.range ?? '3m');
    const parsed = Number.parseInt(raw, 10);
    const seconds = RANGES[raw] ?? Math.min(
      Number.isFinite(parsed) && parsed > 0 ? parsed : 180,
      config.historyWindowSec,
    );
    res.json({ points: history.range(seconds) });
  });

  r.get('/processes', (req, res) => {
    const sort = req.query.sort === 'mem' ? 'mem' : 'cpu';
    const parsed = Number.parseInt(String(req.query.limit ?? '10'), 10);
    const limit = Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : 10, 50);
    const list = [...collector.processes].sort((a, b) =>
      sort === 'mem' ? b.memBytes - a.memBytes : b.cpu - a.cpu,
    );
    res.json({ processes: list.slice(0, limit) });
  });

  r.get('/docker', (_req, res) => {
    res.json({ available: collector.dockerAvailable, containers: collector.containers });
  });

  return r;
}
