# Architecture

How MaskLab is put together, and why it is put together that way. For the rules a change has to respect, see [AGENTS.md](../AGENTS.md); for using the app, [how-to-use.md](how-to-use.md).

---

## The shape of the problem

MaskLab has to do one thing well: take a shape made of several regions, put a different texture in each region, and get the result out of the browser in two formats that agree with each other.

The second half is the hard part. A raster export and a vector export are produced by completely different machinery — Canvas 2D on one side, an SVG document on the other. Any time both sides have to independently compute *where a texture sits*, they will eventually disagree, and the disagreement shows up as an export that does not match the screen. That failure is quiet, cumulative, and only visible if someone happens to compare the two files.

Most of the structure below exists to make that class of bug impossible rather than merely unlikely.

---

## Data flow: file to pixels

```
  image file
      │
      ▼
  lib/ingest.ts ──────────────▶ Asset { id, mime, dataUrl, width, height }
      decode, EXIF-orient,          (base64, so exports are self-contained)
      downscale, re-encode
                                         │
                                         │
  ┌─── templates/*.ts        ────┐       │
  │    lib/svgImport.ts (SVG)    │       │
  │    lib/textTemplate.ts (text)│       │
  └──────────────┬───────────────┘       │
                 ▼                       │
        Template { viewBox, regions[] }  │
        every region carries `d`         │
                 │                       │
                 └────────┬──────────────┘
                          ▼
                      store.ts
              Composition { one Fill per region,
              background, rotation, grain, ring,
              exportSize, transparentBackground }
                          │
          ┌───────────────┴────────────────┐
          ▼                                ▼
  lib/render.ts                     lib/svgExport.ts
  renderComposition()               buildSvg()
          │                                │
   ┌──────┴───────┐                        │
   ▼              ▼                        ▼
live editor   PNG export              SVG export
(Stage.tsx)   (pngExport.ts)         lib/fileIo.ts → JSON save
```

### Three shape sources, one type

The most important structural decision is that **there is only one kind of shape**. A `Region` is an id, a name, an optional hint, SVG path data in `d`, a default fill, and a paint order. That is all.

Built-in templates are hand-authored path data. `lib/svgImport.ts` lowers every SVG primitive it finds — `circle`, `ellipse`, `rect`, `polygon`, `polyline` — into path data before anything else sees it. `lib/textTemplate.ts` runs glyph outlines through opentype.js and emits path data too.

The payoff is that everything downstream is written once. Canvas clipping, `isPointInPath` hit-testing, the SVG `clipPath` per region, the ring, undo, the region cards, keyboard selection — none of them know that text exists. There is no `fillText` call, no `<text>` element, and no `kind` discriminator on `Region`. Adding text to this app required no changes to the renderer at all, which is the clearest evidence the abstraction is placed correctly.

The cost is that text is not re-editable *as text* from the geometry alone, which is why `TextSpec` is carried alongside the generated template rather than derived from it.

### Ingest

`lib/ingest.ts` is the only way an image enters. It tries `createImageBitmap` first — the fast path, and the one that honours EXIF orientation consistently — and falls back to an `<img>` decode when a browser refuses a container through it. SVG textures take a separate path and are rasterised generously (at least 2048 px) because the user can scale a fill well past 1× and a small raster falls apart there.

Two policies worth knowing:

- **Original bytes are preserved when possible.** If the image is under 8 MB and does not need downscaling, its original encoding goes into the `dataUrl` untouched — whatever the source encoder did, it did better than a re-encode would. Touching the pixels costs a re-encode, which is WebP at quality 0.92 where available and PNG otherwise, sniffed rather than assumed.
- **Nothing fails silently.** Ingest never throws for a batch. Each bad file becomes an `IngestFailure` carrying the file name and a specific reason, and the caller raises one notice per failure while keeping the good files. HEIC gets an actionable message rather than a generic rejection, because "unsupported" is not something a user can act on.

Assets are stored as base64 data URLs rather than object URLs specifically so the SVG and JSON exports are self-contained — a saved look has to reproduce on a machine that has never seen the source images.

### State and the two setters

`store.ts` is a single Zustand store holding the composition, the asset library, the generated template (if any), the text spec (if any), fonts, selection, toasts, and history.

Assets sit **outside** the undo history on purpose: undoing a texture assignment should not also discard the decoded image, which would force a re-decode and, worse, make redo impossible to implement correctly later.

---

## The parity contract

Both renderers ask **one function** where a texture goes:

```ts
// src/lib/geometry.ts
export function fillTransform(fill: Fill, asset: Asset, vb: ViewBox): FillTransform
```

It returns the cover-fit scale (`max(vb.w / asset.width, vb.h / asset.height) * fill.scale`), the image centre after the user's offset, the drawn size, the rotation, and the flips as ±1 scale factors. Both renderers then emit the same ordered chain:

```
translate(cx, cy) → rotate(rotation) → scale(flipX, flipY) → draw centred at (-dw/2, -dh/2)
```

Canvas does it with `ctx.translate` / `ctx.rotate` / `ctx.scale` / `drawImage`. SVG does it with a `transform` attribute and an `<image>` positioned at `(-dw/2, -dh/2)`. Different syntax, same numbers, from the same call.

**This is structural, not procedural.** The distinction matters. A checklist — "remember to update the SVG exporter when you change the canvas renderer" — is a process that depends on a person remembering, and it fails the first time someone is in a hurry or unfamiliar with the codebase. Routing both through one function means the two outputs *cannot* drift apart unless `geometry.ts` changes underneath both of them simultaneously, which is exactly the change where you would look at both.

The same reasoning is applied one level up: the live editor and the PNG exporter do not merely agree, they call the **same function**, `renderComposition()`. There is no "preview quality" path. What you see on the canvas is literally the code that produces the file you download, differing only in the pixel size it is handed and a `forExport` flag that drops the background plate when `transparentBackground` is set.

Offsets are stored in **template viewBox units**, not pixels, which is what makes a composition resolution-independent: the same numbers produce the same picture at a 640 px preview and a 4096 px export.

### Framing is shared too

Placement within a region is only half of it. The output is always **square**, but a viewBox need not be — a line of horizontal text is a wide, short box, and an uploaded artboard can be any proportion. If the canvas and the SVG each decided how to fit a non-square viewBox into a square output, they would disagree about framing even while agreeing perfectly about every texture inside it.

So framing goes through `geometry.ts` as well:

- `fitToSquare(vb, size)` returns the contain-fit scale and the centring offsets the canvas applies.
- `outputSquare(vb)` returns the square region of viewBox space the output actually covers — used for the background plate and for the SVG root viewBox.

Both deliberately reproduce SVG's default `xMidYMid meet`: scale to fit the larger dimension, centre the remainder. Measured on pinned templates rasterised at 800 × 800, the two outputs produce identical ink bounding boxes in every proportion:

| viewBox | Canvas / PNG | SVG export |
|---|---|---|
| `[0, 0, 200, 50]` wide | `x 0–799, y 300–499` | `x 0–799, y 300–499` |
| `[0, 0, 50, 200]` tall | `x 300–499, y 0–799` | `x 300–499, y 0–799` |
| `[0, 0, 12, 12]` square | `x 67–732, y 67–732` | `x 67–732, y 67–732` |

### Where parity genuinely breaks

Exactly one place, documented here rather than smoothed over, because a parity guarantee with undisclosed exceptions is worse than no guarantee.

#### Film grain — different generators, by design

The canvas paints grain from a **seeded 256 px noise tile**, generated once with a linear congruential generator so re-renders and exports agree with each other, then tiled at a scale derived from the output size so a 640 px preview and a 2000 px export show the same grain *structure* rather than the same pixel count.

The SVG uses **`feTurbulence`**, because a vector document should not carry a megabyte of raster noise. Its `baseFrequency` is matched to the tile's texel density so the grain reads at the same scale, and the opacity is computed identically — but fractal noise and a seeded LCG are different generators, and the individual pixels will never agree.

So: same scale, same strength, different pixels. **Grain is the single element that is not pixel-identical between the PNG and SVG exports.** The generated SVG carries a comment saying so, in the document itself, rather than leaving someone to discover it by diffing.

There is a second-order consequence worth knowing. An `overlay` blend still paints where nothing is beneath it, so on a transparent-background export the grain would haze the empty corners — a "transparent" PNG came out with alpha in the background. Both renderers now correct for this, and they do it differently: the canvas snapshots the alpha before the grain lands and masks it back afterwards with `destination-in`; the SVG clips its grain overlay to the region paths. Same intent, different mechanism, because the two media offer different tools.

The SVG exporter reserves its `<defs>` slot and fills it after the body is built, so a clip path added while building the body still reaches the document. That ordering was wrong once, and the symptom was a transparent-background grain export referencing `url(#masklab-shape)` without defining it.

---

## Undo and the gesture model

The history is 30 snapshots of `{ composition, customTemplate, textSpec }`, deep-cloned. The interesting part is not the depth, it is **what counts as one step**.

A range input fires `onChange` on every pixel of a drag. Recording each one would push roughly a hundred snapshots for a single zoom drag and flush the entire history, silently destroying every real edit behind it. That is a bug that presents as "undo doesn't work" long after the change that caused it.

So the store exposes two setters and the UI is required to pick correctly:

| Setter | Records? | For |
|---|---|---|
| `updateFill(id, patch)` | No | Continuous: drags, sliders, wheel, pinch |
| `commitFill(id, patch)` | Yes | Discrete: toggles, selects, single key presses |
| `setComposition(patch, record = true)` | Optional | Pass `false` for continuous |

**Continuous controls call `pushHistory()` once at gesture start, then use the non-recording setter.** Every continuous surface in the app implements that contract, each in the way its input demands:

- `SliderRow` and `ColorRow` snapshot on `pointerdown`, and on a non-repeating arrow keypress so keyboard dragging behaves the same.
- `Stage.tsx` snapshots on pointer-down and pinch-start. Wheel events have no natural start or end, so they are coalesced by an idle timer — the first wheel event of a burst snapshots, and the gesture is considered over after 450 ms of quiet.
- `TextPanel.tsx` trailing-debounces spec edits by 250 ms, because installing a rebuilt text template records history and typing a word would otherwise cost one undo step per keystroke.

The result is that undo steps correspond to things a person did, not to events the browser emitted.

Text rebuilds carry a second hazard the panel handles: font loading is async and the Japanese face is 2.3 MB, so a slow load can resolve after a newer one was requested. Each rebuild takes a monotonically increasing ticket and discards its own result if a newer rebuild has started, so the canvas always reflects the most recent spec rather than whichever fetch happened to finish last.

There is currently **no redo**. The store maintains a `future` array and `undo()` pushes onto it, but nothing reads it — no action, no shortcut. Keeping assets outside the history is what would make redo implementable, but it is not implemented.

---

## Text as a template

`lib/textTemplate.ts` is the newest shape source and the clearest demonstration of the `Region.d` abstraction.

**Coordinate policy.** opentype.js stores outlines y-up in font units, but `Glyph.getPath()` emits SVG-space commands (y-down), so a glyph's ink sits at negative y relative to its baseline. The module lays out with the first baseline at `y = 0` and lets the tight ink bounding box become the viewBox, so the absolute origin never matters — only relative spacing does. Two `toPathData` defaults have to be overridden: `flipY` defaults to true and would mirror every glyph about its own box, and `optimize` defaults to true with a tolerance of one output unit, which is about 1% of the em here rather than the sub-pixel it assumes.

**Horizontal layout** measures every line before placing anything, because alignment needs the widest line first. It advances by the glyph's own `advanceWidth`, applies kerning between pairs, and adds the user's tracking.

**Vertical layout** is the CJK setting: glyphs stack downward within a column and columns advance leftwards, so the first column sits on the right. Two deliberate differences from horizontal — the vertical advance comes from the **em box** rather than the glyph's own width, so a narrow kana and a wide kanji occupy the same slot and the column stays rhythmic; and kerning is skipped, being a horizontal-only concept. Each glyph is centred on its column axis. The share of the em above the baseline is taken from the font's OS/2 typo metrics, which for a CJK face span exactly one em and give the ideographic baseline that vertical stacking wants.

**Splitting** decides how many regions come out: one per glyph (the general case), one per line, or one for the whole run. `line` and `all` simply concatenate the path data of their members into a single `d`, which works because a region is just path data — no special casing required.

**Failure surface.** The one failure a user cannot diagnose is a row of `.notdef` boxes, so the module refuses up front: every non-whitespace character is checked against the font, and missing characters are named in the error along with advice (pointing at the bundled Japanese face when the missing characters are CJK). Whitespace advances the pen but never becomes a region, or the inspector would fill with phantom entries nobody can select. Text is capped at 500 glyphs because every region is a separate clip-and-draw per frame.

Fonts are cached by id as a **promise**, so two concurrent requests for the 2.3 MB face share one fetch and one parse; a failure evicts itself so a retry is possible. opentype.js itself is dynamically imported to keep roughly 250 kB out of the initial bundle. An uploaded font is parsed at upload time — so a broken file fails at the moment the user picks it, not later in the middle of a layout — and the parsed result is handed straight to the cache.

---

## Exports

Four outputs, one input shape (`ExportInput = { template, composition, assets }`).

| Export | Path | Notes |
|---|---|---|
| **PNG** | `renderComposition()` into an offscreen canvas → `toBlob` | Awaits `ensureImages()` first; a half-decoded asset would silently degrade to its flat colour. Size clamped to 600–4096. |
| **SVG** | `buildSvg()` assembles the document by hand | One `<clipPath>` per region; images embedded as data URLs; transforms from `fillTransform`. |
| **JSON** | `exportJson()` | The save format. Composition plus every *referenced* asset, plus a generated template and text spec when present. |
| **Clipboard** | `renderToBlob()` → `ClipboardItem` | Two write attempts: Safari wants the item built synchronously from a pending promise so the write stays attributable to the click; older Chromium wants a settled blob. Tried in that order rather than sniffing user agents. |

The SVG exporter has two details worth noting. Region ids come from user-supplied files, so they are sanitised before becoming fragment ids and every attribute is escaped. And canvas composite operations and CSS blend modes share every name except the default, so `source-over` maps to `normal` and any canvas-only operator degrades to `normal` rather than emitting an invalid style — currently latent, since the exposed blend list contains no canvas-only operators.

`exportJson` embeds only assets actually referenced by a fill, and only *uploaded* fonts — built-in faces ship with the app, so re-embedding a 2.3 MB face in every saved look would be waste.

`importJson()` reads `textSpec` and `fonts` back out and validates them, so reopening a saved text look restores the artwork, its fills, and the re-editable run. A writer, a reader and a validator living in three files is the shape that loses a field silently — adding one to `MaskLabFile` means changing all three.

---

## Rendering and interaction

The stage is a single `<canvas>`. It is sized **square by CSS** and JavaScript only reads that size through a `ResizeObserver`; an earlier version measured a box whose height it also set, which is a feedback loop and produced a non-square canvas on narrow viewports. Device pixel ratio is capped at 2 — beyond that the memory cost outruns the visible benefit.

Hit-testing uses `isPointInPath` against `Path2D` objects in viewBox units, walking paint order backwards so the topmost region wins. Pointer coordinates are mapped back through `pointToViewBox()`, which also undoes the global rotation; drag deltas go through `deltaToViewBox()`, which rotates without translating. Because both work in viewBox units, a drag moves a texture by the same amount regardless of the canvas's pixel size.

Wheel handling is bound directly to the element rather than through React's synthetic system, because `preventDefault()` requires a non-passive listener and React cannot guarantee that.

---

## What is deliberately absent

- **No backend.** No account, no upload, no telemetry. Every byte stays in the tab.
- **No canvas or image-processing library.** The render maths is in the repository, readable, and about two hundred lines.
- **No test suite.** Verification is done by driving the running app and measuring output — including the measurements in this document. A dev-only `window.__masklab` handle exposes the store so the app can be driven from a console or automation tool; it is stripped from production builds.
- **No persistence.** No autosave, no local storage. A refresh loses the composition; the JSON export is the save file.
