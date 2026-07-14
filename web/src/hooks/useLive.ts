import { useEffect, useRef, useState } from 'react';
import type {
  ClaudeInfo,
  ContainerInfo,
  HistoryPoint,
  MetricsSnapshot,
  ProcessInfo,
  SystemInfo,
  WsMessage,
} from '../../../shared/types';
import { api, ApiError, wsUrl } from '../lib/api';
import { createDemo, IS_DEMO } from '../lib/demo';

/** Points kept client-side; the visible window is HISTORY_LEN × sampleInterval. */
export const HISTORY_LEN = 90;

export type ConnStatus = 'connecting' | 'online' | 'offline';

export interface LiveState {
  status: ConnStatus;
  system: SystemInfo | null;
  snapshot: MetricsSnapshot | null;
  processes: ProcessInfo[];
  containers: ContainerInfo[];
  claude: ClaudeInfo | null;
  history: HistoryPoint[];
}

/**
 * Live metrics feed: fetches static system info (retried on every reconnect
 * until it succeeds), seeds history over REST, then streams over WebSocket.
 * Reconnects with exponential backoff; polls REST every 5s while offline.
 */
export function useLive(onAuthFailed: () => void): LiveState {
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [snapshot, setSnapshot] = useState<MetricsSnapshot | null>(null);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [claude, setClaude] = useState<ClaudeInfo | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);

  const onAuthFailedRef = useRef(onAuthFailed);
  onAuthFailedRef.current = onAuthFailed;

  useEffect(() => {
    // Demo build (GitHub Pages): drive the exact same UI from a simulator
    if (IS_DEMO) {
      const demo = createDemo();
      setSystem(demo.system);
      setHistory(demo.seedHistory());
      setProcesses(demo.processes());
      setContainers(demo.containers());
      setClaude(demo.claude());
      setStatus('online');
      const applyTick = (): void => {
        const m = demo.tick();
        setSnapshot(m);
        setHistory(h =>
          [...h, {
            ts: m.ts,
            cpu: m.cpu.usage,
            mem: (m.mem.used / m.mem.total) * 100,
            rx: m.net[0].rxSec,
            tx: m.net[0].txSec,
          }].slice(-HISTORY_LEN),
        );
      };
      applyTick();
      const fast = setInterval(applyTick, demo.system.sampleIntervalMs);
      const medium = setInterval(() => {
        setProcesses(demo.processes());
        setContainers(demo.containers());
      }, 5000);
      return () => {
        clearInterval(fast);
        clearInterval(medium);
      };
    }

    let disposed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let attempts = 0;
    let sys: SystemInfo | null = null;

    const handleAuthError = (err: unknown): boolean => {
      if (err instanceof ApiError && err.status === 401) {
        onAuthFailedRef.current();
        return true;
      }
      return false;
    };

    const pushPoint = (m: MetricsSnapshot): void => {
      const primary = m.net[0];
      const point: HistoryPoint = {
        ts: m.ts,
        cpu: m.cpu.usage,
        mem: m.mem.total ? (m.mem.used / m.mem.total) * 100 : 0,
        rx: primary?.rxSec ?? 0,
        tx: primary?.txSec ?? 0,
      };
      setHistory(h =>
        h.length && point.ts <= h[h.length - 1].ts ? h : [...h, point].slice(-HISTORY_LEN),
      );
    };

    const applyMetrics = (m: MetricsSnapshot): void => {
      setSnapshot(m);
      pushPoint(m);
    };

    const fetchSystem = async (): Promise<void> => {
      if (sys) return;
      try {
        const s = await api<SystemInfo | null>('/system');
        if (s && !disposed) {
          sys = s;
          setSystem(s);
        }
      } catch (err) {
        handleAuthError(err);
      }
    };

    const seedHistory = async (): Promise<void> => {
      const intervalMs = sys?.sampleIntervalMs ?? 2000;
      const seconds = Math.ceil((HISTORY_LEN * intervalMs) / 1000);
      try {
        const res = await api<{ points: HistoryPoint[] }>(`/metrics/history?range=${seconds}`);
        if (!disposed) setHistory(res.points.slice(-HISTORY_LEN));
      } catch (err) {
        handleAuthError(err);
      }
    };

    const poll = async (): Promise<void> => {
      void fetchSystem();
      try {
        const m = await api<MetricsSnapshot | null>('/metrics');
        if (m && !disposed) applyMetrics(m);
      } catch (err) {
        handleAuthError(err);
      }
    };

    const startPolling = (): void => {
      if (!pollTimer) pollTimer = setInterval(() => void poll(), 5000);
    };
    const stopPolling = (): void => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const connect = (): void => {
      if (disposed) return;
      ws = new WebSocket(wsUrl());

      ws.onopen = () => {
        attempts = 0;
        setStatus('online');
        stopPolling();
        void fetchSystem(); // retried until it succeeds once
      };

      ws.onmessage = ev => {
        let msg: WsMessage;
        try {
          msg = JSON.parse(ev.data as string) as WsMessage;
        } catch {
          return;
        }
        if (msg.type === 'metrics') applyMetrics(msg.data);
        else if (msg.type === 'processes') setProcesses(msg.data);
        else if (msg.type === 'containers') setContainers(msg.data);
        else if (msg.type === 'claude') setClaude(msg.data);
      };

      ws.onclose = () => {
        if (disposed) return;
        setStatus('offline');
        startPolling();
        // A rejected upgrade (expired JWT) also lands here — the REST poll
        // surfaces the 401 through handleAuthError and returns to login.
        attempts += 1;
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5));
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => ws?.close();
    };

    void fetchSystem()
      .then(seedHistory)
      .then(connect);

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stopPolling();
      ws?.close();
    };
  }, []);

  return { status, system, snapshot, processes, containers, claude, history };
}
