import { useEffect, useState } from 'react';

const THEME_KEY = 'servertop.theme';

export function useTheme(): { dark: boolean; toggle: () => void } {
  const [dark, setDark] = useState<boolean>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);

  const toggle = (): void => {
    setDark(d => {
      localStorage.setItem(THEME_KEY, d ? 'light' : 'dark');
      return !d;
    });
  };

  return { dark, toggle };
}
