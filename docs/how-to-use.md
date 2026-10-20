# How to use MaskLab

MaskLab fills the separate regions of a shape with separate textures. A flag with a photograph in each band. A sticker where one letter is marble and the next is rust. An album cover built from one heavy form with an image running through it.

Everything below happens in your browser. **Nothing is uploaded anywhere** — there is no account, no server, and no network request carrying your images or fonts. Close the tab and it is gone, which is also why you should export a JSON if you want a look back later.

The screen is two halves: the **canvas** on the left (the stage), and the **inspector** on the right. On a desktop the inspector runs top to bottom: Template → Text (when you are using text) → Output → Regions → Composition → About.

Under the canvas sits a strip with a one-line hint on the left and the tools on the right: **Undo**, **Redo**, **Add photos** (**+**) and, once any image is loaded, **Remix**. The tools sit under the artwork, never on top of it.

### On a phone

Below the desktop breakpoint (1024 px wide) the inspector becomes four tabs directly under the canvas. The canvas, the tool strip and the tabs stay pinned at the top while the open tab's controls scroll beneath them, so every change shows live.

| Tab | What is in it |
|-----|---------------|
| **Shape** | Template picker, Custom SVG upload, and the Text controls when you are using text |
| **Regions** | One card per region, in paint order |
| **Look** | The Composition controls: background, rotation, grain, ring, export size |
| **Export** | The Output buttons (export, import, undo, redo, remix, reset) and About |

Tap a region on the canvas and the **Regions** tab opens with that region's card scrolled into view. Selecting by keyboard (`1`–`9`, `[` `]`) does the same. With a keyboard, the arrow keys, `Home` and `End` move between tabs.

The header links to zucity.org, then ZuCity on X, Instagram and Substack, each in a new tab so the canvas is never lost.

The button at the right end of the header sets the **theme**. Each press moves one step along System → Light → Dark → System. **System** follows your device and changes with it. **Light** and **Dark** stay put, and your choice is remembered in this browser. The artwork itself never changes with the theme, and neither do the selection outlines on the canvas.

Short on time? The [guide](https://zucity-aesthetics.vercel.app/guide.html) answers the eight most common questions on one page. The About section links to it as "Read the guide".

The canvas opens already dressed in two of the bundled ZuCity textures, a different pair on each visit. Treat it as a starting point: undo will not step back to a blank shape.

You can install MaskLab to your home screen from your browser's share or install menu; it opens full-screen like an app.

---

## Play with your own photos

The fastest way in, and the one built for a phone.

1. Press **Add photos** in the strip under the canvas (on a phone it is the **+** button). Pick one or more images.
2. They are dealt into the shape straight away, one texture per region, each placed a little differently. A notice tells you how many arrived.
3. Press **Remix** (the circular-arrows button beside it) to deal again. Every press is a new arrangement: your photos and the starter textures are shuffled so each gets a turn before any repeats.
4. Went one too far? Press **Undo** (the left-curling arrow). **Redo** (the right-curling arrow) steps forward again.
5. When you like it, go to **Output** (the **Export** tab on a phone) and press **Export PNG**.

Each deal is one undo step, so you can tap through a run of remixes and walk back to the one you liked.

---

## Put a texture in a shape

1. Pick a shape under **Template**. Yin Yang is loaded by default. Split Circle, Triskelion, and Quadrant Grid are the other built-ins. Switching shape keeps your textures: the first region of the old shape hands its fill to the first region of the new one, and so on. Extra regions in the new shape start in their plain colours.
2. Drag an image file from your desktop and drop it straight onto the shape on the canvas. It fills whichever region is under your cursor.

   You can also drop onto a **region card** in the Regions list, press the small image button on a card to open a file picker for that one region, or copy an image anywhere on your machine and press `⌘V` / `Ctrl+V`. On a phone, the image button on a card is how you put one photo in one region; **Add photos** deals several at once.
3. Repeat for the other regions with different images.

Each region in the Regions list shows its name, a hint describing where it sits in the shape, and a swatch of what is currently in it. Cards are listed in paint order — the last card is the one drawn on top. A shape with more than 12 regions (a long word, say) shows the first 12 plus the selected one; press **show all** to see the rest.

If a file cannot be read, a notice tells you which file and why. Nothing fails silently.

**Accepted images:** JPG, PNG, WebP, AVIF, GIF, SVG, BMP, ICO, TIFF, and HEIC where your browser can decode it — Safari can, most others cannot, and the message will say so. Animated GIF and WebP use the first frame only, and you are told when a file you added is animated. Anything over 4096 px on its long edge is scaled down when it comes in, to keep the tab from running out of memory.

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

Switching **to** Text from a shape is the one move that starts fresh: the letters arrive in plain ink so they are readable, rather than inheriting a yin-yang's halves letter by letter.

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
- **The output is always square.** A shape that is not square is scaled to fit and centred, with background around the short axis. Nothing is cropped, but a very wide or very tall design will sit in a band across the middle.

---

## Upload your own font

In the Text section, press **Upload a font** and pick a `.ttf`, `.otf`, or `.woff` file. It joins the picker immediately and the text is rebuilt with it.

Your font stays on your machine. It is only embedded into a file you export if you export a JSON while using it.

---

## Adjust a texture

Click or tap a region — on the canvas or its card — to select it. The card expands with its controls, and the selected region is outlined in violet on the canvas.

Directly on the canvas:

| Gesture | Effect |
|---------|--------|
| Drag | Pans the texture |
| Scroll | Zooms it |
| Shift-scroll | Spins it |
| Two-finger pinch | Zooms it, on a touchscreen |
| Two-finger twist | Spins it, on a touchscreen — pinch and twist work together in one gesture |

The hint under the canvas switches between the touch and mouse versions of these depending on your device. On a phone it is cut to one line so the pinned canvas never grows.

From the card: **Colour** (used when there is no image), **Zoom**, **Spin**, **X** and **Y** offset, **Flip X** / **Flip Y**, **Opacity**, and **Blend** — the full set of blend modes, so a texture can multiply or screen against what is behind it.

From the keyboard:

| Key | Action |
|-----|--------|
| `1`–`9` | Select region N |
| `[` `]` | Step backwards / forwards through regions |
| Arrows | Nudge the texture (hold `Shift` to move 5× further) |
| `r` | Reset the selected region |
| `⌘Z` / `Ctrl+Z` | Undo — 30 steps |
| `⇧⌘Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |

On a desktop, a one-line reminder of these shortcuts sits at the bottom of **Output**.

### Undo and redo

Undo and Redo are buttons in two places: the strip under the canvas (always in reach on a phone) and the **Output** section. They grey out when there is nothing to undo or redo.

One undo step is one thing you did, not one event the browser saw:

- A whole drag, pinch, slider drag, or burst of scrolling is one step.
- Holding an arrow key down is one step, however far it moves.
- Tapping a region just to select it is not a step at all, and does not clear Redo.
- Each Remix, Add photos, template switch, and Reset is one step.

Redo is cleared as soon as you make a new change after undoing, as in any editor. History keeps the last 30 steps. Added images are never removed by undo; undo only changes where they are used.

### The whole composition

The **Composition** section applies to the piece as a whole:

- **Background** — the plate colour behind everything.
- **Transparent background on export** — drops the plate from the PNG and SVG, leaving only the shape. The editor still shows a backdrop so you can see what you are doing; the checkerboard behind the canvas is what transparency looks like.
- **Global rotation** — turns the whole artwork.
- **Grain** — film grain over the top.
- **Ring width** / **Ring colour** — a circular stroke hugging the artwork. Zero is off.
- **Export size** — 600 to 4096 px, square.

**Remix** (in **Output**, and in the strip under the canvas once any image is loaded) deals the loaded textures across every region with fresh placement; with no images loaded it shuffles colours only. **Reset** returns the composition to its defaults. Both are undoable.

---

## Export

Four buttons under **Output** (the **Export** tab on a phone). Which one you want depends on where the file is going:

| Use | Button | Why |
|-----|--------|-----|
| Posting it — Instagram, a print shop, a sticker order | **Export PNG** | A flat square image at your export size, up to 4096 px. What you see on the canvas is what you get; the editor and the exporter run the same code. |
| Editing it further in Illustrator or Figma | **Export SVG** | A real vector document with one clipping path per region. Regions stay individually selectable, and your images ride along embedded, so the file works on a machine that has never seen them. |
| Saving a look to reopen later | **Export JSON** | The whole document — every setting, every region's fill, and every image embedded. This is MaskLab's save file. |
| Dropping it straight into another app | **Copy PNG** | Puts the image on your clipboard. Some browsers refuse to let a page write images to the clipboard; if yours does, you will be told to use Export PNG instead. |

**Import JSON** reopens a saved document.

Three things to know:

- **Export the JSON if you care about the look.** There is no autosave. A refresh loses everything.
- **Reopening a text piece brings back the editable words.** The letterforms, the fills, every setting, the Text panel's words and settings, and any font you uploaded all return as you left them.
- **Grain is the one thing PNG and SVG do not match exactly.** The PNG grain is a noise tile; the SVG grain is generated by the SVG filter engine. Same intensity, same scale, different pixels. Everything else — placement, scale, rotation, blending, the ring — is identical between the two, by construction. If you need the grain to be exactly what you saw, export the PNG.
