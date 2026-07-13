import crypto from 'node:crypto';
import fs from 'node:fs';

const env = process.env;

/** '/host' when the host root fs is bind-mounted (Docker deployment), else null (native/dev). */
const hostRoot = fs.existsSync('/host/etc') ? '/host' : null;

/** Positive-integer env var with fallback — a typo must not crash or spin the sampler. */
const intEnv = (raw: string | undefined, fallback: number): number => {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  port: intEnv(env.PORT, 3000),
  accessToken: env.ACCESS_TOKEN ?? '',
  authRequired: (env.ACCESS_TOKEN ?? '') !== '',
  jwtSecret: env.JWT_SECRET ?? crypto.randomBytes(32).toString('hex'),
  /** Session lifetime in seconds (default 24h) */
  jwtTtlSec: intEnv(env.JWT_TTL, 24 * 3600),
  sampleIntervalMs: intEnv(env.SAMPLE_INTERVAL, 2000),
  historyWindowSec: intEnv(env.HISTORY_WINDOW, 3600),
  /** Optional dashboard layout JSON (relative to the working dir; /app in Docker) */
  layoutFile: env.LAYOUT_FILE ?? 'layout.json',
  /** Origins allowed for cross-origin API access (e.g. a GitHub Pages frontend). Empty = same-origin only. */
  allowedOrigins: (env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map(s => s.trim().replace(/\/+$/, ''))
    .filter(Boolean),
  hostRoot,
  agentVersion: '0.1.0',
} as const;

if (!config.authRequired) {
  console.warn(
    '[servertop] ACCESS_TOKEN is not set — authentication is DISABLED. Only use on trusted networks.',
  );
}
