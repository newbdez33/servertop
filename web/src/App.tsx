import { useEffect, useState } from 'react';
import { Dashboard } from './Dashboard';
import { useTheme } from './hooks/useTheme';
import { Login } from './Login';
import { api, clearToken, getToken } from './lib/api';
import { IS_DEMO } from './lib/demo';

export default function App() {
  const theme = useTheme();
  const [authRequired, setAuthRequired] = useState<boolean | null>(null);
  const [hasToken, setHasToken] = useState<boolean>(() => Boolean(getToken()));

  useEffect(() => {
    if (IS_DEMO) {
      setAuthRequired(false);
      return;
    }
    api<{ required: boolean }>('/auth/status')
      .then(r => setAuthRequired(r.required))
      .catch(() => setAuthRequired(true));
  }, []);

  if (authRequired === null) {
    return (
      <div className="grid min-h-screen place-items-center text-[12px] text-ink-3">Loading…</div>
    );
  }

  if (authRequired && !hasToken) {
    return <Login onSuccess={() => setHasToken(true)} />;
  }

  return (
    <Dashboard
      theme={theme}
      canLogout={authRequired}
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
