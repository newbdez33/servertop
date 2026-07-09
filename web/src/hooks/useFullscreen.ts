import { useEffect, useState } from 'react';

// Older iPadOS Safari exposes the Fullscreen API only with a webkit prefix
interface FsDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
  webkitFullscreenEnabled?: boolean;
}
interface FsElement extends HTMLElement {
  webkitRequestFullscreen?: () => void;
}

const doc = document as FsDocument;

const fsElement = (): Element | null =>
  document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;

export const fullscreenSupported: boolean =
  document.fullscreenEnabled || Boolean(doc.webkitFullscreenEnabled);

export function useFullscreen(): { active: boolean; toggle: () => void } {
  const [active, setActive] = useState<boolean>(() => Boolean(fsElement()));

  useEffect(() => {
    const onChange = (): void => setActive(Boolean(fsElement()));
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const toggle = (): void => {
    if (fsElement()) {
      if (document.exitFullscreen) void document.exitFullscreen().catch(() => {});
      else doc.webkitExitFullscreen?.();
    } else {
      const el = document.documentElement as FsElement;
      if (el.requestFullscreen) void el.requestFullscreen().catch(() => {});
      else el.webkitRequestFullscreen?.();
    }
  };

  return { active, toggle };
}
