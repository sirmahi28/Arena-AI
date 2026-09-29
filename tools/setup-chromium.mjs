#!/usr/bin/env node
/**
 * Provision a headless Chromium for `npm run shots`.
 *
 * The normal way to get one is `npx playwright install chromium`. Use this
 * script only when that fails — typically a sandbox or CI box where
 * Playwright's CDN is unreachable but the npm registry is not. It pulls the
 * prebuilt browser from the `@sparticuz/chromium` package instead and unpacks
 * it (plus its bundled shared libraries and the SwiftShader software
 * rasteriser) into a cache directory.
 *
 *   node tools/setup-chromium.mjs           # provision, print the env vars
 *   node tools/setup-chromium.mjs --print   # just print them if already there
 *
 * It prints CHROME_BIN / CHROME_LIBS, which tools/shots.mjs picks up:
 *
 *   eval "$(node tools/setup-chromium.mjs --print)" && npm run shots
 */
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PKG = '@sparticuz/chromium@153';
const ROOT = process.env.CHROMIUM_CACHE ?? join(tmpdir(), 'sugar-rush-chromium');
const BIN = join(ROOT, 'chrome');
const LIBS = join(ROOT, 'lib');
const SWIFTSHADER = join(ROOT, 'swiftshader');
const printOnly = process.argv.includes('--print');

/** Everything shots.mjs needs, in a form you can `eval` in a shell. */
const envLines = () => [`export CHROME_BIN=${BIN}`, `export CHROME_LIBS=${LIBS}:${SWIFTSHADER}`];

const done = () => {
  console.log(envLines().join('\n'));
  process.exit(0);
};

if (existsSync(BIN) && existsSync(LIBS)) done();

if (printOnly) {
  console.error(`No Chromium at ${BIN}. Run: node tools/setup-chromium.mjs`);
  process.exit(1);
}

const log = (m) => console.error(m);
log(`→ provisioning Chromium into ${ROOT}`);
log('  (only needed when `npx playwright install chromium` is blocked)');

const scratch = mkdtempSync(join(tmpdir(), 'chromium-dl-'));
try {
  log(`→ npm install ${PKG}`);
  // --no-save/--no-package-lock: this is a throwaway tree, not a project dep.
  execFileSync('npm', ['install', '--silent', '--no-save', '--no-package-lock', PKG], {
    cwd: scratch,
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  const binDir = join(scratch, 'node_modules', '@sparticuz', 'chromium', 'bin');
  if (!existsSync(join(binDir, 'chromium.br'))) {
    throw new Error(`unexpected package layout: no chromium.br in ${binDir}`);
  }

  mkdirSync(ROOT, { recursive: true });
  mkdirSync(SWIFTSHADER, { recursive: true });

  log('→ decompressing the browser binary (~67 MB)');
  writeFileSync(BIN, brotliDecompressSync(readFileSync(join(binDir, 'chromium.br'))));
  chmodSync(BIN, 0o755);

  // The bundled libraries (libnss3 et al) and the software GL driver. The host
  // may well not have these, which is the whole point of shipping them.
  // al2023.tar.br already has a `lib/` prefix, so it unpacks into ROOT and
  // lands in ROOT/lib; swiftshader.tar.br is flat and needs its own directory.
  for (const [archive, dest] of [
    ['al2023.tar.br', ROOT],
    ['swiftshader.tar.br', SWIFTSHADER],
  ]) {
    log(`→ unpacking ${archive}`);
    const tar = join(scratch, archive.replace(/\.br$/, ''));
    writeFileSync(tar, brotliDecompressSync(readFileSync(join(binDir, archive))));
    execFileSync('tar', ['-xf', tar, '-C', dest], { stdio: 'inherit' });
  }

  // Deliberately NOT unpacking fonts.tar.br: that bundle ships a fontconfig
  // setup which, pointed at via FONTCONFIG_PATH, suppresses *all* canvas glyph
  // rendering here. The system fonts render fine, so leave fontconfig alone.

  log('→ verifying');
  const out = execFileSync(BIN, ['--version'], {
    env: { ...process.env, LD_LIBRARY_PATH: `${LIBS}:${SWIFTSHADER}` },
    encoding: 'utf8',
  }).trim();
  log(`✅ ${out}`);
} catch (err) {
  rmSync(ROOT, { recursive: true, force: true });
  log(`\n❌ could not provision Chromium: ${err.message}`);
  log('   Try `npx playwright install chromium` instead.');
  process.exit(1);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

done();
