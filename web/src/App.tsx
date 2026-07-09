import { useEffect, useState } from 'react';
import { Dashboard } from './Dashboard';
import { useTheme } from './hooks/useTheme';
import { api, clearToken, getServerUrl, getToken } from './lib/api';
import { IS_DEMO } from './lib/demo';
import { Login } from './Login';

export default function App() {
  const theme = useTheme();
  const [authRequired, setAuthRequired] = useState<boolean | null>(null);
  const [probeFailed, setProbeFailed] = useState(false);
  const [hasToken, setHasToken] = useState<boolean>(() => Boolean(getToken()));
  const [bootKey, setBootKey] = useState(0);

  useEffect(() => {
    if (IS_DEMO) {
      setAuthRequired(false);
      return;
    }
    let cancelled = false;
    setAuthRequired(null);
    api<{ required: boolean }>('/auth/status')
      .then(r => {
        if (cancelled) return;
        setProbeFailed(false);
        setAuthRequired(r.required);
      })
      .catch(() => {
        if (cancelled) return;
        // No backend answered — separately hosted frontend or server down
        setProbeFailed(true);
        setAuthRequired(true);
      });
    return () => {
      cancelled = true;
    };
  }, [bootKey]);

  if (authRequired === null) {
    return (
      <div className="grid min-h-screen place-items-center text-[12px] text-ink-3">Loading…</div>
    );
  }

  if (!IS_DEMO && (probeFailed || (authRequired && !hasToken))) {
    return (
      <Login
        needsServer={probeFailed}
        onSuccess={() => {
          setHasToken(Boolean(getToken()));
          setBootKey(k => k + 1);
        }}
      />
    );
  }

  return (
    <Dashboard
      theme={theme}
      // A remote-server session must always be able to disconnect and change
      // servers, even when that server has auth disabled
      canLogout={authRequired || Boolean(getServerUrl())}
      onAuthFailed={() => {
        // A 401 proves auth is required now, even if /auth/status said
        // otherwise at mount (e.g. ACCESS_TOKEN was added and the server
        // restarted) — otherwise Login would be unreachable
        clearToken();
        setAuthRequired(true);
        setHasToken(false);
      }}
    />
  );
}
