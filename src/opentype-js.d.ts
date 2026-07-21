/**
 * Ambient declarations for opentype.js v2.0.0.
 *
 * The package ships JavaScript only — no bundled declarations, and the
 * DefinitelyTyped package targets the 1.x API, so pulling it in would describe
 * a different library than the one installed. This is the slice of the real
 * v2 surface we actually touch, written against node_modules.
 *
 * This lives in its own .d.ts because `declare module` inside a file that has
 * its own imports is treated as module *augmentation*, not an ambient
 * declaration, and does not satisfy the import it is meant to describe.
 */

/**
 * opentype.js ships no type declarations, so this is the slice of its surface
 * we actually touch, written against the real v2.0.0 build in node_modules.
 * The ESM entry exports `parse` (a buffer parser); `load`/`loadSync` are the
 * legacy Node paths and are not used here.
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
  /** 0 is `.notdef`, the box a font draws for a character it does not have. */
  index: number;
  name?: string | null;
  advanceWidth?: number;
  getPath(
    x: number,
    y: number,
    fontSize: number,
    options: undefined,
    font: OtFont,
  ): OtPath;
}

interface OtNameRecord {
  [language: string]: string;
}

interface OtFont {
  unitsPerEm: number;
  glyphs: { length: number };
  names?: Record<string, Record<string, OtNameRecord>>;
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
 * The package ships JavaScript only, with no bundled or DefinitelyTyped
 * declarations, so the contract above is declared here rather than added as a
 * dependency. Both shapes are covered because the ESM build exports `parse`
 * directly while the UMD build the dep optimiser may pick puts it behind
 * `default`.
 */
declare module 'opentype.js' {
  export const parse: ((buffer: ArrayBuffer) => OtFont) | undefined;
  const fallback: { parse?: (buffer: ArrayBuffer) => OtFont } | undefined;
  export default fallback;
}

