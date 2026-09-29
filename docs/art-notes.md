# Art notes

The game ships **three** image files, 128 KB in total. Everything else on
screen — every button, icon, star, particle, stripe and wrapper — is still
drawn from code at runtime.

| File | Size | What it is |
|---|---|---|
| `src/assets/bg.webp` | 19 KB | The painted backdrop |
| `src/assets/logo.webp` | 45 KB | The `SUGAR RUSH` title lettering |
| `src/assets/candy-atlas.webp` | 62 KB | Six candy bodies + the colour bomb, 3x3 at 256px |

Both are imported as ES modules, so a normal `npm run build` emits them as
hashed files and `npm run build:standalone` inlines them as data URLs (its
`assetsInlineLimit` is set to 100 MB for exactly this reason).

## Why only these two

The backdrop never moves and never changes colour, so a painting beats a
gradient and the file is almost free — smooth gradients are the best case a
lossy codec ever gets.

The logo is a one-off piece of lettering shown on one screen. Hand-drawing
that in canvas paths would be a lot of code for a worse result.

Candies **were** procedural, on the reasoning that they get scaled, squashed,
stretched, rotated, overlaid and drawn at arbitrary cell sizes, and sprites
would fight all of it.

That reasoning was half wrong. Sprites handle every one of those transforms
perfectly well — the only thing they genuinely cannot do is *recolour*, and
that was never needed, because six hues means six sprites rather than one
tinted sprite. What canvas gradients genuinely cannot do is a lacquered edge,
a luminous core and a tight specular hotspot all at once, and with 63 pieces
on screen that gap is the entire look of the game.

So the bodies are painted now, and the parts that really do want to be
procedural still are:

- the **contact shadow**, drawn per piece with `destination-over` so it tucks
  in behind whatever was composited on top;
- the **stripe** and **wrapper** overlays, which clip themselves with
  `source-atop` — that respects the painted silhouette exactly, where a
  geometric clip path would no longer line up with it.

Stripe contrast adapts to the body: white ribs read beautifully on the
strawberry and hopelessly on the lemon, because a light candy under light
stripes just turns white, and a piece you cannot identify by colour is a piece
you cannot plan a match with. Rib opacity therefore falls as body luminance
rises, and the contrast comes from a dark separator line instead.

It also got *faster*. Blitting a sprite beats building six gradients per
piece: the shots harness went from 71.9 ms a frame to 51.8 ms.

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

### The palette is sampled, not chosen

`PALETTE` in `src/core/types.ts` is derived from the atlas, so particles,
glows and combo text match the painted art exactly. For each cell, the mean
of the mid-tone body pixels is taken with the specular hotspot and the
lacquer rim excluded from the sample — include them and the "colour" comes
out as either white or near-black.

`light` / `dark` / `spark` are then derived from that base with saturation
pushed **up** as lightness rises. Letting it drift down the way a naive HLS
lightening does produces pastel chalk, and in additive particles a
desaturated tint reads as grey ash rather than candy.

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

`art-src/candy-B.png` (generated at 1264x848) — the six bodies:

> A sprite sheet of 6 mobile match-3 game candy jewels arranged in a clean
> grid with exactly 3 columns and 2 rows, evenly spaced with generous
> margins, each piece centred in its own cell, all pieces the same overall
> size. Top row left to right: a glossy crimson red rounded square candy, a
> glossy orange teardrop droplet, a glossy golden yellow five pointed star.
> Bottom row left to right: a glossy emerald green hexagon, a glossy sky blue
> sphere, a glossy violet purple diamond rhombus. Style: hard polished boiled
> sweet, like glass and enamel, deep jewel tone colours, very high gloss
> lacquered surface, brilliant tight white specular hotspot upper left,
> secondary softer highlight, luminous inner glow from the centre, dark
> saturated edges for depth, thin bright rim light outline, candy crush game
> art style, vivid, punchy, chunky cartoon proportions with crisp clean
> edges, 3D rendered icon, studio softbox lighting from upper left. Plain
> flat uniform mid grey background, no shadows cast on the background, no
> text, no labels, no extra objects.

The six silhouettes deliberately match the shapes `candyPath()` already used
— square, teardrop, star, hexagon, sphere, rhombus. Distinct shapes, not just
distinct colours, is what keeps the board readable for colourblind players,
and keeping the same ones meant the painted art dropped straight into the
existing layout.

A first attempt asked for *translucent gummy* candies instead. They were
prettier in isolation and much worse in play: without the dark lacquered edge
the pieces bled into each other and into the board. Readability at 63-pieces-
on-screen beat beauty at one.

`art-src/bomb-raw.png` (generated at 1024x1024) is the colour bomb, prompted
in the same style — a glossy near-black sphere with rainbow sprinkles.

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

### Normalising the sheet

The generator lays the six pieces out on a grid but gives each cell its own
slightly different grey, so the background is keyed **per tile** from that
tile's own corner pixel rather than with one global colour.

Each piece is then scaled to a per-shape *reach* — the fraction of the `2r`
box its bounding box should span — copied straight out of `candyPath()`:

| | square | drop | star | hexagon | sphere | rhombus | bomb |
|---|---|---|---|---|---|---|---|
| reach | 0.88 | 0.84 | 1.00 | 0.97 | 0.93 | 0.99 | 0.98 |

Without this the star, which is mostly empty space inside its bounding box,
would look tiny next to the sphere.

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
