import { Stage } from './components/Stage';
import { Ticker } from './components/Ticker';
import { Inspector } from './components/Inspector';
import { Toasts } from './components/Toasts';
import { useKeyboard } from './hooks/useKeyboard';

export default function App() {
  useKeyboard();

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
        <header className="flex items-baseline gap-3 border-b border-line px-4 py-3 sm:px-8">
          <h1 className="font-mono text-sm font-bold tracking-[0.3em] text-hot uppercase">
            MaskLab
          </h1>
          <p className="label hidden sm:block">one shape, many textures 一つの形、無数の質感</p>
        </header>
        <Ticker />
        <Stage />
      </main>

      <Inspector />
      <Toasts />
    </div>
  );
}
