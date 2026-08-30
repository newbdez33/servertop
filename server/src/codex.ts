import fs from 'node:fs';
import path from 'node:path';
import { contentText, readChunk, visitLinesReverse } from './claude.js';
import { resolveProject } from './project.js';
import type { AgentSession, AgentSessionsInfo } from '../../shared/types.js';

const CHUNK_BYTES = 256 * 1024;
const SCAN_CAP_BYTES = 2 * 1024 * 1024;
const ACTIVE_WINDOW_MS = 5 * 60_000;
const MAX_SESSIONS = 30;
const TITLE_MAX = 80;
const PROMPT_MAX = 160;

// Lines worth JSON-parsing — everything else (function calls, reasoning,
// token counts …) is skipped on a cheap substring check
const INTERESTING = ['session_meta', 'user_message', 'agent_message', '"message"'];

interface ParsedMeta {
  project: string;
  title: string;
  lastPrompt: string;
  gitBranch: string | null;
  startedAt: number | null;
  turns: number | null;
  running: boolean;
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
    lastPrompt: '',
    gitBranch: null,
    startedAt: null,
    turns: null,
    running: false,
  };
  const truncate = (text: string, max: number): string =>
    text.length > max ? `${text.slice(0, max)}…` : text;
  const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();
  const realPrompt = (text: string): boolean =>
    Boolean(text) && !text.startsWith('<') && !text.startsWith('[');
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
      const text = clean(String(payload.message ?? ''));
      if (!meta.title && text.length >= 4 && realPrompt(text)) {
        meta.title = truncate(text, TITLE_MAX);
      }
      return;
    }
    if (entry.type === 'event_msg' && payload.type === 'agent_message' && !assistantFallback) {
      const text = clean(String(payload.message ?? ''));
      if (text.length >= 10) assistantFallback = truncate(text, TITLE_MAX);
      return;
    }
    if (entry.type === 'response_item' && payload.type === 'message') {
      messages++;
      if (!meta.title && payload.role === 'user') {
        const text = clean(contentText(payload.content));
        if (text.length >= 4 && realPrompt(text)) {
          meta.title = truncate(text, TITLE_MAX);
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

    // Find the newest real user message and the latest task lifecycle event.
    // Reverse scanning avoids reading old history in the common case while
    // still crossing arbitrarily large tool-output records when necessary.
    let foundLifecycle = false;
    let legacyRunning: boolean | null = null;
    visitLinesReverse(fd, size, raw => {
      const probe = raw.toString('utf8', 0, Math.min(raw.length, 512));
      const lifecycleOrMessageEvent =
        probe.includes('"type":"event_msg"') &&
        ['task_started', 'task_complete', 'turn_aborted', 'user_message', 'agent_message'].some(
          type => probe.includes(`"type":"${type}"`),
        );
      const responseMessage =
        probe.includes('"type":"response_item"') && probe.includes('"type":"message"');
      if (!lifecycleOrMessageEvent && !responseMessage) {
        return false;
      }

      try {
        const entry = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        const payload = (entry.payload ?? {}) as Record<string, unknown>;
        let prompt = '';
        if (entry.type === 'event_msg' && payload.type === 'user_message') {
          prompt = clean(String(payload.message ?? ''));
        } else if (
          entry.type === 'response_item' &&
          payload.type === 'message' &&
          payload.role === 'user'
        ) {
          prompt = clean(contentText(payload.content));
        }
        if (!realPrompt(prompt)) prompt = '';

        if (!meta.lastPrompt && prompt) {
          meta.lastPrompt = truncate(prompt, PROMPT_MAX);
        }
        if (!foundLifecycle && entry.type === 'event_msg') {
          if (payload.type === 'task_started') {
            meta.running = true;
            foundLifecycle = true;
          } else if (payload.type === 'task_complete' || payload.type === 'turn_aborted') {
            meta.running = false;
            foundLifecycle = true;
          }
        }
        if (legacyRunning === null) {
          if (prompt) {
            legacyRunning = true;
          } else if (
            (entry.type === 'event_msg' && payload.type === 'agent_message') ||
            (entry.type === 'response_item' &&
              payload.type === 'message' &&
              payload.role === 'assistant')
          ) {
            legacyRunning = false;
          }
        }
      } catch {
        /* malformed line */
      }
      return Boolean(meta.lastPrompt) && foundLifecycle;
    });
    if (!foundLifecycle) meta.running = legacyRunning === true;
  } catch {
    /* unreadable file — keep defaults */
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }

  meta.turns = scannedAll ? messages : null; // partial scans would under-count
  if (!meta.title) meta.title = assistantFallback || '(no prompt)';
  if (!meta.lastPrompt) meta.lastPrompt = '(no prompt)';
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
    const projects = new Set<string>();
    const now = Date.now();
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
        const status =
          entry.meta.running && now - st.mtimeMs < ACTIVE_WINDOW_MS ? 'running' : 'wait';
        const rawProject = entry.meta.project || '(unknown)';
        const project = resolveProject(rawProject);
        projects.add(project.root);
        sessions.push({
          id: path.basename(file, '.jsonl').slice(-12),
          project: rawProject,
          projectName: project.name,
          title: entry.meta.title,
          lastPrompt: entry.meta.lastPrompt,
          gitBranch: entry.meta.gitBranch,
          startedAt: entry.meta.startedAt,
          lastActiveAt: Math.round(st.mtimeMs),
          turns: entry.meta.turns,
          sizeBytes: st.size,
          status,
          active: status === 'running',
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
        totalProjects: projects.size,
        sessionsToday: sessions.filter(s => s.lastActiveAt >= midnight).length,
        activeNow: sessions.filter(s => s.active).length,
      },
    };
  }
}
