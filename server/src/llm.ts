import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import type { LlmInfo, LlmServer } from '../../shared/types.js';

const PROBE_TIMEOUT_MS = 3000;

export interface LlmServerConfig {
  name?: string;
  url: string;
  apiKey?: string;
}

/** Loads llm.json: `{"servers": [{name?, url, apiKey?}, …]}`. Never crashes. */
export function loadLlmConfig(file: string): LlmServerConfig[] {
  if (!fs.existsSync(file)) return [];
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = Array.isArray(raw) ? raw : (raw as { servers?: unknown })?.servers;
    if (!Array.isArray(list)) throw new Error('expected {"servers": [...]} or a top-level array');
    const out: LlmServerConfig[] = [];
    for (const entry of list) {
      const e = entry as { name?: unknown; url?: unknown; apiKey?: unknown } | null;
      if (e && typeof e.url === 'string' && /^https?:\/\//i.test(e.url)) {
        out.push({
          url: e.url.replace(/\/+$/, ''),
          name: typeof e.name === 'string' && e.name ? e.name : undefined,
          apiKey: typeof e.apiKey === 'string' && e.apiKey ? e.apiKey : undefined,
        });
      } else {
        console.warn(`[servertop] llm: skipping invalid entry ${JSON.stringify(entry)}`);
      }
    }
    if (out.length) console.log(`[servertop] llm: ${out.length} server(s) from ${file}`);
    return out;
  } catch (err) {
    console.warn(
      `[servertop] llm: ignoring ${file} (${err instanceof Error ? err.message : String(err)})`,
    );
    return [];
  }
}

function localAddresses(): Set<string> {
  const addrs = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '::']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list ?? []) addrs.add(iface.address);
  }
  return addrs;
}

/** Listening pid for a local port; null when unresolvable (e.g. no lsof in container). */
function listeningPid(port: string): number | null {
  try {
    const out = execFileSync('lsof', ['-nP', `-tiTCP:${port}`, '-sTCP:LISTEN'], {
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    const pid = Number.parseInt(out.split('\n')[0], 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function processStats(pid: number): { cpuPct: number; memBytes: number } | null {
  try {
    const out = execFileSync('ps', ['-o', 'pcpu=,rss=', '-p', String(pid)], {
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
      .split(/\s+/);
    const cpu = Number.parseFloat(out[0]);
    const rssKb = Number.parseInt(out[1], 10);
    if (!Number.isFinite(cpu) || !Number.isFinite(rssKb)) return null;
    return { cpuPct: Math.round(cpu * 10) / 10, memBytes: rssKb * 1024 };
  } catch {
    return null;
  }
}

/** Probes OpenAI-compatible endpoints; remembers which servers expose /slots. */
export class LlmProber {
  readonly available: boolean;
  private readonly local = localAddresses();
  private slotsSupport = new Map<string, boolean>();

  constructor(private readonly servers: LlmServerConfig[]) {
    this.available = servers.length > 0;
  }

  async probe(): Promise<LlmInfo> {
    const servers = await Promise.all(this.servers.map(s => this.probeOne(s)));
    return { available: this.available, servers };
  }

  private async probeOne(cfg: LlmServerConfig): Promise<LlmServer> {
    const headers: Record<string, string> = cfg.apiKey
      ? { Authorization: `Bearer ${cfg.apiKey}` }
      : {};

    let up = false;
    let latencyMs: number | null = null;
    let model: string | null = null;
    let contextLength: number | null = null;
    const t0 = Date.now();
    try {
      const res = await fetch(`${cfg.url}/v1/models`, {
        headers,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      latencyMs = Date.now() - t0;
      if (res.ok) {
        up = true;
        const body = (await res.json().catch(() => null)) as {
          data?: Array<{
            id?: string;
            context_length?: number;
            top_provider?: { context_length?: number };
          }>;
        } | null;
        const m = body?.data?.[0];
        if (m) {
          model = m.id ?? null;
          contextLength = m.context_length ?? m.top_provider?.context_length ?? null;
        }
      }
    } catch {
      latencyMs = null;
    }

    // Vanilla llama.cpp exposes /slots — probe until it says no
    let slotsTotal: number | null = null;
    let slotsBusy: number | null = null;
    if (up && this.slotsSupport.get(cfg.url) !== false) {
      try {
        const res = await fetch(`${cfg.url}/slots`, {
          headers,
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        const arr = res.ok ? ((await res.json()) as unknown) : null;
        if (Array.isArray(arr)) {
          this.slotsSupport.set(cfg.url, true);
          slotsTotal = arr.length;
          slotsBusy = arr.filter(s => (s as { is_processing?: boolean }).is_processing).length;
        } else {
          this.slotsSupport.set(cfg.url, false);
        }
      } catch {
        this.slotsSupport.set(cfg.url, false);
      }
    }

    // Local process stats via the listening port
    let pid: number | null = null;
    let cpuPct: number | null = null;
    let memBytes: number | null = null;
    try {
      const u = new URL(cfg.url);
      if (this.local.has(u.hostname)) {
        pid = listeningPid(u.port || (u.protocol === 'https:' ? '443' : '80'));
        if (pid !== null) {
          const stats = processStats(pid);
          if (stats) ({ cpuPct, memBytes } = stats);
        }
      }
    } catch {
      /* bad URL already filtered at load */
    }

    return {
      name: cfg.name ?? model ?? cfg.url.replace(/^https?:\/\//, ''),
      url: cfg.url,
      up,
      latencyMs,
      model,
      contextLength,
      pid,
      cpuPct,
      memBytes,
      slotsTotal,
      slotsBusy,
    };
  }
}
