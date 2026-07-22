import type { Asset, Fill, RegionId } from '../types';
import { ingestFiles } from './ingest';

/**
 * The house textures — ZuCity reds, bundled with the app so the very first
 * canvas a visitor sees is already dressed. They go through the same ingest
 * pipeline as an upload, so they behave identically everywhere downstream:
 * region cards, randomize, JSON export, all of it.
 */
const STARTERS = [
  'centipede.webp',
  'spiral.webp',
  'dragon.webp',
  'liquify.webp',
  'silk.webp',
];

let pending: Promise<Asset[]> | null = null;

/** Fetch and ingest the bundled textures once per session. Failures are quiet
 *  by design — a missing starter must never toast at a visitor who did
 *  nothing; the app simply falls back to flat colours. */
export function loadStarterAssets(): Promise<Asset[]> {
  if (!pending) {
    pending = (async () => {
      const files: File[] = [];
      for (const name of STARTERS) {
        try {
          const res = await fetch(`./textures/${name}`);
          if (!res.ok) continue;
          files.push(new File([await res.blob()], name, { type: 'image/webp' }));
        } catch {
          // Offline or blocked: skip, the default look degrades gracefully.
        }
      }
      const { assets } = await ingestFiles(files);
      return assets;
    })();
  }
  return pending;
}

/**
 * A per-visit look for the default yin-yang: two textures drawn from the
 * shuffled deck, one per S-half. Each dot reuses the transform of the SAME
 * texture as its host half, so the eye reads as a window through to the other
 * layer — the classic yin-yang move, with every visit shuffled differently.
 */
export function starterLook(assets: Asset[]): Partial<Record<RegionId, Partial<Fill>>> {
  if (assets.length < 2) return {};

  const deck = [...assets].sort(() => Math.random() - 0.5);
  const [a, b] = deck;

  const dress = (assetId: string): Partial<Fill> => ({
    kind: 'image',
    assetId,
    scale: 1 + Math.random() * 0.7,
    rotation: Math.random() < 0.5 ? 0 : Math.round(Math.random() * 360),
    offsetX: (Math.random() - 0.5) * 3,
    offsetY: (Math.random() - 0.5) * 3,
    flipX: Math.random() < 0.3,
    flipY: false,
    opacity: 1,
  });

  // One transform per texture, shared by its half and the opposite eye, so
  // the pattern lines up and the dot reads as a cut-out.
  const lookA = dress(a.id);
  const lookB = dress(b.id);

  return { yang: lookA, dotT: lookA, yin: lookB, dotB: lookB };
}
