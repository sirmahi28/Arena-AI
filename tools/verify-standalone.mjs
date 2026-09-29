#!/usr/bin/env node
/**
 * Verify dist-standalone/sugar-rush.html really is self-contained.
 *
 *   node tools/verify-standalone.mjs
 *
 * Opens the file over file:// with **every network request aborted**, so the
 * run proves the game needs nothing but the one file: no dev server, no CDN,
 * not even the Google Fonts stylesheet. Then it plays a move through the
 * game's own hit-testing and checks the canvas is actually painting.
 *
 * Browser resolution matches tools/shots.mjs: Playwright's own Chromium by
 * default, or CHROME_BIN / CHROME_LIBS when set.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:url';
import { pathToFileURL } from 'node:url';

const FILE = 'dist-standalone/sugar-rush.html';
if (!existsSync(FILE)) {
  console.error(`✗ ${FILE} not found — run: node tools/build-standalone.mjs`);
  process.exit(1);
}
mkdirSync('tools/shots', { recursive: true });

const launchOpts = {
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--font-render-hinting=none',
    '--autoplay-policy=no-user-gesture-required',
  ],
};
if (process.env.CHROME_BIN) {
  launchOpts.executablePath = process.env.CHROME_BIN;
  if (process.env.CHROME_LIBS) {
    launchOpts.env = {
      ...process.env,
      LD_LIBRARY_PATH: [process.env.CHROME_LIBS, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
    };
  }
}

const browser = await chromium.launch(launchOpts);
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();

const problems = [];
// We abort every network request on purpose, so the resulting load failures
// are the expected outcome, not a defect. Anything else is real.
const EXPECTED = /net::ERR_FAILED|Failed to load resource/i;
page.on('console', (m) => {
  if (m.type() === 'error' && !EXPECTED.test(m.text())) problems.push(`console: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

// Hard offline: abort anything that isn't the local file itself.
let blocked = 0;
await page.route('**/*', (route) => {
  const url = route.request().url();
  if (url.startsWith('file://')) return route.continue();
  blocked++;
  return route.abort();
});

const url = pathToFileURL(resolve(process.cwd() + '/', FILE)).href;
console.log(`→ opening ${FILE} over file:// with all network blocked`);
await page.goto(url, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(2200);

const wait = (ms) => page.waitForTimeout(ms);

// 1. the game object booted at all
const booted = await page.evaluate(() => !!window.__game);
if (!booted) problems.push('window.__game was never created — the bundle did not boot');

// 2. the canvas is painting something with real colour variety
const canvas = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return { ok: false, why: 'no canvas element' };
  const g = c.getContext('2d');
  const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
  const seen = new Set();
  let nonBlack = 0;
  for (let i = 0; i < data.length; i += 4 * 97) {
    const [r, gg, b] = [data[i], data[i + 1], data[i + 2]];
    if (r + gg + b > 24) nonBlack++;
    seen.add((r >> 3) + ',' + (gg >> 3) + ',' + (b >> 3));
  }
  return { ok: true, width, height, nonBlack, distinct: seen.size };
});
console.log(`  canvas: ${JSON.stringify(canvas)}`);
if (!canvas.ok) problems.push(canvas.why);
else if (canvas.distinct < 20) problems.push(`canvas looks blank (${canvas.distinct} distinct colours)`);

await page.screenshot({ path: 'tools/shots/standalone-01-menu.png' });

// 3. it is actually interactive: press PLAY, then make a legal move
const tap = async (id) => {
  const p = await page.evaluate((b) => window.__game?.debugButtonCenter?.(b), id);
  if (!p) return false;
  await page.mouse.click(p.x, p.y);
  return true;
};
if (!(await tap('primary'))) problems.push('PLAY button was not hit-testable');
await wait(900);

const phase = await page.evaluate(() => window.__game?.debugPhase?.());
console.log(`  phase after PLAY: ${phase}`);
if (phase !== 'playing') problems.push(`expected phase "playing", got "${phase}"`);

const swiped = await page.evaluate(() => {
  const g = window.__game;
  const L = g?.debugLayout?.();
  const mv = g?.debugBoard?.()?.findAnyMove?.();
  if (!L || !mv) return null;
  const cx = (c) => L.bx + (c + 0.5) * L.cell;
  const cy = (r) => L.by + (r + 0.5) * L.cell;
  return { x1: cx(mv.a % L.cols), y1: cy((mv.a / L.cols) | 0), x2: cx(mv.b % L.cols), y2: cy((mv.b / L.cols) | 0) };
});
if (!swiped) problems.push('no legal move was offered by the board');
else {
  await page.mouse.move(swiped.x1, swiped.y1);
  await page.mouse.down();
  await page.mouse.move(swiped.x2, swiped.y2, { steps: 8 });
  await page.mouse.up();
  await wait(700);
  const parts = await page.evaluate(() => window.__game?.debugParticleCount?.() ?? 0);
  console.log(`  particles alive after one match: ${parts}`);
  if (parts <= 0) problems.push('the match produced no particles — FX did not run');
  await page.screenshot({ path: 'tools/shots/standalone-02-match.png' });
}

console.log(`  network requests blocked: ${blocked} (fonts etc. — all non-fatal)`);

await browser.close();

if (problems.length) {
  console.error('\n❌ standalone build FAILED:');
  for (const p of problems) console.error(`   • ${p}`);
  process.exit(1);
}
console.log('\n✅ runs fully offline from a single file: boots, paints, accepts input, FX fire');
