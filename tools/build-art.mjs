#!/usr/bin/env node
/**
 * Turn the raw generated art in art-src/ into the optimised assets the game
 * ships:
 *
 *   art-src/bg-raw.png     →  src/assets/bg.webp           (~19 KB)
 *   art-src/logo-raw.png   →  src/assets/logo.webp         (~46 KB)
 *   art-src/candy-sheet.png ⎤
 *   art-src/bomb-cell.png   ⎦ →  src/assets/candy-atlas.webp  (~63 KB)
 *
 *   node tools/build-art.mjs        (or: npm run art)
 *
 * Only the optimised output is committed; the raw art is git-ignored (~5 MB
 * of intermediate). Each target is therefore built **independently and only
 * if its sources are present** — a missing source skips that one target and
 * leaves the committed .webp alone, rather than failing the whole run. The
 * shipped files are valid regardless; you never need this script to build or
 * play the game.
 *
 * docs/art-notes.md has the generation prompts, so the raw art can be
 * recreated from scratch if it is ever needed.
 *
 * Why WebP: the logo and the candies both need a real alpha channel, and the
 * alternatives all cost more for less. Measured on the logo at 560px wide:
 *
 *   full-colour PNG                346 KB
 *   PNG-8, 256 colours              83 KB   banding in the gradients
 *   PNG-8, 64 colours + dither      60 KB   visible dither speckle
 *   JPEG colour + PNG alpha mask    67 KB   needs runtime compositing
 *   WebP q82                        46 KB   clean, one file
 *
 * Requires ImageMagick (`convert` and `montage`).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, statSync, rmSync } from 'node:fs';

const OUT = 'src/assets';
const TMP = 'art-src/.atlas-tmp';

const run = (cmd, args) => execFileSync(cmd, args).toString().trim();
const convert = (args) => execFileSync('convert', args);
const kb = (p) => `${(statSync(p).size / 1024).toFixed(1)} KB`;

function have(cmd) {
  try {
    execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!have('convert') || !have('montage')) {
  console.error('ImageMagick (convert + montage) not found — cannot rebuild art.');
  console.error(`The committed files in ${OUT}/ are still valid; nothing was changed.`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const built = [];
const skipped = [];

/** Run `fn` only if every source exists, so one missing input can't fail the rest. */
function target(name, sources, fn) {
  const missing = sources.filter((f) => !existsSync(f));
  if (missing.length) {
    skipped.push(`${name} — no ${missing.join(', ')}`);
    return;
  }
  fn();
  built.push(name);
}

/**
 * Key a flat background out from behind generated art.
 *
 * Flood-filling inward from all four corners rather than keying on the colour
 * globally is what keeps grey-ish pixels *inside* the artwork alive. Each
 * corner is sampled separately because the generator's "flat" field is never
 * quite flat, and on a sliced grid every tile has its own shade.
 */
function cutout(src, dst, extra = []) {
  const grey = run('convert', [src, '-format', '%[pixel:p{3,3}]', 'info:']);
  const w = Number(run('convert', [src, '-format', '%w', 'info:']));
  const h = Number(run('convert', [src, '-format', '%h', 'info:']));
  const corners = ['+2+2', `+${w - 3}+2`, `+2+${h - 3}`, `+${w - 3}+${h - 3}`];
  convert([
    src,
    '-alpha', 'set',
    '-fuzz', '14%',
    ...corners.flatMap((at) => ['-fill', 'none', '-floodfill', at, grey]),
    '-trim', '+repage',
    ...extra,
    dst,
  ]);
}

// ---- background -----------------------------------------------------------
// Cover-cropped to a tall phone ratio. It is drawn scale-to-cover at runtime
// too, so this only has to be close; 800px wide is ~1.03x a 390pt screen at
// dsf 2, and it upscales invisibly on anything larger because it is all
// gradient.
target('bg.webp', ['art-src/bg-raw.png'], () => {
  convert([
    'art-src/bg-raw.png',
    '-resize', '800x1710^',
    '-gravity', 'center',
    '-extent', '800x1710',
    '-strip',
    '-quality', '88',
    `${OUT}/bg.webp`,
  ]);
});

// ---- logo -----------------------------------------------------------------
target('logo.webp', ['art-src/logo-raw.png'], () => {
  cutout('art-src/logo-raw.png', `${OUT}/logo.webp`, [
    '-resize', '560x',
    '-strip',
    '-quality', '82',
    '-define', 'webp:alpha-quality=95',
  ]);
});

// ---- candy atlas ----------------------------------------------------------
// Six candy bodies plus the colour bomb, packed 3x3 at 256px a cell. Cells
// 0-5 are the hues in PALETTE order, cell 6 is the bomb, 7-8 are spare.
//
// Each piece is normalised to a per-shape "reach" — the fraction of the 2r
// box its bounding box should span — lifted from candyPath(), so the painted
// art lands in the same silhouette budget the procedural art used. Without
// it the star (mostly empty space) would look tiny beside the sphere.
const REACH = [0.88, 0.84, 1.0, 0.97, 0.93, 0.99, 0.98];
const CELL = 256;

target('candy-atlas.webp', ['art-src/candy-sheet.png', 'art-src/bomb-cell.png'], () => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  convert(['art-src/candy-sheet.png', '-crop', '3x2@', '+repage', `${TMP}/t-%d.png`]);

  for (let i = 0; i < 6; i++) {
    const side = Math.round(REACH[i] * CELL);
    cutout(`${TMP}/t-${i}.png`, `${TMP}/n-${i}.png`, [
      '-resize', `${side}x${side}`,
      '-background', 'none',
      '-gravity', 'center',
      '-extent', `${CELL}x${CELL}`,
    ]);
  }
  // The bomb comes in pre-cut and pre-normalised, so it skips the pipeline
  // above. Its raw render was lost; this cell was recovered from the shipped
  // atlas, which is the same art either way.
  execFileSync('cp', ['art-src/bomb-cell.png', `${TMP}/n-6.png`]);
  convert(['-size', `${CELL}x${CELL}`, 'xc:none', `${TMP}/n-blank.png`]);

  execFileSync('montage', [
    ...REACH.map((_, i) => `${TMP}/n-${i}.png`),
    `${TMP}/n-blank.png`,
    `${TMP}/n-blank.png`,
    '-tile', '3x3',
    '-geometry', '+0+0',
    '-background', 'none',
    `PNG32:${TMP}/atlas.png`,
  ]);
  convert([
    `${TMP}/atlas.png`,
    '-strip',
    '-quality', '88',
    '-define', 'webp:alpha-quality=100',
    `${OUT}/candy-atlas.webp`,
  ]);
  rmSync(TMP, { recursive: true, force: true });
});

/**
 * Sample PALETTE straight out of the atlas.
 *
 * Particles, glows and combo text are tinted from PALETTE, so if it is
 * hand-picked it drifts away from the art and bursts stop matching the candy
 * that produced them. Deriving it removes the chance to get that wrong.
 *
 * Only mid-tone body pixels are sampled: include the specular hotspot and the
 * "colour" comes out white, include the rim and it comes out near-black.
 *
 * Printed rather than written, because clobbering a source file from a build
 * script is a nasty surprise. Paste it into src/core/types.ts.
 */
// ---- UI icon atlas --------------------------------------------------------
/*
 * Eight UI icons packed 4x2 at 192px a cell.
 *
 * These were hand-shaded vector paths for a long time and it was the right
 * default — no asset, tintable, scales anywhere. What killed it is the size
 * they are actually drawn at: 33 CSS pixels. Every technique that makes a
 * vector glyph read as an object — swept extrusion, upper-left gloss,
 * ambient occlusion, rim light — lands inside two or three pixels at that
 * scale and averages back out to a flat coloured shape. Rendering them once
 * at 192px and downscaling keeps all of it.
 *
 * Cell size is generous on purpose: the largest a HUD icon ever gets is
 * 33 CSS px at dpr 3, so 192 leaves nearly 2x headroom and the whole sheet
 * still costs less than the logo.
 *
 * `REACH_ICON` normalises how much of its cell each icon fills, by its
 * *longest* side. Without it the play triangle and the light bulb — very
 * different aspect ratios — end up looking like different point sizes on the
 * same button row.
 */
const ICON_CELL = 192;
const ICON_COLS = 4;
const ICON_IDS = [
  'hammer',
  'shuffle',
  'bulb',
  'restart',
  'sound-on',
  'sound-off',
  'play',
  'next',
];
// Tuned by eye against the rendered footer, not by bounding box: a hollow
// shape like the restart loop has to run larger than a solid one like the
// play triangle to carry the same weight.
const REACH_ICON = [0.94, 0.92, 0.9, 0.94, 0.9, 0.9, 0.82, 0.88];

target('icon-atlas.webp', ['art-src/icons-raw.png'], () => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  convert(['art-src/icons-raw.png', '-crop', '4x2@', '+repage', `${TMP}/i-%d.png`]);

  for (let i = 0; i < ICON_IDS.length; i++) {
    const side = Math.round(REACH_ICON[i] * ICON_CELL);
    cutout(`${TMP}/i-${i}.png`, `${TMP}/ic-${i}.png`, [
      // `>` is deliberately absent: fit the longest side to `side` either
      // way, so a small render is scaled up to match its neighbours.
      '-resize', `${side}x${side}`,
      '-background', 'none',
      '-gravity', 'center',
      '-extent', `${ICON_CELL}x${ICON_CELL}`,
    ]);
  }

  run('montage', [
    ...ICON_IDS.map((_, i) => `${TMP}/ic-${i}.png`),
    '-tile', `${ICON_COLS}x2`,
    '-geometry', `${ICON_CELL}x${ICON_CELL}+0+0`,
    '-background', 'none',
    `${TMP}/icon-atlas.png`,
  ]);

  convert([
    `${TMP}/icon-atlas.png`,
    '-strip',
    '-quality', '86',
    '-define', 'webp:alpha-quality=96',
    `${OUT}/icon-atlas.webp`,
  ]);
});

function samplePalette() {
  const names = ['strawberry', 'orange', 'lemon', 'apple', 'blueberry', 'grape'];
  const rgbToHsl = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn;
    const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  };
  const hslToHex = (h, s, l) => {
    s = Math.min(1, Math.max(0, s)); l = Math.min(1, Math.max(0, l));
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h * 6) % 2) - 1)), m = l - c / 2;
    const seg = Math.floor(h * 6) % 6;
    const [r, g, b] = [[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]][seg];
    const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return `#${to(r)}${to(g)}${to(b)}`;
  };

  const lines = [];
  for (let i = 0; i < 6; i++) {
    const x = (i % 3) * CELL, y = Math.floor(i / 3) * CELL;
    // 256x256 of "x,y: (r,g,b,a)" text is a few MB; the default 1 MB pipe
    // buffer is nowhere near enough.
    const txt = execFileSync(
      'convert',
      [`${OUT}/candy-atlas.webp`, '-crop', `${CELL}x${CELL}+${x}+${y}`, '+repage', '-depth', '8', 'txt:-'],
      { maxBuffer: 64 * 1024 * 1024 },
    ).toString();
    let n = 0, sr = 0, sg = 0, sb = 0;
    for (const line of txt.split('\n').slice(1)) {
      const m = line.match(/\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)/);
      if (!m) continue;
      if (m[4] !== undefined && Number(m[4]) < 0.95) continue;
      const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const [, sat, lum] = rgbToHsl(r, g, b);
      if (lum <= 0.3 || lum >= 0.7 || sat <= 0.4) continue;
      n++; sr += r; sg += g; sb += b;
    }
    if (!n) { lines.push(`  // ${names[i]}: no usable sample`); continue; }
    const [br, bg, bb] = [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)];
    const [h, sat, lum] = rgbToHsl(br, bg, bb);
    const hex = `#${[br, bg, bb].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    // Saturation is pushed UP as lightness rises. Letting it fall, the way a
    // naive HLS lighten does, gives pastel chalk — and in additive particles a
    // desaturated tint reads as grey ash rather than candy.
    lines.push(
      `  ['${hex}', '${hslToHex(h, Math.min(1, sat * 1.18), lum + 0.2)}', ` +
      `'${hslToHex(h, Math.min(1, sat * 1.1), lum * 0.42)}', ` +
      `'${hslToHex(h, Math.min(1, sat), lum + 0.36)}'], // ${i} ${names[i]}`,
    );
  }
  console.log('\nPALETTE sampled from the atlas — paste into src/core/types.ts:\n');
  console.log('export const PALETTE: ReadonlyArray<readonly [string, string, string, string]> = [');
  console.log(lines.join('\n'));
  console.log('];');
}

for (const name of built) console.log(`  rebuilt  ${OUT}/${name}  ${kb(`${OUT}/${name}`)}`);
for (const s of skipped) console.log(`  skipped  ${s} (kept the committed file)`);

if (!built.length) {
  console.log('\nNothing to rebuild — no raw art present. Committed assets untouched.');
} else {
  console.log('\n✅ art rebuilt');
  if (built.includes('candy-atlas.webp')) samplePalette();
}
