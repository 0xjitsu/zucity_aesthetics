import type {
  Asset,
  Composition,
  FontAsset,
  MaskLabFile,
  Template,
  TextSpec,
} from '../types';
import { TEMPLATES } from '../templates';
import type { ExportInput } from './pngExport';

/* -------------------------------------------------------------------------- */
/* Download                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Hand a blob to the browser as a file.
 *
 * The object URL is revoked on a timer rather than immediately: Safari reads
 * it asynchronously after the synthetic click, and revoking too early produces
 * a zero-byte download.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/* -------------------------------------------------------------------------- */
/* Save                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Write the whole look to a `.json` document.
 *
 * Every referenced asset travels with it, dataUrls and all, so the file
 * reproduces the same result on a machine that has never seen the source
 * images. A user-uploaded SVG template ships alongside for the same reason —
 * without it the composition would point at a template that does not exist.
 */
export function exportJson(
  input: ExportInput & {
    customTemplate?: Template | null;
    textSpec?: TextSpec | null;
    fonts?: Record<string, FontAsset>;
  },
): void {
  const { template, composition, assets, customTemplate, textSpec, fonts } = input;

  const used = new Set<string>();
  for (const fill of Object.values(composition.fills)) {
    if (fill.kind === 'image' && fill.assetId) used.add(fill.assetId);
  }

  const file: MaskLabFile = {
    format: 'masklab',
    version: 1,
    composition,
    assets: Object.values(assets).filter((asset) => used.has(asset.id)),
  };

  const custom =
    customTemplate && customTemplate.id === composition.templateId
      ? customTemplate
      : TEMPLATES.some((t) => t.id === template.id)
        ? undefined
        : template;
  if (custom) file.customTemplate = custom;

  // A text composition is only reproducible if the run that generated it comes
  // along, and an uploaded font is only reproducible if its bytes do. Built-in
  // fonts are omitted — they ship with the app, so re-embedding a 2.3 MB face
  // in every saved look would be waste.
  if (textSpec) {
    file.textSpec = textSpec;
    const used = fonts?.[textSpec.fontId];
    if (used && used.source === 'uploaded') file.fonts = [used];
  }

  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `masklab-${composition.templateId}.json`);
}

/* -------------------------------------------------------------------------- */
/* Load                                                                        */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read a `.json` document back into a MaskLabFile.
 *
 * Validation is deliberately shallow but load-bearing: it confirms the file is
 * ours, that the version is one we understand, and that the parts the editor
 * dereferences immediately are actually present. Everything it rejects, it
 * rejects with a sentence that tells the user what to do next.
 */
export async function importJson(file: File): Promise<MaskLabFile> {
  const label = file.name || 'that file';

  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new Error(`Could not read ${label}. Try picking the file again.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `${label} is not a MaskLab file — it is not readable as JSON. Choose a .json file that MaskLab saved.`,
    );
  }

  if (!isRecord(parsed) || parsed.format !== 'masklab') {
    throw new Error(`${label} was not saved by MaskLab. Choose a .json file that MaskLab saved.`);
  }

  if (parsed.version !== 1) {
    const seen = typeof parsed.version === 'number' ? ` (version ${parsed.version})` : '';
    throw new Error(
      `${label} was saved by a different version of MaskLab${seen}. Update MaskLab, or save the look again from the version that made it.`,
    );
  }

  const composition = parsed.composition;
  if (!isRecord(composition) || !isRecord(composition.fills)) {
    throw new Error(`${label} is missing its artwork settings, so there is nothing to open.`);
  }

  const rawAssets = parsed.assets;
  if (rawAssets !== undefined && !Array.isArray(rawAssets)) {
    throw new Error(`The textures in ${label} are damaged, so it cannot be opened.`);
  }
  const assets = (rawAssets ?? []) as unknown[];
  for (const asset of assets) {
    if (!isRecord(asset) || typeof asset.id !== 'string' || typeof asset.dataUrl !== 'string') {
      throw new Error(`One of the textures in ${label} is damaged, so it cannot be opened.`);
    }
  }

  const customTemplate = parsed.customTemplate;
  if (customTemplate !== undefined && (!isRecord(customTemplate) || !Array.isArray(customTemplate.regions))) {
    throw new Error(`The custom shape saved in ${label} is damaged, so it cannot be opened.`);
  }

  const out: MaskLabFile = {
    format: 'masklab',
    version: 1,
    composition: composition as unknown as Composition,
    assets: assets as unknown as Asset[],
  };
  if (customTemplate !== undefined) out.customTemplate = customTemplate as unknown as Template;
  return out;
}
