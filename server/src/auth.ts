import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

export const loginLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

function tokenMatches(candidate: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(config.accessToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function login(req: Request, res: Response): void {
  if (!config.authRequired) {
    res.json({ token: '', expiresIn: 0 });
    return;
  }
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  if (!token || !tokenMatches(token)) {
    res.status(401).json({ error: 'Invalid access token' });
    return;
  }
  const signed = jwt.sign({ sub: 'servertop' }, config.jwtSecret, {
    expiresIn: config.jwtTtlSec,
  });
  res.json({ token: signed, expiresIn: config.jwtTtlSec });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.authRequired) {
    next();
    return;
  }
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

export function verifyWsToken(token: string | null): boolean {
  if (!config.authRequired) return true;
  if (!token) return false;
  try {
    jwt.verify(token, config.jwtSecret);
    return true;
  } catch {
    return false;
  }
}
