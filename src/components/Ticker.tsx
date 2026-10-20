import { useEffect, useMemo, useRef, useState } from 'react';
import { currentTemplate, useStore } from '../store';
import { sortedRegions } from '../templates';

/**
 * The ZuCity event ticker, repurposed as ambient help: one drifting mono
 * strip, bilingual, +++ separators. It reads the live composition so the
 * lines are true, not decorative — region counts and template names come
 * from the store.
 *
 * Motion is pausable (WCAG 2.2.2): hover or keyboard focus pauses it, a tap
 * or click toggles it, and it stops while scrolled off-screen so a phone is
 * not compositing a wide layer nobody can see.
 */
export function Ticker() {
  const template = useStore(currentTemplate);
  const assetCount = useStore((s) => Object.keys(s.assets).length);
  const ref = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [offscreen, setOffscreen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setOffscreen(!entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const lines = useMemo(() => {
    const regions = sortedRegions(template).length;
    return [
      `${template.name.toLowerCase()} — ${regions} fillable region${regions === 1 ? '' : 's'}`,
      'drop an image on a region ドロップしてね',
      'type a word, texture every letter 文字にテクスチャ',
      assetCount > 0
        ? `${assetCount} texture${assetCount === 1 ? '' : 's'} loaded (^-^)b`
        : 'nothing leaves your browser 全部ローカル',
      window.matchMedia('(pointer: coarse)').matches
        ? 'pinch to zoom, twist to spin'
        : 'scroll to zoom, shift-scroll to spin',
      'made for zucity ズシティのために',
      '\\(^o^)/ make a flag, an album cover, a sticker',
    ];
  }, [template, assetCount]);

  // Two copies of the run make the CSS loop seamless.
  const run = lines.map((l, i) => (
    <span key={i} className="inline-flex items-center">
      <span className="px-4">{l}</span>
      <span aria-hidden="true" className="text-accent">
        +++
      </span>
    </span>
  ));

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Tips"
      tabIndex={0}
      data-paused={paused || undefined}
      data-offscreen={offscreen || undefined}
      onClick={() => setPaused((p) => !p)}
      className="ticker py-1.5 font-mono text-[11px] tracking-[0.08em] text-muted"
    >
      <div className="ticker-track">
        <span className="inline-flex items-center">{run}</span>
        <span className="inline-flex items-center" aria-hidden="true">
          {run}
        </span>
      </div>
    </div>
  );
}
