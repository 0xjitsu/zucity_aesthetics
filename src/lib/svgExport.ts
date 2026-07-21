import type { Asset, BlendMode, Fill } from '../types';
import { sortedRegions } from '../templates';
import type { ViewBox } from './geometry';
import { centerOf, fillTransform, outputSquare, ringGeometry, viewBoxOf } from './geometry';
import type { ExportInput } from './pngExport';
import { exportEdge } from './pngExport';
import { downloadBlob } from './fileIo';

const GRAIN_FILTER_ID = 'masklab-grain';
const SHAPE_CLIP_ID = 'masklab-shape';
/** Noise texels across the canvas width in `paintGrain`; used to size feTurbulence. */
const GRAIN_TEXELS = 1024;

/* -------------------------------------------------------------------------- */
/* Serialisation helpers                                                       */
/* -------------------------------------------------------------------------- */

/** Trim float noise so the document stays readable and diffable. */
function num(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 1e4) / 1e4;
  return Object.is(r, -0) ? '0' : String(r);
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Region ids come from user-supplied SVGs, so they are not trusted as fragment ids. */
function clipId(regionId: string): string {
  return `clip-${regionId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

/**
 * Canvas composite operations and CSS blend modes share every name except the
 * default. Anything outside the CSS set (a canvas-only operator) degrades to
 * normal rather than producing an invalid style.
 */
const CANVAS_ONLY = /^(source|destination)-|^(lighter|copy|xor)$/;
function blendOf(blend: BlendMode): string {
  if (blend === 'source-over' || CANVAS_ONLY.test(blend)) return 'normal';
  return blend;
}

/* -------------------------------------------------------------------------- */
/* Document                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Build a self-contained SVG of the composition.
 *
 * Parity with the PNG is the whole point of this module. Every texture
 * transform is read from `fillTransform` — the same call the canvas renderer
 * makes — and emitted as the same ordered chain
 * (translate -> rotate -> scale -> draw centred), so the two outputs cannot
 * drift apart without geometry.ts changing underneath both of them.
 */
export function buildSvg(input: ExportInput): string {
  const { template, composition, assets } = input;
  const vb = viewBoxOf(template);
  const [cx, cy] = centerOf(vb);
  const edge = exportEdge(composition);
  const regions = sortedRegions(template);

  const defs: string[] = [];
  for (const region of regions) {
    defs.push(
      `<clipPath id="${esc(clipId(region.id))}" clipPathUnits="userSpaceOnUse"><path d="${esc(region.d)}"/></clipPath>`,
    );
  }
  if (composition.grain > 0) defs.push(grainFilter(vb));

  const body: string[] = [];
  for (const region of regions) {
    const fill = composition.fills[region.id];
    if (!fill) continue;
    const asset = fill.kind === 'image' && fill.assetId ? assets[fill.assetId] : undefined;
    body.push(regionGroup(region.id, fill, asset, vb));
  }

  if (composition.ringWidth > 0) {
    const ring = ringGeometry(template, composition.ringWidth);
    body.push(
      `<circle cx="${num(ring.cx)}" cy="${num(ring.cy)}" r="${num(ring.r)}"` +
        ` fill="none" stroke="${esc(composition.ringColor)}" stroke-width="${num(composition.ringWidth)}"/>`,
    );
  }

  // The canvas applies the global rotation about the viewBox centre before it
  // paints any region, and the ring rides along with it.
  const rotated = composition.globalRotation
    ? `<g transform="rotate(${num(composition.globalRotation)}, ${num(cx)}, ${num(cy)})">\n${indent(body)}\n</g>`
    : body.join('\n');

  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"` +
      ` width="${num(edge)}" height="${num(edge)}"` +
      ` viewBox="${num(vb.x)} ${num(vb.y)} ${num(vb.w)} ${num(vb.h)}">`,
  );
  lines.push(`  <title>${esc(template.name)}</title>`);
  lines.push(`  <defs>\n${indent(defs, '    ')}\n  </defs>`);
  if (!composition.transparentBackground) {
    // The output is square but the viewBox need not be (text templates are
    // tall). The plate spans what the image actually covers, not the artwork.
    lines.push(`  ${rect(outputSquare(vb), composition.background)}`);
  }
  lines.push(indent([rotated], '  '));
  if (composition.grain > 0) {
    // Same reasoning as the canvas: without the plate, an unclipped overlay
    // would tint the empty area that is supposed to be transparent.
    const clipToShape = composition.transparentBackground;
    if (clipToShape) {
      defs.push(
        `<clipPath id="${SHAPE_CLIP_ID}">` +
          regions.map((r) => `<path d="${esc(r.d)}"/>`).join('') +
          `</clipPath>`,
      );
    }
    const overlay = grainOverlay(vb, composition.grain);
    lines.push(
      indent(
        clipToShape
          ? [`<g clip-path="url(#${SHAPE_CLIP_ID})">`, ...overlay, '</g>']
          : overlay,
        '  ',
      ),
    );
  }
  lines.push('</svg>');

  return lines.join('\n') + '\n';
}

/** Serialise and hand the file to the browser's download machinery. */
export function exportSvg(input: ExportInput): void {
  const blob = new Blob([buildSvg(input)], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, `masklab-${input.composition.templateId}.svg`);
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

function rect(vb: ViewBox, fill: string): string {
  return `<rect x="${num(vb.x)}" y="${num(vb.y)}" width="${num(vb.w)}" height="${num(vb.h)}" fill="${esc(fill)}"/>`;
}

/**
 * One clipped, blended region. Image fills reuse `fillTransform` verbatim: the
 * cover maths lives in geometry.ts and is never restated here.
 */
function regionGroup(regionId: string, fill: Fill, asset: Asset | undefined, vb: ViewBox): string {
  const open =
    `<g clip-path="url(#${esc(clipId(regionId))})" opacity="${num(fill.opacity)}"` +
    ` style="mix-blend-mode: ${blendOf(fill.blend)}">`;

  if (!asset) {
    // Matches the canvas fallback: a flat plate across the whole viewBox.
    // Matches the canvas, which paints colour fills across the whole output
    // square; both are clipped to the region, so this only matters when a
    // region reaches past the viewBox.
    return `${open}\n  ${rect(outputSquare(vb), fill.color)}\n</g>`;
  }

  const t = fillTransform(fill, asset, vb);
  const href = esc(asset.dataUrl);
  const inner =
    `<g transform="translate(${num(t.cx)}, ${num(t.cy)}) rotate(${num(t.rotation)}) scale(${num(t.flipX)}, ${num(t.flipY)})">\n` +
    `    <image href="${href}" xlink:href="${href}"` +
    ` x="${num(-t.dw / 2)}" y="${num(-t.dh / 2)}" width="${num(t.dw)}" height="${num(t.dh)}"` +
    ` preserveAspectRatio="none"/>\n` +
    `  </g>`;

  return `${open}\n  ${inner}\n</g>`;
}

/**
 * The canvas grain is a seeded 256px noise tile; feTurbulence is a completely
 * different generator. Frequency is matched to the tile's texel density so the
 * grain reads at the same scale, but the individual pixels will not agree.
 */
function grainFilter(vb: ViewBox): string {
  const frequency = num(GRAIN_TEXELS / vb.w);
  return (
    `<filter id="${GRAIN_FILTER_ID}" x="0%" y="0%" width="100%" height="100%"` +
    ` filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">\n` +
    `  <feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="2" stitchTiles="stitch" result="noise"/>\n` +
    `  <feColorMatrix in="noise" type="saturate" values="0" result="grey"/>\n` +
    `  <feColorMatrix in="grey" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0 1"/>\n` +
    `</filter>`
  );
}

function grainOverlay(vb: ViewBox, grain: number): string[] {
  const square = outputSquare(vb);
  return [
    '<!-- Grain is the one element that is NOT pixel-identical to the PNG export:',
    '     the canvas uses a seeded noise tile, SVG uses feTurbulence. Same scale',
    '     and strength, different generator. -->',
    `<rect x="${num(square.x)}" y="${num(square.y)}" width="${num(square.w)}" height="${num(square.h)}"` +
      ` filter="url(#${GRAIN_FILTER_ID})" opacity="${num((grain / 100) * 0.55)}"` +
      ` style="mix-blend-mode: overlay"/>`,
  ];
}

function indent(lines: string[], pad = '  '): string {
  return lines
    .join('\n')
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n');
}
