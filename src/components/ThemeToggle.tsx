import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

/* Three states. 'system' is the absence of a stored choice and of
   data-theme, so the prefers-color-scheme block in index.css decides. The
   inline script in index.html's <head> applies a stored choice before first
   paint; this component only owns changes after that. */
type Mode = 'system' | 'light' | 'dark';

const KEY = 'masklab-theme';
const NEXT: Record<Mode, Mode> = { system: 'light', light: 'dark', dark: 'system' };

function readMode(): Mode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system'; // private mode can throw on any storage access
  }
}

/** Browser chrome follows the page ground, whichever palette is live. */
function syncThemeColor() {
  const ground = getComputedStyle(document.documentElement).getPropertyValue('--ground').trim();
  if (!ground) return;
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute('content', ground));
}

function applyMode(mode: Mode) {
  const root = document.documentElement;
  if (mode === 'system') delete root.dataset.theme;
  else root.dataset.theme = mode;
  try {
    if (mode === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {
    // Not persisted; the choice still holds for this page.
  }
  syncThemeColor();
}

const ICON: Record<Mode, ReactNode> = {
  system: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="1" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  dark: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
};

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>(readMode);

  useEffect(() => {
    syncThemeColor();
    // In system mode the OS can flip the palette under us.
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', syncThemeColor);
    return () => mq.removeEventListener('change', syncThemeColor);
  }, []);

  const next = NEXT[mode];
  return (
    <button
      type="button"
      className="navlink -mr-3 cursor-pointer sm:-mr-2"
      aria-label={`Theme: ${mode}. Switch to ${next}.`}
      title={`Theme: ${mode}`}
      onClick={() => {
        applyMode(next);
        setMode(next);
      }}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {ICON[mode]}
      </svg>
    </button>
  );
}
