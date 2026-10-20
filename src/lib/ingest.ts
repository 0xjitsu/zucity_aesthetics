import type { Asset } from '../types';

export interface IngestFailure {
  name: string;
  reason: string;
}

export interface IngestResult {
  assets: Asset[];
  failures: IngestFailure[];
}

export class IngestError extends Error {
  reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = 'IngestError';
    this.reason = reason;
  }
}

/** Long-edge cap. A 50MP drop would otherwise sit in memory for the whole session. */
const MAX_EDGE = 4096;
const DEFAULT_RASTER = 2048;
/** Under this, and untouched, the original bytes go straight into the document. */
const INLINE_LIMIT = 8 * 1024 * 1024;
const WEBP_QUALITY = 0.92;

const HEIC_REASON = 'Safari can open HEIC directly; on other browsers convert to JPG first';
const CORRUPT_REASON = 'Not an image, or the file is corrupt';

/**
 * Consulted only when `file.type` is empty — some OS/browser combinations hand
 * over files with no MIME at all. This is a fallback, not an allowlist: when a
 * type is present we accept any `image/*` and let the decoder have the final say.
 */
const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
};

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Ingest a batch. Never throws: anything unsupported becomes a failure entry so
 * the caller can surface one toast per bad file and still keep the good ones.
 *
 * Sequential on purpose — decoding several large images at once is the fastest
 * way to get the tab killed on a memory-constrained device.
 */
export async function ingestFiles(
  files: File[] | FileList,
  opts?: { rasterSize?: number },
): Promise<IngestResult> {
  const assets: Asset[] = [];
  const failures: IngestFailure[] = [];

  for (const file of toFileArray(files)) {
    try {
      assets.push(await ingestFile(file, opts));
    } catch (err) {
      failures.push({ name: file?.name || 'Untitled', reason: reasonOf(err) });
    }
  }

  return { assets, failures };
}

/** Ingest one file. Throws `IngestError` with a human `reason` on failure. */
export async function ingestFile(file: File, opts?: { rasterSize?: number }): Promise<Asset> {
  if (!file) throw new IngestError('No file was provided');

  const name = file.name || 'Untitled';
  if (file.size === 0) throw new IngestError('Empty file');

  const mime = mimeOf(file);
  if (!mime) {
    throw new IngestError('Unknown file type — no MIME type and no recognised image extension');
  }
  if (!mime.startsWith('image/')) {
    throw new IngestError(`Not an image (${mime})`);
  }

  if (mime === 'image/svg+xml') {
    return rasterizeSvg(file, name, opts?.rasterSize);
  }
  return ingestBitmap(file, name, mime);
}

/** Pull files out of a drag-drop payload, skipping dragged text and folders. */
export function filesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];

  const out: File[] = [];
  const items = dt.items;
  if (items && items.length) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind !== 'file') continue;
      // Dropped folders arrive as zero-byte "files"; drop them before they
      // become a misleading "Empty file" failure.
      if (item.webkitGetAsEntry?.()?.isDirectory) continue;
      const file = item.getAsFile();
      if (file) out.push(file);
    }
  }

  // Older paths (and some Linux browsers) only populate `files`.
  if (!out.length && dt.files) {
    for (let i = 0; i < dt.files.length; i++) out.push(dt.files[i]);
  }
  return out;
}

/** Pull files out of a paste. Text/HTML flavours of the clipboard are ignored. */
export function filesFromClipboard(e: ClipboardEvent): File[] {
  return filesFromDataTransfer(e.clipboardData);
}

/* -------------------------------------------------------------------------- */
/* Bitmaps                                                                     */
/* -------------------------------------------------------------------------- */

async function ingestBitmap(file: File, name: string, mime: string): Promise<Asset> {
  const decoded = await decode(file, mime);
  try {
    const [sw, sh] = [decoded.width, decoded.height];
    if (!sw || !sh) throw new IngestError(CORRUPT_REASON);

    const long = Math.max(sw, sh);
    const downscaled = long > MAX_EDGE;
    const scale = downscaled ? MAX_EDGE / long : 1;
    const width = Math.max(1, Math.round(sw * scale));
    const height = Math.max(1, Math.round(sh * scale));

    // Keeping the original bytes preserves whatever the source encoder did
    // better than we would; re-encoding is the price of touching the pixels.
    const keepOriginal = !downscaled && file.size < INLINE_LIMIT;
    const encoded = keepOriginal
      ? { dataUrl: await readAsDataUrl(retype(file, mime)), mime }
      : encodeCanvas(drawScaled(decoded.source, width, height));

    const asset: Asset = {
      id: nextId(name),
      name,
      mime: encoded.mime,
      dataUrl: encoded.dataUrl,
      width,
      height,
    };
    if ((mime === 'image/gif' || mime === 'image/webp') && (await isAnimated(file))) {
      asset.animatedSource = true;
    }
    if (downscaled) asset.downscaledFrom = [sw, sh];
    return asset;
  } finally {
    decoded.release();
  }
}

/**
 * Only an animated file loses anything by keeping frame 1, so only an
 * animated file gets the flag. Sniffs the first 64 KB:
 * - WebP: a `VP8X` header with the animation bit (0x02 of the flags byte at
 *   offset 20), or an `ANIM` chunk.
 * - GIF: a `NETSCAPE2.0` looping extension, which every animation encoder
 *   writes. ponytail: a looping-less multi-frame GIF reads as static; count
 *   image descriptors if that ever matters.
 */
async function isAnimated(file: Blob): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  const ascii = (at: number, len: number) =>
    String.fromCharCode(...bytes.subarray(at, at + len));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    // Only the extended (VP8X) container can carry animation at all.
    if (ascii(12, 4) !== 'VP8X') return false;
    return (bytes[20] & 0x02) !== 0 || indexOf(bytes, 'ANIM') !== -1;
  }
  if (ascii(0, 3) === 'GIF') return indexOf(bytes, 'NETSCAPE2.0') !== -1;
  return false;
}

function indexOf(bytes: Uint8Array, needle: string): number {
  const n = Array.from(needle, (c) => c.charCodeAt(0));
  outer: for (let i = 0; i <= bytes.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) if (bytes[i + j] !== n[j]) continue outer;
    return i;
  }
  return -1;
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/**
 * `createImageBitmap` is the fast path and the only one that honours EXIF
 * orientation consistently. Not every browser accepts every container through
 * it, so a plain <img> decode is kept as a second opinion before giving up.
 */
async function decode(file: File, mime: string): Promise<Decoded> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  } catch {
    // fall through to the element decoder
  }

  try {
    const img = await loadImageElement(await readAsDataUrl(retype(file, mime)));
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      release: () => {},
    };
  } catch {
    if (mime.startsWith('image/heic') || mime.startsWith('image/heif')) {
      throw new IngestError(HEIC_REASON);
    }
    throw new IngestError(`${CORRUPT_REASON} (${mime})`);
  }
}

/* -------------------------------------------------------------------------- */
/* SVG                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * SVG textures get rasterized generously up front. The fill can be scaled well
 * past 1x by the user, and a 300px raster would fall apart there — whereas the
 * vector itself costs nothing extra to draw large exactly once.
 */
async function rasterizeSvg(file: File, name: string, rasterSize?: number): Promise<Asset> {
  const target = Math.max(DEFAULT_RASTER, rasterSize ?? DEFAULT_RASTER);
  const url = URL.createObjectURL(retype(file, 'image/svg+xml'));

  try {
    let img: HTMLImageElement;
    try {
      img = await loadImageElement(url);
    } catch {
      throw new IngestError('This SVG could not be rendered — it may be malformed');
    }

    // Width/height-less SVGs report 0 in some browsers and a 300x150 default in
    // others; neither is a real intrinsic size, so square it off.
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = iw && ih ? target / Math.max(iw, ih) : 0;
    const width = scale ? Math.max(1, Math.round(iw * scale)) : target;
    const height = scale ? Math.max(1, Math.round(ih * scale)) : target;

    const encoded = encodeCanvas(drawScaled(img, width, height));
    return {
      id: nextId(name),
      name,
      mime: encoded.mime,
      dataUrl: encoded.dataUrl,
      width,
      height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* -------------------------------------------------------------------------- */
/* Canvas helpers                                                              */
/* -------------------------------------------------------------------------- */

function drawScaled(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new IngestError('The browser refused a 2D canvas, so the image cannot be processed');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

/**
 * WebP keeps alpha and is roughly half the size of PNG at this quality. A
 * browser without WebP encoding silently returns a PNG data URL from
 * `toDataURL`, so the result is sniffed rather than assumed.
 */
function encodeCanvas(canvas: HTMLCanvasElement): { dataUrl: string; mime: string } {
  const webp = canvas.toDataURL('image/webp', WEBP_QUALITY);
  if (webp.startsWith('data:image/webp')) return { dataUrl: webp, mime: 'image/webp' };
  const png = canvas.toDataURL('image/png');
  if (!png.startsWith('data:image/png')) throw new IngestError('The browser could not encode this image');
  return { dataUrl: png, mime: 'image/png' };
}

/* -------------------------------------------------------------------------- */
/* Plumbing                                                                    */
/* -------------------------------------------------------------------------- */

function mimeOf(file: File): string {
  if (file.type) return file.type.toLowerCase();
  const ext = (file.name || '').split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? '';
}

/**
 * A typeless Blob would become a `data:application/octet-stream` URL, which no
 * <img> will render — so the inferred MIME is stamped on before reading.
 */
function retype(file: File, mime: string): Blob {
  return file.type ? file : file.slice(0, file.size, mime);
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new IngestError('The file could not be read'));
    };
    reader.onerror = () => reject(new IngestError('The file could not be read'));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new IngestError(CORRUPT_REASON));
    img.src = src;
  });
}

function toFileArray(files: File[] | FileList): File[] {
  if (Array.isArray(files)) return files;
  const out: File[] = [];
  for (let i = 0; i < files.length; i++) out.push(files[i]);
  return out;
}

function reasonOf(err: unknown): string {
  if (err instanceof IngestError) return err.reason;
  if (err instanceof Error && err.message) return err.message;
  return CORRUPT_REASON;
}

let seq = 0;
/**
 * The counter alone would collide with ids inside a .masklab file saved by an
 * earlier session, which would silently overwrite an asset on import; the
 * session token makes each run's ids disjoint.
 */
const SESSION = Math.random().toString(36).slice(2, 8);

function nextId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  return `a${++seq}-${SESSION}-${slug || 'image'}`;
}
