import { useId, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import type { BlendMode, Fill, Region } from '../types';
import { BLEND_MODES } from '../types';
import { currentTemplate, useStore } from '../store';
import { filesFromDataTransfer, ingestFiles } from '../lib/ingest';
import { ColorRow, SliderRow } from './Controls';

interface RegionCardProps {
  region: Region;
  fill: Fill | undefined;
}

export function RegionCard({ region, fill }: RegionCardProps) {
  const selected = useStore((s) => s.selectedId === region.id);
  const asset = useStore((s) => (fill?.assetId ? s.assets[fill.assetId] : undefined));
  const viewBox = useStore((s) => currentTemplate(s).viewBox);

  const select = useStore((s) => s.select);
  const hover = useStore((s) => s.hover);
  const addAsset = useStore((s) => s.addAsset);
  const assignAsset = useStore((s) => s.assignAsset);
  const clearFill = useStore((s) => s.clearFill);
  const commitFill = useStore((s) => s.commitFill);
  const updateFill = useStore((s) => s.updateFill);
  const applyFillToAll = useStore((s) => s.applyFillToAll);
  const toast = useStore((s) => s.toast);

  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dropping, setDropping] = useState(false);
  const [busy, setBusy] = useState(false);
  const blendId = useId();

  const hasImage = fill?.kind === 'image';
  const missingAsset = hasImage && !asset;

  async function take(files: File[]) {
    if (files.length === 0) {
      toast('error', 'Nothing landed on ' + region.name, 'That drop carried no files.');
      return;
    }
    setBusy(true);
    try {
      const { assets, failures } = await ingestFiles(files);
      for (const f of failures) toast('error', `Could not read ${f.name}`, f.reason);
      for (const a of assets) addAsset(a);
      const first = assets[0];
      if (first) {
        assignAsset(region.id, first.id);
        if (first.animatedSource) {
          toast('info', `${first.name} is animated`, 'Only the first frame was used.');
        }
      } else if (failures.length === 0) {
        toast('error', 'No usable image', 'None of those files could be read as an image.');
      }
    } finally {
      setBusy(false);
    }
  }

  function onPicked(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length > 0) void take(files);
  }

  function onDragEnter(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    dragDepth.current += 1;
    setDropping(true);
  }

  function onDragOver(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  function onDragLeave(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropping(false);
  }

  function onDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDropping(false);
    void take(filesFromDataTransfer(e.dataTransfer));
  }

  const frame = dropping
    ? 'border-accent border-dashed bg-accent/5'
    : selected
      ? 'border-accent bg-raise'
      : 'border-line bg-panel';

  return (
    <article
      className={`border transition-colors ${frame}`}
      onMouseEnter={() => hover(region.id)}
      onMouseLeave={() => hover(null)}
      onFocus={() => hover(region.id)}
      onBlur={() => hover(null)}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex items-stretch gap-2 p-2">
        <button
          type="button"
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={selected}
          onClick={() => select(selected ? null : region.id)}
        >
          <Swatch fill={fill} src={asset?.dataUrl} />
          <span className="min-w-0 flex-1">
            <span
              className={`block truncate text-[13px] leading-tight ${
                selected ? 'text-ink' : 'text-muted'
              }`}
            >
              {region.name}
            </span>
            <span className="num mt-0.5 block truncate">
              {region.hint ?? 'No hint for this region.'}
            </span>
          </span>
        </button>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple={false}
          className="sr-only"
          tabIndex={-1}
          onChange={onPicked}
        />

        <button
          type="button"
          className="btn min-w-11"
          aria-label={`Choose an image for ${region.name}`}
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <ImageGlyph />
        </button>

        <button
          type="button"
          className="btn min-w-11"
          aria-label={`Clear the image on ${region.name}`}
          disabled={!hasImage || busy}
          onClick={() => clearFill(region.id)}
        >
          <CrossGlyph />
        </button>
      </div>

      <p className="num px-3 pb-2 leading-snug">
        {busy
          ? 'Reading that file…'
          : dropping
            ? 'Drop to fill this region.'
            : !fill
              ? 'No fill data for this region yet.'
              : missingAsset
                ? 'Image missing — the asset it points to is not in this document.'
                : hasImage && asset
                  ? asset.name
                  : 'Flat colour.'}
      </p>

      {selected ? (
        fill ? (
          <div className="border-t border-line-soft px-3 pt-1 pb-4">
            <ColorRow
              label="Colour"
              value={fill.color}
              onChange={(color) => updateFill(region.id, { color })}
            />

            <SliderRow
              label="Zoom"
              value={fill.scale}
              min={0.1}
              max={4}
              step={0.01}
              format={(v) => `${v.toFixed(2)}×`}
              onChange={(scale) => updateFill(region.id, { scale })}
            />

            <SliderRow
              label="Spin"
              value={fill.rotation}
              min={0}
              max={360}
              step={1}
              format={(v) => `${Math.round(v)}°`}
              onChange={(rotation) => updateFill(region.id, { rotation })}
            />

            <SliderRow
              label="X"
              value={fill.offsetX}
              min={-viewBox[2]}
              max={viewBox[2]}
              step={viewBox[2] / 400}
              format={(v) => `${v.toFixed(2)} u`}
              onChange={(offsetX) => updateFill(region.id, { offsetX })}
            />

            <SliderRow
              label="Y"
              value={fill.offsetY}
              min={-viewBox[3]}
              max={viewBox[3]}
              step={viewBox[3] / 400}
              format={(v) => `${v.toFixed(2)} u`}
              onChange={(offsetY) => updateFill(region.id, { offsetY })}
            />

            <div className="flex gap-2 py-2">
              <button
                type="button"
                className={`btn flex-1 ${fill.flipX ? 'btn-accent' : ''}`}
                aria-pressed={fill.flipX}
                onClick={() => commitFill(region.id, { flipX: !fill.flipX })}
              >
                Flip X
              </button>
              <button
                type="button"
                className={`btn flex-1 ${fill.flipY ? 'btn-accent' : ''}`}
                aria-pressed={fill.flipY}
                onClick={() => commitFill(region.id, { flipY: !fill.flipY })}
              >
                Flip Y
              </button>
            </div>

            <SliderRow
              label="Opacity"
              value={fill.opacity}
              min={0}
              max={1}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(opacity) => updateFill(region.id, { opacity })}
            />

            <div className="py-2">
              <label htmlFor={blendId} className="label">
                Blend
              </label>
              <select
                id={blendId}
                aria-label={`Blend mode for ${region.name}`}
                className="mt-2 min-h-11 w-full"
                value={fill.blend}
                onChange={(e) => commitFill(region.id, { blend: e.target.value as BlendMode })}
              >
                {BLEND_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </div>

            {/* The move that matters for text: six katakana sharing one
                photograph, instead of six identical trips through this panel. */}
            <div className="mt-2 border-t border-line-soft pt-4">
              <button
                type="button"
                className="btn w-full"
                aria-label={`Apply the fill on ${region.name} to every region`}
                onClick={() => applyFillToAll(region.id)}
              >
                <span className="truncate">Apply to every region</span>
              </button>
              <p className="num mt-2 leading-snug">
                Copies this texture and every setting above onto all the other regions.
              </p>
            </div>
          </div>
        ) : (
          <p className="num border-t border-line-soft px-3 py-4 leading-snug">
            This region has no fill recorded, so there is nothing to adjust. Pick an image or
            switch template to rebuild it.
          </p>
        )
      ) : null}
    </article>
  );
}

function Swatch({ fill, src }: { fill: Fill | undefined; src: string | undefined }) {
  if (!fill) {
    return (
      <span
        className="label flex h-11 w-11 shrink-0 items-center justify-center border border-line text-faint"
        aria-hidden="true"
      >
        ?
      </span>
    );
  }

  if (fill.kind === 'image') {
    return src ? (
      <span className="checkerboard h-11 w-11 shrink-0 overflow-hidden border border-line">
        <img src={src} alt="" className="h-full w-full object-cover" />
      </span>
    ) : (
      <span
        className="label flex h-11 w-11 shrink-0 items-center justify-center border border-accent text-accent"
        aria-hidden="true"
      >
        !
      </span>
    );
  }

  return (
    <span
      className="h-11 w-11 shrink-0 border border-line"
      style={{ background: fill.color }}
      aria-hidden="true"
    />
  );
}

function ImageGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      aria-hidden="true"
    >
      <rect x="1.5" y="2.5" width="13" height="11" />
      <path d="M1.5 10.5 5 7l3.5 3.5L11 8l3.5 3.5" />
      <circle cx="10.5" cy="5.5" r="1.2" />
    </svg>
  );
}

function CrossGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      aria-hidden="true"
    >
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}
