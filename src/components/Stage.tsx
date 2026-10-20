import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { currentTemplate, useStore } from '../store';
import { sortedRegions } from '../templates';
import { deltaToViewBox, fitToSquare, pointToViewBox, viewBoxOf } from '../lib/geometry';
import { useImages } from '../lib/imageCache';
import { renderComposition } from '../lib/render';
import { filesFromClipboard, filesFromDataTransfer, ingestFiles } from '../lib/ingest';
import { Buddy } from './Buddy';
import type { RegionId } from '../types';

/** Identity-transform context used purely for hit-testing in viewBox units. */
let hitCtx: CanvasRenderingContext2D | null = null;
function getHitCtx(): CanvasRenderingContext2D {
  if (!hitCtx) hitCtx = document.createElement('canvas').getContext('2d')!;
  return hitCtx;
}

/** Wheel and drag are continuous; one history entry per gesture, not per event. */
const GESTURE_IDLE_MS = 450;

export function Stage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(0);
  const [dropping, setDropping] = useState(false);

  const composition = useStore((s) => s.composition);
  const assets = useStore((s) => s.assets);
  const selectedId = useStore((s) => s.selectedId);
  const hoveredId = useStore((s) => s.hoveredId);
  const template = useStore(currentTemplate);

  const images = useImages(assets);
  const vb = useMemo(() => viewBoxOf(template), [template]);
  const paths = useMemo(
    () => sortedRegions(template).map((r) => ({ region: r, path: new Path2D(r.d) })),
    [template],
  );

  /* ---------------------------------------------------------------- sizing */
  /* The stage box is square by CSS (aspect-square), so we only read it — never
     size it from JS. Measuring a box whose own height we also set would be a
     feedback loop, and on a narrow viewport it produced a non-square canvas. */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize(Math.max(0, Math.floor(Math.min(width, height))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* --------------------------------------------------------------- drawing */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.floor(size * dpr);
    if (canvas.width !== px) canvas.width = px;
    if (canvas.height !== px) canvas.height = px;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    renderComposition(ctx, { template, composition, assets, images, size: px });
    paintOutlines(ctx, px);
  });

  const paintOutlines = (ctx: CanvasRenderingContext2D, px: number) => {
    if (!hoveredId && !selectedId) return;
    const fit = fitToSquare(vb, px);
    ctx.save();
    ctx.translate(fit.dx, fit.dy);
    ctx.scale(fit.scale, fit.scale);
    ctx.translate(-vb.x, -vb.y);
    if (composition.globalRotation) {
      const cx = vb.x + vb.w / 2;
      const cy = vb.y + vb.h / 2;
      ctx.translate(cx, cy);
      ctx.rotate((composition.globalRotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }
    for (const { region, path } of paths) {
      const isSelected = region.id === selectedId;
      const isHovered = region.id === hoveredId;
      if (!isSelected && !isHovered) continue;
      ctx.lineWidth = (isSelected ? 2 : 1) / fit.scale;
      ctx.strokeStyle = isSelected ? '#a78bfa' : 'rgba(229,229,229,0.5)';
      ctx.stroke(path);
    }
    ctx.restore();
  };

  /* ---------------------------------------------------------- hit-testing */
  const regionAt = useCallback(
    (clientX: number, clientY: number): RegionId | null => {
      const canvas = canvasRef.current;
      if (!canvas || size <= 0) return null;
      const rect = canvas.getBoundingClientRect();
      const [x, y] = pointToViewBox(
        clientX - rect.left,
        clientY - rect.top,
        size,
        vb,
        composition.globalRotation,
      );
      const ctx = getHitCtx();
      // Topmost region wins, so walk paint order backwards.
      for (let i = paths.length - 1; i >= 0; i--) {
        if (ctx.isPointInPath(paths[i].path, x, y)) return paths[i].region.id;
      }
      return null;
    },
    [paths, size, vb, composition.globalRotation],
  );

  /* ------------------------------------------------------------- gestures */
  /* `pending` = the gesture has not changed anything yet, so it has not
     recorded history. A click that only selects must not cost an undo step. */
  const gestureRef = useRef<{
    id: number | null;
    last: [number, number];
    timer: number | null;
    pending: boolean;
  }>({
    id: null,
    last: [0, 0],
    timer: null,
    pending: false,
  });
  const pinchRef = useRef<{
    dist: number;
    scale: number;
    angle: number;
    rotation: number;
  } | null>(null);

  const beginGesture = () => {
    const g = gestureRef.current;
    if (g.timer !== null) {
      window.clearTimeout(g.timer);
    } else {
      useStore.getState().pushHistory();
    }
    g.timer = window.setTimeout(() => {
      g.timer = null;
    }, GESTURE_IDLE_MS);
  };

  const recordOnce = () => {
    const g = gestureRef.current;
    if (!g.pending) return;
    g.pending = false;
    useStore.getState().pushHistory();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // A second finger joins the gesture already running; it is not a new tap.
    if (gestureRef.current.id !== null || pinchRef.current) return;
    const hit = regionAt(e.clientX, e.clientY);
    if (hit) useStore.getState().select(hit);
    const target = hit ?? selectedId;
    if (!target) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gestureRef.current.id = e.pointerId;
    gestureRef.current.last = [e.clientX, e.clientY];
    gestureRef.current.pending = true;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gestureRef.current;
    if (pinchRef.current) {
      // Keep the anchor fresh so the finger left after a pinch pans without a jump.
      if (g.id === e.pointerId) g.last = [e.clientX, e.clientY];
      return;
    }
    if (g.id === e.pointerId && selectedId) {
      const [dx, dy] = deltaToViewBox(
        e.clientX - g.last[0],
        e.clientY - g.last[1],
        size,
        vb,
        composition.globalRotation,
      );
      g.last = [e.clientX, e.clientY];
      const fill = useStore.getState().composition.fills[selectedId];
      if (fill && (dx !== 0 || dy !== 0)) {
        recordOnce();
        useStore
          .getState()
          .updateFill(selectedId, { offsetX: fill.offsetX + dx, offsetY: fill.offsetY + dy });
      }
      return;
    }
    const hit = regionAt(e.clientX, e.clientY);
    if (hit !== hoveredId) useStore.getState().hover(hit);
  };

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (gestureRef.current.id === e.pointerId) gestureRef.current.id = null;
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!selectedId) return;
    beginGesture();
    const fill = useStore.getState().composition.fills[selectedId];
    if (!fill) return;
    if (e.shiftKey) {
      useStore.getState().updateFill(selectedId, { rotation: fill.rotation + e.deltaY * 0.25 });
    } else {
      const next = fill.scale * Math.exp(-e.deltaY * 0.0015);
      useStore.getState().updateFill(selectedId, { scale: clamp(next, 0.05, 20) });
    }
  };

  /* Touch: two fingers pinch to zoom AND twist to spin — one gesture, both
     axes, the native-app expectation. One finger pans via pointer events. */
  const onTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length !== 2 || !selectedId) return;
    const fill = useStore.getState().composition.fills[selectedId];
    if (!fill) return;
    pinchRef.current = {
      dist: touchDistance(e.touches),
      scale: fill.scale,
      angle: touchAngle(e.touches),
      rotation: fill.rotation,
    };
    // Inside a pointer gesture, share its single history entry.
    if (gestureRef.current.id === null) gestureRef.current.pending = true;
  };

  const onTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const pinch = pinchRef.current;
    if (!pinch || e.touches.length !== 2 || !selectedId) return;
    e.preventDefault();
    const nextScale = pinch.scale * (touchDistance(e.touches) / pinch.dist);
    // Shortest-path angle delta, so crossing the ±180° seam never snaps.
    let dAngle = touchAngle(e.touches) - pinch.angle;
    if (dAngle > 180) dAngle -= 360;
    if (dAngle < -180) dAngle += 360;
    recordOnce();
    useStore.getState().updateFill(selectedId, {
      scale: clamp(nextScale, 0.05, 20),
      rotation: pinch.rotation + dAngle,
    });
  };

  const onTouchEnd = () => {
    pinchRef.current = null;
  };

  /* Remix is the play loop: every tap deals the loaded textures into the
     regions afresh. Keyed remount replays the pop, so the button itself
     bounces with each deal. */
  const [remixCount, setRemixCount] = useState(0);
  const canRemix = useStore((s) => Object.keys(s.assets).length >= 1);
  const onRemix = () => {
    useStore.getState().randomize();
    setRemixCount((n) => n + 1);
  };

  /* Phones have no keyboard, drag-drop or paste, so undo/redo and upload
     live on the stage itself. */
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const onPickPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = ''; // so picking the same file again still fires change
    if (!files.length) return;
    const state = useStore.getState();
    const { assets: ingested, failures } = await ingestFiles(files, {
      rasterSize: state.composition.exportSize,
    });
    for (const f of failures) state.toast('error', f.name, f.reason);
    if (!ingested.length) return;
    for (const asset of ingested) {
      useStore.getState().addAsset(asset);
      if (asset.animatedSource) {
        state.toast('info', asset.name, 'GIF and WebP textures use the first frame only.');
      }
    }
    useStore.getState().randomize();
    const n = ingested.length;
    state.toast(
      'ok',
      'photos added \\(^o^)/',
      `${n} new texture${n === 1 ? '' : 's'} dealt in — tap remix for another deal`,
    );
  };

  /* ------------------------------------------------------ files onto stage */
  const acceptFiles = useCallback(
    async (files: File[], clientX?: number, clientY?: number) => {
      if (!files.length) return;
      const state = useStore.getState();
      const target =
        (clientX !== undefined && clientY !== undefined ? regionAt(clientX, clientY) : null) ??
        state.selectedId ??
        sortedRegions(currentTemplate(state))[0]?.id;
      if (!target) return;

      const { assets: ingested, failures } = await ingestFiles(files, {
        rasterSize: state.composition.exportSize,
      });
      for (const f of failures) state.toast('error', f.name, f.reason);
      ingested.forEach((asset, i) => {
        useStore.getState().addAsset(asset);
        if (i === 0) useStore.getState().assignAsset(target, asset.id);
        if (asset.animatedSource) {
          state.toast('info', asset.name, 'GIF and WebP textures use the first frame only.');
        }
      });
    },
    [regionAt],
  );

  const onDrop = (e: React.DragEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setDropping(false);
    void acceptFiles(filesFromDataTransfer(e.dataTransfer), e.clientX, e.clientY);
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = filesFromClipboard(e);
      if (files.length) void acceptFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [acceptFiles]);

  /* Wheel must be non-passive to preventDefault, which React's synthetic
     handler cannot guarantee — bind it directly. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stop = (e: Event) => {
      if (useStore.getState().selectedId) e.preventDefault();
    };
    canvas.addEventListener('wheel', stop, { passive: false });
    return () => canvas.removeEventListener('wheel', stop);
  }, []);

  return (
    <section
      className="sticky top-0 z-20 flex flex-col border-b border-line bg-ground lg:static lg:z-auto lg:min-h-0 lg:flex-1 lg:border-b-0"
      aria-label="Composition stage"
      onDragOver={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
    >
      <div
        className="dotpaper flex h-[44svh] w-full items-center justify-center p-3 sm:p-8 lg:h-auto lg:min-h-0 lg:flex-1"
      >
        <div
          ref={wrapRef}
          className="checkerboard relative aspect-square h-full max-h-full w-auto max-w-full"
        >
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`${template.name} composition, ${template.regions.length} region${template.regions.length === 1 ? '' : 's'}`}
            className="block h-full w-full touch-none"
            style={{ cursor: selectedId ? 'grab' : 'crosshair' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            onPointerLeave={() => useStore.getState().hover(null)}
            onWheel={onWheel}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
          />
          {dropping ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center border-2 border-dashed border-accent bg-accent/10">
              <span className="wobble bg-ground/80 px-4 py-2 font-mono text-xs tracking-[0.12em] text-accent uppercase">
                drop it here! ここにドロップ
              </span>
            </div>
          ) : null}
          <div className="absolute right-2 bottom-2 z-10 flex gap-1.5 sm:right-3 sm:bottom-3">
            <button
              type="button"
              onClick={() => useStore.getState().undo()}
              disabled={!canUndo}
              className="btn min-w-11"
              aria-label="Undo"
              title="Undo"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M5 2.5 2 5.5l3 3" />
                <path d="M2 5.5h7.5a4.5 4.5 0 0 1 0 9H7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => useStore.getState().redo()}
              disabled={!canRedo}
              className="btn min-w-11"
              aria-label="Redo"
              title="Redo"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="m11 2.5 3 3-3 3" />
                <path d="M14 5.5H6.5a4.5 4.5 0 0 0 0 9H9" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="btn min-w-11"
              aria-label="Add photos"
              title="Add photos"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M8 2v12M2 8h12" />
              </svg>
              <span className="hidden sm:inline">add photos</span>
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              aria-label="Add photos"
              onChange={(e) => void onPickPhotos(e)}
            />
            {canRemix ? (
              <button
                key={remixCount}
                type="button"
                onClick={onRemix}
                className="btn btn-accent pop min-w-11"
                aria-label="Remix: deal the loaded textures into the regions afresh"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M2 8a6 6 0 0 1 10.5-4M14 8a6 6 0 0 1-10.5 4" />
                  <path d="M12.5 1v3h3M3.5 15v-3h-3" />
                </svg>
                <span className="hidden sm:inline">remix</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <Buddy />
    </section>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function touchDistance(touches: React.TouchList) {
  const [a, b] = [touches[0], touches[1]];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function touchAngle(touches: React.TouchList) {
  const [a, b] = [touches[0], touches[1]];
  return (Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180) / Math.PI;
}
