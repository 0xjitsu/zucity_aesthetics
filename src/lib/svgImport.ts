import type { Region, Template } from '../types';

/**
 * Turns an arbitrary SVG file into a MaskLab Template: one fillable region per
 * primitive, in document order.
 *
 * Transform policy: an element's `transform` (and every ancestor `<g>`'s) is
 * baked into the emitted path data only when the accumulated matrix is an
 * axis-aligned scale plus a translate (b = c = 0, positive scales), because
 * that is the only family we can apply to arc parameters without guessing.
 * Anything with a rotation or a skew in the chain is emitted untransformed
 * rather than emitted wrong; the region is still selectable and fillable, it
 * just sits where the untransformed geometry sits.
 */

export class SvgImportError extends Error {
  reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = 'SvgImportError';
    this.reason = reason;
  }
}

/** [a, b, c, d, e, f] */
type Matrix = [number, number, number, number, number, number];

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface PathResult extends Box {
  d: string;
  /** Drawing commands, used only for the hint text. */
  commands: number;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const FILLABLE = new Set(['path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline']);

/** Not directly fillable: definitions, referenced content, and non-geometry. */
const IGNORED = new Set([
  'defs',
  'clippath',
  'mask',
  'use',
  'symbol',
  'pattern',
  'marker',
  'filter',
  'lineargradient',
  'radialgradient',
  'style',
  'title',
  'desc',
  'metadata',
  'script',
  'text',
  'textpath',
  'tspan',
  'image',
  'foreignobject',
]);

/** Alternating light/dark so neighbouring regions never read as one blob. */
const PALETTE = ['#e8e6e1', '#3d3b38', '#c2bdb4', '#6f6b64', '#a09a91', '#141416'];

/** ids that carry no meaning, so we fall back to "Region N". */
const JUNK_ID =
  /^(path|shape|layer|group|vector|rect|rectangle|circle|ellipse|polygon|polyline|line|svg|g|clip|mask|frame|union|subtract|object)[-_\s]*\d*$/i;

export function parseSvgToTemplate(svgText: string, name?: string): Template {
  const root = parseRoot(svgText);
  const regions: Region[] = [];
  const bounds: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  collect(root, IDENTITY, regions, bounds);

  if (regions.length === 0) {
    throw new SvgImportError('No fillable shapes found in this SVG');
  }

  return {
    id: 'custom',
    name: name?.trim() || 'Custom SVG',
    viewBox: readViewBox(root, bounds),
    regions,
  };
}

function parseRoot(svgText: string): Element {
  if (typeof svgText !== 'string' || !/<svg[\s>]/i.test(svgText)) {
    throw new SvgImportError('This file does not look like an SVG');
  }

  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const failure = doc.querySelector('parsererror');
  if (failure) {
    throw new SvgImportError(`This SVG could not be parsed: ${summarise(failure.textContent)}`);
  }

  const root = doc.documentElement;
  if (!root || localName(root) !== 'svg') {
    throw new SvgImportError('This file does not look like an SVG');
  }
  return root;
}

function summarise(text: string | null): string {
  const line = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!line) return 'the markup is malformed';
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

/* ------------------------------------------------------------------ walking */

function collect(parent: Element, matrix: Matrix | null, out: Region[], bounds: Box): void {
  for (const el of Array.from(parent.children)) {
    const tag = localName(el);
    if (IGNORED.has(tag)) continue;

    let here = matrix;
    const own = el.getAttribute('transform');
    if (own !== null) {
      const parsed = parseTransform(own);
      here = parsed === null || here === null ? null : multiply(here, parsed);
    }

    if (FILLABLE.has(tag)) {
      const built = toRegion(el, tag, here, out.length);
      if (built) {
        out.push(built.region);
        grow(bounds, built.box);
      }
    }

    if (el.children.length > 0) collect(el, here, out, bounds);
  }
}

function toRegion(
  el: Element,
  tag: string,
  matrix: Matrix | null,
  index: number,
): { region: Region; box: Box } | null {
  const raw = toPathData(el, tag);
  if (!raw) return null;

  // convertPath bails on arcs it cannot map under `matrix`; identity always works.
  const bakeable =
    matrix !== null && matrix[1] === 0 && matrix[2] === 0 && matrix[0] > 0 && matrix[3] > 0;
  const result = (bakeable ? convertPath(raw, matrix as Matrix) : null) ?? convertPath(raw, IDENTITY);
  if (!result) return null;

  return {
    region: {
      id: `r${index}`,
      name: regionName(el, index),
      hint: hintFor(el, tag, result),
      d: result.d,
      defaultFill: fillFor(el, index),
      z: index,
    },
    box: result,
  };
}

function regionName(el: Element, index: number): string {
  const id = (el.getAttribute('id') ?? '').trim();
  if (id && id.length <= 40 && !JUNK_ID.test(id) && !/^[0-9a-f]{8,}$/i.test(id)) {
    const words = id.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (words) return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return `Region ${index + 1}`;
}

function fillFor(el: Element, index: number): string {
  const candidates = [el.getAttribute('fill'), styleValue(el.getAttribute('style'), 'fill')];
  for (const value of candidates) {
    const colour = (value ?? '').trim();
    if (!colour) continue;
    const lower = colour.toLowerCase();
    if (lower === 'none' || lower === 'transparent' || lower === 'inherit') continue;
    if (lower === 'currentcolor' || lower.startsWith('url(')) continue;
    return colour;
  }
  return PALETTE[index % PALETTE.length];
}

function styleValue(style: string | null, property: string): string | null {
  if (!style) return null;
  for (const chunk of style.split(';')) {
    const colon = chunk.indexOf(':');
    if (colon < 0) continue;
    if (chunk.slice(0, colon).trim().toLowerCase() === property) {
      return chunk.slice(colon + 1).trim();
    }
  }
  return null;
}

function hintFor(el: Element, tag: string, result: PathResult): string {
  const w = fmt(result.maxX - result.minX);
  const h = fmt(result.maxY - result.minY);
  const at = `at ${fmt(result.minX)}, ${fmt(result.minY)}`;
  if (tag === 'polygon' || tag === 'polyline') {
    const points = numbers(el.getAttribute('points') ?? '').length >> 1;
    const closed = tag === 'polyline' ? ', closed' : '';
    return `<${tag}> ${points} points${closed}, ${w} x ${h} ${at}`;
  }
  if (tag === 'path') {
    return `<path> ${result.commands} commands, ${w} x ${h} ${at}`;
  }
  const rounded =
    tag === 'rect' && (el.getAttribute('rx') || el.getAttribute('ry')) ? 'rounded, ' : '';
  return `<${tag}> ${rounded}${w} x ${h} ${at}`;
}

/* -------------------------------------------------------------- primitives */

/** Every primitive is lowered to path data first, so one transform routine serves them all. */
function toPathData(el: Element, tag: string): string {
  switch (tag) {
    case 'path':
      return (el.getAttribute('d') ?? '').trim();
    case 'circle': {
      const r = num(el.getAttribute('r'));
      return r > 0 ? ellipsePath(num(el.getAttribute('cx')), num(el.getAttribute('cy')), r, r) : '';
    }
    case 'ellipse': {
      const rx = num(el.getAttribute('rx'));
      const ry = num(el.getAttribute('ry'));
      return rx > 0 && ry > 0
        ? ellipsePath(num(el.getAttribute('cx')), num(el.getAttribute('cy')), rx, ry)
        : '';
    }
    case 'rect':
      return rectPath(el);
    case 'polygon':
    case 'polyline':
      return polyPath(el.getAttribute('points') ?? '');
    default:
      return '';
  }
}

/** Two half-arcs, matching how the built-in templates draw their dots. */
function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return (
    `M${fmt(cx - rx)} ${fmt(cy)}` +
    `A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx + rx)} ${fmt(cy)}` +
    `A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx - rx)} ${fmt(cy)}Z`
  );
}

function rectPath(el: Element): string {
  const x = num(el.getAttribute('x'));
  const y = num(el.getAttribute('y'));
  const w = num(el.getAttribute('width'));
  const h = num(el.getAttribute('height'));
  if (!(w > 0) || !(h > 0)) return '';

  const rxAttr = el.getAttribute('rx');
  const ryAttr = el.getAttribute('ry');
  // Per spec each radius falls back to the other, then clamps to half the side.
  let rx = rxAttr !== null ? num(rxAttr) : ryAttr !== null ? num(ryAttr) : 0;
  let ry = ryAttr !== null ? num(ryAttr) : rx;
  rx = Math.min(Math.max(rx, 0), w / 2);
  ry = Math.min(Math.max(ry, 0), h / 2);

  if (rx <= 0 || ry <= 0) {
    return `M${fmt(x)} ${fmt(y)}H${fmt(x + w)}V${fmt(y + h)}H${fmt(x)}Z`;
  }
  const a = `A${fmt(rx)} ${fmt(ry)} 0 0 1 `;
  return (
    `M${fmt(x + rx)} ${fmt(y)}` +
    `H${fmt(x + w - rx)}${a}${fmt(x + w)} ${fmt(y + ry)}` +
    `V${fmt(y + h - ry)}${a}${fmt(x + w - rx)} ${fmt(y + h)}` +
    `H${fmt(x + rx)}${a}${fmt(x)} ${fmt(y + h - ry)}` +
    `V${fmt(y + ry)}${a}${fmt(x + rx)} ${fmt(y)}Z`
  );
}

/** `<polyline>` is closed as well, since an open stroke is not a fillable region. */
function polyPath(points: string): string {
  const n = numbers(points);
  if (n.length < 6) return '';
  let d = `M${fmt(n[0])} ${fmt(n[1])}`;
  for (let i = 2; i + 1 < n.length; i += 2) d += `L${fmt(n[i])} ${fmt(n[i + 1])}`;
  return `${d}Z`;
}

/* --------------------------------------------------------------- transform */

const TRANSFORM_FN = /([a-zA-Z]+)\s*\(([^)]*)\)/g;

/** Returns null for anything we cannot bake, which the caller treats as "leave it alone". */
function parseTransform(value: string): Matrix | null {
  if (!value.trim()) return IDENTITY;

  let m: Matrix = IDENTITY;
  let seen = false;
  for (const hit of value.matchAll(TRANSFORM_FN)) {
    seen = true;
    const args = numbers(hit[2]);
    switch (hit[1].toLowerCase()) {
      case 'translate':
        m = multiply(m, [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0]);
        break;
      case 'scale': {
        const sx = args[0] ?? 1;
        m = multiply(m, [sx, 0, 0, args.length > 1 ? args[1] : sx, 0, 0]);
        break;
      }
      case 'matrix':
        if (args.length !== 6) return null;
        m = multiply(m, [args[0], args[1], args[2], args[3], args[4], args[5]]);
        break;
      default:
        return null;
    }
  }
  return seen ? m : null;
}

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/* --------------------------------------------------------------- path data */

const ARG_COUNT: Record<string, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

interface Segment {
  cmd: string;
  relative: boolean;
  args: number[];
}

/**
 * Rewrites `d` into absolute commands with `m` applied, and reports the
 * bounding box on the way. Returns null when the data is empty or when an
 * elliptical arc cannot be mapped exactly (rotated arc under a non-uniform
 * scale) - the caller then retries with the identity matrix.
 */
function convertPath(d: string, m: Matrix): PathResult | null {
  const segments = scanPath(d);
  if (segments.length === 0) return null;

  const [a, , , dd, e, fy] = m;
  const uniform = Math.abs(a - dd) < 1e-9;
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const tx = (x: number) => a * x + e;
  const ty = (y: number) => dd * y + fy;
  const mark = (x: number, y: number) => {
    if (x < box.minX) box.minX = x;
    if (y < box.minY) box.minY = y;
    if (x > box.maxX) box.maxX = x;
    if (y > box.maxY) box.maxY = y;
  };
  const put = (x: number, y: number) => {
    mark(tx(x), ty(y));
    return `${fmt(tx(x))} ${fmt(ty(y))}`;
  };

  let out = '';
  let commands = 0;
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;

  for (const seg of segments) {
    const p = seg.args;
    const ox = seg.relative ? curX : 0;
    const oy = seg.relative ? curY : 0;
    commands += 1;

    switch (seg.cmd) {
      case 'M':
        curX = ox + p[0];
        curY = oy + p[1];
        startX = curX;
        startY = curY;
        out += `M${put(curX, curY)}`;
        break;
      case 'L':
        curX = ox + p[0];
        curY = oy + p[1];
        out += `L${put(curX, curY)}`;
        break;
      case 'H':
        curX = ox + p[0];
        out += `L${put(curX, curY)}`;
        break;
      case 'V':
        curY = oy + p[1];
        out += `L${put(curX, curY)}`;
        break;
      case 'C': {
        const head = `C${put(ox + p[0], oy + p[1])} ${put(ox + p[2], oy + p[3])} `;
        curX = ox + p[4];
        curY = oy + p[5];
        out += head + put(curX, curY);
        break;
      }
      case 'S': {
        const head = `S${put(ox + p[0], oy + p[1])} `;
        curX = ox + p[2];
        curY = oy + p[3];
        out += head + put(curX, curY);
        break;
      }
      case 'Q': {
        const head = `Q${put(ox + p[0], oy + p[1])} `;
        curX = ox + p[2];
        curY = oy + p[3];
        out += head + put(curX, curY);
        break;
      }
      case 'T':
        curX = ox + p[0];
        curY = oy + p[1];
        out += `T${put(curX, curY)}`;
        break;
      case 'A': {
        const rot = p[2];
        if (rot !== 0 && !uniform) return null;
        const rx = a * p[0];
        const ry = dd * p[1];
        curX = ox + p[5];
        curY = oy + p[6];
        // Radii bound the arc generously; exact extrema are not worth the maths here.
        mark(tx(curX) - rx, ty(curY) - ry);
        mark(tx(curX) + rx, ty(curY) + ry);
        out += `A${fmt(rx)} ${fmt(ry)} ${fmt(rot)} ${p[3]} ${p[4]} ${put(curX, curY)}`;
        break;
      }
      case 'Z':
        curX = startX;
        curY = startY;
        out += 'Z';
        break;
      default:
        break;
    }
  }

  if (!out || box.minX === Infinity) return null;
  // A region has to be closed to be fillable; a stray open subpath is harmless to close.
  if (!out.endsWith('Z')) out += 'Z';
  return { d: out, commands, ...box };
}

/**
 * Hand-rolled because arc flags are single characters that minifiers happily
 * glue to the next number ("a5 5 0 1 15-5"), which a plain number regex splits
 * in the wrong place.
 */
function scanPath(d: string): Segment[] {
  const segments: Segment[] = [];
  const n = d.length;
  let i = 0;
  let cmd = '';

  const skipSep = () => {
    while (
      i < n &&
      (d[i] === ',' || d[i] === ' ' || d[i] === '\t' || d[i] === '\n' || d[i] === '\r')
    ) {
      i++;
    }
  };
  const readNumber = (): number | null => {
    skipSep();
    const start = i;
    if (i < n && (d[i] === '+' || d[i] === '-')) i++;
    while (i < n && d[i] >= '0' && d[i] <= '9') i++;
    if (i < n && d[i] === '.') {
      i++;
      while (i < n && d[i] >= '0' && d[i] <= '9') i++;
    }
    if (i < n && (d[i] === 'e' || d[i] === 'E')) {
      const before = i;
      i++;
      if (i < n && (d[i] === '+' || d[i] === '-')) i++;
      if (i < n && d[i] >= '0' && d[i] <= '9') {
        while (i < n && d[i] >= '0' && d[i] <= '9') i++;
      } else {
        i = before;
      }
    }
    if (i === start) return null;
    const value = Number(d.slice(start, i));
    return Number.isFinite(value) ? value : null;
  };
  const readFlag = (): number | null => {
    skipSep();
    if (i < n && (d[i] === '0' || d[i] === '1')) return Number(d[i++]);
    return null;
  };

  while (i < n) {
    skipSep();
    if (i >= n) break;

    if (/[MLHVCSQTAZ]/i.test(d[i])) {
      cmd = d[i];
      i++;
    } else if (!cmd) {
      break; // leading garbage
    } else if (cmd === 'M' || cmd === 'm') {
      // Repeated moveto arguments are implicit linetos.
      cmd = cmd === 'M' ? 'L' : 'l';
    }

    const upper = cmd.toUpperCase();
    if (upper === 'Z') {
      segments.push({ cmd: 'Z', relative: false, args: [] });
      continue;
    }

    const relative = cmd !== upper;
    const args: number[] = [];
    let ok = true;
    for (let k = 0; k < ARG_COUNT[upper]; k++) {
      const value = upper === 'A' && (k === 3 || k === 4) ? readFlag() : readNumber();
      if (value === null) {
        ok = false;
        break;
      }
      args.push(value);
    }
    if (!ok) break;

    // V's single argument is a y, so pad it into the slot the writer expects.
    segments.push({ cmd: upper, relative, args: upper === 'V' ? [0, args[0]] : args });
  }

  return segments;
}

/* ----------------------------------------------------------------- viewBox */

function readViewBox(root: Element, bounds: Box): [number, number, number, number] {
  const declared = numbers(root.getAttribute('viewBox') ?? '');
  if (declared.length === 4 && declared[2] > 0 && declared[3] > 0) {
    return [declared[0], declared[1], declared[2], declared[3]];
  }

  const w = length(root.getAttribute('width'));
  const h = length(root.getAttribute('height'));
  if (w > 0 && h > 0) return [0, 0, w, h];

  // Last resort: the geometry's own (approximate) box, never zero-sized.
  const minX = Number.isFinite(bounds.minX) ? bounds.minX : 0;
  const minY = Number.isFinite(bounds.minY) ? bounds.minY : 0;
  const boxW = Number.isFinite(bounds.maxX) ? bounds.maxX - minX : 0;
  const boxH = Number.isFinite(bounds.maxY) ? bounds.maxY - minY : 0;
  return [minX, minY, boxW > 0 ? boxW : 1, boxH > 0 ? boxH : 1];
}

/** Percentages are meaningless without a viewport, so they are treated as absent. */
function length(value: string | null): number {
  if (!value || value.includes('%')) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/* ------------------------------------------------------------------- utils */

const NUMBER = /[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?/g;

function numbers(value: string): number[] {
  return (value.match(NUMBER) ?? []).map(Number).filter(Number.isFinite);
}

function num(value: string | null): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function fmt(n: number): string {
  const rounded = Math.round(n * 1e4) / 1e4;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function grow(box: Box, other: Box): void {
  box.minX = Math.min(box.minX, other.minX);
  box.minY = Math.min(box.minY, other.minY);
  box.maxX = Math.max(box.maxX, other.maxX);
  box.maxY = Math.max(box.maxY, other.maxY);
}

function localName(el: Element): string {
  return el.tagName.toLowerCase().replace(/^.*:/, '');
}
