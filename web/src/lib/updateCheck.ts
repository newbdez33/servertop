/**
 * Auto-reload on new deploys: periodically re-fetch our own index.html and
 * compare the hashed bundle filename it references with the bundle that is
 * currently running. Works for both the same-origin (Docker) deployment and
 * the GitHub Pages-hosted frontend. No-op during `vite dev`.
 */

import { enterFullscreen, fullscreenElement } from '../hooks/useFullscreen';

const CHECK_INTERVAL_MS = 5 * 60_000;
const RELOADED_KEY = 'servertop.updateReloadedFor';
const FS_RESTORE_KEY = 'servertop.restoreFullscreen';
const BUNDLE_RE = /assets\/index-[\w-]+\.js/;

/**
 * A reload drops browser fullscreen and the Fullscreen API needs a user
 * gesture to re-enter — so after an auto-update reload, restore fullscreen
 * on the first touch/click/keypress. (PWA standalone mode is unaffected.)
 */
function restoreFullscreenAfterUpdate(): void {
  if (sessionStorage.getItem(FS_RESTORE_KEY) !== '1') return;
  sessionStorage.removeItem(FS_RESTORE_KEY);
  const once = (): void => {
    window.removeEventListener('pointerdown', once);
    window.removeEventListener('keydown', once);
    enterFullscreen();
  };
  window.addEventListener('pointerdown', once);
  window.addEventListener('keydown', once);
}

export function startUpdateCheck(): void {
  restoreFullscreenAfterUpdate();

  // The URL of the currently executing bundle, e.g. /servertop/assets/index-Abc123.js
  const current = new URL(import.meta.url).pathname;
  if (!BUNDLE_RE.test(current)) return; // dev server — hashed bundles don't exist

  let reloaded = false;

  const check = async (): Promise<void> => {
    if (reloaded || document.hidden) return;
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}index.html`, { cache: 'no-store' });
      if (!res.ok) return;
      const latest = (await res.text()).match(BUNDLE_RE)?.[0];
      if (!latest || current.endsWith(latest)) return;
      // Reload once per discovered version — never loop if caches disagree
      if (sessionStorage.getItem(RELOADED_KEY) === latest) return;
      sessionStorage.setItem(RELOADED_KEY, latest);
      if (fullscreenElement()) sessionStorage.setItem(FS_RESTORE_KEY, '1');
      reloaded = true;
      location.reload();
    } catch {
      /* offline / server restarting — try again next tick */
    }
  };

  setInterval(() => void check(), CHECK_INTERVAL_MS);
  // iPad wakes / tab switches: check immediately instead of waiting a tick
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void check();
  });
}
