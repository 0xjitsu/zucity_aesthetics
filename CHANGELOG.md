# Changelog

All notable changes to MaskLab. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Dates are commit dates; MaskLab has no tagged releases yet, so each entry is a day's work rather than a version.

## [Unreleased]

### Added

- **Redo.** `⇧⌘Z`, `Ctrl+Shift+Z` and `Ctrl+Y` redo the last undone step. Undo and Redo buttons sit in the strip under the canvas and in the Output section.
- **Add photos** button under the canvas. Pick images and they join the texture deck and are dealt into the shape straight away. This is the upload path on phones, which have no drag-drop or paste.
- On desktop, a one-line shortcuts reminder at the bottom of Output.
- Regions lists longer than 12 collapse behind a "show all" button, always keeping the selected region visible.
- The canvas has `role="img"` and a label; the ticker is a focusable "Tips" region; the notifications stack is a labelled region; hidden file inputs are labelled; region hints show in full as a tooltip.
- **Phone tabs.** On a phone the controls are four tabs under the canvas: Shape, Regions, Look and Export. Only the open tab is drawn, and the canvas and tabs stay pinned while it scrolls. Tapping a region on the canvas (or selecting one by key) opens Regions with its card scrolled into view. The tabs work with arrow keys, `Home` and `End`.
- An **About** section (foot of the inspector on desktop, Export tab on a phone) saying what MaskLab is and linking zucity.org, X, Instagram and Substack.
- **Findable in search and AI assistants:** the title and description now lead with "MaskLab by ZuCity", with a canonical URL; Open Graph and Twitter cards with a 1200 × 630 preview image (`og.png`); JSON-LD describing ZuCity, the site and the app together; readable HTML for crawlers that do not run JavaScript, matching the About section; `robots.txt` that allows search and AI crawlers; `sitemap.xml`; and an IndexNow key plus `scripts/indexnow.mjs` to run after each deploy. See [docs/seo.md](docs/seo.md).
- `vercel.json` with cache headers: hashed `/assets/*` immutable for a year, `/fonts` and `/textures` for 30 days with stale-while-revalidate, icons, the manifest, `og.png`, `robots.txt`, `sitemap.xml` and the IndexNow key for one day.

### Changed

- **Switching template keeps your textures.** Fills carry over by paint-order position. Arriving at Text from a shape still starts fresh in ink; retyping keeps the look.
- **Undo history is recorded on the first move that changes something,** not on pointer-down. A click that only selects records nothing and keeps the redo stack. One held arrow key is one undo step. A pinch is one undo step, and a second finger never changes the selection.
- The ticker pauses on keyboard focus, on tap, and while scrolled off-screen, as well as on hover (now real pointers only).
- Inspector sections are ordered Template → Text → Output → Regions → Composition, so export is reachable without scrolling past every region.
- Faint text (`#80808b`) and the red accent (`#ef4444`) now meet 4.5:1 contrast on all panel surfaces.
- **Undo, Redo, Add photos and Remix moved to a strip under the canvas,** beside the hint line, so they no longer cover the artwork. On a phone the hint stays on one line.
- Header links are plain icon links in the order X, Instagram, Substack. They had rendered as boxed grey buttons.
- **Faster first load.** The canvas draws first and the controls follow without blocking it, with their space held so nothing jumps. The Text controls and typesetter load only when you press Text (main bundle 89.1 → 85.5 kB gzipped). Textures decode off the main thread.
- The phone stage height uses `44svh`, so the canvas no longer resizes when the iOS toolbar collapses.
- Editing is lighter on long text: region paths and paint order are cached per template, undo snapshots keep the template by reference instead of copying it, and only the dragged region's card re-renders during a drag.
- The "look saved" notice counts only the textures actually packed into the file.

### Fixed

- Space Mono, the interface font, never loaded in production: the CSS URL resolved under `/assets/` and 404'd. It now loads as `woff2` with a `ttf` fallback, preloaded.
- The "first frame only" notice no longer fires for every GIF and WebP; the file is checked for animation first.

### Removed

- `content-visibility: auto` on inspector sections. It was tried to skip layout of below-the-fold sections, but sections snapped from a 480 px estimate to their real height and pushed content down (a 0.062 layout shift on desktop). Phone tabs and the deferred inspector made it unnecessary.
- `public/llms.txt`. No search engine or AI crawler reads it; `AGENTS.md`, accessible names and JSON-LD cover the same need.

## 2026-10-20

### Added

- Header links to ZuCity's X, Substack and Instagram, each opening in a new tab.

## 2026-07-22

### Added

- **Remix** play loop: a button on the canvas corner deals the loaded textures across the regions afresh, one undo step per deal. Every texture gets a turn before any repeats.
- Phone-native layout: the canvas stays pinned while the controls scroll beneath it.
- Two-finger twist rotates the selected texture, together with pinch zoom.
- Installable as an app: PWA manifest, icons, and edge-to-edge display on notched phones. No service worker.
- Five bundled ZuCity starter textures. Each first visit opens on a different pair; the canvas is dressed without adding an undo step.
- A zucity.org link in the header.
- New look from ZuCity's design values: Space Mono, violet accent, a live ticker, a kaomoji buddy, sticker-style region cards. All motion respects reduced-motion settings.
- Space Mono Bold as a typesetting font.

### Changed

- The first canvas appears faster: only the two textures it wears are fetched before it dresses, in parallel, and the starter files are smaller.
- Remix favours photos: with images loaded, every region gets one; blend surprises are rare and limited to flattering modes.

## 2026-07-21

### Added

- **Text as a template:** type a word and every glyph becomes its own fillable region. Horizontal or vertical (CJK) layout, bundled fonts, and upload of your own.
- MaskLab v1: four built-in templates, custom SVG upload, broad image ingest, the inspector, and all four exports (PNG, SVG, JSON, copy to clipboard).

### Fixed

- Non-square shapes (such as text) were framed differently, and wrongly, by the canvas. Both renderers now share one fit.
- The ring now hugs the shape instead of floating around the viewBox.
- Custom SVG region bounds were wrong for arcs and loose for curves.
- The stage rendered non-square on phones.
- Grain hazed the empty area of a transparent-background export.
- A transparent-background SVG with grain referenced a clip path it never defined.
- Retyping text kept the previous words' ring size.
- Reopening a saved text piece lost the editable words.
- The "Skip to controls" link pointed at nothing.
