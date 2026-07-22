<div align="center">

# MaskLab

**One shape. Many textures.**

Fill each region of a vector shape — or each letter of a word you type — with a different image. Live, with per-region transform control and lossless export.

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL_v3-ff3b14?style=flat-square)](LICENSE)
[![Fonts: SIL OFL](https://img.shields.io/badge/bundled_fonts-SIL_OFL_1.1-8b8b95?style=flat-square)](#license)
[![Deploy with Vercel](https://img.shields.io/badge/deploy-Vercel-000000?style=flat-square&logo=vercel)](https://vercel.com/new)
[![TypeScript](https://img.shields.io/badge/TypeScript-1f1f26?style=flat-square&logo=typescript&logoColor=3178c6)](https://www.typescriptlang.org/)
[![React 19](https://img.shields.io/badge/React_19-1f1f26?style=flat-square&logo=react&logoColor=61dafb)](https://react.dev/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff3b14?style=flat-square)](#contributing)

[Quick Start](#quick-start) · [How to Use](docs/how-to-use.md) · [Architecture](docs/architecture.md) · [For Agents](AGENTS.md) · [Live app](https://zucity-aesthetics.vercel.app)

</div>

---

## Why This Exists

A yin-yang saved as one compound SVG path has no separately selectable fills. You cannot put texture A in one half and texture B in the other — the halves are not addressable, only the whole silhouette is.

MaskLab solves that generally, and it solves the same problem for type. Two headline capabilities:

| | What it does |
|---|---|
| **Textures into shape regions** | Any multi-region template — built-in, or an SVG you upload — becomes a set of individually fillable regions. Drop an image on one, drag to place it. |
| **Textures into typed text** | Type a word and every glyph becomes its own fillable region, with real outline path data. Horizontal or vertical (CJK) layout, built-in fonts or your own. |

The house style this exists for: flags, stickers, album covers. Heavy forms with photographic or generative texture running through them.

Nothing leaves the browser. There is no backend and no upload — your images and fonts are decoded, composited, and exported entirely on your machine.

## Quick Start

```bash
npm install
npm run dev
```

Then drop an image onto a region. Or click a region and use the inspector. Full walkthrough: [docs/how-to-use.md](docs/how-to-use.md).

| Gesture | Effect |
|---------|--------|
| Click a region on the canvas | Selects it |
| Drag on the canvas | Pans the selected texture |
| Scroll | Zooms the selected texture |
| Shift-scroll | Spins the selected texture |
| Two-finger pinch | Zooms the selected texture (touch) |
| Drop a file on a region card | Assigns that texture to that region |
| Drop a file on the canvas | Fills the region under the cursor |
| Paste (`Cmd/Ctrl+V`) | Ingests an image from the clipboard |

| Key | Action |
|-----|--------|
| `1`–`9` | Select region N in paint order |
| `[` `]` | Cycle backwards / forwards through regions |
| Arrows | Nudge the selected texture (hold `Shift` for 5×) |
| `r` | Reset the selected region |
| `Cmd/Ctrl+Z` | Undo (30 steps) |

Shortcuts go inert while a form control has focus, so typing into the text box never moves the selection.

## What's Inside

- **Per-region fills** — colour or image, each with its own zoom, spin, X/Y offset, flip, opacity and blend mode. Offsets are stored in template viewBox units, so they are resolution-independent.
- **Text as a template** — a typed run is lowered to outline paths with [opentype.js](https://github.com/opentypejs/opentype.js) and installed as an ordinary template. Split the run per glyph, per line, or keep it whole. Four bundled fonts plus upload of your own `.ttf` / `.otf` / `.woff`.
- **Broad image ingest** — JPG, PNG, WebP, AVIF, GIF, SVG, BMP, ICO, TIFF, and HEIC where the browser can decode it. SVG textures are rasterised generously so they survive being zoomed past 1×. Files over 4096 px on the long edge are downscaled on ingest. Every rejection names the file and the reason — nothing fails silently.
- **Four exports** — PNG up to 4096 px, a real vector SVG with one `clipPath` per region, a JSON document that round-trips a whole look including its embedded assets, and copy-to-clipboard.
- **Six template sources** — four built-ins, typed text, and custom SVG upload.
- **Composition controls** — background colour, global rotation, film grain, ring stroke, export size, and transparent-background export.
- **30-step undo** — one entry per gesture, not per input event.

## How It Works

```
  image file ──▶ lib/ingest.ts ──▶ Asset { dataUrl, width, height }
                                        │
  templates/*.ts        ──┐             │
  lib/svgImport.ts (SVG) ─┤             │
  lib/textTemplate.ts    ─┘             │
        └── Template { viewBox, regions[] with path data }
                          │             │
                          ▼             ▼
                       store.ts ──▶ Composition { one Fill per region }
                                        │
                      ┌─────────────────┴─────────────────┐
                      ▼                                   ▼
            lib/render.ts (canvas)            lib/svgExport.ts (vector)
                      │                                   │
           ┌──────────┴──────────┐                        │
           ▼                     ▼                        ▼
     live editor            PNG export                SVG export
```

Every shape source converges on the same thing: a `Template` whose regions carry SVG path data in `Region.d`. Text is not a special case in the renderer — glyphs are lowered to path data before they ever reach it. That is why per-region zoom, blend modes, ring, grain, and all four exports work on letterforms without a line of type-specific code downstream.

The interesting constraint is that the canvas render and the SVG export must agree. Both derive their transform chain from one exported function, `fillTransform()` in [`src/lib/geometry.ts`](src/lib/geometry.ts):

```
translate(cx, cy) → rotate(rotation) → scale(flipX, flipY) → draw at (-dw/2, -dh/2)
```

Neither renderer recomputes the cover-fit maths independently. Parity is a property of the architecture rather than something to re-verify by eye after each change. The live editor and the PNG exporter go further and share the *same* function, `renderComposition()`, so what you see on screen is literally the code path you download.

**One honest exception: film grain.** The canvas uses a seeded 256 px noise tile; the SVG uses `feTurbulence`, because a vector document should not carry a raster noise plate. Same scale and strength, different generator — grain is the single element that is not pixel-identical between the two exports. The exported SVG says so in a comment rather than pretending otherwise.

More detail in [docs/architecture.md](docs/architecture.md).

## Templates

| Template | Regions | Notes |
|----------|---------|-------|
| Yin Yang | 4 | The default, and the origin problem |
| Split Circle | 2 | The simplest case — proves the model generalises |
| Triskelion | 6 | 120° rotational analogue; arcs generated programmatically, not transcribed |
| Quadrant Grid | 4 | Boring on purpose — the regression case for arbitrary regions |
| Text | 1 per glyph, line, or run | Typed words lowered to outline paths |
| Custom SVG | one per shape | Upload your own; every `path`, `circle`, `ellipse`, `rect`, `polygon` and `polyline` becomes a fillable region |

All four built-ins share a `[0, 0, 12, 12]` viewBox. Adding a template is a new file in `src/templates/` plus one line in the registry — no component changes, because the UI reads region count, names, and paint order from the data.

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
  types.ts                Data model: Region, Template, Fill, Asset,
                          Composition, TextSpec, FontAsset, MaskLabFile
  opentype-js.d.ts        Ambient types for opentype.js v2
  store.ts                Zustand state, 30-step undo, gesture/history contract
  lib/
    geometry.ts           fillTransform() — the shared transform contract
    render.ts             Canvas renderer (live editor + PNG export)
    svgExport.ts          Vector document assembly
    pngExport.ts          Raster export + clipboard
    fileIo.ts             JSON round-trip + download plumbing
    ingest.ts             Image decode pipeline + format matrix
    svgImport.ts          Uploaded SVG becomes a Template
    textTemplate.ts       Typed text becomes a Template (opentype.js)
    imageCache.ts         Decode-once asset cache
  templates/              One file per built-in shape, plus the registry
  components/             Stage (canvas, hit-testing, gestures), Inspector,
                          TextPanel, RegionCard, Controls, Toolbar, Toasts
  hooks/useKeyboard.ts    Global shortcuts
public/fonts/             Four bundled typefaces + LICENSE.txt (SIL OFL 1.1)
public/llms.txt           Site overview for AI agents (llmstxt.org)
```

<details>
<summary><strong>Developer Setup</strong></summary>

```bash
npm install
npm run dev        # vite dev server (:5173 by default)
npm run build      # tsc -b && vite build  ->  dist/
npm run preview    # serve the production build
npm run lint       # oxlint
```

Verification commands that matter:

```bash
npx tsc -b --noEmit    # types
npm run build          # types + bundle
npx oxlint src         # lint
```

There is **no test suite**. This app is verified by driving it in a browser and measuring the output. In a dev build, `window.__masklab` exposes the Zustand store so the running app can be driven and inspected from the console; it is stripped from production.

No environment variables. `npm run build` produces a fully static `dist/` with zero runtime configuration.

Contributor-facing map of the codebase, its invariants, and task recipes: [AGENTS.md](AGENTS.md).

</details>

## Deploy

Any static host. For Vercel:

```bash
npx vercel --prod
```

Framework preset: Vite. Build command `npm run build`, output directory `dist`. Live at [zucity-aesthetics.vercel.app](https://zucity-aesthetics.vercel.app).

## Tech Stack

| Layer | Choice |
|-------|--------|
| Build | [Vite](https://vite.dev/) |
| UI | [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com/) (core utilities only, no plugins) |
| State | [Zustand](https://zustand.docs.pmnd.rs/) |
| Type outlines | [opentype.js](https://github.com/opentypejs/opentype.js) |
| Rendering | Canvas 2D `Path2D` + `clip()`, and hand-assembled SVG |
| Lint | [oxlint](https://oxc.rs/docs/guide/usage/linter.html) |
| Backend | None |

No canvas library. No image-processing dependency. The render maths is in the repo where you can read it.

## Contributing

Issues and PRs welcome. PRs target `test` first, not `main`.

Before opening a PR, run `npx tsc -b --noEmit`, `npm run build`, and `npx oxlint src`, then drive the change in a browser — there is no test suite to catch you. Read [AGENTS.md](AGENTS.md) first; it states the invariants that a change must not break.

**Contributor License Agreement** — by contributing to MaskLab you grant the maintainer a perpetual, worldwide, irrevocable, royalty-free licence to use, reproduce, modify, distribute, sublicense, and **relicense** your contribution, including under commercial or proprietary terms, without further permission or compensation. You confirm you have the right to grant this. This keeps the dual-license model viable.

## License

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL_v3-ff3b14?style=flat-square)](LICENSE)

MaskLab's source is licensed under the **GNU AGPL v3** — see [LICENSE](LICENSE). If you want to ship MaskLab inside a proprietary product, or run a modified version as a network service without publishing your changes, a commercial license is available; open an issue to ask.

**Bundled fonts are not covered by the AGPL.** The three typefaces in `public/fonts/` are third-party works licensed under the **SIL Open Font License 1.1**, and redistributing this repository redistributes them:

| File | Typeface | Copyright |
|------|----------|-----------|
| `Anton-Regular.ttf` | Anton | © 2020 The Anton Project Authors |
| `ArchivoBlack-Regular.ttf` | Archivo Black | © 2017 The Archivo Black Project Authors |
| `ZenKakuGothicNew-Black.ttf` | Zen Kaku Gothic New | © 2022 The Zen Project Authors |
| `SpaceMono-Regular.ttf`, `SpaceMono-Bold.ttf` | Space Mono | © 2016 The Space Mono Project Authors |

The OFL permits redistribution, bundling, and embedding, including in a commercial product, provided the fonts are not sold on their own and the licence and copyright notices travel with them. It does **not** let you relicense the font files themselves. Attributions and the full licence text ship alongside the fonts in [`public/fonts/LICENSE.txt`](public/fonts/LICENSE.txt) — keep that file with them. Full terms: [scripts.sil.org/OFL](https://scripts.sil.org/OFL). If you fork MaskLab, this obligation forks with you.

---

<div align="center">

**One shape. Many textures.**

[Quick Start](#quick-start) · [How to Use](docs/how-to-use.md) · [Report a Bug](https://github.com/0xjitsu/zucity_aesthetics/issues/new) · [Request a Feature](https://github.com/0xjitsu/zucity_aesthetics/issues/new)

</div>
