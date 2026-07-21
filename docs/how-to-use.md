# How to use MaskLab

MaskLab fills the separate regions of a shape with separate textures. A flag with a photograph in each band. A sticker where one letter is marble and the next is rust. An album cover built from one heavy form with an image running through it.

Everything below happens in your browser. **Nothing is uploaded anywhere** — there is no account, no server, and no network request carrying your images or fonts. Close the tab and it is gone, which is also why you should export a JSON if you want a look back later.

The screen is two halves: the **canvas** on the left (the stage), and the **inspector** on the right, stacked below the canvas on a phone. The inspector runs top to bottom in the order you will use it: Template → Text (when you are using text) → Regions → Composition → Output.

---

## Put a texture in a shape

1. Pick a shape under **Template**. Yin Yang is loaded by default. Split Circle, Triskelion, and Quadrant Grid are the other built-ins.
2. Drag an image file from your desktop and drop it straight onto the shape on the canvas. It fills whichever region is under your cursor.

   You can also drop onto a **region card** in the Regions list, or press the small image button on a card to open a file picker, or copy an image anywhere on your machine and press `Cmd/Ctrl+V`.
3. Repeat for the other regions with different images.

Each region in the Regions list shows its name, a hint describing where it sits in the shape, and a swatch of what is currently in it. Cards are listed in paint order — the last card is the one drawn on top.

If a file cannot be read, a notice tells you which file and why. Nothing fails silently.

**Accepted images:** JPG, PNG, WebP, AVIF, GIF, SVG, BMP, ICO, TIFF, and HEIC where your browser can decode it — Safari can, most others cannot, and the message will say so. Animated GIF and WebP use the first frame only. Anything over 4096 px on its long edge is scaled down when it comes in, to keep the tab from running out of memory.

---

## Put a texture in text

This is the same machine, pointed at letterforms. Every glyph becomes its own fillable region with real outline geometry, so a photograph can run through the inside of a letter.

1. Under **Template**, press **Text**. A **Text** section appears in the inspector.
2. Type into the **Words** box. The canvas rebuilds shortly after you stop typing — a burst of typing costs one rebuild and one undo step, not one per keystroke.
3. Set the shape of the type:

   | Control | What it does |
   |---------|--------------|
   | **Font** | Choose a bundled face or one you uploaded. Each option lists what it covers. |
   | **Size** | The em size, in the shape's own units. |
   | **Letter spacing** | Extra tracking between glyphs. Negative values tighten. |
   | **Line height** | A multiplier on the em size. |
   | **Direction** | Horizontal, or Vertical for CJK setting. |
   | **Align** | Where short lines sit against the long ones. |
   | **Split** | How many fillable regions you get — see below. |

4. Fill the glyphs from the Regions list exactly as you would fill any other region.

### Split: how many regions you get

**Split** is the control that decides what you can fill independently.

| Split | Result |
|-------|--------|
| **Glyph** | Every character is its own region. Different texture per letter. |
| **Line** | Every line is one region. Different texture per line. |
| **Whole** | The entire run is a single region. One texture across all the words. |

### Vertical Japanese

Set **Direction** to **Vertical** and glyphs stack downward, with columns running right to left — the CJK setting.

Pick a font that actually covers the characters you typed. **Zen Kaku Gothic New** is the bundled face that covers kana and kanji; the Latin faces do not. If you type Japanese with a Latin font selected, MaskLab warns you rather than quietly rendering nothing, and the font picker spells out each face's coverage next to its name. Japanese faces are large, so the first load of one takes a moment.

### One photograph through every letter

Filling twenty glyphs one at a time is not the move. Instead:

1. Fill **one** glyph with your image and adjust it until the placement is right.
2. Open that glyph's card and press **Apply to every region**.

That copies the texture *and* every setting above it — zoom, spin, offset, flip, opacity, blend — onto every other region. Because all the regions share one coordinate space, the image lands continuously across the whole word rather than restarting inside each letter.

### Editing the words later

Retype whenever you like. The regions are rebuilt, but the fills you already placed are carried across by position, so changing a word does not throw away the textures.

---

## Upload your own SVG shape

Any SVG with separate shapes in it will do.

1. Under **Template**, press **Custom SVG** (it reads **Replace SVG** once one is loaded) and pick a file.
2. Every `path`, `circle`, `ellipse`, `rect`, `polygon`, and `polyline` in the file becomes its own fillable region, in document order. A notice tells you how many regions it found.
3. Fill them like any other region.

Region names come from the element's `id` when that `id` says something useful; otherwise they are numbered. Each region's default colour is taken from the file's own `fill` when it has a plain one.

Things worth knowing before you export a design out of Illustrator or Figma:

- **Compound paths stay compound.** A shape saved as one path is one region, however many visual pieces it appears to have. Release compound paths if you want the pieces separately fillable — that is the whole problem MaskLab exists for.
- **Text in an SVG is skipped.** Convert type to outlines first, or use the Text template instead.
- **Rotated or skewed groups** are placed from their untransformed geometry, so a shape inside a rotated group can land somewhere unexpected. Flatten transforms on export if the layout matters.
- **Square artboards work best.** MaskLab's output is always square. A tall, narrow SVG will be cut off at the bottom on the canvas.

---

## Upload your own font

In the Text section, press **Upload a font** and pick a `.ttf`, `.otf`, or `.woff` file. It joins the picker immediately and the text is rebuilt with it.

Your font stays on your machine. It is only embedded into a file you export if you export a JSON while using it.

---

## Adjust a texture

Click a region — on the canvas or its card — to select it. The card expands with its controls, and the selected region is outlined in red on the canvas.

Directly on the canvas:

| Gesture | Effect |
|---------|--------|
| Drag | Pans the texture |
| Scroll | Zooms it |
| Shift-scroll | Spins it |
| Two-finger pinch | Zooms it, on a touchscreen |

From the card: **Colour** (used when there is no image), **Zoom**, **Spin**, **X** and **Y** offset, **Flip X** / **Flip Y**, **Opacity**, and **Blend** — the full set of blend modes, so a texture can multiply or screen against what is behind it.

From the keyboard:

| Key | Action |
|-----|--------|
| `1`–`9` | Select region N |
| `[` `]` | Step backwards / forwards through regions |
| Arrows | Nudge the texture (hold `Shift` to move 5× further) |
| `r` | Reset the selected region |
| `Cmd/Ctrl+Z` | Undo — 30 steps |

Undo counts a whole gesture as one step, so a long slider drag is one undo, not a hundred. There is no redo.

### The whole composition

The **Composition** section applies to the piece as a whole:

- **Background** — the plate colour behind everything.
- **Transparent background on export** — drops the plate from the PNG and SVG, leaving only the shape. The editor still shows a backdrop so you can see what you are doing; the checkerboard behind the canvas is what transparency looks like.
- **Global rotation** — turns the whole artwork.
- **Grain** — film grain over the top.
- **Ring width** / **Ring colour** — a circular stroke hugging the artwork. Zero is off.
- **Export size** — 600 to 4096 px, square.

**Randomize** throws textures and settings at every region at once; with no images loaded it shuffles colours only. **Reset** returns the composition to its defaults. Both are undoable.

---

## Export

Four buttons under **Output**. Which one you want depends on where the file is going:

| Use | Button | Why |
|-----|--------|-----|
| Posting it — Instagram, a print shop, a sticker order | **Export PNG** | A flat square image at your export size, up to 4096 px. What you see on the canvas is what you get; the editor and the exporter run the same code. |
| Editing it further in Illustrator or Figma | **Export SVG** | A real vector document with one clipping path per region. Regions stay individually selectable, and your images ride along embedded, so the file works on a machine that has never seen them. |
| Saving a look to reopen later | **Export JSON** | The whole document — every setting, every region's fill, and every image embedded. This is MaskLab's save file. |
| Dropping it straight into another app | **Copy PNG** | Puts the image on your clipboard. Some browsers refuse to let a page write images to the clipboard; if yours does, you will be told to use Export PNG instead. |

**Import JSON** reopens a saved document.

Two things to know:

- **Export the JSON if you care about the look.** There is no autosave. A refresh loses everything.
- **Grain is the one thing PNG and SVG do not match exactly.** The PNG grain is a noise tile; the SVG grain is generated by the SVG filter engine. Same intensity, same scale, different pixels. Everything else — placement, scale, rotation, blending, the ring — is identical between the two, by construction. If you need the grain to be exactly what you saw, export the PNG.
