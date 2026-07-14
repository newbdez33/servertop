import fs from 'node:fs';
import path from 'node:path';
import type { ClaudeInfo, ClaudeSession } from '../../shared/types.js';

const CHUNK_BYTES = 256 * 1024;
const SCAN_CAP_BYTES = 4 * 1024 * 1024; // forward-scan budget to find a meaningful title
const TAIL_BYTES = 1024 * 1024; // messageCount lines can hide behind huge assistant entries
const ACTIVE_WINDOW_MS = 5 * 60_000;
const MAX_SESSIONS = 30;
const TITLE_MAX = 80;

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

function readChunk(fd: number, position: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  const read = fs.readSync(fd, buf, 0, length, position);
  return read === length ? buf : buf.subarray(0, read);
}

/** Extract plain text from a Claude message content (string or content-block array) */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
        return String((block as { text?: unknown }).text ?? '');
      }
    }
  }
  return '';
}

function parseMeta(file: string, size: number, dirName: string): ParsedMeta {
  const meta: ParsedMeta = {
    project: dirName,
    title: '',
    gitBranch: null,
    startedAt: null,
    turns: null,
  };
  const truncate = (t: string): string => (t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX)}…` : t);
  let fallbackTitle = ''; // trivial first prompt like "." — used only if nothing better
  let assistantFallback = ''; // first assistant text — for sessions with no real prompt

  const visit = (entry: Record<string, unknown>): void => {
    if (meta.startedAt === null && typeof entry.timestamp === 'string') {
      const t = Date.parse(entry.timestamp);
      if (Number.isFinite(t)) meta.startedAt = t;
    }
    if (meta.project === dirName && typeof entry.cwd === 'string' && entry.cwd) {
      meta.project = entry.cwd;
      if (typeof entry.gitBranch === 'string' && entry.gitBranch) meta.gitBranch = entry.gitBranch;
    }
    // Best title: a compaction summary line (continued sessions carry one up top)
    if (!meta.title && entry.type === 'summary' && typeof entry.summary === 'string' && entry.summary) {
      meta.title = truncate(entry.summary.replace(/\s+/g, ' ').trim());
    }
    // Otherwise: first meaningful prompt — skip command wrappers ("<command…"),
    // interruption markers ("[Request interrupted…"), and throwaway openers
    // like "." (some people start every session with one)
    if (!meta.title && entry.type === 'user' && !entry.isMeta && !entry.isSidechain) {
      const msg = entry.message as { content?: unknown } | undefined;
      const text = contentText(msg?.content).replace(/\s+/g, ' ').trim();
      if (text && !text.startsWith('<') && !text.startsWith('[')) {
        if (text.length >= 4) meta.title = truncate(text);
        else if (!fallbackTitle) fallbackTitle = text;
      }
    }
    if (!assistantFallback && entry.type === 'assistant' && !entry.isSidechain) {
      const msg = entry.message as { content?: unknown } | undefined;
      const text = contentText(msg?.content).replace(/\s+/g, ' ').trim();
      if (text.length >= 10) assistantFallback = truncate(text);
    }
  };
  const done = (): boolean =>
    Boolean(meta.title) && meta.project !== dirName && meta.startedAt !== null;

  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');

    // Forward scan in chunks (byte-level newline split keeps multi-byte
    // characters intact) until the metadata is complete or the cap is hit
    const cap = Math.min(size, SCAN_CAP_BYTES);
    let pos = 0;
    let leftover = Buffer.alloc(0);
    scan: while (pos < cap) {
      const chunk = readChunk(fd, pos, Math.min(CHUNK_BYTES, cap - pos));
      pos += chunk.length;
      let data = Buffer.concat([leftover, chunk]);
      let nl: number;
      while ((nl = data.indexOf(0x0a)) !== -1) {
        const line = data.subarray(0, nl).toString('utf8');
        data = data.subarray(nl + 1);
        if (!line) continue;
        try {
          visit(JSON.parse(line) as Record<string, unknown>);
        } catch {
          /* malformed line */
        }
        if (done()) break scan;
      }
      leftover = data;
    }

    // Tail scan for the latest messageCount
    const tailStart = Math.max(0, size - TAIL_BYTES);
    const lines = readChunk(fd, tailStart, Math.min(size, TAIL_BYTES)).toString('utf8').split('\n');
    if (tailStart > 0) lines.shift(); // first line of the chunk is almost certainly partial
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i]) continue;
      try {
        const entry = JSON.parse(lines[i]) as Record<string, unknown>;
        if (typeof entry.messageCount === 'number') {
          meta.turns = entry.messageCount;
          break;
        }
      } catch {
        /* partial line */
      }
    }
  } catch {
    /* unreadable file — keep defaults */
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
  if (!meta.title) meta.title = assistantFallback || fallbackTitle || '(no prompt)';
  return meta;
}

/**
 * Scans ~/.claude/projects/<slug>/<session>.jsonl transcripts. Parsing is
 * incremental: file content is only re-read when (mtime, size) changes;
 * unchanged sessions cost one stat() per scan.
 */
export class ClaudeScanner {
  readonly available: boolean;
  private readonly projectsDir: string;
  private cache = new Map<string, CacheEntry>();

  constructor(claudeDir: string) {
    this.projectsDir = path.join(claudeDir, 'projects');
    this.available = fs.existsSync(this.projectsDir);
  }

  scan(): ClaudeInfo {
    const empty: ClaudeInfo = {
      available: false,
      sessions: [],
      stats: { totalSessions: 0, totalProjects: 0, sessionsToday: 0, activeNow: 0 },
    };
    if (!this.available) return empty;

    const sessions: ClaudeSession[] = [];
    const projects = new Set<string>();
    const seen = new Set<string>();
    try {
      for (const dir of fs.readdirSync(this.projectsDir)) {
        const dirPath = path.join(this.projectsDir, dir);
        let files: string[];
        try {
          files = fs.readdirSync(dirPath);
        } catch {
          continue;
        }
        let hasSession = false;
        for (const f of files) {
          if (!f.endsWith('.jsonl')) continue;
          const file = path.join(dirPath, f);
          let st: fs.Stats;
          try {
            st = fs.statSync(file);
          } catch {
            continue;
          }
          hasSession = true;
          seen.add(file);
          let entry = this.cache.get(file);
          if (!entry || entry.mtimeMs !== st.mtimeMs || entry.size !== st.size) {
            entry = { mtimeMs: st.mtimeMs, size: st.size, meta: parseMeta(file, st.size, dir) };
            this.cache.set(file, entry);
          }
          sessions.push({
            id: path.basename(f, '.jsonl'),
            project: entry.meta.project,
            title: entry.meta.title,
            gitBranch: entry.meta.gitBranch,
            startedAt: entry.meta.startedAt,
            lastActiveAt: Math.round(st.mtimeMs),
            turns: entry.meta.turns,
            sizeBytes: st.size,
            active: Date.now() - st.mtimeMs < ACTIVE_WINDOW_MS,
          });
        }
        if (hasSession) projects.add(dir);
      }
    } catch (err) {
      console.warn(
        `[servertop] claude scan failed: ${err instanceof Error ? err.message : String(err)}`,
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
