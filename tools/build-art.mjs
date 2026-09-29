#!/usr/bin/env node
/**
 * Turn the raw generated art in art-src/ into the optimised assets the game
 * ships:
 *
 *   art-src/bg-raw.png     →  src/assets/bg.webp           (~19 KB)
 *   art-src/logo-raw.png   →  src/assets/logo.webp         (~46 KB)
 *   art-src/candy-B.png  ⎤
 *   art-src/bomb-raw.png ⎦ →  src/assets/candy-atlas.webp  (~63 KB)
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

target('candy-atlas.webp', ['art-src/candy-B.png', 'art-src/bomb-raw.png'], () => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  convert(['art-src/candy-B.png', '-crop', '3x2@', '+repage', `${TMP}/t-%d.png`]);
  execFileSync('cp', ['art-src/bomb-raw.png', `${TMP}/t-6.png`]);

  for (let i = 0; i < REACH.length; i++) {
    const side = Math.round(REACH[i] * CELL);
    cutout(`${TMP}/t-${i}.png`, `${TMP}/n-${i}.png`, [
      '-resize', `${side}x${side}`,
      '-background', 'none',
      '-gravity', 'center',
      '-extent', `${CELL}x${CELL}`,
    ]);
  }
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

for (const name of built) console.log(`  rebuilt  ${OUT}/${name}  ${kb(`${OUT}/${name}`)}`);
for (const s of skipped) console.log(`  skipped  ${s} (kept the committed file)`);

if (!built.length) {
  console.log('\nNothing to rebuild — no raw art present. Committed assets untouched.');
} else {
  console.log('\n✅ art rebuilt');
}
