const TOKEN_KEY = 'servertop.token';
const SERVER_KEY = 'servertop.server';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string): void => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

/**
 * Backend base URL — a CLIENT-side connection setting for separately hosted
 * frontends (e.g. GitHub Pages). Empty string = same-origin (Docker deploy).
 */
export const getServerUrl = (): string => localStorage.getItem(SERVER_KEY) ?? '';
export function setServerUrl(url: string): void {
  const trimmed = url.trim().replace(/\/+$/, '');
  const next = trimmed
    ? /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`
    : '';
  // Tokens are scoped to the server that issued them — never send a JWT
  // obtained from one server to a different one
  if (next !== getServerUrl()) clearToken();
  if (next) localStorage.setItem(SERVER_KEY, next);
  else localStorage.removeItem(SERVER_KEY);
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${getServerUrl()}/api${path}`, { ...init, headers });
  if (!res.ok) throw new ApiError(res.status, `API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export function wsUrl(): string {
  const token = getToken();
  const q = token ? `?token=${encodeURIComponent(token)}` : '';
  const base = getServerUrl();
  if (base) return `${base.replace(/^http/i, 'ws')}/ws${q}`;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws${q}`;
}
