# Art notes

The game ships **three** image files, 121 KB in total. Everything else on
screen — every button, icon, star, particle, stripe and wrapper — is still
drawn from code at runtime.

| File | Size | What it is |
|---|---|---|
| `src/assets/bg.webp` | 19 KB | The painted backdrop |
| `src/assets/logo.webp` | 45 KB | The `SUGAR RUSH` title lettering |
| `src/assets/candy-atlas.webp` | 56 KB | Six candy bodies + the colour bomb, 3x3 at 256px |

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

### Overlays calibrate themselves against the art

White ribs read beautifully on the strawberry and hopelessly on the lemon: a
light candy under light stripes just turns white, and a piece you cannot
identify by colour is a piece you cannot plan a match with.

Two mechanisms fix this, and the second is the one that matters.

**Ribs come in pairs.** Each light rib is followed by a dark one in the gap.
That doubles the contrast for half the brightness push, so a striped piece
keeps its hue instead of bleaching toward white.

**Strength is measured, not assumed.** Opacity scales with how bright the art
actually is — light rib weaker and dark rib stronger as luminance rises. The
first version read that luminance off `PALETTE`, which worked for the
lacquered art and failed badly for the translucent art, whose lit cores render
far paler than the mid-tone the palette samples: the orange teardrop came out
beige. So `measureAtlas()` now downsamples each cell to 8x8 on load and takes
the mean luminance of the opaque pixels — six tiny reads, once, with the GPU
doing the averaging during the downscale.

That is what made swapping art styles safe. Redraw the atlas and the overlays
retune themselves; nothing has to be hand-tuned to a particular set of
pictures again.

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

`art-src/candy-sheet.png` (generated at 1408x768) — the six bodies:

> Six glossy translucent jelly candy icons laid out as a 3 column by 2 row
> grid, six objects total. Reading order: red rounded square, orange
> teardrop, yellow star, green hexagon, blue sphere, purple diamond. All six
> drawn flat and face-on like game icons, straight front view, no
> perspective, no tilting, no rotation, identical scale, evenly spaced with
> wide margins. Style: premium glossy translucent gummy candy, deep saturated
> jewel colour, strong subsurface scattering so light glows through the body,
> bright sharp specular highlight upper left, soft coloured bounce light
> along the bottom edge, crisp rim light, smooth rounded bevelled edges, wet
> shiny surface, high end 3D render, studio lighting from upper left,
> extremely detailed, clean. Plain flat uniform mid grey background, no cast
> shadows, no text, no labels, no extra objects.

The six silhouettes deliberately match the shapes `candyPath()` already used
— square, teardrop, star, hexagon, sphere, rhombus. Distinct shapes, not just
distinct colours, is what keeps the board readable for colourblind players,
and keeping the same ones meant the painted art dropped straight into the
existing layout.

### Two styles, and why the softer one won

Two sheets were generated: hard *polished boiled sweet* with a dark lacquered
edge, and soft *translucent gummy*. The lacquered one was shipped first, on
the argument that at 63 pieces on screen the dark edge is what stops candies
bleeding into each other and into the board.

The player preferred the gummy one, and they were right that it looks better.
The readability worry was real but it was solvable in the wrong place — it was
being solved by *art* when it should have been solved by *code*. See the
overlay calibration below: once the stripe and wrapper overlays measure the
art instead of assuming it, the soft style reads fine.

The softer art does cost about 7 ms a frame more in the software rasteriser,
because large soft alpha edges are more expensive to blend than hard ones.
On a GPU it is free.

The colour bomb is a glossy near-black sphere with rainbow sprinkles,
prompted separately at 1024x1024. Its raw render was lost to a sandbox reset,
so the build now takes it from `art-src/bomb-cell.png` — the finished 256px
cell recovered out of the shipped atlas. Same art, already normalised, so it
skips the cut-and-scale pipeline the candies go through.

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

### Generating a sheet is a dice roll; generating singles loses consistency

Worth knowing before regenerating anything. Asking for all six on one sheet
gives **consistent** lighting and framing but an **unreliable** layout — one
attempt came back as four columns with a stray red blob and no green hexagon
at all. Asking for six separate images gives a reliable layout but
inconsistent framing: the green arrived as a tilted pentagon in three-quarter
perspective while the red and orange were face-on.

Sheets are the right call, because inconsistent lighting across pieces cannot
be fixed afterwards whereas a bad sheet can simply be re-rolled. Adding
"flat head-on orthographic view, no perspective tilt, no three-quarter angle"
to the prompt is what stopped the individual pieces drifting into perspective.

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

## Particles: brightness is not quality

The candy art is painted; everything thrown *off* a candy is still code. That
code went through a pass aimed at making it look more expensive, and the
lesson was that nearly every lever worth pulling reduced light rather than
adding it.

The failure mode is specific and worth naming. Additive blending drives
overlapping particles toward white. Any white already in the source therefore
compounds, and past a fairly low threshold every effect in the game converges
on the same colourless flare — maximum glow carrying zero information about
what just happened. A burst that cannot tell you *which candy* exploded is a
burst that has stopped doing its job.

So the glow sprite keeps its hue (core pushed only 55% toward white, tight
falloff instead of a linear ramp), white was pulled out of twelve of the
fourteen emitters that seeded it, shockwave rings went from two per pop to
one, and rings are drawn as four stacked strokes approximating a gradient
rather than one hard circle.

The additions were all shape rather than brightness: a four-point glint
sprite, a lit facet on each shard, per-shape decay envelopes, and a flicker
term. A two-pixel round blob is indistinguishable from a dead pixel; a
two-pixel *spiked* blob reads as a highlight. That distinction is most of
what separates a cheap particle system from an expensive-looking one.

One trap found along the way: the first version of the shard shading split
each chip into a lit half and a shaded half, which is how you shade a large
object. On a 10px chip flying over a dark board it reads as dirt, and on the
yellow candy the shaded half turned the debris olive. A silhouette against a
dark background does not need a dark side — it needs a bright one.

Compare versions with `npm run fx`, which fires one named effect and captures
the board at fixed offsets. Screenshot tooling that catches an arbitrary
frame cannot evaluate something that lives for 400 ms.

## UI icons: flat glyphs on a lit game

The icons were flat white strokes, which was worse than it sounds. Everything
else on screen — candies, buttons, the logo — has a light source in the upper
left and a visible sense of thickness, so flat glyphs read as placeholder art
sitting on top of a finished game.

The fix is structural rather than per-icon. Each icon defines nothing but
geometry, using whatever fill and stroke the caller has set, and the renderer
draws that geometry four times: a soft contact shadow, a dark extrusion
offset straight down, the lit face, and a catchlight clipped to the top edge.
Add an icon and it gets the treatment for free.

Two things went wrong on the way, both instructive.

**It cost 380 ms a frame** — a five-fold regression. Four traces per icon plus
a `ctx.filter` blur, seven icons, every frame. None of that work depends on
anything that changes between frames, so it is now baked once per icon-size
and the frame does a single blit. That ends up *cheaper* than the flat version
it replaced, which was re-tracing its paths every frame for a worse result.

**The tints did not show.** The face ramp reached its upper stop within a
third of the glyph height, and the upper stops were all near-white, so every
icon rendered as a white shape with a coloured sliver along the bottom. The
white stop has to be a narrow specular band at the very top and the upper
tint has to be an actual colour. A near-white palette with a bevel is still
just white.

The extrusion had the same class of bug: mixing it toward the background
purple made it a blue ghost copy offset one pixel down, like a misregistered
print. A side wall has to be a much darker version of the object's *own*
colour.

Buttons got the same pass. Four things separate a gradient rectangle from a
moulded plastic button, and all of them are cheap: a deep lip in a darker
shade of the face colour rather than a grey drop shadow, so the side wall
looks like the same material; a dark outer keyline, which is what stops the
button dissolving into a busy background; bounce light along the bottom
inside edge where a real moulded surface catches light reflected back up off
the lip; and a specular sheen that is an *arc*, because a straight-edged
highlight is the clearest tell of a flat shape. Pressing sinks the face into
the lip instead of moving the whole button, so the travel is visible against
a fixed silhouette.
