import { useState } from 'react';
import { api, ApiError, getServerUrl, setServerUrl, setToken } from './lib/api';

/**
 * Connect screen. `needsServer` is true when no same-origin backend answered
 * (separately hosted frontend, e.g. GitHub Pages) — it adds a Server URL field.
 */
export function Login({ needsServer, onSuccess }: { needsServer: boolean; onSuccess: () => void }) {
  const [server, setServer] = useState(getServerUrl());
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const showServer = needsServer || Boolean(getServerUrl());

  const submit = async (ev: React.FormEvent): Promise<void> => {
    ev.preventDefault();
    if (busy) return;
    if (showServer && !server.trim()) {
      setError('Enter the server URL.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (showServer) setServerUrl(server);
      const status = await api<{ required: boolean }>('/auth/status');
      if (status.required) {
        if (!value) {
          setError('This server requires an access token.');
          return;
        }
        const res = await api<{ token: string }>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ token: value }),
        });
        setToken(res.token);
      }
      onSuccess();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Invalid access token.'
          : err instanceof ApiError && err.status === 429
            ? 'Too many attempts — wait a minute and retry.'
            : showServer
              ? 'Could not reach the server. Check the URL (must be HTTPS when this page is) and that ALLOWED_ORIGIN is set on the server.'
              : 'Could not reach the server.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center p-4">
      {/* noValidate: bare hostnames are normalized to https:// in setServerUrl */}
      <form
        onSubmit={submit}
        noValidate
        className="flex w-80 flex-col gap-4 rounded-xl border border-line bg-surface p-6 [box-shadow:var(--shadow)]"
      >
        <div className="flex items-center gap-2.5">
          <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
            <rect x="1" y="1" width="28" height="28" rx="8" fill="var(--accent)" opacity="0.14" />
            <rect
              x="1"
              y="1"
              width="28"
              height="28"
              rx="8"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.4"
            />
            <polyline
              points="6,17 11,17 13,10 17,21 19,14 24,14"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div>
            <b className="text-[15px] font-semibold">ServerTop</b>
            <p className="m-0 text-[11.5px] text-ink-3">
              {showServer ? 'Connect to your server' : 'Enter the access token to continue'}
            </p>
          </div>
        </div>

        {showServer && (
          <input
            type="url"
            autoFocus
            value={server}
            onChange={ev => setServer(ev.target.value)}
            placeholder="Server URL (https://monitor.example.com)"
            className="rounded-lg border border-line bg-page px-3 py-2 text-[13px] text-ink placeholder:text-ink-3"
          />
        )}

        <input
          type="password"
          autoFocus={!showServer}
          value={value}
          onChange={ev => setValue(ev.target.value)}
          placeholder="Access token"
          className="rounded-lg border border-line bg-page px-3 py-2 text-[13px] text-ink placeholder:text-ink-3"
        />

        {error && <p className="m-0 text-[11.5px] text-crit">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="cursor-pointer rounded-lg bg-accent py-2 text-[13px] font-semibold text-white disabled:cursor-default disabled:opacity-50"
        >
          {busy ? 'Connecting…' : showServer ? 'Connect' : 'Sign in'}
        </button>

        {needsServer && (
          <p className="m-0 text-center text-[11.5px] text-ink-3">
            No server yet?{' '}
            <a href="?demo" className="text-accent hover:underline">
              Try the live demo
            </a>
          </p>
        )}
      </form>
    </div>
  );
}
