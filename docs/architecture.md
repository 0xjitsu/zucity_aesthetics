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

Assets sit **outside** the undo history on purpose: undoing a texture assignment should not also discard the decoded image, which would force a re-decode and leave redo pointing at an asset that no longer exists.

Switching template keeps the look. Region ids differ between templates, so `carryFills()` hands fills across by **paint-order position**: the old template's first region gives its fill to the new one's first, and so on; regions beyond the old count get their defaults. Retyping text uses the same function. The one exception is arriving at the text template from a shape, which starts fresh in ink so a typed word is readable rather than inheriting a yin-yang's halves glyph by glyph.

### Immutability contract

**Templates and regions are never mutated after they are built.** To change a shape, build a new `Template`. Several things rely on that, by object identity:

| Consumer | What it caches or holds |
|---|---|
| `shapeBounds()` in `geometry.ts` | Union bounding box per template (`WeakMap`) |
| `pathOf()` in `render.ts` | One parsed `Path2D` per region (`WeakMap`) |
| `orderOf()` in `render.ts` | Paint-order region array per template (`WeakMap`) |
| History snapshots in `store.ts` | `customTemplate` held by reference, not cloned |

Identity is the only correct key. Ids are not unique over time: every text template is `'text'` and every uploaded SVG is `'custom'`, which is exactly how `shapeBounds()` once returned a ring sized for the previous words. `WeakMap` lets a discarded template's entries be collected with it.

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

The history is up to 30 snapshots of `{ composition, customTemplate, textSpec }`, with a matching redo stack. `composition` and `textSpec` are deep-cloned; `customTemplate` is kept by reference, because templates are immutable and a text template can hold 500 glyph outlines that would otherwise be copied on every push. Any recorded edit clears the redo stack. The interesting part is not the depth, it is **what counts as one step**.

A range input fires `onChange` on every pixel of a drag. Recording each one would push roughly a hundred snapshots for a single zoom drag and flush the entire history, silently destroying every real edit behind it. That is a bug that presents as "undo doesn't work" long after the change that caused it.

So the store exposes two setters and the UI is required to pick correctly:

| Setter | Records? | For |
|---|---|---|
| `updateFill(id, patch)` | No | Continuous: drags, sliders, wheel, pinch |
| `commitFill(id, patch)` | Yes | Discrete: toggles, selects, single key presses |
| `setComposition(patch, record = true)` | Optional | Pass `false` for continuous |

**Continuous controls call `pushHistory()` once per gesture, then use the non-recording setter.** Every continuous surface in the app implements that contract, each in the way its input demands:

- `SliderRow` and `ColorRow` snapshot on `pointerdown`, and on a non-repeating arrow keypress so keyboard dragging behaves the same.
- `Stage.tsx` records on the **first move that changes something**, not on pointer-down. Pointer-down selects and sets a `pending` flag; the first drag move with a non-zero delta calls `recordOnce()`, which pushes history and clears the flag. A pinch follows the same rule, and a pinch that starts inside a running pointer gesture shares that gesture's single entry. A second finger never starts a new pointer gesture, so it cannot change the selection mid-pinch. Wheel events have no natural start or end, so they are coalesced by an idle timer — the first wheel event of a burst snapshots, and the gesture is considered over after 450 ms of quiet.
- `useKeyboard.ts` records the first arrow nudge with `commitFill` and applies auto-repeats with `updateFill`, so one held key is one step.
- `TextPanel.tsx` trailing-debounces spec edits by 250 ms, because installing a rebuilt text template records history and typing a word would otherwise cost one undo step per keystroke.

**A gesture that changes nothing records nothing.** This matters twice over now that redo exists: recording clears the redo stack, so a click that merely selected a region used to cost an undo step *and* throw away everything the user could have redone.

The result is that undo steps correspond to things a person did, not to events the browser emitted.

Text rebuilds carry a second hazard the panel handles: font loading is async and the Japanese face is 2.3 MB, so a slow load can resolve after a newer one was requested. Each rebuild takes a monotonically increasing ticket and discards its own result if a newer rebuild has started, so the canvas always reflects the most recent spec rather than whichever fetch happened to finish last.

Redo is `redo()` in the store, bound to `⇧⌘Z` / `Ctrl+Shift+Z` / `Ctrl+Y`, with Undo and Redo buttons on the stage and in the Output section, because a phone has no keyboard.

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

### Phone layout

Below the `lg` breakpoint (1024 px) the page is one scrolling column. In `App.tsx` the `Stage` and the `InspectorTabs` strip share one wrapper, marked `data-sticky-stage`, that is `position: sticky` at the top, so the canvas, its tool strip and the tabs stay in view while the open panel scrolls beneath. On desktop the wrapper is `lg:contents` and dissolves, so the stage fills its column as before. The canvas box is `44svh` tall rather than `dvh`: the small-viewport unit does not change when the iOS toolbar collapses, so the canvas does not resize mid-scroll. The kaomoji hint under the art is truncated to one line on phones for the same reason — a wrapping line would grow the sticky block.

The tool strip (Undo, Redo, Add photos, Remix) is a flex row under the canvas inside `Stage.tsx`, beside the `Buddy` hint, rather than absolutely positioned over the art.

The tab state (`'shape' | 'regions' | 'look' | 'export'`) lives in `App` and is passed to both `InspectorTabs` and `Inspector`. `Inspector` reads the breakpoint with `useSyncExternalStore` over `matchMedia('(min-width: 1024px)')`:

| Width | What `Inspector` renders |
|---|---|
| Desktop | Every section stacked: Template/Text → Output → Regions → Composition → About |
| Phone | Four `role="tabpanel"` shells; only the active one has children. Inactive shells stay in the DOM, `hidden` and empty, so every tab's `aria-controls` resolves without rendering its controls |

The tabs follow the APG tabs pattern: `role="tablist"` with roving `tabIndex`, and Arrow Left/Right, `Home` and `End` move and select. The active tab is marked by `.tab[aria-selected='true']` in `index.css`.

Selecting a region opens the Regions tab. `App` subscribes to the store directly (`useStore.subscribe`) and calls `setTab('regions')` whenever `selectedId` changes to a new value, so selection itself never re-renders `App`. `RegionList` then brings the selected card (`data-region-card`, looked up with `CSS.escape` because ids come from user files) into view. On desktop that is `scrollIntoView({ block: 'nearest' })`. On a phone `scrollIntoView` would park the card under the sticky stage, so it measures the `data-sticky-stage` wrapper, does nothing if the card is already visible below it, and otherwise scrolls the window by the difference, smoothly unless reduced motion is set.

### Light and dark themes

Colours are raw CSS variables in `src/index.css`, not Tailwind literals, so the palette can change at runtime. `@theme inline` maps each Tailwind colour (`--color-ground`, `--color-ink`, …) to its variable.

| Block | Applies when |
|---|---|
| `:root`, `:root[data-theme='dark']` | The default, and when dark is pinned |
| `@media (prefers-color-scheme: light) { :root:not([data-theme='dark']) }` | The OS is light and the user has not pinned dark |
| `:root[data-theme='light']` | Light is pinned, including on a dark OS |

`ThemeToggle.tsx` in the header is a three-state button: System → Light → Dark. System is the absence of a stored choice and of `data-theme`, so the media query decides and follows the OS live. Light and Dark set `data-theme` on `<html>` and store the choice in `localStorage` under `masklab-theme`. Storage access is wrapped in `try`, because private mode can throw, so a choice that cannot be saved still holds for the page.

Two things in `index.html` keep the first paint right, before any CSS loads:

- A tiny inline script in `<head>` reads `masklab-theme` and sets `data-theme`.
- An inline `<style>` paints the `<html>` background and `color-scheme` for the right theme.

`<body>` has no inline background on purpose. An inline style beats the stylesheet, and it once kept the body dark in the light theme.

The page also carries two `theme-color` metas, one per `prefers-color-scheme`. `ThemeToggle` copies the live `--ground` into both on mount, on each change, and when the OS flips, so the browser bar matches whichever palette is showing.

The light palette is a paper edition of the same identity, not an inversion:

| Token | Light | Token | Light |
|---|---|---|---|
| ground | `#f5f4f1` | muted | `#52525b` |
| panel | `#fbfaf8` | faint | `#62626b` |
| raise | `#eeede8` | accent | `#5b3fd6` |
| ink | `#141416` | hot | `#c81e1e` |

Every text token meets WCAG AA (4.5:1) in both themes. The lowest is about 4.6:1: the faint label on the raised and accent surfaces in dark.

Canvas selection outlines are the same in both themes. They are drawn on the artwork, which does not change with the theme, so they must stay visible against it, not against the page. The static `public/guide.html` is separate: it carries its own small palette and follows the OS setting only.

### Header links

The header's zucity.org and social links (X, Instagram, Substack, in that order) use `.navlink`, a small class in `index.css` for plain text and icon links with a 44 px target. They used `.btn` before, and because `.btn` is unlayered CSS the Tailwind utilities meant to unbox it were ignored, so they rendered as boxed grey buttons.

### Render caching

The draw effect in `Stage.tsx` deliberately has no dependency array and runs on every render, so the per-frame cost of `renderComposition()` matters. Two `WeakMap` caches in `render.ts` remove the repeated work: `pathOf()` parses each region's `d` into a `Path2D` once, and `orderOf()` sorts a template's regions into paint order once. Without them a 500-glyph text template re-parsed ~500 paths and re-sorted them every frame. Both are keyed on object identity and are correct only because of the immutability contract above.

### Keeping drags cheap in React

A drag rewrites `composition.fills` every frame, so what subscribes to it decides how much re-renders. `RegionCard` is memoised, and untouched regions keep their fill object's identity, so only the dragged card re-renders. `RegionList` owns the `fills` subscription instead of the whole `Inspector`; `Controls` subscribes to each composition field separately; `Toolbar` reads the store at click time instead of subscribing.

Below-the-fold inspector sections used to carry `content-visibility: auto` with an intrinsic-size estimate (480 px). It was removed: when a section's real height replaced the estimate, the sections below jumped, pushing About down and adding a 0.06 desktop layout shift. It is also no longer needed, since a phone renders only the active tab and the desktop inspector mounts in a time-sliced transition (see "First load and caching"). The lesson for this app: do not render a hidden panel, rather than rendering it and asking the browser to skip it.

### Accessibility notes

The canvas is `role="img"` with a label naming the template and its region count. The ticker is a focusable "Tips" region that pauses on hover (real pointers only), keyboard focus, a tap, and whenever it is scrolled off-screen. The toast stack is a labelled `role="region"` with `aria-live="polite"`. Hidden file inputs carry labels. In the dark theme the `--color-faint` (#80808b) and `--color-hot` (#ef4444) tokens meet 4.5:1 on the ground, panel and raise surfaces (lowest: 4.62, faint on raise). The light theme is held to the same bar; see "Light and dark themes" above.

---

## First load and caching

The first visit is dressed, not blank. `useStarterLook()` in `App.tsx` calls `loadStarterAssets()`, which shuffles the five bundled textures in `public/textures/`, fetches **only the chosen pair** in parallel, and dresses the default yin-yang as soon as those two arrive. The other three stream in behind and join the Remix deck. Starters go through the same ingest pipeline as an upload, so they behave identically downstream. The dressing applies its fills with `updateFill`, so it records **no undo entry**, and it only touches a pristine session (no history, no assets, every fill still a flat colour). A failed fetch degrades quietly to flat colour.

### Stage first, inspector in a transition

The stage paints before the controls. `App` holds a `ready` flag that starts `false`; while it is false, `Inspector` renders only its `<aside>` shell, which reserves the column on desktop and `min-h-[50svh]` on a phone, so nothing shifts when the controls arrive. Right after mount, `App` flips `ready` inside `startTransition`, and React renders the inspector as interruptible, time-sliced work instead of one long boot task that blocks the first frame.

The flip is scheduled twice: by `requestAnimationFrame`, and by a 120 ms `setTimeout` as a backstop. The timeout exists because **a background tab never fires `requestAnimationFrame`**. A page opened in a background tab would otherwise sit with an empty inspector until the user switched to it. Whichever fires first sets `ready`; the second is a no-op. Both are cancelled in the effect cleanup, which is safe under `StrictMode`: the re-run schedules again.

On a phone only the active tab panel renders (see "Phone layout" above), so the first paint builds one panel's controls, not four.

### Text code loads on demand

The typesetter is not in the main bundle. `TextPanel` is a `React.lazy` import in `Inspector.tsx`, rendered under `Suspense` with a "loading the typesetter…" fallback, and the press on **Text** in the template picker `await import('../lib/textTemplate')` before it typesets. A chunk that fails to load (offline, or a stale tab after a deploy) resolves to a short message saying so and that the canvas still shows the last typeset text, rather than an unhandled rejection that would take down the app. `textTemplate.ts` in turn dynamically imports opentype.js. Together this took the main bundle from 89.1 to 85.5 kB gzipped.

### Images decode off the main thread

`loadImage()` in `lib/imageCache.ts` sets `img.src` and awaits `img.decode()` before caching the element. With a plain `onload`, the first `drawImage` of each texture decoded synchronously on the main thread, inside the first-paint long task. A failed decode still rejects with `Could not decode <name>`, and in-flight loads are still shared per asset id.

### Fonts

The UI font, Space Mono, is preloaded from `index.html` as `woff2`, with the `.ttf` as a CSS fallback. `@font-face` uses absolute `/fonts/…` URLs: a relative `url()` resolves against the built stylesheet in `/assets/`, which is how the font 404'd in production before. The typesetter's built-in fonts are fetched from JavaScript and use relative `./fonts/…` URLs, which resolve against the page and are correct.

### Caching

`vercel.json` sets cache headers and nothing else:

| Path | Cache-Control | Why |
|---|---|---|
| `/assets/*` | `public, max-age=31536000, immutable` | Vite fingerprints these; a new build means a new name |
| `/fonts/*`, `/textures/*` | `public, max-age=2592000, stale-while-revalidate=86400` | Stable names, so 30 days rather than forever |
| Icons, `manifest.webmanifest` | `public, max-age=86400` | Change rarely, but must be able to change |
| `og.png`, `robots.txt`, `sitemap.xml`, the IndexNow key file (`[0-9a-f]{32}.txt`) | `public, max-age=86400` | Same: stable names that must be able to change. See [seo.md](seo.md) |
| `/` (`index.html`) | No rule; Vercel's default revalidates on each request | It names the current hashed assets |

Only fingerprinted files may be immutable. There is a PWA manifest and icons for installability but no service worker, on purpose: installing should not bring a stale-cache risk.

---

## What is deliberately absent

- **No backend.** No account, no upload, no telemetry. Every byte stays in the tab.
- **No canvas or image-processing library.** The render maths is in the repository, readable, and about two hundred lines.
- **No test suite.** Verification is done by driving the running app and measuring output — including the measurements in this document. A dev-only `window.__masklab` handle exposes the store so the app can be driven from a console or automation tool; it is stripped from production builds.
- **No persistence of your work.** No autosave. A refresh loses the composition; the JSON export is the save file. The one thing stored in the browser is the theme choice (`masklab-theme` in `localStorage`).
