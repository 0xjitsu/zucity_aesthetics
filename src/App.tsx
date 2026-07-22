import { useEffect } from 'react';
import { Stage } from './components/Stage';
import { Ticker } from './components/Ticker';
import { Inspector } from './components/Inspector';
import { Toasts } from './components/Toasts';
import { useKeyboard } from './hooks/useKeyboard';
import { useStore } from './store';
import { loadStarterAssets, starterLook } from './lib/starterTextures';

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
    void loadStarterAssets().then((assets) => {
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
  }, []);
}

export default function App() {
  useKeyboard();
  useStarterLook();

  return (
    <div className="flex min-h-dvh flex-col bg-ground lg:fixed lg:inset-0 lg:min-h-0 lg:flex-row lg:overflow-hidden">
      <a
        href="#inspector"
        className="label sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-raise focus:px-3 focus:py-2"
      >
        Skip to controls
      </a>

      {/* min-w-0: the ticker's intrinsic width must never inflate the column. */}
      <main className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
        <header className="flex items-center gap-3 border-b border-line px-4 py-1.5 sm:px-8">
          <h1 className="font-mono text-sm font-bold tracking-[0.3em] text-hot uppercase">
            MaskLab
          </h1>
          <p className="label hidden sm:block">one shape, many textures 一つの形、無数の質感</p>
          <a
            href="https://zucity.org"
            className="btn ml-auto min-h-11 border-0 bg-transparent px-2 text-accent hover:text-ink"
            aria-label="Back to zucity.org, the project this app was made for"
          >
            zucity.org
            <span aria-hidden="true">↗</span>
          </a>
        </header>
        <Ticker />
        <Stage />
      </main>

      <Inspector />
      <Toasts />
    </div>
  );
}
