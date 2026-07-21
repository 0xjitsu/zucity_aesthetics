import { Stage } from './components/Stage';
import { Inspector } from './components/Inspector';
import { Toasts } from './components/Toasts';
import { useKeyboard } from './hooks/useKeyboard';

export default function App() {
  useKeyboard();

  return (
    <div className="flex h-full min-h-0 flex-col bg-ground lg:flex-row">
      <a
        href="#inspector"
        className="label sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-raise focus:px-3 focus:py-2"
      >
        Skip to controls
      </a>

      <main className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-baseline gap-3 border-b border-line px-4 py-3 sm:px-8">
          <h1 className="font-mono text-sm tracking-[0.28em] text-ink uppercase">MaskLab</h1>
          <p className="label hidden sm:block">One shape, many textures</p>
        </header>
        <Stage />
      </main>

      <Inspector />
      <Toasts />
    </div>
  );
}
