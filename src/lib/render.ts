import type { Asset, Composition, Template } from '../types';
import { sortedRegions } from '../templates';
import { fillTransform, fitToSquare, outputSquare, ringGeometry, viewBoxOf } from './geometry';

const DEG = Math.PI / 180;

export interface RenderInput {
  template: Template;
  composition: Composition;
  assets: Record<string, Asset>;
  /** Decoded images keyed by asset id. Missing entries fall back to the flat colour. */
  images: Record<string, CanvasImageSource>;
  /** Square output edge, in px. */
  size: number;
  /** Export renders honour `transparentBackground`; the editor always paints it. */
  forExport?: boolean;
}

/**
 * Paints a composition into a 2D context sized `size` x `size`.
 *
 * Used by both the live editor and the PNG exporter, so what you see is
 * literally the same code path as what you download.
 */
export function renderComposition(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { template, composition, assets, images, size, forExport } = input;
  const vb = viewBoxOf(template);
  const fit = fitToSquare(vb, size);

  ctx.save();
  ctx.clearRect(0, 0, size, size);

  const paintBackground = !(forExport && composition.transparentBackground);
  if (paintBackground) {
    ctx.fillStyle = composition.background;
    ctx.fillRect(0, 0, size, size);
  }

  ctx.translate(fit.dx, fit.dy);
  ctx.scale(fit.scale, fit.scale);
  ctx.translate(-vb.x, -vb.y);

  const cx = vb.x + vb.w / 2;
  const cy = vb.y + vb.h / 2;
  if (composition.globalRotation) {
    ctx.translate(cx, cy);
    ctx.rotate(composition.globalRotation * DEG);
    ctx.translate(-cx, -cy);
  }

  for (const region of sortedRegions(template)) {
    const fill = composition.fills[region.id];
    if (!fill) continue;

    ctx.save();
    ctx.clip(new Path2D(region.d));
    ctx.globalAlpha = fill.opacity;
    ctx.globalCompositeOperation = fill.blend;

    const asset = fill.kind === 'image' && fill.assetId ? assets[fill.assetId] : undefined;
    const image = asset ? images[asset.id] : undefined;

    if (asset && image) {
      const t = fillTransform(fill, asset, vb);
      ctx.translate(t.cx, t.cy);
      ctx.rotate(t.rotation * DEG);
      ctx.scale(t.flipX, t.flipY);
      ctx.drawImage(image, -t.dw / 2, -t.dh / 2, t.dw, t.dh);
    } else {
      const square = outputSquare(vb);
      ctx.fillStyle = fill.color;
      ctx.fillRect(square.x, square.y, square.w, square.h);
    }

    ctx.restore();
  }

  if (composition.ringWidth > 0) {
    ctx.save();
    ctx.strokeStyle = composition.ringColor;
    ctx.lineWidth = composition.ringWidth;
    const ring = ringGeometry(template, composition.ringWidth);
    ctx.beginPath();
    ctx.arc(ring.cx, ring.cy, ring.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();

  if (composition.grain > 0) {
    // On a transparent export the grain would otherwise haze the empty area,
    // because an 'overlay' blend still paints where there is nothing beneath.
    paintGrain(ctx, size, composition.grain, !paintBackground);
  }
}

/* -------------------------------------------------------------------------- */
/* Grain                                                                       */
/* -------------------------------------------------------------------------- */

const GRAIN_TILE = 256;
let grainTile: HTMLCanvasElement | null = null;

/** Deterministic noise, so re-renders and exports agree. */
function makeGrainTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = GRAIN_TILE;
  c.height = GRAIN_TILE;
  const g = c.getContext('2d')!;
  const img = g.createImageData(GRAIN_TILE, GRAIN_TILE);
  let seed = 0x9e3779b9;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const v = seed >>> 24;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Grain is scaled with the render size so a 640px preview and a 2000px export
 * show the same grain structure rather than the same pixel count.
 */
export function paintGrain(
  ctx: CanvasRenderingContext2D,
  size: number,
  grain: number,
  keepExistingAlphaOnly = false,
): void {
  if (!grainTile) grainTile = makeGrainTile();
  const pattern = ctx.createPattern(grainTile, 'repeat');
  if (!pattern) return;

  // Snapshot the alpha before the grain lands, so it can be masked back after.
  let mask: HTMLCanvasElement | null = null;
  if (keepExistingAlphaOnly) {
    mask = document.createElement('canvas');
    mask.width = size;
    mask.height = size;
    mask.getContext('2d')?.drawImage(ctx.canvas, 0, 0);
  }
  const scale = size / 1024;
  pattern.setTransform(new DOMMatrix([scale, 0, 0, scale, 0, 0]));
  ctx.save();
  ctx.globalAlpha = (grain / 100) * 0.55;
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  if (mask) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, 0, 0);
    ctx.restore();
  }
}
