import fs from 'node:fs';
import path from 'node:path';
import { resolveProject } from './project.js';
import type { AgentSession, AgentSessionsInfo } from '../../shared/types.js';

const CHUNK_BYTES = 256 * 1024;
const SCAN_CAP_BYTES = 4 * 1024 * 1024; // forward-scan budget to find a meaningful title
const ACTIVE_WINDOW_MS = 5 * 60_000;
const MAX_SESSIONS = 30;
const TITLE_MAX = 80;
const PROMPT_MAX = 160;

interface ParsedMeta {
  project: string;
  title: string;
  lastPrompt: string;
  gitBranch: string | null;
  startedAt: number | null;
  lastActiveAt: number | null;
  turns: number | null;
  running: boolean;
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  meta: ParsedMeta;
}

export function readChunk(fd: number, position: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  const read = fs.readSync(fd, buf, 0, length, position);
  return read === length ? buf : buf.subarray(0, read);
}

/** Visit complete JSONL records newest-first, stopping when visit returns true. */
export function visitLinesReverse(
  fd: number,
  size: number,
  visit: (line: Buffer) => boolean,
): void {
  let end = size;
  let trailing: Buffer = Buffer.alloc(0);

  while (end > 0) {
    const start = Math.max(0, end - CHUNK_BYTES);
    const chunk = readChunk(fd, start, end - start);
    const data = trailing.length === 0 ? chunk : Buffer.concat([chunk, trailing]);
    let lineEnd = data.length;

    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i] !== 0x0a) continue;
      const line = data.subarray(i + 1, lineEnd);
      lineEnd = i;
      if (line.length > 0 && visit(line)) return;
    }

    trailing = data.subarray(0, lineEnd);
    end = start;
  }

  if (trailing.length > 0) visit(trailing);
}

/** Extract plain text from a Claude message content (string or content-block array) */
export function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        block =>
          block &&
          typeof block === 'object' &&
          ['text', 'input_text', 'output_text'].includes(
            String((block as { type?: unknown }).type ?? ''),
          ),
      )
      .map(block => String((block as { text?: unknown }).text ?? ''))
      .join('\n');
  }
  return '';
}

const cleanText = (text: string): string => text.replace(/\s+/g, ' ').trim();
const isRealPrompt = (text: string): boolean =>
  Boolean(text) && !text.startsWith('<') && !text.startsWith('[');
const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

function parseMeta(file: string, size: number, dirName: string): ParsedMeta {
  const meta: ParsedMeta = {
    project: dirName,
    title: '',
    lastPrompt: '',
    gitBranch: null,
    startedAt: null,
    lastActiveAt: null,
    turns: null,
    running: false,
  };
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
      meta.title = truncate(cleanText(entry.summary), TITLE_MAX);
    }
    // Otherwise: first meaningful prompt — skip command wrappers ("<command…"),
    // interruption markers ("[Request interrupted…"), and throwaway openers
    // like "." (some people start every session with one)
    if (!meta.title && entry.type === 'user' && !entry.isMeta && !entry.isSidechain) {
      const msg = entry.message as { content?: unknown } | undefined;
      const text = cleanText(contentText(msg?.content));
      if (isRealPrompt(text)) {
        if (text.length >= 4) meta.title = truncate(text, TITLE_MAX);
        else if (!fallbackTitle) fallbackTitle = text;
      }
    }
    if (!assistantFallback && entry.type === 'assistant' && !entry.isSidechain) {
      const msg = entry.message as { content?: unknown } | undefined;
      const text = cleanText(contentText(msg?.content));
      if (text.length >= 10) assistantFallback = truncate(text, TITLE_MAX);
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

    // Walk backward until both the latest prompt and turn boundary are found.
    // This is not byte-capped: one very large tool result can otherwise hide
    // the prompt that started the current turn.
    let foundStatus = false;
    let foundActivity = false;
    visitLinesReverse(fd, size, raw => {
      const probe = raw.toString('utf8', 0, Math.min(raw.length, 512));
      if (
        !probe.includes('"type":"last-prompt"') &&
        !probe.includes('"type":"user"') &&
        !probe.includes('"type":"assistant"') &&
        !probe.includes('"type":"system"')
      ) {
        return false;
      }

      try {
        const entry = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
        const message = entry.message as { content?: unknown; stop_reason?: unknown } | undefined;
        const mainUser = entry.type === 'user' && !entry.isMeta && !entry.isSidechain;
        let prompt = '';
        if (entry.type === 'last-prompt' && typeof entry.lastPrompt === 'string') {
          prompt = cleanText(entry.lastPrompt);
        } else if (mainUser) {
          prompt = cleanText(contentText(message?.content));
        }
        if (!isRealPrompt(prompt)) prompt = '';

        if (!foundActivity) {
          const hasToolResult =
            mainUser &&
            Array.isArray(message?.content) &&
            message.content.some(
              block =>
                block &&
                typeof block === 'object' &&
                (block as { type?: unknown }).type === 'tool_result',
            );
          const meaningfulActivity =
            (!entry.isSidechain && entry.type === 'assistant') ||
            (mainUser && (Boolean(prompt) || hasToolResult)) ||
            (!entry.isSidechain &&
              entry.type === 'system' &&
              entry.subtype === 'turn_duration');
          if (meaningfulActivity) {
            foundActivity = true;
            if (typeof entry.timestamp === 'string') {
              const timestamp = Date.parse(entry.timestamp);
              if (Number.isFinite(timestamp)) meta.lastActiveAt = timestamp;
            }
          }
        }

        if (!meta.lastPrompt && prompt) {
          meta.lastPrompt = truncate(prompt, PROMPT_MAX);
        }
        if (
          meta.turns === null &&
          !entry.isSidechain &&
          typeof entry.messageCount === 'number'
        ) {
          meta.turns = entry.messageCount;
        }
        if (!foundStatus) {
          // `last-prompt` snapshots can be appended while a session is idle;
          // only an actual main-chain user record starts a running turn.
          if (
            !entry.isSidechain &&
            ((entry.type === 'system' && entry.subtype === 'turn_duration') ||
              (entry.type === 'assistant' && message?.stop_reason === 'end_turn'))
          ) {
            meta.running = false;
            foundStatus = true;
          } else if (mainUser && prompt) {
            meta.running = true;
            foundStatus = true;
          }
        }
      } catch {
        /* malformed line */
      }
      return (
        Boolean(meta.lastPrompt) &&
        foundStatus &&
        meta.turns !== null &&
        foundActivity
      );
    });
  } catch {
    /* unreadable file — keep defaults */
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
  if (!meta.title) meta.title = assistantFallback || fallbackTitle || '(no prompt)';
  if (!meta.lastPrompt) meta.lastPrompt = fallbackTitle || '(no prompt)';
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

  scan(): AgentSessionsInfo {
    const empty: AgentSessionsInfo = {
      available: false,
      sessions: [],
      stats: { totalSessions: 0, totalProjects: 0, sessionsToday: 0, activeNow: 0 },
    };
    if (!this.available) return empty;

    const sessions: AgentSession[] = [];
    const projects = new Set<string>();
    const seen = new Set<string>();
    const now = Date.now();
    try {
      for (const dir of fs.readdirSync(this.projectsDir)) {
        const dirPath = path.join(this.projectsDir, dir);
        let files: string[];
        try {
          files = fs.readdirSync(dirPath);
        } catch {
          continue;
        }
        for (const f of files) {
          if (!f.endsWith('.jsonl')) continue;
          const file = path.join(dirPath, f);
          let st: fs.Stats;
          try {
            st = fs.statSync(file);
          } catch {
            continue;
          }
          seen.add(file);
          let entry = this.cache.get(file);
          if (!entry || entry.mtimeMs !== st.mtimeMs || entry.size !== st.size) {
            entry = { mtimeMs: st.mtimeMs, size: st.size, meta: parseMeta(file, st.size, dir) };
            this.cache.set(file, entry);
          }
          // Claude may touch a transcript for metadata-only updates, so prefer
          // the latest meaningful event timestamp. mtime is legacy fallback.
          const lastActiveAt = entry.meta.lastActiveAt ?? Math.round(st.mtimeMs);
          const status =
            entry.meta.running && now - lastActiveAt < ACTIVE_WINDOW_MS ? 'running' : 'wait';
          const project = resolveProject(entry.meta.project);
          projects.add(project.root);
          sessions.push({
            id: path.basename(f, '.jsonl'),
            project: entry.meta.project,
            projectName: project.name,
            title: entry.meta.title,
            lastPrompt: entry.meta.lastPrompt,
            gitBranch: entry.meta.gitBranch,
            startedAt: entry.meta.startedAt,
            lastActiveAt,
            turns: entry.meta.turns,
            sizeBytes: st.size,
            status,
            active: status === 'running',
          });
        }
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
