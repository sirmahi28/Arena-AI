# 🍬 Sugar Rush

A mobile-first, Candy-Crush-style match-3 game built on a bare HTML5 canvas — with a
particle system built for juice.

No game engine, no sprite sheets, no audio files. Every candy is drawn procedurally,
every sound is synthesised with the Web Audio API, and the whole thing ships in
**~23 KB gzipped**.

| Menu | Cascade | Colour bomb | Level clear |
|---|---|---|---|
| ![Menu](docs/screen-menu.png) | ![Cascade](docs/screen-cascade.png) | ![Colour bomb](docs/screen-colorbomb.png) | ![Level clear](docs/screen-levelclear.png) |

---

## Run it

```bash
npm install
npm run dev          # → http://localhost:5173
```

It's built for a phone. On desktop, open devtools and switch to a mobile viewport
(the game works with a mouse too — drag a candy, or tap one then tap its neighbour).

### Or run it with no server at all

```bash
npm run build:standalone     # → dist-standalone/sugar-rush.html
```

That's the entire game — code, art and audio — inlined into a single ~240 KB
HTML file. Double-click it, email it to yourself, or copy it onto a phone; it
needs no server, no install and no network. `npm run verify:standalone` opens
it over `file://` with **every** network request blocked and checks it still
boots, paints, takes input and fires its particle effects.

(Most of the art and *all* the sound is procedural, which is what makes a
single file possible at all. The three binary assets — the painted backdrop,
the title lettering and the candy atlas, 121 KB between them — get
base64-inlined. The one
remote reference left is the Google Fonts stylesheet, deliberately kept as a
progressive enhancement: online you get Baloo 2, offline you get the system
fallback and nothing breaks.)

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production bundle |
| `npm run build:standalone` | Bundle the whole game into one portable `.html` file |
| `npm run verify:standalone` | Prove that file runs offline, from `file://`, with no network |
| `npm test` | Headless rules soak test (1500 simulated moves) |
| `npm run test:boosters` | Stress the hammer / shuffle paths that plain swapping never reaches |
| `npm run test:calibrate` | Difficulty simulation across levels |
| `npm run shots` | Drives the real game in headless Chromium and screenshots it |
| `npm run art` | Re-optimise `art-src/*.png` → `src/assets/*.webp` (needs ImageMagick) |
| `npm run setup:chromium` | Fallback browser install, if Playwright's download is blocked |

---

## How it plays

Swipe to swap two adjacent candies. Line up three or more and they pop, the ones
above fall in, and any new matches cascade — each step in a chain scores more and
pitches the sound effect a note higher.

**Specials** are forged from bigger matches and are where the fireworks live:

| Match | Candy | Effect |
|---|---|---|
| 4 in a row | **Striped** | Clears the whole row or column |
| L / T shape | **Wrapped** | 3×3 detonation |
| 5 in a row | **Colour bomb** | Vaporises every candy of one colour |

Swapping two specials together combines them — striped + striped clears a full
cross, wrapped + wrapped is a 5×5 blast, and a colour bomb swapped onto a striped
candy turns every candy of that colour striped and sets them all off at once.

Three **boosters** per level: smash a single candy, reshuffle the board, or light up
a hint. If the board ever runs out of legal moves it reshuffles itself automatically.

---

## Where the juice comes from

"Juicy" isn't one effect, it's a pile of small ones firing together. Every candy
that pops triggers:

- **Shards** that tumble under gravity in the candy's own colours, each with a
  lit facet across the top so it reads as a solid chip rather than a lozenge
- **Additive sparks** for the bloom, on a separate render pass so the glow stacks
- **One thin shockwave ring**, with a second pulse only on boosted pops
- **Radiating speed lines** and **four-point glints**
- **Sugar dust** drifting upward
- **A physical shove to every neighbouring candy** — see below
- **Squash-and-stretch** — candies inflate before they implode, and land with a bounce
- **Screen shake** using a trauma model (shake² so small hits stay subtle and big
  ones really kick), plus **hit-stop** that freezes time for ~50 ms on a detonation
- **A screen flash**, colour-matched to whatever just exploded
- **Floating score text** that pops in with an elastic overshoot
- **Haptics** via `navigator.vibrate`, with a pattern per event type
- **A rising musical note** per cascade step, climbing a pentatonic ladder

### Neighbouring candies actually get hit

The effect that does the most work is the cheapest one. Every tile carries a
spring-damper displacement (`ox/oy`, `ovx/ovy`) layered on top of its grid
position at render time, so the logical board is never disturbed. When a candy
pops it shoves everything around it outward along the blast vector, with
inverse-square falloff and a bigger radius for specials; a landing candy thumps
whatever it lands on. Each shoved tile also gains `jelly`, a decaying sine that
stretches one axis while squeezing the other, with a per-tile phase so a row
never wobbles in lockstep.

The result is that a match doesn't just delete candies — the whole
neighbourhood recoils and springs back. Measured cost: **~2 ms/frame** under a
software rasteriser.

### Why more glow made it look worse

The particle system went through a pass whose entire goal was to make the
effects look *more expensive*, and almost all of it was subtraction. Four
things were adding brightness and removing quality.

**Every glow sprite had a white core.** Additive blending already drives
overlaps toward white, so seeding white on top guaranteed that any burst
collapsed into the same colourless flare — a red candy and a blue candy
exploded identically. The core is now pushed only 55% toward white, and the
falloff is tight rather than linear, so the bright part stays small and
overlapping sparks add detail instead of flooding. Bursts read as their own
colour again.

**Pure white was seeded into nearly every emitter** — fourteen places. Two
remain: the leading edge of the colour-bomb shockwave, and confetti, which is
paper rather than light.

**Every pop drew two shockwave rings.** Fine for one candy; a colour bomb
clearing ten reds drew twenty expanding circles and the board turned into
soap bubbles. A ring is punctuation. One per pop, thin, with the second pulse
reserved for pops that earn it.

**Rings were single hard strokes.** A stroked circle reads as geometry, not
energy, and widening it at low alpha just adds a second hard edge. Canvas
cannot gradient across a stroke, so rings are now four stacked strokes, each
roughly half the width and well over double the opacity of the one beneath —
close enough to a real falloff that no individual edge is findable.

What was *added* is shape, not brightness: a four-point glint sprite to
replace soft blobs in the sparkle role (a round blob two pixels across is
indistinguishable from dirt on the screen; a spiked one reads as deliberate),
per-shape decay envelopes so sparks snap out while smoke drifts, and a little
high-frequency flicker, because steady sparkle reads as dots rather than
lights.

It got *faster*: median frame time 80.9 ms to 73.2 ms, and p95 106 ms to
79.7 ms, since the ring budget was most of the worst-case overdraw.

### Light bloom

Everything emissive — additive particles, special-candy auras, anything
mid-pop — is drawn a second time into two small offscreen buffers (¼ and ⅒
scale) which are scaled back over the frame with `lighter`. The upscale *is*
the blur: the browser's bilinear filter does the work for free. Stacking two
radii, a tight core and a wide halo, is what stops it looking like a uniform
smear, and a real separable gaussian would cost several full-resolution passes
to buy very little at these sizes.

It is the most expensive single thing the game draws, so it is the first thing
to go: the same rolling frame average that scales particle counts drops the
wide halo at ~28ms/frame and the whole pass at ~40ms. On a GPU it stays on.

### Candies are lit, not just coloured

The sprite shading is built from the dark end of the ramp rather than by piling
on white: a five-stop body gradient, subsurface scattering bleeding through the
middle, ambient occlusion opposite the key light, a hue-tinted bounce light
climbing the bottom edge, a bevel lip on the top-left, and a tight specular hot
spot. The first attempt used the bright end for all of it and every candy came
out looking like pastel chalk — form has to come from shadow.

```
src/fx/
  particles.ts   pooled, zero-allocation particle system (2600 slots)
  emitters.ts    named presets — candyPop, explosion, bombBurst, stripeBeam…
  floaters.ts    score / combo popups
  shake.ts       trauma-based shake, hit-stop and screen flash
```

### Making it fast enough for a phone

The naïve version of this ran at ~15 fps under a software rasteriser. Two changes
did most of the work:

0. **Judge an effect at a fixed offset, not whenever the screenshot lands.**
   `npm run shots` catches an arbitrary frame, which is useless for something
   that lives 400 ms; `npm run fx` fires one named effect and captures the
   board at 60/120/200/320/460 ms so two versions can be compared frame for
   frame. Every particle change above was made against those captures.

1. **Bake every gradient once.** `createRadialGradient` per particle per frame is
   the single most expensive thing you can do in Canvas 2D. Particle glows, comet
   streaks, background bokeh and the vignette are all pre-rendered into small
   offscreen canvases and blitted instead.
2. **Bake the static layers.** The board frame, its `shadowBlur`, and all 63 cell
   tiles never change, so they're rendered once per resize into one canvas and
   drawn with a single `drawImage`.

Measured in the same headless software-rendered environment, that took the frame
time from **65 ms → ~48 ms** (the harness reports it on every run). On a real
device with GPU compositing there's a lot more headroom — and the particle system
still scales its own emission counts down automatically if frames start slipping.

The same discipline paid off again later: adding drifting light rays, twinkling
stars and a stage-light pool to the background *lowered* the board's frame time
from 45.4 ms to **40.0 ms**, because the aurora and glow layers they replaced
were being composited live every frame and are now folded into the baked base.
Measured with bloom forced on, the full-quality path costs 58.3 ms.

---

## Architecture

```
src/
  main.ts                 boot
  core/
    game.ts               the shell: layout, HUD, input routing, game states
    game-config.ts        level curve + board size  (deliberately DOM-free)
    board.ts              the rule engine          (deliberately DOM-free)
    input.ts              pointer / touch / mouse plumbing
    types.ts  rng.ts      shared vocabulary and easing
  render/
    sprites.ts            procedural candy art, cached per size
    background.ts         painted backdrop + live rays, stars, bokeh
    bloom.ts              two-radius glow post-process (adaptive)
  fx/                     particles, emitters, floaters, screen shake
  assets/                 the three image files — see docs/art-notes.md
  ui/
    hud.ts  icons.ts      canvas widgets and vector glyphs
  audio/sfx.ts            Web Audio synthesis
```

`board.ts` and `game-config.ts` don't touch the DOM. That's the load-bearing
decision in the whole project: it means the rules and the balance can be tested
headlessly at thousands of moves per second, without a browser.

### Two images, and everything else is code

The game ships three binary assets totalling 121 KB: a painted backdrop
(19 KB), the title lettering (45 KB) and a candy atlas (56 KB — six bodies
plus the colour bomb, 3x3 at 256px a cell). Every button, icon, star,
particle, stripe and wrapper is still drawn from code at runtime.

The candies were procedural too, until they weren't. The argument for keeping
them that way was that they get scaled, squashed, stretched, rotated and drawn
at arbitrary cell sizes — but sprites do all of that fine. The only thing they
genuinely can't do is recolour, and that was never needed: six hues means six
sprites. What canvas gradients genuinely can't do is a lacquered edge, a
luminous core and a tight specular hotspot at once, and across 63 pieces that
gap is the whole look of the game. Swapping them in also cut the frame time,
because a blit beats six gradients per piece.

What stayed procedural is what actually wants to be: the per-piece contact
shadow (drawn with `destination-over` so it tucks behind), and the stripe and
wrapper overlays (drawn with `source-atop`, which clips them to the painted
silhouette exactly — a geometric clip path no longer lines up with it).

Those overlays **measure the art rather than assuming it**. Stripe opacity has
to scale with how bright a candy is — white ribs read beautifully on the
strawberry and bleach the lemon to white — and reading that brightness off
`PALETTE` only worked for one particular set of pictures. `measureAtlas()`
downsamples each cell to 8x8 on load and takes the mean luminance of the
opaque pixels instead. Redraw the atlas and the overlays retune themselves,
which is what made swapping the whole candy style safe.

`docs/art-notes.md` has the generation prompts, the cut-out pipeline and the
format comparison that landed on WebP (it beat palette PNG on both size *and*
quality, which does not happen often).

The painting does **not** replace the animated background — the drifting light
shafts, twinkling stars, floating bokeh and vignette still run on top of it. A
static image alone reads as dead wallpaper.

### Candies are drawn, not loaded

Six candy families (jelly square, drop, star, hexagon, sphere, rhombus) are drawn
as paths with a radial body gradient, a rim light, a gloss highlight and an
outline. Each `(colour, special)` combination is rendered once into an offscreen
canvas at the current cell size and blitted from then on — so per-frame cost is a
`drawImage`, and changing the board size just rebuilds the cache.

---

## Testing

### `npm test` — rules soak test

Runs the real `Board` class headlessly at a fixed timestep for 1500 moves and
asserts the invariants that matter after *every single move*:

- the grid never has a hole once settled
- no un-cleared match is ever left behind
- visual positions always converge to logical positions (no desynced tiles)
- a legal move always exists when control returns to the player
- the resolver always terminates
- every settled tile is actually *drawable* — see below

Plus targeted fixtures for each rule — 4-in-a-row forges a striped candy, 5 forges
a colour bomb, an L-shape forges a wrapped candy, a striped candy chain-clears its
row, a colour bomb clears every candy of its colour, and a provably dead board
auto-shuffles into a playable one.

```
✓ initial deal (7x9) is match-free and playable
✓ 4-in-a-row forges a striped candy
✓ 5-in-a-row forges a colour bomb
✓ L-shaped match forges a wrapped candy
✓ striped candy chain-clears its entire row
✓ colour bomb cleared all 10 candies of one colour
✓ dead board auto-shuffles into a playable one
✅ all invariants held
```

### The bug that hid between two passing checks

A player reported cells that looked empty and never refilled. The soak test was
green, because it asked the wrong question. It checked `tiles[i] !== null` — is
a cell occupied? — and every cell *was* occupied.

When a match of 4+ forges a special candy, the new tile was created with both
`spawnT = 0` (which animates up, driving the pop-in) and `scale = 0` (which
nothing ever animates back). The renderer multiplies the two and skips anything
below `0.01`, so the candy was never drawn — while still occupying its cell, so
gravity skipped it too. A permanent gap, appearing only after a match of 4 or
more, which is exactly why it felt random.

The fix is one deleted line; `spawnT` alone already expresses the pop-in. The
lasting change is the invariant, which now mirrors the renderer's own test:

```js
const drawn = t.scale * (t.spawnT < 1 ? t.spawnT : 1);
if (!(drawn > 0.01)) fail(`cell looks empty but never refills`);
```

Verified as a real regression guard by re-introducing the bug with the check in
place: `❌ tile 319 at 3,2 is invisible after move 74 (scale=0, spawnT=1)`.

`npm run test:boosters` was added at the same time, because the soak only ever
*swapped* — the hammer and shuffle buttons were never exercised by any test.

### `npm run test:calibrate` — difficulty simulation

A greedy bot (always takes the move that clears the most) plays 400 boards per
level and reports the score distribution against the level's target.

This caught a real balance bug. Score per move is essentially *flat* — around
365 points with six colours — but the original targets grew linearly, so by
level 5 the levels were mathematically unwinnable:

```
 lvl   target   median   clear-rate
   4    9,979    8,000       23%     ← impossible for most players
   8   16,694    8,090        1%
```

Targets are now priced as a fraction of what a good player is *expected* to
score, easing from 45% up to an asymptote — which produces a curve that actually
ramps:

```
 lvl  col  moves    target   median      p25      p75  clear  3-star
   1    5     15     4,250    9,400    6,940   12,865    97%     74%
   3    6     25     5,000    9,180    7,575   10,695   100%     63%
   6    6     25     6,000    9,090    7,690   10,920    97%     37%
  10    6     24     6,750    8,725    7,305   10,505    84%     18%
  20    6     22     7,500    8,130    6,635    9,820    59%      7%
```

The constants that shape this all live in `src/core/game-config.ts`, and the
simulator imports the same file the game ships — so the numbers can't drift apart.

### `npm run shots` — visual smoke test

Drives the actual game in headless Chromium at an iPhone viewport: taps PLAY
through the game's own hit-testing, asks the board for legal moves and swipes
them, forces each special to detonate, and screenshots the result. It fails the
run on any console error, uncaught exception or failed request, checks the canvas
isn't blank, and reports frame timings.

Requires a browser:

```bash
npx playwright install chromium   # the normal way
npm run shots
```

If that download is blocked (locked-down CI, a sandbox with a partial egress
allowlist), there's a fallback that pulls a prebuilt Chromium from the npm
registry instead, together with the shared libraries and software GL driver it
needs:

```bash
eval "$(npm run --silent setup:chromium)"   # exports CHROME_BIN + CHROME_LIBS
npm run shots
```

`shots.mjs` uses `CHROME_BIN` / `CHROME_LIBS` when they're set and Playwright's
own browser otherwise, so neither path is special-cased in the test itself.

---

## Notes

- **Board shape is 7×9, not square.** A portrait phone is far taller than it is
  wide; a square grid either leaves a third of the screen empty or shrinks the
  candies. Tall-and-narrow fills the screen and makes each candy ~20% bigger,
  which matters a lot for thumbs.
- **Icons are vector paths, not emoji.** Emoji were the quick option, but they
  render as tofu boxes wherever there's no emoji font (including the test
  harness, which is how this got caught) and their metrics vary per platform.
- **Progress persists** in `localStorage`: current level, best score, mute state.
- Safe-area insets are respected, so the HUD and booster bar clear the notch and
  the home indicator.
