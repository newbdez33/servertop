import fs from 'node:fs';
import path from 'node:path';
import { contentText, readChunk } from './claude.js';
import type { AgentSession, AgentSessionsInfo } from '../../shared/types.js';

const CHUNK_BYTES = 256 * 1024;
const SCAN_CAP_BYTES = 2 * 1024 * 1024;
const ACTIVE_WINDOW_MS = 5 * 60_000;
const MAX_SESSIONS = 30;
const TITLE_MAX = 80;

// Lines worth JSON-parsing — everything else (function calls, reasoning,
// token counts …) is skipped on a cheap substring check
const INTERESTING = ['session_meta', 'user_message', 'agent_message', '"message"'];

interface ParsedMeta {
  project: string;
  title: string;
  gitBranch: string | null;
  startedAt: number | null;
  turns: number | null;
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  meta: ParsedMeta;
}

function parseMeta(file: string, size: number): ParsedMeta {
  const meta: ParsedMeta = {
    project: '',
    title: '',
    gitBranch: null,
    startedAt: null,
    turns: null,
  };
  const truncate = (t: string): string => (t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX)}…` : t);
  let assistantFallback = '';
  let messages = 0;

  const visit = (entry: Record<string, unknown>): void => {
    const payload = (entry.payload ?? {}) as Record<string, unknown>;
    if (entry.type === 'session_meta') {
      if (typeof payload.cwd === 'string') meta.project = payload.cwd;
      const ts = typeof payload.timestamp === 'string' ? Date.parse(payload.timestamp) : NaN;
      if (Number.isFinite(ts)) meta.startedAt = ts;
      const git = payload.git as { branch?: unknown } | undefined;
      if (git && typeof git.branch === 'string' && git.branch) meta.gitBranch = git.branch;
      return;
    }
    if (entry.type === 'event_msg' && payload.type === 'user_message') {
      const text = String(payload.message ?? '').replace(/\s+/g, ' ').trim();
      if (!meta.title && text.length >= 4 && !text.startsWith('<') && !text.startsWith('[')) {
        meta.title = truncate(text);
      }
      return;
    }
    if (entry.type === 'event_msg' && payload.type === 'agent_message' && !assistantFallback) {
      const text = String(payload.message ?? '').replace(/\s+/g, ' ').trim();
      if (text.length >= 10) assistantFallback = truncate(text);
      return;
    }
    if (entry.type === 'response_item' && payload.type === 'message') {
      messages++;
      if (!meta.title && payload.role === 'user') {
        const text = contentText(payload.content).replace(/\s+/g, ' ').trim();
        if (text.length >= 4 && !text.startsWith('<') && !text.startsWith('[')) {
          meta.title = truncate(text);
        }
      }
    }
  };

  let fd: number | null = null;
  let scannedAll = false;
  try {
    fd = fs.openSync(file, 'r');
    const cap = Math.min(size, SCAN_CAP_BYTES);
    let pos = 0;
    let leftover = Buffer.alloc(0);
    while (pos < cap) {
      const chunk = readChunk(fd, pos, Math.min(CHUNK_BYTES, cap - pos));
      pos += chunk.length;
      let data = Buffer.concat([leftover, chunk]);
      let nl: number;
      while ((nl = data.indexOf(0x0a)) !== -1) {
        const raw = data.subarray(0, nl);
        data = data.subarray(nl + 1);
        if (raw.length === 0) continue;
        const probe = raw.toString('utf8', 0, Math.min(raw.length, 200));
        if (!INTERESTING.some(k => probe.includes(k))) continue;
        try {
          visit(JSON.parse(raw.toString('utf8')) as Record<string, unknown>);
        } catch {
          /* malformed line */
        }
      }
      leftover = data;
    }
    scannedAll = cap === size;
  } catch {
    /* unreadable file — keep defaults */
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }

  meta.turns = scannedAll ? messages : null; // partial scans would under-count
  if (!meta.title) meta.title = assistantFallback || '(no prompt)';
  return meta;
}

/**
 * Scans ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl. Incremental like the
 * Claude scanner: content is only re-read when (mtime, size) changes.
 */
export class CodexScanner {
  readonly available: boolean;
  private readonly sessionsDir: string;
  private cache = new Map<string, CacheEntry>();

  constructor(codexDir: string) {
    this.sessionsDir = path.join(codexDir, 'sessions');
    this.available = fs.existsSync(this.sessionsDir);
  }

  scan(): AgentSessionsInfo {
    const empty: AgentSessionsInfo = {
      available: false,
      sessions: [],
      stats: { totalSessions: 0, totalProjects: 0, sessionsToday: 0, activeNow: 0 },
    };
    if (!this.available) return empty;

    const sessions: AgentSession[] = [];
    const seen = new Set<string>();
    try {
      const entries = fs.readdirSync(this.sessionsDir, { recursive: true }) as string[];
      for (const rel of entries) {
        if (!rel.endsWith('.jsonl')) continue;
        const file = path.join(this.sessionsDir, rel);
        let st: fs.Stats;
        try {
          st = fs.statSync(file);
        } catch {
          continue;
        }
        if (!st.isFile()) continue;
        seen.add(file);
        let entry = this.cache.get(file);
        if (!entry || entry.mtimeMs !== st.mtimeMs || entry.size !== st.size) {
          entry = { mtimeMs: st.mtimeMs, size: st.size, meta: parseMeta(file, st.size) };
          this.cache.set(file, entry);
        }
        sessions.push({
          id: path.basename(file, '.jsonl').slice(-12),
          project: entry.meta.project || '(unknown)',
          title: entry.meta.title,
          gitBranch: entry.meta.gitBranch,
          startedAt: entry.meta.startedAt,
          lastActiveAt: Math.round(st.mtimeMs),
          turns: entry.meta.turns,
          sizeBytes: st.size,
          active: Date.now() - st.mtimeMs < ACTIVE_WINDOW_MS,
        });
      }
    } catch (err) {
      console.warn(
        `[servertop] codex scan failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return empty;
    }
    for (const key of this.cache.keys()) {
      if (!seen.has(key)) this.cache.delete(key);
    }

    sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    const midnight = new Date().setHours(0, 0, 0, 0);
    return {
      available: true,
      sessions: sessions.slice(0, MAX_SESSIONS),
      stats: {
        totalSessions: sessions.length,
        totalProjects: new Set(sessions.map(s => s.project)).size,
        sessionsToday: sessions.filter(s => s.lastActiveAt >= midnight).length,
        activeNow: sessions.filter(s => s.active).length,
      },
    };
  }
}
