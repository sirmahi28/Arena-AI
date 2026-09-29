# Art notes

The game ships exactly **two** image files. Everything else on screen — every
candy, every button, every icon, every particle — is drawn from code at
runtime. That is deliberate: code-drawn art is resolution-independent, can be
recoloured and squashed per frame, and costs nothing to download.

| File | Size | What it is |
|---|---|---|
| `src/assets/bg.webp` | 19 KB | The painted backdrop |
| `src/assets/logo.webp` | 45 KB | The `SUGAR RUSH` title lettering |

Both are imported as ES modules, so a normal `npm run build` emits them as
hashed files and `npm run build:standalone` inlines them as data URLs (its
`assetsInlineLimit` is set to 100 MB for exactly this reason).

## Why only these two

The backdrop never moves and never changes colour, so a painting beats a
gradient and the file is almost free — smooth gradients are the best case a
lossy codec ever gets.

The logo is a one-off piece of lettering shown on one screen. Hand-drawing
that in canvas paths would be a lot of code for a worse result.

Candies are the opposite case on every count. They get tinted to six
different hues, scaled, squashed, stretched, rotated, given three different
special overlays and drawn at whatever cell size the screen works out to.
Sprites would fight all of that, so they stay procedural.

## Regenerating

The optimised `.webp` files are committed, so you never need to do this. The
raw art lives in `art-src/` and is git-ignored (~2.7 MB of intermediate).

```
npm run art      # art-src/*-raw.png  →  src/assets/*.webp
```

That needs ImageMagick (`convert`). See `tools/build-art.mjs` for the exact
pipeline — notably the four-corner flood fill that keys the flat grey field
out from behind the logo without eating the grey-ish pixels inside the
artwork, and the format comparison that landed on WebP.

### The prompts

`art-src/bg-raw.png` (generated at 704x1504):

> Vertical portrait mobile game background illustration, tall 9:19 aspect
> ratio. A dreamy candy-land night sky. Deep violet, indigo and dark magenta
> gradient sky. Along the very bottom edge only: distant soft-focus
> silhouettes of rolling candy hills, lollipops and swirl-cone trees, heavily
> blurred and very dark, barely visible. At the very top: faint glowing
> cotton-candy clouds, soft stars, gentle light rays. CRITICAL: the entire
> middle two-thirds of the image must be calm, dark, empty sky with no objects
> at all, just a smooth glowing gradient, because game UI sits on top of it.
> Muted desaturated colours, very low contrast, dark overall, soft airbrushed
> digital painting, atmospheric, no text, no letters, no words, no characters,
> no people, no foreground objects in the centre.

The "empty middle" instruction is the load-bearing part. The board covers the
centre of the screen, so any detail painted there is both invisible and
actively harmful — it would show through the gaps between candies and make
the grid harder to read.

`art-src/logo-raw.png` (generated at 1408x768):

> Mobile game title logo artwork. Chunky rounded 3D candy lettering spelling
> the two words "SUGAR RUSH" stacked on two lines, centred. Glossy hot pink
> and golden yellow gradient letters with a thick creamy white outline, a dark
> purple drop shadow and bright glossy highlights. A few colourful sprinkles
> and a small candy swirl decoration. Playful, bold, cartoon mobile game logo
> style, clean vector-like rendering, centred composition on a plain flat
> mid-grey background, no scene, no border, no extra text.

Asking for a **plain flat mid-grey background** is what makes the cut-out
clean. Grey is far enough from every colour in the logo that an 18% fuzz
flood fill removes it completely without touching the artwork — 5 stray
pixels survived out of 347,000.

## Format comparison

Measured on this logo at 560px wide, with alpha:

| Format | Size | Verdict |
|---|---|---|
| PNG, full colour | 346 KB | far too big |
| PNG-8, 256 colours | 83 KB | banding in the gradients |
| PNG-8, 64 colours + dither | 60 KB | visible dither speckle |
| JPEG colour + PNG alpha mask | 67 KB | clean, but needs runtime compositing |
| **WebP q82** | **45 KB** | clean, one file, no runtime work |

WebP won on every axis at once, which does not happen often.

## How they are used

The backdrop is drawn **scale-to-cover, anchored low** (`background.ts`), so
the candy-hill horizon stays in frame on short screens. The procedural
gradient that used to be the whole background is still drawn underneath it:
it covers the moment before the image decodes, and it fills the gap if the
viewport is a wildly different shape to the painting.

Crucially the animated layers still run **on top** of the painting — drifting
light shafts, twinkling stars, floating bokeh, vignette. A static image on its
own reads as dead wallpaper. The painted light shafts got the live ray layer
turned down from 0.6 to 0.28 alpha, so the light now appears to drift rather
than being drawn twice.

The logo replaces the drawn title **on the menu only**. The win and lose
banners still use canvas text, because their wording changes and two more
pieces of art would cost more than they return.
