import type { FontAsset, Region, Template, TextSpec } from '../types';
import { TEXT_TEMPLATE_ID } from '../templates';

/**
 * Turns a run of typed text into a MaskLab Template: one fillable region per
 * glyph, line, or whole run, carrying real outline path data.
 *
 * The whole point is that nothing downstream has to know text exists. Glyph
 * outlines are lowered to `Region.d` exactly like every other template, so the
 * canvas renderer, hit-testing, the SVG/PNG exporters and undo all work on text
 * without a single change. There is no text region kind, no `fillText`, no
 * `<text>` element anywhere.
 *
 * Coordinate policy: opentype.js stores outlines y-up in font units, but
 * `Glyph.getPath()` emits SVG-space commands (y-down, baseline at the y it is
 * handed), so a glyph's ink sits at *negative* y relative to its baseline. We
 * lay out with the first baseline at y = 0 and let the tight ink bounding box
 * become the viewBox, which means the absolute origin never matters — only the
 * relative spacing does.
 */

export class TextTemplateError extends Error {
  reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = 'TextTemplateError';
    this.reason = reason;
  }
}

/* ----------------------------------------------------------- opentype.js v2 */

/**
 * opentype.js v2.0.0 ships JavaScript only — no bundled declarations, and no
 * `@types/opentype.js` here — so this is the slice of its surface we actually
 * touch, written against the real build in node_modules rather than from
 * memory. The ESM entry exports `parse` (a buffer parser); `load`/`loadSync`
 * are the legacy Node paths and are unused.
 */
interface OtBoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface OtPathDataOptions {
  decimalPlaces: number;
  /** Defaults to *true*, which would mirror every glyph about its own box. */
  flipY: boolean;
  /** Defaults to true, and its tolerance is 1 output unit — far too coarse here. */
  optimize: boolean;
}

interface OtPath {
  getBoundingBox(): OtBoundingBox;
  toPathData(options: OtPathDataOptions): string;
}

interface OtGlyph {
  /** 0 is `.notdef`, the empty box a font draws for a character it lacks. */
  index: number;
  name?: string | null;
  advanceWidth?: number;
  getPath(x: number, y: number, fontSize: number, options: undefined, font: OtFont): OtPath;
}

interface OtFont {
  unitsPerEm: number;
  glyphs: { length: number };
  names?: Record<string, Record<string, Record<string, string>>>;
  tables: {
    os2?: { sTypoAscender?: number; sTypoDescender?: number };
  };
  charToGlyph(char: string): OtGlyph;
  getKerningValue(left: OtGlyph, right: OtGlyph): number;
}

interface OpenTypeApi {
  parse(buffer: ArrayBuffer): OtFont;
}

/**
 * The untyped import is contained here, once, and widened to `unknown` on the
 * way out so no implicit `any` escapes into the rest of the module — the
 * namespace is narrowed to `OpenTypeApi` by an explicit check in `openType()`.
 * A `declare module` augmentation cannot do this job: TypeScript refuses to
 * augment a module that resolves to an untyped file.
 */
function importOpenType(): Promise<unknown> {
  return import('opentype.js');
}

/* ------------------------------------------------------------------- tuning */

/**
 * Enough to stay smooth at a 4096px export (the emitted units are ~1/100 em, so
 * three places is well under a tenth of a pixel) without bloating the SVG
 * export, which embeds this path data verbatim.
 */
const DECIMALS = 3;

/**
 * Text reads as one object, so every glyph starts on the same ink colour and the
 * user diverges from there.
 *
 * Light, not dark. A shape template can default to dark ink because its regions
 * contrast with each other; a run of text is one colour against the background,
 * and the app's background defaults to near-black — dark ink there is invisible
 * on arrival, which reads as "the feature is broken".
 */
const DEFAULT_INK = '#ecebe7';

/** Breathing room around the ink, as a fraction of the em. */
const MARGIN_EM = 0.08;

/** A viewBox side is never allowed to collapse to zero. */
const MIN_EXTENT = 1e-3;

/**
 * Every region is a separate clip + draw per frame, so a pasted essay would
 * stall the canvas. Refuse early with a reason rather than hanging.
 */
const MAX_GLYPHS = 500;

/** Fallback share of the em box above the baseline, used for vertical stacking. */
const FALLBACK_EM_ASCENT = 0.88;

/** Kana, kanji, CJK punctuation and fullwidth forms, for the "wrong font" hint. */
const CJK = /[　-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;

/* -------------------------------------------------------------------- fonts */

export const BUILTIN_FONTS: FontAsset[] = [
  {
    id: 'anton',
    name: 'Anton',
    source: 'builtin',
    // `base: './'`, so every asset URL stays relative to the deployed page.
    url: './fonts/Anton-Regular.ttf',
    coverage: 'Latin',
  },
  {
    id: 'archivo-black',
    name: 'Archivo Black',
    source: 'builtin',
    url: './fonts/ArchivoBlack-Regular.ttf',
    coverage: 'Latin',
  },
  {
    id: 'zen-kaku-gothic-new',
    name: 'Zen Kaku Gothic New Black',
    source: 'builtin',
    url: './fonts/ZenKakuGothicNew-Black.ttf',
    coverage: 'Latin + Japanese kana and kanji',
  },
];

export function defaultTextSpec(): TextSpec {
  return {
    text: 'ZUCITY',
    fontId: BUILTIN_FONTS[0].id,
    fontSize: 100,
    letterSpacing: 0,
    lineHeight: 1.05,
    direction: 'horizontal',
    align: 'center',
    split: 'glyph',
  };
}

export interface LoadedFont {
  id: string;
  name: string;
  /** Parsed outlines. Kept opaque to callers; only this module reads it. */
  font: OtFont;
  unitsPerEm: number;
  /** Share of the em box that sits above the baseline, for vertical stacking. */
  emAscent: number;
}

/**
 * opentype.js is ~250 kB minified and only matters once someone reaches for
 * text, so it is pulled in dynamically and code-split out of the initial bundle.
 */
let apiPromise: Promise<OpenTypeApi> | null = null;

function openType(): Promise<OpenTypeApi> {
  if (!apiPromise) {
    apiPromise = importOpenType()
      .then((mod) => {
        // Depending on whether the bundler picks the ESM or the UMD build, the
        // named export may sit on the namespace or behind `default`.
        const ns = mod as unknown as Partial<OpenTypeApi> & { default?: Partial<OpenTypeApi> };
        const parse = ns.parse ?? ns.default?.parse;
        if (typeof parse !== 'function') {
          throw new TextTemplateError('The font engine could not be loaded');
        }
        return { parse } as OpenTypeApi;
      })
      .catch((error: unknown) => {
        apiPromise = null; // A network blip should not poison every later attempt.
        throw error instanceof TextTemplateError
          ? error
          : new TextTemplateError('The font engine could not be loaded');
      });
  }
  return apiPromise;
}

/**
 * Cached by id, and the *promise* is cached rather than the result so two
 * concurrent requests for the 2.3 MB Japanese font share one fetch and one
 * parse. A failure evicts itself so the user can retry.
 */
const loaded = new Map<string, Promise<LoadedFont>>();

export function loadFont(font: FontAsset): Promise<LoadedFont> {
  const cached = loaded.get(font.id);
  if (cached) return cached;

  const pending = decode(font).catch((error: unknown) => {
    loaded.delete(font.id);
    throw error;
  });
  loaded.set(font.id, pending);
  return pending;
}

async function decode(asset: FontAsset): Promise<LoadedFont> {
  const bytes =
    asset.source === 'uploaded' || asset.dataUrl ? fromDataUrl(asset) : await fetchFont(asset);
  const font = await parseFont(bytes, asset.name);
  return toLoaded(asset.id, asset.name, font);
}

function toLoaded(id: string, name: string, font: OtFont): LoadedFont {
  return {
    id,
    name,
    font,
    unitsPerEm: font.unitsPerEm > 0 ? font.unitsPerEm : 1000,
    emAscent: emAscentRatio(font),
  };
}

async function fetchFont(asset: FontAsset): Promise<ArrayBuffer> {
  if (!asset.url) {
    throw new TextTemplateError(`The font "${asset.name}" has nowhere to load from`);
  }
  let response: Response;
  try {
    response = await fetch(asset.url);
  } catch {
    throw new TextTemplateError(`The font "${asset.name}" could not be downloaded`);
  }
  if (!response.ok) {
    throw new TextTemplateError(
      `The font "${asset.name}" could not be downloaded (${response.status})`,
    );
  }
  return response.arrayBuffer();
}

async function parseFont(bytes: ArrayBuffer, label: string): Promise<OtFont> {
  const api = await openType();
  let font: OtFont;
  try {
    font = api.parse(bytes);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : '';
    throw new TextTemplateError(
      detail
        ? `"${label}" could not be read as a font: ${summarise(detail)}`
        : `"${label}" could not be read as a font`,
    );
  }
  if (!font || !font.glyphs || font.glyphs.length === 0) {
    throw new TextTemplateError(`"${label}" contains no glyphs`);
  }
  return font;
}

/**
 * The share of the em box above the baseline. The typo metrics of a CJK face
 * span exactly one em (Zen Kaku Gothic New reports 880 / -120 on a 1000 em), so
 * normalising them gives the ideographic baseline that vertical stacking wants.
 * A display Latin face reports metrics taller than its em; normalising is still
 * the right shape, it just packs the column a little tighter.
 */
function emAscentRatio(font: OtFont): number {
  const ascender = font.tables?.os2?.sTypoAscender;
  const descender = font.tables?.os2?.sTypoDescender;
  if (typeof ascender === 'number' && typeof descender === 'number') {
    const span = ascender - descender;
    if (ascender > 0 && span > 0) return ascender / span;
  }
  return FALLBACK_EM_ASCENT;
}

/* ------------------------------------------------------------- font uploads */

const FONT_MIME: Record<string, string> = {
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
};

let uploadCount = 0;

/**
 * Validates an uploaded font and packages it as a self-contained `FontAsset`.
 * The bytes ride along as a base64 dataUrl so a JSON export stays portable —
 * reopening the document must not depend on the user still having the file.
 */
export async function fontFromFile(file: File): Promise<FontAsset> {
  const name = baseName(file.name);
  const extension = (file.name.split('.').pop() ?? '').toLowerCase();

  if (extension === 'woff2') {
    // opentype.js v2 reads the wOF2 signature and then refuses: it needs an
    // external Brotli decompressor we are not shipping.
    throw new TextTemplateError(
      'WOFF2 fonts are not supported — convert this font to TTF or OTF and try again',
    );
  }
  const mime = FONT_MIME[extension];
  if (!mime) {
    throw new TextTemplateError('Fonts must be a .ttf, .otf, or .woff file');
  }

  const bytes = await file.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new TextTemplateError(`"${name}" is empty`);
  }

  // Parse before accepting, so a broken file fails at the upload rather than
  // later, in the middle of a layout the user asked for.
  const font = await parseFont(bytes, name);

  uploadCount += 1;
  const id = `font-${Date.now().toString(36)}-${uploadCount}`;
  const label = familyName(font) ?? name;

  const asset: FontAsset = {
    id,
    name: label,
    source: 'uploaded',
    dataUrl: `data:${mime};base64,${toBase64(new Uint8Array(bytes))}`,
    coverage: `Uploaded, ${font.glyphs.length} glyphs`,
  };

  // We already paid for the parse; hand it to the cache so `loadFont` is free.
  loaded.set(id, Promise.resolve(toLoaded(id, label, font)));
  return asset;
}

/** Prefers the font's own full name over the file name, in any language. */
function familyName(font: OtFont): string | null {
  const names = font.names;
  if (!names) return null;
  for (const platform of Object.values(names)) {
    if (!platform) continue;
    for (const key of ['fullName', 'fontFamily'] as const) {
      const record = platform[key];
      if (!record) continue;
      const value = record.en ?? Object.values(record)[0];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return null;
}

function baseName(fileName: string): string {
  const withoutPath = fileName.split(/[\\/]/).pop() ?? fileName;
  return withoutPath.replace(/\.[^.]+$/, '').trim() || 'Uploaded font';
}

function fromDataUrl(asset: FontAsset): ArrayBuffer {
  const dataUrl = asset.dataUrl ?? '';
  const comma = dataUrl.indexOf(',');
  if (comma < 0 || !dataUrl.slice(0, comma).includes(';base64')) {
    throw new TextTemplateError(`The font "${asset.name}" is stored in an unreadable form`);
  }
  let binary: string;
  try {
    binary = atob(dataUrl.slice(comma + 1));
  } catch {
    throw new TextTemplateError(`The font "${asset.name}" is stored in an unreadable form`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Chunked, because a 2 MB font blows the argument limit in one spread. */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/* ------------------------------------------------------------------- layout */

interface Placed {
  /** The source character, used for the region name. */
  char: string;
  d: string;
  box: OtBoundingBox;
  /** Line for horizontal text, column for vertical. */
  run: number;
  /** Index among the *visible* glyphs of that run. */
  slot: number;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function buildTextTemplate(spec: TextSpec, font: LoadedFont): Template {
  const text = (spec.text ?? '').replace(/\r\n?/g, '\n');
  if (!text.trim()) {
    throw new TextTemplateError('Type something to shape it');
  }

  // Array.from, not split(''), so an astral character stays one glyph.
  const runs = text.split('\n').map((line) => Array.from(line));
  assertCovered(runs, font);

  const vertical = spec.direction === 'vertical';
  const fontSize = spec.fontSize > 0 ? spec.fontSize : 100;
  const lineHeight = spec.lineHeight > 0 ? spec.lineHeight : 1;
  const tracking = Number.isFinite(spec.letterSpacing) ? spec.letterSpacing : 0;

  const placed = vertical
    ? layoutVertical(runs, font, fontSize, lineHeight, tracking, spec.align)
    : layoutHorizontal(runs, font, fontSize, lineHeight, tracking, spec.align);

  if (placed.length === 0) {
    // Only reachable for text that is entirely blank-outlined (say, an
    // ideographic space), which trim() cannot see.
    throw new TextTemplateError('Type something to shape it');
  }
  if (placed.length > MAX_GLYPHS) {
    throw new TextTemplateError(
      `That is ${placed.length} glyphs — keep it under ${MAX_GLYPHS} so every region stays paintable`,
    );
  }

  return {
    id: TEXT_TEMPLATE_ID,
    name: truncate(text.replace(/\s+/g, ' ').trim(), 32) || 'Text',
    viewBox: viewBoxFor(placed, fontSize),
    regions: regionsFor(placed, runs, spec.split, vertical),
  };
}

/**
 * Every character the font cannot draw would come out as `.notdef` — the empty
 * box. Rendering a row of boxes and calling it success is the one failure the
 * user cannot diagnose, so name the characters and point at a font that has
 * them. Whitespace is exempt: it only ever advances the pen.
 */
function assertCovered(runs: string[][], font: LoadedFont): void {
  const missing: string[] = [];
  for (const run of runs) {
    for (const char of run) {
      if (/\s/.test(char) || missing.includes(char)) continue;
      const glyph = font.font.charToGlyph(char);
      if (glyph.index === 0 || glyph.name === '.notdef') missing.push(char);
    }
  }
  if (missing.length === 0) return;

  const shown = missing.slice(0, 6).join(' ');
  const rest = missing.length > 6 ? ` and ${missing.length - 6} more` : '';
  const advice = missing.some((char) => CJK.test(char))
    ? 'Switch to Zen Kaku Gothic New Black, which covers Japanese kana and kanji.'
    : 'Pick a font that covers those characters, or remove them.';
  throw new TextTemplateError(`${font.name} has no glyph for ${shown}${rest}. ${advice}`);
}

function layoutHorizontal(
  runs: string[][],
  font: LoadedFont,
  fontSize: number,
  lineHeight: number,
  tracking: number,
  align: TextSpec['align'],
): Placed[] {
  const scale = fontSize / font.unitsPerEm;

  // Measure every line first: alignment needs the widest one before placing any.
  const measured = runs.map((chars) => {
    const glyphs = chars.map((char) => font.font.charToGlyph(char));
    const pen: number[] = [];
    let x = 0;
    for (let i = 0; i < glyphs.length; i++) {
      pen.push(x);
      x += (glyphs[i].advanceWidth ?? 0) * scale;
      const next = glyphs[i + 1];
      if (next) x += kerning(font, glyphs[i], next) * scale + tracking;
    }
    return { chars, glyphs, pen, width: x };
  });

  const widest = measured.reduce((max, line) => Math.max(max, line.width), 0);
  const out: Placed[] = [];

  measured.forEach((line, run) => {
    const offsetX = alignOffset(align, widest, line.width);
    const baselineY = run * fontSize * lineHeight;
    let slot = 0;
    line.glyphs.forEach((glyph, i) => {
      const drawn = draw(glyph, offsetX + line.pen[i], baselineY, fontSize, font);
      if (!drawn) return; // whitespace: it advanced the pen, it is not a region
      out.push({ char: line.chars[i], run, slot, ...drawn });
      slot += 1;
    });
  });

  return out;
}

/**
 * The CJK setting. Glyphs stack downward inside a column and columns advance
 * leftwards, which is the reading order of vertical Japanese: the first column
 * sits on the right. Vertical advance comes from the em box rather than the
 * glyph's own width, so a narrow kana and a wide kanji occupy the same slot,
 * and each glyph is centred on its column axis. Kerning is a horizontal-only
 * concept and is skipped.
 */
function layoutVertical(
  runs: string[][],
  font: LoadedFont,
  fontSize: number,
  lineHeight: number,
  tracking: number,
  align: TextSpec['align'],
): Placed[] {
  const scale = fontSize / font.unitsPerEm;
  const step = fontSize + tracking;
  const lengths = runs.map((chars) => (chars.length > 0 ? chars.length * fontSize + (chars.length - 1) * tracking : 0));
  const longest = lengths.reduce((max, length) => Math.max(max, length), 0);

  const out: Placed[] = [];

  runs.forEach((chars, run) => {
    const axisX = -run * fontSize * lineHeight;
    const offsetY = alignOffset(align, longest, lengths[run]);
    let slot = 0;
    chars.forEach((char, i) => {
      const glyph = font.font.charToGlyph(char);
      const advance = (glyph.advanceWidth ?? 0) * scale;
      const baselineY = offsetY + i * step + fontSize * font.emAscent;
      const drawn = draw(glyph, axisX - advance / 2, baselineY, fontSize, font);
      if (!drawn) return;
      out.push({ char, run, slot, ...drawn });
      slot += 1;
    });
  });

  return out;
}

function alignOffset(align: TextSpec['align'], total: number, own: number): number {
  if (align === 'center') return (total - own) / 2;
  if (align === 'end') return total - own;
  return 0;
}

/**
 * Lowers one glyph to path data at its final position. Returns null for an
 * empty outline — a space advances the pen but must not become a region, or the
 * inspector fills up with phantom entries nobody can select.
 */
function draw(
  glyph: OtGlyph,
  x: number,
  y: number,
  fontSize: number,
  font: LoadedFont,
): { d: string; box: OtBoundingBox } | null {
  const path = glyph.getPath(x, y, fontSize, undefined, font.font);
  // flipY defaults to true and would mirror each glyph about its own box;
  // optimize defaults to true and drops detail within 1 output unit, which is
  // 1% of the em here rather than the sub-pixel it assumes.
  const d = path.toPathData({ decimalPlaces: DECIMALS, flipY: false, optimize: false });
  if (!d) return null;
  return { d, box: path.getBoundingBox() };
}

function kerning(font: LoadedFont, left: OtGlyph, right: OtGlyph): number {
  try {
    const value = font.font.getKerningValue(left, right);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0; // A font without usable kern/GPOS data simply tracks at zero.
  }
}

/* ------------------------------------------------------------------ regions */

function regionsFor(
  placed: Placed[],
  runs: string[][],
  split: TextSplit,
  vertical: boolean,
): Region[] {
  // Labels come from the source text, not from the placed glyphs, so the spaces
  // that were dropped as regions still show up in the name the inspector reads.
  const runCount = runs.length;

  if (split === 'all') {
    return [
      {
        id: 'all',
        name: truncate(runs.map((run) => run.join('')).join(' '), 24),
        hint: `The whole run, ${placed.length} ${plural(placed.length, 'character')}`,
        d: placed.map((p) => p.d).join(''),
        defaultFill: DEFAULT_INK,
        z: 0,
      },
    ];
  }

  if (split === 'line') {
    const unit = vertical ? 'Column' : 'Line';
    const groups = new Map<number, Placed[]>();
    for (const glyph of placed) {
      const group = groups.get(glyph.run);
      if (group) group.push(glyph);
      else groups.set(glyph.run, [glyph]);
    }
    // Only runs that produced ink; a blank line is not a region.
    const used = [...groups.keys()].sort((a, b) => a - b);
    return used.map((run, index) => {
      const group = groups.get(run) ?? [];
      return {
        id: `l${index}`,
        name: truncate((runs[run] ?? []).join(''), 24),
        hint:
          runCount > 1
            ? `${unit} ${run + 1} of ${runCount}, ${group.length} ${plural(group.length, 'character')}`
            : `${unit} of ${group.length} ${plural(group.length, 'character')}`,
        d: group.map((p) => p.d).join(''),
        defaultFill: DEFAULT_INK,
        z: index,
      };
    });
  }

  // 'glyph': the general case, one fillable region per character.
  const perRun = new Map<number, number>();
  for (const glyph of placed) perRun.set(glyph.run, (perRun.get(glyph.run) ?? 0) + 1);

  return placed.map((glyph, index) => ({
    id: `g${index}`,
    name: glyph.char,
    hint: glyphHint(glyph, perRun.get(glyph.run) ?? 1, runCount, vertical),
    d: glyph.d,
    defaultFill: DEFAULT_INK,
    z: index,
  }));
}

function glyphHint(glyph: Placed, runTotal: number, runCount: number, vertical: boolean): string {
  const where = `Character ${glyph.slot + 1} of ${runTotal}`;
  if (runCount <= 1) return where;
  return `${vertical ? 'Column' : 'Line'} ${glyph.run + 1}, ${where.toLowerCase()}`;
}

/* ------------------------------------------------------------------ viewBox */

/** The tight ink box plus a small margin, and never a zero-sized side. */
function viewBoxFor(placed: Placed[], fontSize: number): [number, number, number, number] {
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const glyph of placed) {
    if (glyph.box.x1 < box.minX) box.minX = glyph.box.x1;
    if (glyph.box.y1 < box.minY) box.minY = glyph.box.y1;
    if (glyph.box.x2 > box.maxX) box.maxX = glyph.box.x2;
    if (glyph.box.y2 > box.maxY) box.maxY = glyph.box.y2;
  }
  if (!Number.isFinite(box.minX) || !Number.isFinite(box.minY)) {
    throw new TextTemplateError('That text produced no drawable outlines');
  }

  const margin = fontSize * MARGIN_EM;
  const width = Math.max(box.maxX - box.minX, MIN_EXTENT) + margin * 2;
  const height = Math.max(box.maxY - box.minY, MIN_EXTENT) + margin * 2;
  return [round(box.minX - margin), round(box.minY - margin), round(width), round(height)];
}

/* -------------------------------------------------------------------- utils */

type TextSplit = TextSpec['split'];

function round(value: number): number {
  const rounded = Math.round(value * 10 ** DECIMALS) / 10 ** DECIMALS;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function truncate(value: string, max: number): string {
  const line = value.replace(/\s+/g, ' ').trim();
  if (!line) return 'Text';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

function summarise(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}
