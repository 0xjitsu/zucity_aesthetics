import { startTransition, useEffect, useState } from 'react';
import { Stage } from './components/Stage';
import { Ticker } from './components/Ticker';
import { Inspector, InspectorTabs } from './components/Inspector';
import type { Tab } from './components/Inspector';
import { Toasts } from './components/Toasts';
import { ThemeToggle } from './components/ThemeToggle';
import { useKeyboard } from './hooks/useKeyboard';
import { useStore } from './store';
import { loadStarterAssets, starterLook } from './lib/starterTextures';

/** ZuCity's official accounts, as linked from zucity.org's own hero. */
const SOCIALS = [
  {
    label: 'X',
    href: 'https://x.com/zucity_japan',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    label: 'Instagram',
    href: 'https://instagram.com/zucity_japan',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
      </svg>
    ),
  },
  {
    label: 'Substack',
    href: 'https://jpy2.substack.com',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M22.539 8.242H1.46V5.406h21.08v2.836zM1.46 10.812V24L12 18.11 22.54 24V10.812H1.46zM22.54 0H1.46v2.836h21.08V0z" />
      </svg>
    ),
  },
];

/** Module-level, so React StrictMode's double-run of effects cannot dress twice. */
let dressed = false;

/**
 * First-visit dressing: the default yin-yang arrives already wearing two of
 * the bundled ZuCity textures, shuffled per visit. Deliberately does NOT
 * record undo history — the dressed canvas IS the starting state, and undo
 * should never step back to a blank one.
 */
function useStarterLook() {
  useEffect(() => {
    if (dressed) return;
    dressed = true;

    // No liveness guard on purpose. Under StrictMode the first effect run
    // claims the module flag and is immediately cleaned up, so a cleanup-based
    // cancel would cancel the only run there is. The pristine check below is
    // the real gate; a late resolution against an edited session is a no-op.
    const { pair, rest } = loadStarterAssets();

    void pair.then((assets) => {
      if (assets.length === 0) return;
      const s = useStore.getState();

      // Only dress a pristine session. A restored JSON document, an early
      // upload, or any edit at all means the visitor's work wins.
      const pristine =
        s.past.length === 0 &&
        Object.keys(s.assets).length === 0 &&
        Object.values(s.composition.fills).every((f) => f.kind === 'color');
      assets.forEach((a) => s.addAsset(a));
      if (!pristine) return;

      const look = starterLook(assets);
      for (const [regionId, patch] of Object.entries(look)) {
        // updateFill, not assignAsset: nothing here may push undo history.
        if (patch) useStore.getState().updateFill(regionId, patch);
      }
    });

    // The other three starters are remix fodder, not boot-critical; they
    // stream in behind the first paint and simply join the deck.
    void rest.then((assets) => {
      assets.forEach((a) => useStore.getState().addAsset(a));
    });
  }, []);
}

export default function App() {
  useKeyboard();
  useStarterLook();

  const [tab, setTab] = useState<Tab>('shape');
  const [ready, setReady] = useState(false);

  /* The stage paints first; the inspector then renders in a transition, which
     React time-slices, instead of everything landing in one long boot task.
     Cancelling in cleanup is StrictMode-safe: the re-run schedules again. */
  useEffect(() => {
    const go = () => startTransition(() => setReady(true));
    const raf = requestAnimationFrame(go);
    // Background tabs never fire rAF; the timeout keeps the controls from
    // staying empty until the tab is shown.
    const timer = window.setTimeout(go, 120);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, []);

  /* Picking a region (on the canvas or by key) jumps the phone to its card.
     A store subscription, so selection never re-renders App. */
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if (s.selectedId && s.selectedId !== prev.selectedId) setTab('regions');
      }),
    [],
  );

  return (
    <div
      className="flex min-h-dvh flex-col bg-ground lg:fixed lg:inset-0 lg:min-h-0 lg:flex-row lg:overflow-hidden"
      style={{
        paddingTop: 'var(--safe-top)',
        paddingLeft: 'var(--safe-left)',
        paddingRight: 'var(--safe-right)',
      }}
    >
      <a
        href="#inspector"
        className="label sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-raise focus:px-3 focus:py-2"
      >
        Skip to controls
      </a>

      {/* Mobile: display-contents flattens header/ticker/stage into the page
          column, so the stage's position:sticky travels the whole scroll — a
          sticky element can never escape its parent, and main would otherwise
          end exactly where the stage ends. Desktop: a normal flex column.
          min-w-0 there so the ticker's intrinsic width cannot inflate it. */}
      <main className="contents lg:flex lg:min-h-0 lg:min-w-0 lg:flex-1 lg:flex-col">
        <header className="flex items-center gap-1.5 border-b border-line px-4 sm:gap-3 sm:px-8 sm:py-1.5">
          <h1 className="font-mono text-sm font-bold tracking-[0.3em] text-hot uppercase">
            MaskLab
          </h1>
          <p className="label hidden sm:block">one shape, many textures 一つの形、無数の質感</p>
          <nav aria-label="ZuCity" className="ml-auto flex items-center">
            {/* New tab, so leaving for ZuCity never throws away the canvas. */}
            <a
              href="https://zucity.org"
              target="_blank"
              rel="noopener noreferrer"
              className="navlink navlink-primary"
              aria-label="zucity.org, the project this app was made for (opens in a new tab)"
            >
              <span className="hidden sm:inline">zucity.org</span>
              <span className="sm:hidden">zucity</span>
              <span aria-hidden="true">↗</span>
            </a>
            {SOCIALS.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="navlink"
                aria-label={`ZuCity on ${s.label} (opens in a new tab)`}
              >
                {s.icon}
              </a>
            ))}
          </nav>
          {/* Outside the ZuCity nav: it is a setting, not a link. */}
          <ThemeToggle />
        </header>
        <Ticker />
        {/* Phones: stage and tabs stick together while the panel scrolls.
            Desktop: the wrapper dissolves and the stage fills the column. */}
        <div data-sticky-stage className="sticky top-0 z-20 bg-ground lg:contents">
          <Stage />
          <InspectorTabs tab={tab} onTab={setTab} />
        </div>
      </main>

      <Inspector tab={tab} ready={ready} />
      <Toasts />
    </div>
  );
}
