import type { Asset, Composition, Template } from '../types';
import { ensureImages } from './imageCache';
import { renderComposition } from './render';
import { downloadBlob } from './fileIo';

/** Everything the exporters need. Shared by the PNG, SVG and JSON paths. */
export interface ExportInput {
  template: Template;
  composition: Composition;
  assets: Record<string, Asset>;
}

const MIN_SIZE = 600;
const MAX_SIZE = 4096;
const DEFAULT_SIZE = 2000;
const MIME = 'image/png';

const CLIPBOARD_UNAVAILABLE =
  'This browser will not let a page write images to the clipboard. Use Export PNG instead and the file will be saved to your downloads.';

/** Guards against a corrupted or hand-edited exportSize reaching the canvas. */
export function exportEdge(composition: Composition, override?: number): number {
  const raw = override ?? composition.exportSize;
  if (!Number.isFinite(raw)) return DEFAULT_SIZE;
  return Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, raw)));
}

/**
 * Rasterise a composition to a PNG blob.
 *
 * The pixels come from `renderComposition` — the same function the editor
 * canvas uses — with `forExport` set, so a transparent-background export
 * really is transparent while the editor still shows its backdrop.
 */
export async function renderToBlob(input: ExportInput, size?: number): Promise<Blob> {
  const edge = exportEdge(input.composition, size);

  // Decode first: a half-loaded asset silently degrades to its flat colour.
  const images = await ensureImages(input.assets);

  const canvas = document.createElement('canvas');
  canvas.width = edge;
  canvas.height = edge;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('This browser could not open a drawing canvas, so the PNG could not be made.');
  }

  renderComposition(ctx, {
    template: input.template,
    composition: input.composition,
    assets: input.assets,
    images,
    size: edge,
    forExport: true,
  });

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The PNG could not be encoded. Try a smaller export size.'));
    }, MIME);
  });
}

/** Render and hand the file to the browser's download machinery. */
export async function exportPng(input: ExportInput): Promise<void> {
  const edge = exportEdge(input.composition);
  const blob = await renderToBlob(input, edge);
  downloadBlob(blob, `masklab-${input.composition.templateId}-${edge}.png`);
}

/**
 * Copy the render straight to the system clipboard.
 *
 * Two write attempts, because the browsers disagree about what a ClipboardItem
 * may hold. Safari wants the item constructed synchronously from a pending
 * promise so the write is still attributable to the click that started it;
 * older Chromium wants a blob that has already resolved. We try the Safari
 * shape first and fall back, rather than sniffing user agents.
 */
export async function copyPngToClipboard(input: ExportInput): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    throw new Error(CLIPBOARD_UNAVAILABLE);
  }

  const blobPromise = renderToBlob(input);
  // Keep a render failure from surfacing as an unhandled rejection if the
  // clipboard write below bails out before anything awaits the blob.
  blobPromise.catch(() => undefined);

  try {
    await navigator.clipboard.write([new ClipboardItem({ [MIME]: blobPromise })]);
    return;
  } catch {
    // Fall through to the settled-blob shape.
  }

  // Rethrows a rendering problem as itself; only clipboard refusals become the
  // "use Export PNG" message.
  const blob = await blobPromise;
  try {
    await navigator.clipboard.write([new ClipboardItem({ [MIME]: Promise.resolve(blob) })]);
  } catch {
    throw new Error(CLIPBOARD_UNAVAILABLE);
  }
}
