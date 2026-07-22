import type { Asset, Fill, RegionId } from '../types';
import { ingestFiles } from './ingest';

/**
 * The house textures — ZuCity reds, bundled with the app so the very first
 * canvas a visitor sees is already dressed. They go through the same ingest
 * pipeline as an upload, so they behave identically everywhere downstream:
 * region cards, remix, JSON export, all of it.
 */
const STARTERS = [
  'centipede.webp',
  'spiral.webp',
  'dragon.webp',
  'liquify.webp',
  'silk.webp',
];

async function fetchOne(name: string): Promise<File | null> {
  try {
    const res = await fetch(`./textures/${name}`);
    if (!res.ok) return null;
    return new File([await res.blob()], name, { type: 'image/webp' });
  } catch {
    // Offline or blocked: the default look degrades to flat colour, quietly.
    return null;
  }
}

async function ingestNames(names: string[]): Promise<Asset[]> {
  const files = (await Promise.all(names.map(fetchOne))).filter((f): f is File => f !== null);
  const { assets } = await ingestFiles(files);
  return assets;
}

export interface StarterBatches {
  /** The two textures this visit's look will wear — the boot-critical pair. */
  pair: Promise<Asset[]>;
  /** Everything else, arriving whenever it arrives. */
  rest: Promise<Asset[]>;
}

let pending: StarterBatches | null = null;

/**
 * Load the starters in two waves. The visit's pair is chosen FIRST, then only
 * those two files are fetched (in parallel) before the canvas dresses; the
 * other three stream in behind. Waiting for all five was the visible
 * boot delay — the look only ever needed two.
 */
export function loadStarterAssets(): StarterBatches {
  if (!pending) {
    const deck = [...STARTERS].sort(() => Math.random() - 0.5);
    pending = {
      pair: ingestNames(deck.slice(0, 2)),
      rest: ingestNames(deck.slice(2)),
    };
  }
  return pending;
}

/**
 * A look for the default yin-yang from a pair of textures. Each dot reuses
 * the transform of the SAME texture as its opposite half, so the eye reads
 * as a window through to the other layer — the classic yin-yang move,
 * differently dealt on every visit.
 */
export function starterLook(assets: Asset[]): Partial<Record<RegionId, Partial<Fill>>> {
  if (assets.length < 2) return {};
  const [a, b] = assets;

  const lookA = dress(a.id);
  const lookB = dress(b.id);
  return { yang: lookA, dotT: lookA, yin: lookB, dotB: lookB };
}

export function dress(assetId: string): Partial<Fill> {
  return {
    kind: 'image',
    assetId,
    scale: 1 + Math.random() * 0.7,
    rotation: Math.random() < 0.5 ? 0 : Math.round(Math.random() * 360),
    offsetX: (Math.random() - 0.5) * 3,
    offsetY: (Math.random() - 0.5) * 3,
    flipX: Math.random() < 0.3,
    flipY: false,
    opacity: 1,
    blend: 'source-over',
  };
}
