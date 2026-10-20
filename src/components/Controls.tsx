import { useId } from 'react';
import { currentTemplate, useStore } from '../store';

/* --------------------------------------------------------------------------
   Shared control primitives. RegionCard imports these too, so a slider looks
   and behaves identically whether it drives a fill or the whole composition.
   -------------------------------------------------------------------------- */

/**
 * A range input fires onChange on every pixel of a drag. If each of those
 * recorded an undo step, one zoom drag would push ~100 snapshots and flush the
 * 30-step history, destroying every real edit behind it. So the primitives
 * below snapshot ONCE when the gesture starts and hand callers a non-recording
 * setter — the same contract the canvas gestures use.
 */
function useGestureStart() {
  const pushHistory = useStore((s) => s.pushHistory);
  return {
    onPointerDown: () => pushHistory(),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (!e.repeat && e.key.startsWith('Arrow')) pushHistory();
    },
  };
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  /** Must NOT record history; the row does that once per gesture. */
  onChange: (v: number) => void;
}

export function SliderRow({ label, value, min, max, step, format, onChange }: SliderRowProps) {
  const id = useId();
  const gesture = useGestureStart();
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="label">
          {label}
        </label>
        <span className="num">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        {...gesture}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

interface ColorRowProps {
  label: string;
  value: string;
  /** Must NOT record history; the row does that once per gesture. */
  onChange: (v: string) => void;
}

export function ColorRow({ label, value, onChange }: ColorRowProps) {
  const id = useId();
  const gesture = useGestureStart();
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <span className="num uppercase">{value}</span>
        <input
          id={id}
          type="color"
          className="h-11 w-11 shrink-0"
          value={value}
          {...gesture}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}

export function ToggleRow({ label, checked, onChange, hint }: ToggleRowProps) {
  const id = useId();
  return (
    <div className="py-1">
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3">
        <input
          id={id}
          type="checkbox"
          className="accent-accent h-4 w-4 shrink-0"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="font-mono text-[10px] tracking-[0.14em] text-muted uppercase">
          {label}
        </span>
      </label>
      {hint ? <p className="num pl-7 leading-snug">{hint}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function Controls() {
  const background = useStore((s) => s.composition.background);
  const transparentBackground = useStore((s) => s.composition.transparentBackground);
  const globalRotation = useStore((s) => s.composition.globalRotation);
  const grain = useStore((s) => s.composition.grain);
  const ringWidth = useStore((s) => s.composition.ringWidth);
  const ringColor = useStore((s) => s.composition.ringColor);
  const exportSize = useStore((s) => s.composition.exportSize);
  const setComposition = useStore((s) => s.setComposition);
  const pushHistory = useStore((s) => s.pushHistory);
  const viewBox = useStore((s) => currentTemplate(s).viewBox);
  const sizeId = useId();

  const vw = viewBox[2];
  const ringMax = Math.max(vw * 0.12, 0.001);

  return (
    <div className="flex flex-col gap-1">
      <ColorRow
        label="Background"
        value={background}
        onChange={(background) => setComposition({ background }, false)}
      />

      <ToggleRow
        label="Transparent background on export"
        checked={transparentBackground}
        onChange={(transparentBackground) => setComposition({ transparentBackground })}
        hint={
          transparentBackground
            ? 'The plate is dropped; only the shape is written out.'
            : 'The background plate is written into the file.'
        }
      />

      <div className="my-3 border-t border-line-soft" />

      <SliderRow
        label="Global rotation"
        value={globalRotation}
        min={0}
        max={360}
        step={1}
        format={(v) => `${Math.round(v)}°`}
        onChange={(globalRotation) => setComposition({ globalRotation }, false)}
      />

      <SliderRow
        label="Grain"
        value={grain}
        min={0}
        max={100}
        step={1}
        format={(v) => (v === 0 ? 'Off' : `${Math.round(v)}%`)}
        onChange={(grain) => setComposition({ grain }, false)}
      />

      <div className="my-3 border-t border-line-soft" />

      <SliderRow
        label="Ring width"
        value={ringWidth}
        min={0}
        max={ringMax}
        step={ringMax / 240}
        format={(v) => (v === 0 ? 'Off' : `${v.toFixed(3)} u`)}
        onChange={(ringWidth) => setComposition({ ringWidth }, false)}
      />

      {ringWidth === 0 ? (
        <p className="num leading-snug">
          The ring is off. Raise the width to draw an outline around the shape.
        </p>
      ) : (
        <ColorRow
          label="Ring colour"
          value={ringColor}
          onChange={(ringColor) => setComposition({ ringColor }, false)}
        />
      )}

      <div className="my-3 border-t border-line-soft" />

      <div className="py-2">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={sizeId} className="label">
            Export size
          </label>
          <span className="num">{`${exportSize} px`}</span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <input
            type="range"
            className="min-w-0 flex-1"
            aria-label="Export size in pixels"
            min={600}
            max={4096}
            step={2}
            value={exportSize}
            onPointerDown={() => pushHistory()}
            onKeyDown={(e) => {
              if (!e.repeat && e.key.startsWith('Arrow')) pushHistory();
            }}
            onChange={(e) => setComposition({ exportSize: Number(e.target.value) }, false)}
          />
          <input
            id={sizeId}
            type="number"
            className="min-h-11 w-24 shrink-0 text-right"
            min={600}
            max={4096}
            step={1}
            value={exportSize}
            onFocus={() => pushHistory()}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              setComposition({ exportSize: Math.min(4096, Math.max(600, Math.round(n))) }, false);
            }}
          />
        </div>
      </div>
    </div>
  );
}
