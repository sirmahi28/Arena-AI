#!/usr/bin/env node
/**
 * Turn the raw generated art in art-src/ into the optimised assets the game
 * actually ships:
 *
 *   art-src/bg-raw.png    →  src/assets/bg.webp     (~19 KB)
 *   art-src/logo-raw.png  →  src/assets/logo.webp   (~46 KB)
 *
 *   node tools/build-art.mjs        (or: npm run art)
 *
 * Only the optimised output is committed. The raw art is ~2.7 MB of
 * intermediate and is git-ignored — see docs/art-notes.md for the prompts
 * that produced it, so it can be regenerated from scratch if needed.
 *
 * Why WebP: the logo needs a real alpha channel, and the alternatives all
 * cost more for less. Measured on this exact logo at 560px wide:
 *
 *   full-colour PNG                346 KB
 *   PNG-8, 256 colours              83 KB   banding in the gradients
 *   PNG-8, 64 colours + dither      60 KB   visible dither speckle
 *   JPEG colour + PNG alpha mask    67 KB   needs runtime compositing
 *   WebP q82                        46 KB   clean, one file
 *
 * The background is nothing but smooth gradients, which is the best case for
 * a lossy codec: 800x1710 lands at 19 KB.
 *
 * Requires ImageMagick (`convert`), which is present on the build box. If it
 * is missing this script fails loudly rather than silently shipping stale
 * assets — the committed .webp files mean a normal `npm run build` never
 * needs it.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, statSync } from 'node:fs';

const OUT = 'src/assets';

function have(cmd) {
  try {
    execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!have('convert')) {
  console.error('ImageMagick `convert` not found — cannot rebuild art.');
  console.error('The committed files in src/assets/ are still valid; nothing was changed.');
  process.exit(1);
}

for (const f of ['art-src/bg-raw.png', 'art-src/logo-raw.png']) {
  if (!existsSync(f)) {
    console.error(`missing ${f} — see docs/art-notes.md to regenerate the raw art`);
    process.exit(1);
  }
}

mkdirSync(OUT, { recursive: true });
const kb = (p) => `${(statSync(p).size / 1024).toFixed(1)} KB`;

// ---- background -----------------------------------------------------------
// Cover-cropped to a tall phone ratio. It is drawn scaled-to-cover at runtime
// too, so this only has to be close; 800px wide is ~1.03x a 390pt screen at
// dsf 2 and upscales invisibly on anything larger because it is all gradient.
execFileSync('convert', [
  'art-src/bg-raw.png',
  '-resize', '800x1710^',
  '-gravity', 'center',
  '-extent', '800x1710',
  '-strip',
  '-quality', '88',
  `${OUT}/bg.webp`,
]);

// ---- logo -----------------------------------------------------------------
// The generator puts the lettering on a flat grey field. Flood-fill it away
// from all four corners rather than keying on the colour globally, so the
// grey-ish pixels *inside* the artwork survive. 18% fuzz is enough to catch
// the sensor-noise variation in the field without eating the drop shadow.
const corners = [
  ['+2+2'],
  ['+1405+2'],
  ['+2+765'],
  ['+1405+765'],
];
execFileSync('convert', [
  'art-src/logo-raw.png',
  '-alpha', 'set',
  '-fuzz', '18%',
  ...corners.flatMap(([at]) => ['-fill', 'none', '-floodfill', at, 'srgb(133,133,133)']),
  '-trim', '+repage',
  '-resize', '560x',
  '-strip',
  '-quality', '82',
  '-define', 'webp:alpha-quality=95',
  `${OUT}/logo.webp`,
]);

console.log(`  ${OUT}/bg.webp    ${kb(`${OUT}/bg.webp`)}`);
console.log(`  ${OUT}/logo.webp  ${kb(`${OUT}/logo.webp`)}`);
console.log('\n✅ art rebuilt');
