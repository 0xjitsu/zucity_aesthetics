import { useEffect, useState } from 'react';
import type { Asset } from '../types';

const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement>>();

/** Decode an asset's dataUrl once and keep it around for the session. */
export function loadImage(asset: Asset): Promise<HTMLImageElement> {
  const hit = cache.get(asset.id);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(asset.id);
  if (inflight) return inflight;

  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      cache.set(asset.id, img);
      pending.delete(asset.id);
      resolve(img);
    };
    img.onerror = () => {
      pending.delete(asset.id);
      reject(new Error(`Could not decode ${asset.name}`));
    };
    img.src = asset.dataUrl;
  });
  pending.set(asset.id, p);
  return p;
}

export function getLoadedImage(assetId: string): HTMLImageElement | undefined {
  return cache.get(assetId);
}

/** Synchronously usable map of every decoded asset, refreshed as they load. */
export function useImages(assets: Record<string, Asset>): Record<string, HTMLImageElement> {
  const [images, setImages] = useState<Record<string, HTMLImageElement>>(() => snapshot(assets));

  useEffect(() => {
    let live = true;
    const missing = Object.values(assets).filter((a) => !cache.has(a.id));
    if (!missing.length) {
      setImages(snapshot(assets));
      return;
    }
    Promise.allSettled(missing.map(loadImage)).then(() => {
      if (live) setImages(snapshot(assets));
    });
    return () => {
      live = false;
    };
  }, [assets]);

  return images;
}

function snapshot(assets: Record<string, Asset>): Record<string, HTMLImageElement> {
  const out: Record<string, HTMLImageElement> = {};
  for (const id of Object.keys(assets)) {
    const img = cache.get(id);
    if (img) out[id] = img;
  }
  return out;
}

/** Await every asset — used before exporting so nothing renders half-loaded. */
export async function ensureImages(assets: Record<string, Asset>): Promise<Record<string, HTMLImageElement>> {
  await Promise.allSettled(Object.values(assets).map(loadImage));
  return snapshot(assets);
}
