# AGENTS.md — MaskLab

## Orientation

MaskLab is a client-only React + TypeScript app that fills the individual regions of a vector shape with different user-supplied textures, live, and exports the result as PNG, SVG, or a JSON save file. Shapes come from three places — built-in templates, an uploaded SVG, and typed text — but all three converge on one type, `Template`, whose regions carry SVG path data.

**The single sentence that most constrains changes here:** the canvas renderer and the SVG exporter must produce the same picture, and they stay in agreement only because they both derive their transform from one function rather than each computing it — so any change that re-derives placement, or introduces a third renderer, breaks the guarantee the whole app is built on.

There is no backend, no router, no test suite, and no environment configuration.

**There is no `llms.txt`, on purpose.** No search engine or AI crawler consumes it, so it is not shipped; do not re-add it. Agent-readiness comes from this file, semantic HTML with correct accessible names, the JSON-LD `@graph` in `index.html`, and the crawlable HTML inside `#root`. Search and AI visibility (including the static `public/guide.html` answer page), and the rules for changing site copy, are in [docs/seo.md](docs/seo.md).

---

## The invariants

Break one of these and the failure is silent — a drifting export, a flushed undo history, or a `$0`-shaped lie on screen. Each rule has its reason attached, because the reason is what tells you whether your change is an exception.

### 1. `fillTransform()` is the only place texture placement is computed

`src/lib/geometry.ts` exports `fillTransform(fill, asset, viewBox)`. It returns the cover-fit scale, the centre after the user's offset, the drawn size, the rotation, and the flips. Both `lib/render.ts` and `lib/svgExport.ts` read it and emit the same ordered chain:

```
translate(cx, cy) → rotate(rotation) → scale(flipX, flipY) → draw centred at (-dw/2, -dh/2)
```

**Never re-derive the cover maths by hand in a second renderer**, and never "just inline" it because the call is inconvenient in your context. PNG/SVG parity is a property of this single-source arrangement, not something a reviewer re-checks by eye after every change. If you need placement in a new output format, call `fillTransform` and translate its result into that format's transform syntax — do not recompute it.

The same reasoning covers `renderComposition()` in `lib/render.ts`: the live editor and the PNG exporter call the *same* function, so what a user sees is literally the code path they download. Do not fork it into an "editor version" and an "export version". The only sanctioned difference is the `forExport` flag, which exists solely so `transparentBackground` drops the plate on export while the editor still shows a backdrop.

Two sibling helpers in `geometry.ts` extend the same discipline to **framing**, and matter because the output is always square while a viewBox need not be — text templates are wide, uploaded artboards can be anything:

- `fitToSquare(vb, size)` — the contain-fit (scale plus centring offsets) the canvas uses.
- `outputSquare(vb)` — the square region of viewBox space the output actually covers, used for the background plate and for the SVG root viewBox.

Both renderers must frame through these rather than scaling by `size / vb.w` or emitting the raw viewBox. They deliberately reproduce SVG's default `xMidYMid meet`, which is what keeps a non-square template's PNG and SVG identical. Verified: wide `[0,0,200,50]`, tall `[0,0,50,200]`, and square `[0,0,12,12]` templates all produce byte-identical ink bounding boxes across the two outputs.

### 2. `Region.d` is the only shape interface

A `Region` is an id, a name, an optional hint, **SVG path data**, a default fill, and a paint order. That is the entire contract. Everything downstream — canvas `clip()`, `isPointInPath` hit-testing, the SVG `clipPath`, the ring, undo — operates on path data and knows nothing else.

**Anything that wants to be fillable must lower itself to path data.** This is exactly how text works: `lib/textTemplate.ts` converts glyph outlines to path strings via opentype.js and emits ordinary `Region`s. There is no `fillText`, no `<text>` element, and no `kind: 'text'` anywhere in the renderer.

**Do not add a parallel region kind.** If you are tempted to add `Region.text` or `Region.circle` or a `kind` discriminator so a renderer can branch, stop: you would be introducing a second code path that the SVG exporter, the hit-tester, and the ring all have to learn about independently, which is how the two outputs drift apart. Lower your new shape source to `d` and everything downstream works for free. `lib/svgImport.ts` follows the same discipline — every SVG primitive (`circle`, `rect`, `polygon`, …) is lowered to path data before anything else touches it.

### 3. Continuous controls snapshot once per gesture

`store.ts` keeps a 30-step history with undo and redo. Any recorded edit clears the redo stack. Two setters exist deliberately:

| Setter | Records history? | Use for |
|---|---|---|
| `updateFill(id, patch)` | No | Continuous edits — drags, sliders, wheel |
| `commitFill(id, patch)` | Yes | Discrete edits — toggles, selects, single presses |
| `setComposition(patch, record = true)` | Optional | Pass `false` for continuous |

A range input fires `onChange` on every pixel of a drag. If each one recorded, a single zoom drag would push ~100 snapshots and flush the entire 30-step history, destroying every real edit behind it. So **continuous controls call `pushHistory()` once per gesture and then use the non-recording setter.**

**A gesture that changes nothing records nothing.** Recording also clears redo, so a plain click that only selects a region must not cost an undo step or throw away the redo stack.

The gesture hooks already exist — reuse them rather than inventing a new pattern:

- `useGestureStart()` in `components/Controls.tsx` (`onPointerDown`, plus `onKeyDown` for non-repeat arrow keys) is wired into `SliderRow` and `ColorRow`. A slider built from those primitives is already correct; its `onChange` **must not** record.
- `Stage.tsx` sets a `pending` flag on pointer-down and calls `pushHistory()` (via `recordOnce()`) on the first move that actually changes the fill. A pinch follows the same rule: touch-start sets `pending` (unless a pointer gesture is already running, in which case it shares that gesture's single entry), and the first pinch move records. A second finger never starts a new pointer gesture, so it never changes the selection. Wheel events coalesce through `beginGesture()` with a 450 ms idle window.
- `useKeyboard.ts`: an arrow nudge records on the first press (`commitFill`) and uses `updateFill` for auto-repeats, so one held arrow key is one undo step.
- `TextPanel.tsx` trailing-debounces spec changes by 250 ms, because `setTextTemplate` records history and an undebounced rebuild has the same history-flushing problem.

Assets are deliberately **outside** the history: undoing a texture assignment must not also discard the decoded image.

The first-visit starter look (`useStarterLook()` in `App.tsx`) applies its fills with `updateFill` and records nothing, so undo at boot never steps back to a blank canvas. It only dresses a pristine session.

### 4. Templates and regions are immutable once built

Never mutate a `Template` or a `Region` in place. To change a shape, build a new object. Four things rely on object identity:

- `shapeBounds()` in `lib/geometry.ts` caches bounds in a `WeakMap` keyed on the template.
- `pathOf()` in `lib/render.ts` caches one `Path2D` per region; `orderOf()` caches the paint-order array per template.
- History snapshots hold `customTemplate` **by reference**, not a deep clone.

A mutated template keeps its old cached paths, bounds and order, and silently rewrites every undo snapshot that points at it. Ids are not a substitute key: every text template is `'text'` and every uploaded SVG is `'custom'`.

### 5. Producers must not silently emit zero or empty where data is missing

When a value is absent, say so. Do not substitute `0`, `''`, `[]`, or a hidden section, because a fallback renders forever without anyone noticing the producer stopped emitting.

The codebase already holds this line and you should match it:

- `lib/ingest.ts` never throws away a bad file quietly. Every rejection becomes an `IngestFailure` naming the file and the reason, and the UI raises one toast per bad file while keeping the good ones.
- `RegionCard.tsx` distinguishes "flat colour", "no fill data for this region yet", and "image missing — the asset it points to is not in this document". It does not render an empty swatch for all three.
- `TextPanel.tsx` shows "Text not rebuilt" with the reason and states that the canvas is still showing the last run that worked, rather than blanking the stage.
- `textTemplate.ts` refuses text the font cannot draw (`assertCovered`) instead of rendering a row of `.notdef` boxes, because a row of boxes is the one failure a user cannot diagnose.

If you add a control or a readout, give it an explicit missing state. A conditional that hides the section is worse than a visible error, because the regression becomes invisible.

### 6. Region ids from user files are untrusted

Ids in an uploaded SVG are attacker- or exporter-controlled. `svgExport.ts` sanitises them through `clipId()` before they become fragment ids, and escapes every attribute value with `esc()`. Keep that up in any new serialiser.

---

## Task recipes

### To add a template

1. Create `src/templates/myShape.ts` exporting a `Template`: `id`, `name`, `viewBox` as `[minX, minY, w, h]`, and `regions[]`. Give every region an `id`, `name`, `d`, `defaultFill`, and ascending `z`. A `hint` is optional but shows in the region card.
2. Register it in `src/templates/index.ts`: import it and add it to the `TEMPLATES` array.
3. Nothing else. The template picker, region list, keyboard selection, and all four exports read region count, names, and paint order from the data.

Keep the viewBox **square** unless you have read the non-square caveat below. All four built-ins use `[0, 0, 12, 12]`. Regions should be closed subpaths — an open path is not reliably fillable.

If you generate paths programmatically, look at `triskelion.ts` first: it documents why it rounds to six decimals rather than the usual three, because a shortened arc chord makes SVG trim the sweep and the error grows as its square root.

### To add an export format

1. Add `src/lib/myExport.ts`. Take `ExportInput` (`{ template, composition, assets }`) from `lib/pngExport.ts` — it is the shared shape for all export paths.
2. **Get placement from `fillTransform()`** (invariant 1) and iterate regions via `sortedRegions(template)` so paint order matches every other output.
3. Honour `composition.transparentBackground` (skip the background plate), `globalRotation` (applied about the viewBox centre, before regions are painted, with the ring riding along), `ringWidth`/`ringColor` via `ringGeometry()`, and `grain`.
4. Clamp any pixel size through `exportEdge(composition, override?)` — it guards a corrupted or hand-edited `exportSize` and clamps to 600–4096.
5. Hand the result to `downloadBlob(blob, filename)` in `lib/fileIo.ts`. Do not build your own object-URL plumbing; that function revokes on a timer because Safari reads the URL asynchronously and revoking immediately yields a zero-byte download.
6. Wire a button into `components/Toolbar.tsx`. Add your job to the `Job` union and `JOB_LABEL`, and run it through the existing `run()` helper so failures become toasts and the buttons disable while it works.

Raster formats should go through `renderToBlob()` rather than re-rendering, and must `await ensureImages()` first — a half-decoded asset silently degrades to its flat colour.

### To add a per-region control

1. Add the field to `Fill` in `src/types.ts` and give it a value in `defaultFill()` in `src/store.ts`. Both are required: a `Fill` missing your field will render as `undefined` downstream.
2. Consume it in **both** renderers — `lib/render.ts` and `lib/svgExport.ts` — in the same order relative to the existing transform chain. A control honoured in only one is a parity break.
3. Add the UI in `components/RegionCard.tsx`. Use `SliderRow` / `ColorRow` from `components/Controls.tsx` for continuous values and wire them to `updateFill` (**not** `commitFill` — the row already snapshots history, see invariant 3). Use `commitFill` for discrete controls such as toggles and selects.
4. Consider `randomize()` and `applyFillToAll()` in the store. `applyFillToAll` spreads the whole `Fill` object and needs no change; `randomize()` names fields explicitly and will ignore yours unless you add it.
5. Old JSON files will not contain your field. `importJson` validates shallowly and does not migrate, so read it defensively or bump the file `version` and handle both.

### To support another image format

Most of the work is already done: `lib/ingest.ts` accepts **any** `image/*` MIME and lets the browser's decoder have the final say. A format the browser can decode generally already works.

- If files arrive with an empty `file.type` (some OS/browser combinations), add the extension to `EXT_MIME`. That map is a fallback for typeless files, **not** an allowlist — do not turn it into one.
- If the format needs a decoder the browser lacks, add the branch in `ingestFile()` next to the existing SVG branch, and produce an `Asset` with real `width`/`height` and a self-contained `dataUrl`. Assets must be base64 so the SVG and JSON exports stay portable.
- Give failures a specific, actionable `IngestError` message. HEIC is the model: it names what to do ("Safari can open HEIC directly; on other browsers convert to JPG first") rather than saying "unsupported".
- Respect `MAX_EDGE` (4096) so a 50 MP drop does not sit in memory all session, and set `downscaledFrom` when you shrink and `animatedSource` when you keep only frame 1.

### To add a built-in font

Drop the file in `public/fonts/` and add an entry to `BUILTIN_FONTS` in `src/lib/textTemplate.ts` with an `id`, `name`, `source: 'builtin'`, a **relative** `url` (`./fonts/…`, because `vite.config.ts` sets `base: './'`), and an honest `coverage` string — the UI shows it next to the name and uses it to warn about CJK/Latin mismatches. **Any font you add must be redistributable, and its licence obligations become the repository's** (see the OFL note in the README).

### To change copy on the site

The words about MaskLab live in two places that must say the same thing: the fallback HTML inside `<div id="root">` in `index.html` (what crawlers that do not run JavaScript read) and `src/components/About.tsx` (what people see). Change both in the same commit. Title and description rules, and what to update when the domain changes, are in [docs/seo.md](docs/seo.md).

`public/guide.html` repeats its answers in JSON-LD (FAQPage and HowTo). **Each structured-data answer must match its visible text word for word.** To change an answer, change the visible `<p>` or `<li>` and its JSON-LD twin in the same commit. Never edit one alone.

---

## File map

| File | What it owns |
|---|---|
| `index.html` | Title, description, canonical, Open Graph and Twitter tags, PWA and icon links, Space Mono `woff2` preloads, the JSON-LD `@graph` (Organization, WebSite, WebApplication), the crawlable fallback HTML inside `#root` that must match `About.tsx` (see [docs/seo.md](docs/seo.md)), and the theme boot code in `<head>`: an inline script that applies the stored `masklab-theme` choice and an inline `<style>` that paints the `<html>` background for the right theme before the CSS loads. `<body>` carries no inline background, on purpose |
| `vercel.json` | Cache-Control headers only (see "Caching" below) |
| `public/manifest.webmanifest` | PWA manifest: standalone display, icons. No service worker, on purpose |
| `public/og.png` | 1200 × 630 social preview image named by `og:image` and `twitter:image`. A static asset; no script in the repo generates it |
| `public/robots.txt` | Allows all crawlers, names the search and AI crawlers explicitly, and points at the sitemap |
| `public/sitemap.xml` | Two URLs (the root and `/guide.html`), each with a hand-written `lastmod` |
| `public/guide.html` | Static, no-JavaScript answer page at `/guide.html`: eight question headings, numbered steps for the how-tos, and JSON-LD (FAQPage, HowTo, BreadcrumbList) that points at the `@id`s in `index.html`. Visible text and JSON-LD must match word for word. Follows the OS light/dark setting only; it has no toggle |
| `public/3e7a11ffb764d796ce88a0d7894582cf.txt` | IndexNow key file. Its name and contents are the key in `scripts/indexnow.mjs`; never delete or rename it |
| `scripts/indexnow.mjs` | Pings IndexNow with the root URL and `/guide.html`. Run `node scripts/indexnow.mjs` after every production deploy; it refuses to run until the key file is live |
| `docs/seo.md` | What ships for search and AI visibility, owner-only off-site actions, and agent rules for changing copy |
| `public/textures/` | Five bundled starter textures (`.webp`) that dress the first visit |
| `public/fonts/` | Bundled OFL fonts, `.ttf` for the typesetter plus `woff2` copies of Space Mono for the UI, and `LICENSE.txt` |
| `src/main.tsx` | React root, `StrictMode` mount |
| `src/App.tsx` | Layout shell, header with the zucity.org and social links (X → Instagram → Substack) and the theme toggle, skip link, the first-visit starter look, the phone tab state and the selection→Regions subscription, the `ready` flag that mounts the inspector in a transition, the sticky `data-sticky-stage` wrapper around Stage and `InspectorTabs`, installs keyboard hook |
| `src/index.css` | The colour tokens as raw CSS variables (dark on `:root`, light under `prefers-color-scheme` and `[data-theme='light']`), the `@theme inline` block that points Tailwind at them, `@font-face`, and the unlayered `.btn` / `.navlink` / `.tab` / `.label` / `.num` / `.panel` / `.checkerboard` / `.ticker` classes |
| `src/types.ts` | The whole data model: `Region`, `Template`, `Fill`, `Asset`, `Composition`, `TextSpec`, `FontAsset`, `MaskLabFile`, `BLEND_MODES` |
| `src/opentype-js.d.ts` | Ambient declarations for opentype.js v2 — the package ships no types and the DefinitelyTyped package describes the 1.x API. Must stay a standalone `.d.ts`: a `declare module` inside a file that has its own imports is treated as module *augmentation*, not an ambient declaration, and would not satisfy the import. |
| `src/store.ts` | Zustand state, 30-step undo and redo, the gesture/history contract, `carryFills()` (fills follow paint-order position across a template switch), `randomize()` (Remix), toasts, dev-only `window.__masklab` |
| `src/hooks/useKeyboard.ts` | Global shortcuts, including undo/redo; inert while a form control has focus |
| `src/lib/starterTextures.ts` | `loadStarterAssets()` (the visit's pair first, the other three streamed), `starterLook()`, `dress()` |
| `src/lib/geometry.ts` | `fillTransform()` (the placement contract), `shapeBounds()`, `ringGeometry()`, `pointToViewBox()`, `deltaToViewBox()` |
| `src/lib/render.ts` | `renderComposition()` — the shared canvas renderer for editor and PNG — the `pathOf()` / `orderOf()` identity caches, and the seeded grain tile |
| `src/lib/pngExport.ts` | `exportEdge()` clamping, `renderToBlob()`, `exportPng()`, `copyPngToClipboard()`, and the `ExportInput` shape |
| `src/lib/svgExport.ts` | `buildSvg()` / `exportSvg()` — vector document assembly, clip paths, blend-mode mapping, `feTurbulence` grain |
| `src/lib/fileIo.ts` | `downloadBlob()`, `exportJson()`, `importJson()` and its validation messages |
| `src/lib/ingest.ts` | Image decode pipeline, the format matrix, downscaling, animation sniffing (`isAnimated()`), drag-drop and clipboard file extraction, the failure surface |
| `src/lib/svgImport.ts` | `parseSvgToTemplate()` — uploaded SVG to `Template`, primitive lowering, transform baking policy, path scanner |
| `src/lib/textTemplate.ts` | `BUILTIN_FONTS`, `defaultTextSpec()`, `loadFont()`, `fontFromFile()`, `buildTextTemplate()` — typed text to `Template`, horizontal and vertical layout |
| `src/lib/imageCache.ts` | Decode-once asset cache: `loadImage()` (awaits `img.decode()` so decoding happens off the main thread), `useImages()`, `ensureImages()` |
| `src/templates/index.ts` | Registry, `CUSTOM_TEMPLATE_ID` / `TEXT_TEMPLATE_ID` / `DEFAULT_TEMPLATE_ID`, `findTemplate()`, `sortedRegions()` |
| `src/templates/yinYang.ts` | Default template, 4 regions |
| `src/templates/splitCircle.ts` | 2 regions, the minimal case |
| `src/templates/triskelion.ts` | 6 regions, arcs generated programmatically |
| `src/templates/quadrantGrid.ts` | 4 regions, deliberately plain |
| `src/components/ThemeToggle.tsx` | Three-state header button (System → Light → Dark). Owns the `masklab-theme` localStorage key, sets or clears `data-theme` on `<html>`, and copies the live `--ground` into the `theme-color` metas |
| `src/components/Stage.tsx` | Canvas element, sizing, drawing, selection outlines, `isPointInPath` hit-testing, drag/wheel/pinch-and-twist gestures, drop and paste, and the tool strip under the art (Buddy hint plus Undo / Redo / Add photos / Remix) |
| `src/components/Buddy.tsx` | Kaomoji companion in the stage's tool strip; pointer-aware gesture hints, one truncated line on phones |
| `src/components/Ticker.tsx` | Scrolling "Tips" strip that reads live state; pauses on hover, keyboard focus, tap, and off-screen |
| `src/components/Inspector.tsx` | Inspector shell (empty until `ready`), `InspectorTabs` and the `Tab` type, the desktop/phone split via `matchMedia`, template picker, SVG upload, text entry point (dynamic `import('../lib/textTemplate')`), the lazy `TextPanel`, desktop section order (Template → Text → Output → Regions → Composition → About), phone panels (Shape / Regions / Look / Export), `RegionList` (collapses past 12 regions, scrolls the selected card into view below the sticky stage) |
| `src/components/TextPanel.tsx` | Text spec editing, debounce, stale-rebuild tickets, font picker and upload, CJK coverage warning. Lazy-loaded; never import it statically |
| `src/components/About.tsx` | In-app About section (desktop: foot of the inspector; phone: Export tab). Must say the same as the `#root` fallback in `index.html` |
| `src/components/RegionCard.tsx` | Per-region row (memoised): swatch, drop target, file picker, and the expanded fill controls |
| `src/components/Controls.tsx` | `SliderRow` / `ColorRow` / `ToggleRow` primitives (with the gesture-start contract) and the composition-wide controls |
| `src/components/Toolbar.tsx` | The four exports, JSON import, Undo, Redo, Remix, Reset, the desktop shortcuts line, and job/error handling |
| `src/components/Toasts.tsx` | Notification stack (`role="region"`, `aria-live="polite"`) |

---

## Verifying a change

```bash
pnpm exec tsc -b --noEmit  # types
pnpm build                 # types + production bundle
pnpm exec oxlint src       # lint
```

**There is no test suite. This app is verified by driving it in a browser.** No unit tests, no integration tests, no snapshot tests — none. Do not claim tests pass, do not report "all tests green", and do not add an assertion to a test file that does not exist. If you want a behavioural guarantee, either drive the running app and measure the output, or add a real test harness as its own change.

Driving it:

```bash
pnpm dev
```

In a dev build only, `window.__masklab` is the Zustand store, so you can drive and inspect the running app from the console or an automation tool:

```js
window.__masklab.getState().setTemplate('triskelion');
window.__masklab.getState().composition.fills;
```

**Performance: measure with the real-throttle harness, not by eye.** Run `node ~/Developer/jitsu-os/scripts/real-perf.mjs https://zucity-aesthetics.vercel.app/`. It applies a real 4× CPU slowdown, starts a fresh Chrome per run, proves its own slowdown took effect, and fails on any of: blocking time over 200 ms, longest freeze over 300 ms, any same-origin 404, any failed font. Before the font fix below, measured 20 Oct 2026 on five cold mobile loads of the live site: median blocking 158 ms, longest freeze 208 ms, largest paint about 700 ms. After it (live, 20 Oct, load average 254 on 14 cores, measured slowdown 3.0–4.6×): median blocking 28 ms, longest freeze 72 ms, largest paint 588 ms. That is close to Lighthouse, so Lighthouse's numbers for this app are roughly right. That boot long task (about 55 ms unthrottled) was not JavaScript: it was the first layout, where Chrome spent ~50 ms in per-character system font fallback to find glyphs for the ticker's Japanese and the kaomoji. Naming `'Hiragino Sans'` and `'Noto Sans CJK JP'` in `--font-sans` and `--font-mono` (`index.css`) lets those characters resolve from the list, and the task is gone. Measured 20 Oct 2026 on the local production build, back to back under the same load (load average 170–200 on 14 cores, so all numbers read high): before, median blocking 360 / 341 ms and longest freeze 308 / 332 ms; after, median blocking 121 / 87 ms and longest freeze 99 / 81 ms. **Keep a CJK family named in both font stacks**; any new non-Latin text that falls through to system fallback brings the long task back. To see what is inside a long task, trace it (`devtools.timeline` plus the `blink,fonts` categories) rather than reading only a JS CPU profile, which shows layout and font work as opaque `(program)` time. (An earlier note here claimed Lighthouse overstated blocking time several times over. That was wrong: the harness used to check it never applied its 4× slowdown. Do not repeat it.)

The high-value checks are the ones that measure pixels rather than read code: render a composition to a canvas, export the same composition to SVG, rasterise both at the same size, and compare ink bounding boxes. That is how the defects below were found, and how the ones in `git log` were found before them — the commit bodies are worth reading, since several document a bug and the reasoning that fixed it.

---

## Known sharp edges

Verified by measurement against the running app, not inferred from reading. Check before assuming any of it is still true.

### Three defects that were found here and have since been fixed

Left recorded because the reasoning is reusable, and because each was found by measuring the running app rather than reading the source.

**The SVG grain clip path was referenced but never defined.** `defs` was serialised into the document before the grain block appended the shape clip path to it, so a `transparentBackground` + `grain > 0` export carried `clip-path="url(#masklab-shape)"` with no matching definition. Fixed by reserving the `<defs>` slot and splicing it in after the body is built, so anything appended while building still lands. If you add another `defs` entry from inside the body-building code, this is why it works.

**`shapeBounds()` cached by `template.id`, which is not unique over time.** Generated templates reuse a constant id — every text template is `'text'`, every uploaded SVG is `'custom'` — so retyping returned the previous run's bounds, visible as a ring sized for the old words. Fixed by keying the cache on the template *object* in a `WeakMap`. Templates are immutable, so identity is the correct key. Do not "optimise" this back to an id.

**The JSON round trip lost the editable text run.** `exportJson()` wrote `textSpec` and any uploaded font, and `store.loadFile()` read them, but `importJson()` never copied them onto its return value. Fixed, with validation and a human message for each. The general lesson: a writer, a reader and a validator in three files is exactly the shape that loses a field silently — when you add one to `MaskLabFile`, change all three.

### Smaller things

- **Stage's draw effect has no dependency array**, so it runs on every render. That is deliberate — the canvas must repaint on any state change — but it means anything you add to that effect runs every commit.
- **Re-render discipline.** A drag rewrites `composition.fills` every frame. `RegionCard` is wrapped in `memo`, and untouched regions keep their fill object's identity, so only the dragged card re-renders. `RegionList` owns the `fills` subscription, `Controls` subscribes to each composition field separately, and `Toolbar` reads `useStore.getState()` at click time. **Never subscribe a component to all of `composition`** (or to `assets`) unless it paints from it, as `Stage` does; it will re-render on every drag frame.
- **`.btn` is unlayered CSS, so it beats Tailwind utilities.** Tailwind v4 puts utilities in `@layer utilities`, and an unlayered rule wins over any layered one regardless of specificity. On an element with `class="btn …"`, utilities for properties `.btn` sets (`color`, `background`, `border`, `padding`, `min-height`, `display`, `font-*`, `gap`, `transform` on hover) are ignored. Utilities for properties it does not set (`w-full`, `min-w-11`, position) work. To vary a button, add a modifier class next to `.btn-accent` in `index.css`. **A link that should not look like a button must not use `.btn` at all**: the header links once did, with utilities to unbox them, and rendered as boxed grey buttons. They use `.navlink` (plain text or icon, 44 px target) and `.navlink-primary` for the zucity.org link. Use `.navlink` for header-style links, `.btn` for actions.
- **Caching: only fingerprinted files are immutable.** `vercel.json` gives `/assets/*` (Vite's hashed output) `max-age=31536000, immutable`. `/fonts/*` and `/textures/*` keep their names across releases, so they get 30 days plus `stale-while-revalidate=86400`; replacing one of those files in place can take up to 30 days to reach a returning visitor, so rename it if it must change at once. Icons, the manifest, `og.png`, `robots.txt`, `sitemap.xml` and the IndexNow key file get one day. `index.html` has no rule and falls to Vercel's default, revalidated on each request. Never mark an unhashed path immutable.
- **CSS `url()` resolves relative to the built stylesheet, which lives in `/assets/`.** `vite.config.ts` sets `base: './'`, and a relative `url('./fonts/…')` in `index.css` became `/assets/fonts/…` in production and 404'd, so Space Mono never loaded. The `@font-face` rules now use absolute `/fonts/…` URLs (`woff2` first, `ttf` fallback), matching the preloads in `index.html`. JavaScript `fetch` URLs are different: they resolve against the page, so `BUILTIN_FONTS` and `starterTextures.ts` correctly use `./fonts/…` and `./textures/…`.
- **SVG textures rasterise at two different resolutions** depending on where they enter. `Stage.tsx` (drop, paste and Add photos) passes `rasterSize: composition.exportSize`; `RegionCard.tsx` calls `ingestFiles(files)` with no options and gets the 2048 default.
- **Switching template carries fills by paint-order position** (`carryFills()`), because region ids differ between templates. Text is the exception: arriving at text from a shape starts fresh in ink (`defaultFills`); retyping within text carries.
- **Animated detection sniffs bytes.** `isAnimated()` reads the first 64 KB: WebP needs a `VP8X` header with the animation bit or an `ANIM` chunk; GIF needs a `NETSCAPE2.0` extension. A multi-frame GIF without that looping extension reads as static.
- **`blendOf()` in `svgExport.ts` silently degrades canvas-only composite operators** (`lighter`, `copy`, `xor`, `source-*`, `destination-*`) to `normal`. `BLEND_MODES` currently exposes none of them, so this is latent — but adding one to that list would create a PNG/SVG mismatch with no warning.
- **WOFF2 fonts are rejected on purpose.** opentype.js v2 needs an external Brotli decompressor that this app does not ship, so `fontFromFile()` refuses `.woff2` with a message telling the user to convert. Do not "fix" this by adding the extension to `FONT_MIME`; it would fail later and less clearly.
- **Text is capped at 500 glyphs** (`MAX_GLYPHS`). Every region is a separate clip-and-draw per frame, so the cap is a real performance boundary, not a guess.
- **opentype.js is dynamically imported** in `textTemplate.ts` to keep ~250 kB out of the initial bundle. Keep it behind the dynamic import; a static import at the top of any eagerly-loaded module undoes the split.
- **Never import `TextPanel` or `lib/textTemplate` statically from an eagerly loaded module** (`App`, `Inspector`, `Stage`, `store`, `Toolbar`, anything they import). `Inspector.tsx` loads `TextPanel` with `React.lazy` and `textTemplate` with `await import()` inside the Text button handler; one static `import { … } from '../lib/textTemplate'` pulls the typesetter back into the main bundle (85.5 kB gzipped today, 89.1 kB before the split). If you need a constant from `textTemplate.ts` in eager code, move the constant, not the import.
- **Heavy below-the-fold UI goes inside the inspector's transition.** `App` mounts the inspector only after `ready` flips in `startTransition`, scheduled by `requestAnimationFrame` *and* a 120 ms `setTimeout`. Keep the timeout: background tabs never fire rAF, and without it a page opened in a background tab shows empty controls until it is focused. New heavy UI belongs inside `Inspector` (or another component behind `ready`), not rendered beside `Stage` in the first paint.
- **Phones render only the active tab panel.** Inactive `role="tabpanel"` shells stay in the DOM, `hidden` and empty, so `aria-controls` resolves. A component in an inactive tab is unmounted, so it must not hold state the user expects to survive a tab switch; keep such state in the store.
- **`content-visibility` with an intrinsic-size estimate caused layout shift here; prefer not rendering hidden panels.** A `.cv-auto` class (`content-visibility: auto; contain-intrinsic-size: auto 480px`) was tried on inspector sections and removed: sections snapped from 480 px to their real height and pushed About down, a 0.062 desktop layout shift.
- **Themes: every colour is a token defined in both themes.** The palette is raw CSS variables in `index.css`, dark on `:root`, light under `@media (prefers-color-scheme: light)` (skipped when dark is pinned with `[data-theme='dark']`) and under `[data-theme='light']`. A new colour must be added as a variable in **all three** blocks and exposed through `@theme inline`. Never hard-code a hex in a component. Never put an inline `background` on `<body>`: an inline style beats the CSS, and it once kept the body dark in the light theme. The storage key `masklab-theme` appears twice, in `ThemeToggle.tsx` and in the inline script in the `<head>` of `index.html`, and the two hex values in the inline `<style>` beside it must match `--ground` in each theme; change them together. Canvas selection outlines are the same in both themes on purpose, because they are drawn on the artwork, which does not change with the theme. Every text token must stay at 4.5:1 or better in both themes; recompute if you touch one.
- **Selection drives the phone tab.** `App` subscribes to the store and switches to Regions when `selectedId` changes to a new value. Anything that sets `selectedId` (canvas, keys, cards) therefore opens Regions on a phone. Do not move this into a component that subscribes to `selectedId` through a hook, or `App` re-renders on every selection.
