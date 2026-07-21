<div align="center">

# MaskLab

**One shape. Many textures.**

Fill each region of a vector shape with a different image — live, with per-region transform control and lossless export.

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL_v3-ff3b14?style=flat-square)](LICENSE)
[![Deploy with Vercel](https://img.shields.io/badge/deploy-Vercel-000000?style=flat-square&logo=vercel)](https://vercel.com/new)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React_19-20232a?style=flat-square&logo=react)](https://react.dev/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff3b14?style=flat-square)](#contributing)

[Quick Start](#quick-start) · [How It Works](#how-it-works) · [Templates](#templates) · [Deploy](#deploy)

</div>

---

## Why This Exists

A yin-yang saved as one compound SVG path has no separately selectable fills. You cannot put texture A in one half and texture B in the other — the halves are not addressable, only the whole silhouette is.

MaskLab solves that generally. Any multi-region template, any number of regions, any raster or vector texture. Drop an image on a region, drag to place it, export a PNG that matches what you see or an SVG whose regions stay individually editable in Illustrator and Figma.

Nothing leaves the browser. There is no backend and no upload — your images are decoded, composited, and exported entirely on your machine.

## Quick Start

```bash
npm install
npm run dev
```

Then drop an image onto a region. Or click a region and use the inspector.

| Gesture | Effect |
|---------|--------|
| Click a region | Selects it |
| Drag on canvas | Pans the selected texture |
| Scroll | Zooms it |
| Shift-scroll | Spins it |
| Drop a file on a card | Assigns that texture to that region |
| Paste (`Cmd/Ctrl+V`) | Ingests an image from the clipboard |

| Key | Action |
|-----|--------|
| `1`–`9` | Select region N |
| `[` `]` | Cycle regions |
| Arrows | Nudge the selected texture (hold shift for 5x) |
| `r` | Reset the selected region |
| `Cmd/Ctrl+Z` | Undo (30 steps) |

## What's Inside

- **Per-region fills** — colour or image, each with its own zoom, spin, offset, flip, opacity and blend mode.
- **Broad image ingest** — JPG, PNG, WebP, AVIF, GIF, SVG, BMP, ICO, TIFF and HEIC where the browser can decode it. SVG textures are rasterised at export resolution so they stay crisp. Oversized files are downscaled on ingest. Every rejection is explained by name and reason — nothing fails silently.
- **Four exports** — PNG at up to 4096px, a real vector SVG with one `clipPath` per region, a JSON document that round-trips a whole look including its assets, and copy-to-clipboard.
- **Five templates** — including custom SVG upload, which extracts every path, circle, ellipse, rect and polygon as an individually fillable region.
- **Composition controls** — background, global rotation, film grain, ring stroke, export size, transparent-background export.

## How It Works

```
  file  ──▶  lib/ingest.ts  ──▶  Asset { dataUrl, width, height }
                                      │
  template (plain data) ──┐           │
                          ▼           ▼
                     store.ts  ──▶  Composition { fills per region }
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
          lib/render.ts (canvas)              lib/svgExport.ts (vector)
                    │                                   │
         ┌──────────┴──────────┐                        │
         ▼                     ▼                        ▼
   live editor            PNG export                SVG export
```

The interesting constraint is that the canvas render and the SVG export must agree. Both derive their transform chain from a single exported function, `fillTransform()` in [`src/lib/geometry.ts`](src/lib/geometry.ts):

```
translate(cx, cy) → rotate(rotation) → scale(flipX, flipY) → draw at (-dw/2, -dh/2)
```

Neither renderer recomputes the cover-fit maths independently. Parity is a property of the architecture rather than something to re-verify by eye after each change.

The live editor and the PNG exporter go further and share the *same* function — `renderComposition()` — so what you see on screen is literally the code path you download.

**One honest exception:** film grain. The canvas uses a seeded noise tile; the SVG uses `feTurbulence`, because a vector document should not carry a raster noise plate. These are different generators and do not match pixel for pixel. The exported SVG says so in a comment rather than pretending otherwise.

## Templates

| Template | Regions | Notes |
|----------|---------|-------|
| Yin Yang | 4 | The default, and the origin problem |
| Split Circle | 2 | The simplest case — proves the model generalises |
| Triskelion | 6 | 120° rotational analogue; paths generated from arcs |
| Quadrant Grid | 4 | Boring on purpose — the regression test for arbitrary regions |
| Custom SVG | any | Upload your own; every shape becomes a fillable region |

Adding a template is a new file in `src/templates/` plus one line in the registry. No component changes — the UI reads region count, names and paint order from the data.

```ts
export const myShape: Template = {
  id: 'my-shape',
  name: 'My Shape',
  viewBox: [0, 0, 12, 12],
  regions: [
    { id: 'a', name: 'Left', d: 'M...Z', defaultFill: '#141416', z: 0 },
    { id: 'b', name: 'Right', d: 'M...Z', defaultFill: '#e8e6e1', z: 1 },
  ],
};
```

## Project Structure

```
src/
  types.ts              Data model: Region, Template, Fill, Asset, Composition
  store.ts              Zustand state + 30-step undo history
  lib/
    geometry.ts         fillTransform() — the shared transform contract
    render.ts           Canvas renderer (editor + PNG)
    svgExport.ts        Vector document assembly
    pngExport.ts        Raster export + clipboard
    fileIo.ts           JSON round-trip
    ingest.ts           Image decode pipeline + format matrix
    svgImport.ts        Custom SVG to Template
    imageCache.ts       Decode-once asset cache
  templates/            One file per shape, plus the registry
  components/           Stage (canvas) + Inspector (controls)
  hooks/useKeyboard.ts  Global shortcuts
```

<details>
<summary><strong>Developer Setup</strong></summary>

```bash
npm install
npm run dev        # vite dev server
npm run build      # tsc -b && vite build  ->  dist/
npm run preview    # serve the production build
npm run lint       # oxlint
```

No environment variables. `npm run build` produces a fully static `dist/` with zero runtime configuration.

</details>

## Deploy

Any static host. For Vercel:

```bash
npx vercel --prod
```

Framework preset: Vite. Build command `npm run build`, output directory `dist`.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Build | Vite |
| UI | React 19 + TypeScript |
| Styling | Tailwind CSS v4 (core utilities only) |
| State | Zustand |
| Rendering | Canvas 2D `Path2D` + `clip()`, hand-assembled SVG |
| Backend | None |

No canvas library. No image-processing dependency. The render maths is in the repo where you can read it.

## Contributing

Issues and PRs welcome. PRs target `test` first, not `main`.

**Contributor License Agreement** — by contributing you grant the maintainer a perpetual, worldwide, irrevocable licence to use, modify, and relicense your contribution, including under commercial terms. This keeps the dual-license model viable.

## License

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL_v3-ff3b14?style=flat-square)](LICENSE)

AGPL v3 for open source use. If you want to ship MaskLab inside a proprietary product, or run a modified version as a network service without publishing your changes, a commercial license is available — open an issue to ask.

---

<div align="center">

**One shape. Many textures.**

[Quick Start](#quick-start) · [Report a Bug](https://github.com/0xjitsu/zucity_aesthetics/issues/new) · [Request a Feature](https://github.com/0xjitsu/zucity_aesthetics/issues/new)

</div>
