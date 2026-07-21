import type { Region, Template } from '../types';

/**
 * The 120-degree analogue of the yin-yang. Three spokes leave the centre for
 * the rim at -90, 30 and 150 degrees; each spoke is a half-circle standing on
 * the radius C->P, exactly like the two halves of the yin-yang S-curve. Those
 * three half-circles meet only at the centre and are tangent to the rim at
 * their spoke point, so lobe k = spoke k, the 120-degree rim arc, spoke k+1
 * back to the centre. Three lobes, no gaps, no overlaps.
 */
const CX = 6;
const CY = 6;
const R = 5;
/** Half-circle on the radius, so it is internally tangent to the rim. */
const SPOKE_R = R / 2;
const DOT_R = 0.9;

const LOBE_NAMES = ['Upper-right lobe', 'Lower lobe', 'Upper-left lobe'];
const DOT_NAMES = ['Top dot', 'Lower-right dot', 'Lower-left dot'];
/** Dot k lands inside lobe k+2, so reusing FILLS[k] for it always contrasts, the way the yin-yang eyes do. */
const FILLS = ['#141416', '#8a857d', '#e8e6e1'];

/**
 * Six decimals, not the usual three or four: a half-circle's chord is its
 * diameter, so a rounded endpoint shortens the chord and SVG answers by
 * trimming the sweep. The resulting drift grows as the square root of the
 * rounding error, which at three decimals is already visible as a lopsided
 * third lobe.
 */
function f(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

/** Rim point for spoke k. */
function spoke(k: number): [number, number] {
  const a = ((-90 + 120 * k) * Math.PI) / 180;
  return [CX + R * Math.cos(a), CY + R * Math.sin(a)];
}

/**
 * Centre -> spoke k (half-circle, sweep 0) -> rim arc to spoke k+1
 * (sweep 1, always the minor 120-degree arc) -> spoke k+1 back to the
 * centre (the same half-circle traversed backwards, so sweep 1).
 */
function lobePath(k: number): string {
  const [ax, ay] = spoke(k);
  const [bx, by] = spoke(k + 1);
  return (
    `M${f(CX)} ${f(CY)}` +
    `A${f(SPOKE_R)} ${f(SPOKE_R)} 0 0 0 ${f(ax)} ${f(ay)}` +
    `A${f(R)} ${f(R)} 0 0 1 ${f(bx)} ${f(by)}` +
    `A${f(SPOKE_R)} ${f(SPOKE_R)} 0 0 1 ${f(CX)} ${f(CY)}Z`
  );
}

/** The eye sits at the centre of spoke k's half-circle, so it clears every boundary by SPOKE_R. */
function dotPath(k: number): string {
  const [ax, ay] = spoke(k);
  const cx = (CX + ax) / 2;
  const cy = (CY + ay) / 2;
  return (
    `M${f(cx - DOT_R)} ${f(cy)}` +
    `A${f(DOT_R)} ${f(DOT_R)} 0 1 0 ${f(cx + DOT_R)} ${f(cy)}` +
    `A${f(DOT_R)} ${f(DOT_R)} 0 1 0 ${f(cx - DOT_R)} ${f(cy)}Z`
  );
}

function buildRegions(): Region[] {
  const lobes: Region[] = [0, 1, 2].map((k) => ({
    id: `lobe${k}`,
    name: LOBE_NAMES[k],
    hint: 'One third of the disc, wrapping the next lobe',
    d: lobePath(k),
    defaultFill: FILLS[k],
    z: k,
  }));
  const dots: Region[] = [0, 1, 2].map((k) => ({
    id: `dot${k}`,
    name: DOT_NAMES[k],
    hint: 'The small eye inside the lobe that wraps it',
    d: dotPath(k),
    defaultFill: FILLS[k],
    z: 3 + k,
  }));
  return [...lobes, ...dots];
}

export const triskelion: Template = {
  id: 'triskelion',
  name: 'Triskelion',
  viewBox: [0, 0, 12, 12],
  regions: buildRegions(),
};
