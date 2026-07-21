import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { currentTemplate, useStore } from '../store';
import { sortedRegions } from '../templates';
import { deltaToViewBox, pointToViewBox, viewBoxOf } from '../lib/geometry';
import { useImages } from '../lib/imageCache';
import { renderComposition } from '../lib/render';
import { filesFromClipboard, filesFromDataTransfer, ingestFiles } from '../lib/ingest';
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
    const s = px / vb.w;
    ctx.save();
    ctx.scale(s, s);
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
      ctx.lineWidth = (isSelected ? 2 : 1) / s;
      ctx.strokeStyle = isSelected ? '#ff3b14' : 'rgba(236,235,231,0.5)';
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
  const gestureRef = useRef<{ id: number | null; last: [number, number]; timer: number | null }>({
    id: null,
    last: [0, 0],
    timer: null,
  });
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);

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

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const hit = regionAt(e.clientX, e.clientY);
    if (hit) useStore.getState().select(hit);
    const target = hit ?? selectedId;
    if (!target) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gestureRef.current.id = e.pointerId;
    gestureRef.current.last = [e.clientX, e.clientY];
    useStore.getState().pushHistory();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gestureRef.current;
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
      if (fill) {
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
    e.preventDefault();
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

  /* Touch: two fingers pinch the selected texture. One finger pans via pointer events. */
  const onTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length !== 2 || !selectedId) return;
    const fill = useStore.getState().composition.fills[selectedId];
    if (!fill) return;
    pinchRef.current = { dist: touchDistance(e.touches), scale: fill.scale };
    useStore.getState().pushHistory();
  };

  const onTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const pinch = pinchRef.current;
    if (!pinch || e.touches.length !== 2 || !selectedId) return;
    e.preventDefault();
    const next = pinch.scale * (touchDistance(e.touches) / pinch.dist);
    useStore.getState().updateFill(selectedId, { scale: clamp(next, 0.05, 20) });
  };

  const onTouchEnd = () => {
    pinchRef.current = null;
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
      className="flex min-h-0 flex-1 flex-col"
      aria-label="Composition stage"
      onDragOver={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
    >
      <div
        ref={wrapRef}
        className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-8"
      >
        <div
          className="checkerboard relative"
          style={{ width: size || undefined, height: size || undefined }}
        >
          <canvas
            ref={canvasRef}
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
          {dropping && (
            <div className="pointer-events-none absolute inset-0 border-2 border-accent bg-accent/10" />
          )}
        </div>
      </div>
      <p className="label px-4 pb-4 text-center sm:px-8">
        Click a region to select · drag to pan · scroll to zoom · shift-scroll to spin
      </p>
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
