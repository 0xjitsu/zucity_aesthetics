import type { Asset, Fill, Template } from '../types';

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function viewBoxOf(template: Template): ViewBox {
  const [x, y, w, h] = template.viewBox;
  return { x, y, w, h };
}

export function centerOf(vb: ViewBox): [number, number] {
  return [vb.x + vb.w / 2, vb.y + vb.h / 2];
}

/**
 * The single source of truth for texture placement.
 *
 * Both the canvas renderer and the SVG exporter derive their transform chain
 * from this function. If it is ever duplicated by hand in one of them, the two
 * outputs will silently drift apart — which is exactly the bug this exists to
 * prevent.
 *
 * The resulting chain is, in order:
 *   translate(cx, cy) -> rotate(rotation) -> scale(flipX, flipY)
 *   -> draw image at (-dw/2, -dh/2) sized (dw, dh)
 */
export interface FillTransform {
  /** Scale factor that cover-fits the image into the viewBox, times fill.scale. */
  cover: number;
  /** Image centre, in viewBox units, after the user's offset. */
  cx: number;
  cy: number;
  /** Drawn size, in viewBox units. */
  dw: number;
  dh: number;
  /** Degrees. */
  rotation: number;
  flipX: number;
  flipY: number;
}

export function fillTransform(fill: Fill, asset: Asset, vb: ViewBox): FillTransform {
  const cover = Math.max(vb.w / asset.width, vb.h / asset.height) * fill.scale;
  const [ox, oy] = centerOf(vb);
  return {
    cover,
    cx: ox + fill.offsetX,
    cy: oy + fill.offsetY,
    dw: asset.width * cover,
    dh: asset.height * cover,
    rotation: fill.rotation,
    flipX: fill.flipX ? -1 : 1,
    flipY: fill.flipY ? -1 : 1,
  };
}

/** Radius of the ring stroke: the largest circle inscribed in the viewBox. */
export function ringRadius(vb: ViewBox, ringWidth: number): number {
  return Math.max(0, Math.min(vb.w, vb.h) / 2 - ringWidth / 2);
}

const DEG = Math.PI / 180;

/**
 * Map a point from canvas/CSS pixel space back into viewBox units, undoing the
 * global rotation. Used for hit-testing and for turning pointer deltas into
 * resolution-independent offsets.
 */
export function pointToViewBox(
  px: number,
  py: number,
  size: number,
  vb: ViewBox,
  globalRotation: number,
): [number, number] {
  const s = size / vb.w;
  let x = px / s + vb.x;
  let y = py / s + vb.y;
  if (globalRotation) {
    const [ox, oy] = centerOf(vb);
    const a = -globalRotation * DEG;
    const dx = x - ox;
    const dy = y - oy;
    x = ox + dx * Math.cos(a) - dy * Math.sin(a);
    y = oy + dx * Math.sin(a) + dy * Math.cos(a);
  }
  return [x, y];
}

/** Rotate a delta (no translation) from screen space into viewBox space. */
export function deltaToViewBox(
  dx: number,
  dy: number,
  size: number,
  vb: ViewBox,
  globalRotation: number,
): [number, number] {
  const s = size / vb.w;
  let x = dx / s;
  let y = dy / s;
  if (globalRotation) {
    const a = -globalRotation * DEG;
    const rx = x * Math.cos(a) - y * Math.sin(a);
    const ry = x * Math.sin(a) + y * Math.cos(a);
    x = rx;
    y = ry;
  }
  return [x, y];
}
