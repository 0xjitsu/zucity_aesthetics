export type RegionId = string;

export interface Region {
  id: RegionId;
  name: string;
  hint?: string;
  /** SVG path data, authored in the template's viewBox units. */
  d: string;
  defaultFill: string;
  /** Paint order, ascending. */
  z: number;
}

export interface Template {
  id: string;
  name: string;
  /** [minX, minY, width, height] */
  viewBox: [number, number, number, number];
  regions: Region[];
}

export type BlendMode = GlobalCompositeOperation;

export interface Fill {
  regionId: RegionId;
  kind: 'color' | 'image';
  color: string;
  assetId?: string;
  /** 1 = cover-fit the viewBox. */
  scale: number;
  /** Offsets are in template viewBox units, so they are resolution-independent. */
  offsetX: number;
  offsetY: number;
  /** Degrees. */
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  /** 0..1 */
  opacity: number;
  blend: BlendMode;
}

export interface Asset {
  id: string;
  name: string;
  mime: string;
  /** base64, so SVG export is self-contained. */
  dataUrl: string;
  width: number;
  height: number;
  /** Set when the source was an animated GIF/WebP and only frame 1 was used. */
  animatedSource?: boolean;
  /** Set when the source was downscaled on ingest to protect memory. */
  downscaledFrom?: [number, number];
}

export interface Composition {
  templateId: string;
  fills: Record<RegionId, Fill>;
  background: string;
  /** Degrees, about the viewBox center. */
  globalRotation: number;
  /** 0..100 overlay noise. */
  grain: number;
  /** 0 = off. Stroke width in viewBox units. */
  ringWidth: number;
  ringColor: string;
  /** Export size in px. */
  exportSize: number;
  /** Export PNG/SVG without the background plate. */
  transparentBackground: boolean;
}

/** Serialised document: a composition plus every asset it references. */
export interface MaskLabFile {
  format: 'masklab';
  version: 1;
  composition: Composition;
  assets: Asset[];
  /** Present only for templates that are not in the built-in registry (custom SVG). */
  customTemplate?: Template;
}

export const BLEND_MODES: BlendMode[] = [
  'source-over',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
];
