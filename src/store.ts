import { create } from 'zustand';
import type {
  Asset,
  BlendMode,
  Composition,
  Fill,
  FontAsset,
  MaskLabFile,
  Region,
  RegionId,
  Template,
  TextSpec,
} from './types';
import { BLEND_MODES } from './types';
import {
  CUSTOM_TEMPLATE_ID,
  DEFAULT_TEMPLATE_ID,
  TEXT_TEMPLATE_ID,
  findTemplate,
  sortedRegions,
} from './templates';

const HISTORY_LIMIT = 30;

export type ToastTone = 'error' | 'info' | 'ok';

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  detail?: string;
}

export function defaultFill(region: Region): Fill {
  return {
    regionId: region.id,
    kind: 'color',
    color: region.defaultFill,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    flipX: false,
    flipY: false,
    opacity: 1,
    blend: 'source-over',
  };
}

export function defaultFills(template: Template): Record<RegionId, Fill> {
  const out: Record<RegionId, Fill> = {};
  for (const r of template.regions) out[r.id] = defaultFill(r);
  return out;
}

function baseComposition(template: Template): Composition {
  return {
    templateId: template.id,
    fills: defaultFills(template),
    background: '#0b0b0d',
    globalRotation: 0,
    grain: 0,
    ringWidth: 0,
    ringColor: '#e8e6e1',
    exportSize: 2000,
    transparentBackground: false,
  };
}

interface Snapshot {
  composition: Composition;
  customTemplate: Template | null;
  textSpec: TextSpec | null;
}

export interface MaskLabState {
  composition: Composition;
  assets: Record<string, Asset>;
  /** A generated template — uploaded SVG, or text. Lives outside the registry. */
  customTemplate: Template | null;
  /** Set when `customTemplate` came from text, so the run stays re-editable. */
  textSpec: TextSpec | null;
  /** Built-in and uploaded fonts available to the text template. */
  fonts: Record<string, FontAsset>;
  selectedId: RegionId | null;
  hoveredId: RegionId | null;
  toasts: Toast[];
  past: Snapshot[];
  future: Snapshot[];

  /** Snapshot current state. Call once at the start of a continuous gesture. */
  pushHistory: () => void;
  undo: () => void;

  setTemplate: (id: string) => void;
  setCustomTemplate: (template: Template) => void;
  /**
   * Install a template generated from text. Fills are carried over by position,
   * so editing the words does not throw away the textures already placed.
   */
  setTextTemplate: (template: Template, spec: TextSpec) => void;
  addFont: (font: FontAsset) => void;

  addAsset: (asset: Asset) => void;
  assignAsset: (regionId: RegionId, assetId: string) => void;
  clearFill: (regionId: RegionId) => void;
  /** Continuous edits: does NOT record history. Call pushHistory() first. */
  updateFill: (regionId: RegionId, patch: Partial<Fill>) => void;
  /** Discrete edits from inputs: records history. */
  commitFill: (regionId: RegionId, patch: Partial<Fill>) => void;
  resetRegion: (regionId: RegionId) => void;

  setComposition: (patch: Partial<Composition>, record?: boolean) => void;

  select: (id: RegionId | null) => void;
  hover: (id: RegionId | null) => void;

  randomize: () => void;
  /** Copy one region's fill onto every other region — the "all glyphs alike" move. */
  applyFillToAll: (regionId: RegionId) => void;
  resetAll: () => void;
  loadFile: (file: MaskLabFile) => void;

  toast: (tone: ToastTone, title: string, detail?: string) => void;
  dismissToast: (id: string) => void;
}

export function currentTemplate(state: MaskLabState): Template {
  return findTemplate(state.composition.templateId, state.customTemplate);
}

let toastSeq = 0;

export const useStore = create<MaskLabState>((set, get) => {
  const snapshot = (): Snapshot => {
    const s = get();
    return {
      composition: structuredClone(s.composition),
      customTemplate: s.customTemplate ? structuredClone(s.customTemplate) : null,
      textSpec: s.textSpec ? structuredClone(s.textSpec) : null,
    };
  };

  const record = () =>
    set((s) => ({
      past: [...s.past, snapshot()].slice(-HISTORY_LIMIT),
      future: [],
    }));

  return {
    composition: baseComposition(findTemplate(DEFAULT_TEMPLATE_ID)),
    assets: {},
    customTemplate: null,
    textSpec: null,
    fonts: {},
    selectedId: null,
    hoveredId: null,
    toasts: [],
    past: [],
    future: [],

    pushHistory: record,

    undo: () =>
      set((s) => {
        const prev = s.past[s.past.length - 1];
        if (!prev) return s;
        return {
          past: s.past.slice(0, -1),
          future: [
            ...s.future,
            {
              composition: structuredClone(s.composition),
              customTemplate: s.customTemplate,
              textSpec: s.textSpec,
            },
          ],
          composition: prev.composition,
          customTemplate: prev.customTemplate,
          textSpec: prev.textSpec,
        };
      }),

    setTemplate: (id) => {
      record();
      const template = findTemplate(id, get().customTemplate);
      set((s) => ({
        composition: { ...s.composition, templateId: template.id, fills: defaultFills(template) },
        selectedId: null,
        hoveredId: null,
      }));
    },

    setCustomTemplate: (template) => {
      record();
      const t: Template = { ...template, id: CUSTOM_TEMPLATE_ID };
      set((s) => ({
        customTemplate: t,
        textSpec: null,
        composition: { ...s.composition, templateId: t.id, fills: defaultFills(t) },
        selectedId: null,
        hoveredId: null,
      }));
    },

    setTextTemplate: (template, spec) => {
      record();
      const t: Template = { ...template, id: TEXT_TEMPLATE_ID };
      set((s) => {
        const previous = sortedRegions(currentTemplate(s));
        const wasText = s.composition.templateId === TEXT_TEMPLATE_ID;
        const next = defaultFills(t);
        // Retyping should keep the look. Region ids change with the text, so
        // carry fills across by position rather than by id.
        if (wasText) {
          sortedRegions(t).forEach((region, i) => {
            const old = previous[i] ? s.composition.fills[previous[i].id] : undefined;
            if (old) next[region.id] = { ...old, regionId: region.id };
          });
        }
        return {
          customTemplate: t,
          textSpec: spec,
          composition: { ...s.composition, templateId: t.id, fills: next },
          selectedId: null,
          hoveredId: null,
        };
      });
    },

    addFont: (font) => set((s) => ({ fonts: { ...s.fonts, [font.id]: font } })),

    addAsset: (asset) => set((s) => ({ assets: { ...s.assets, [asset.id]: asset } })),

    assignAsset: (regionId, assetId) => {
      record();
      set((s) => {
        const fill = s.composition.fills[regionId];
        if (!fill) return s;
        return {
          composition: {
            ...s.composition,
            fills: { ...s.composition.fills, [regionId]: { ...fill, kind: 'image', assetId } },
          },
          selectedId: regionId,
        };
      });
    },

    clearFill: (regionId) => {
      record();
      set((s) => {
        const fill = s.composition.fills[regionId];
        if (!fill) return s;
        return {
          composition: {
            ...s.composition,
            fills: {
              ...s.composition.fills,
              [regionId]: { ...fill, kind: 'color', assetId: undefined },
            },
          },
        };
      });
    },

    updateFill: (regionId, patch) =>
      set((s) => {
        const fill = s.composition.fills[regionId];
        if (!fill) return s;
        return {
          composition: {
            ...s.composition,
            fills: { ...s.composition.fills, [regionId]: { ...fill, ...patch } },
          },
        };
      }),

    commitFill: (regionId, patch) => {
      record();
      get().updateFill(regionId, patch);
    },

    resetRegion: (regionId) => {
      record();
      set((s) => {
        const template = currentTemplate(s);
        const region = template.regions.find((r) => r.id === regionId);
        if (!region) return s;
        return {
          composition: {
            ...s.composition,
            fills: { ...s.composition.fills, [regionId]: defaultFill(region) },
          },
        };
      });
    },

    setComposition: (patch, shouldRecord = true) => {
      if (shouldRecord) record();
      set((s) => ({ composition: { ...s.composition, ...patch } }));
    },

    select: (id) => set({ selectedId: id }),
    hover: (id) => set({ hoveredId: id }),

    randomize: () => {
      record();
      set((s) => {
        const template = currentTemplate(s);
        const assetIds = Object.keys(s.assets);
        const fills: Record<RegionId, Fill> = {};
        for (const region of sortedRegions(template)) {
          const base = defaultFill(region);
          const assetId = assetIds.length
            ? assetIds[Math.floor(Math.random() * assetIds.length)]
            : undefined;
          fills[region.id] = {
            ...base,
            kind: assetId ? 'image' : 'color',
            assetId,
            color: assetId ? base.color : randomHex(),
            scale: 0.9 + Math.random() * 1.4,
            offsetX: (Math.random() - 0.5) * template.viewBox[2] * 0.3,
            offsetY: (Math.random() - 0.5) * template.viewBox[3] * 0.3,
            rotation: Math.round(Math.random() * 360),
            flipX: Math.random() > 0.7,
            flipY: Math.random() > 0.85,
            blend: Math.random() > 0.75 ? pick(BLEND_MODES) : 'source-over',
          };
        }
        return { composition: { ...s.composition, fills } };
      });
    },

    applyFillToAll: (regionId) => {
      record();
      set((s) => {
        const source = s.composition.fills[regionId];
        if (!source) return s;
        const fills: Record<RegionId, Fill> = {};
        for (const id of Object.keys(s.composition.fills)) {
          fills[id] = { ...source, regionId: id };
        }
        return { composition: { ...s.composition, fills } };
      });
    },

    resetAll: () => {
      record();
      set((s) => ({
        composition: baseComposition(currentTemplate(s)),
        selectedId: null,
        hoveredId: null,
      }));
    },

    loadFile: (file) => {
      record();
      const assets: Record<string, Asset> = {};
      for (const a of file.assets) assets[a.id] = a;
      const fonts: Record<string, FontAsset> = {};
      for (const f of file.fonts ?? []) fonts[f.id] = f;
      set((s) => ({
        assets,
        fonts: { ...s.fonts, ...fonts },
        customTemplate: file.customTemplate ?? null,
        textSpec: file.textSpec ?? null,
        composition: file.composition,
        selectedId: null,
        hoveredId: null,
      }));
    },

    toast: (tone, title, detail) => {
      const id = `t${++toastSeq}`;
      set((s) => ({ toasts: [...s.toasts, { id, tone, title, detail }] }));
      setTimeout(() => get().dismissToast(id), tone === 'error' ? 9000 : 4500);
    },

    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  };
});

/* Dev-only handle, so the running app can be driven and inspected from the
   console (and by automated checks) without shipping anything to production. */
if (import.meta.env.DEV) {
  (window as unknown as { __masklab?: typeof useStore }).__masklab = useStore;
}

function pick<T>(xs: T[]): T {
  return xs[Math.floor(Math.random() * xs.length)];
}

function randomHex(): string {
  const h = Math.floor(Math.random() * 360);
  const s = 40 + Math.random() * 45;
  const l = 25 + Math.random() * 50;
  return hslToHex(h, s, l);
}

function hslToHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export type { BlendMode };
