/**
 * Visual smoke test: drives the real game in headless Chromium at a phone
 * viewport, plays a few moves, and captures screenshots. Also fails loudly on
 * any console error / uncaught exception, which is the cheapest way to catch
 * a broken render path.
 *
 * Usage: node tools/shots.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5173/';
const OUT = 'tools/shots';
const DOCS = 'docs';
mkdirSync(OUT, { recursive: true });
mkdirSync(DOCS, { recursive: true });

// By default use Playwright's own browser (`npx playwright install chromium`).
// CHROME_BIN lets a locked-down CI/sandbox point at a hand-provisioned build,
// with CHROME_LIBS for any bundled shared libraries it needs.
const launchOpts = {
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-software-rasterizer-fallback',
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

const browser = await chromium.launch(launchOpts).catch((err) => {
  console.error(
    '\nCould not launch Chromium. Run `npx playwright install chromium`,\n' +
      'or set CHROME_BIN to an existing Chromium binary.\n',
  );
  throw err;
});

const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});

const problems = [];
const page = await ctx.newPage();
const IGNORABLE = /localhost|ERR_CONNECTION|WebSocket|Failed to load resource|fonts\.(googleapis|gstatic)/i;
page.on('console', (m) => {
  if (m.type() === 'error' && !IGNORABLE.test(m.text())) problems.push(`console.error: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => {
  if (!IGNORABLE.test(r.url())) problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  📸 ${name}.png`);
};
/** 1x capture for the README, so the repo doesn't carry retina-sized PNGs. */
const docShot = async (name) => {
  await page.screenshot({ path: `${DOCS}/${name}.png`, scale: 'css' });
  console.log(`  🖼  docs/${name}.png`);
};

console.log(`→ loading ${BASE}`);
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45000 });
await wait(1400);
await docShot('screen-menu');

// Make sure the canvas is actually painting rather than sitting blank.
const canvasInfo = await page.evaluate(() => {
  const cv = document.getElementById('stage');
  if (!cv) return { ok: false, reason: 'no canvas' };
  const c = cv.getContext('2d');
  const d = c.getImageData(0, 0, cv.width, cv.height).data;
  let nonBlack = 0;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4 * 97) {
    const key = `${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`;
    seen.add(key);
    if (d[i] + d[i + 1] + d[i + 2] > 40) nonBlack++;
  }
  return { ok: true, w: cv.width, h: cv.height, nonBlack, distinctColors: seen.size };
});
console.log('  canvas:', JSON.stringify(canvasInfo));
if (!canvasInfo.ok) problems.push(canvasInfo.reason);
if (canvasInfo.distinctColors < 20) problems.push(`canvas looks flat (${canvasInfo.distinctColors} colours)`);

await shot('01-menu');

// --- Press PLAY (via the game's own hit-test, so we exercise real input) ---
const playBtn = await page.evaluate(() => window.__game?.debugButtonCenter('primary') ?? null);
if (!playBtn) problems.push('PLAY button was not registered');
else {
  await page.mouse.click(playBtn.x, playBtn.y);
}
await wait(1600);
const phase = await page.evaluate(() => window.__game?.debugPhase());
console.log(`  phase after PLAY: ${phase}`);
if (phase !== 'playing') problems.push(`tapping PLAY did not start the game (phase=${phase})`);
await shot('02-board');

// --- Read the real board geometry straight from the game -----------------
const geo = await page.evaluate(() => window.__game?.debugLayout() ?? null);
if (!geo) {
  problems.push('could not read board layout');
  await browser.close();
  process.exit(1);
}
const { cols: COLS, rows: ROWS, bx, by, cell } = geo;
const px = (c) => bx + (c + 0.5) * cell;
const py = (r) => by + (r + 0.5) * cell;
console.log(`  board: ${COLS}x${ROWS}  cell=${cell}px  origin=(${bx},${by})`);

// --- Ask the game for a legal move, then swipe it -------------------------
async function playBestMove(label) {
  const mv = await page.evaluate(() => {
    const g = window.__game;
    if (!g) return null;
    const b = g.debugBoard();
    if (!b || b.busy) return null;
    const m = b.findAnyMove();
    if (!m) return null;
    const c = g.debugLayout().cols;
    return {
      a: { col: m.a % c, row: Math.floor(m.a / c) },
      b: { col: m.b % c, row: Math.floor(m.b / c) },
    };
  });
  if (!mv) {
    console.log(`  (no move available for ${label})`);
    return false;
  }
  const x0 = px(mv.a.col);
  const y0 = py(mv.a.row);
  const x1 = px(mv.b.col);
  const y1 = py(mv.b.row);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / 6, y0 + ((y1 - y0) * i) / 6);
    await wait(16);
  }
  await page.mouse.up();
  return true;
}

let shotIdx = 3;
for (let i = 0; i < 7; i++) {
  // Wait for the board to settle before asking for a move.
  for (let t = 0; t < 40; t++) {
    const busy = await page.evaluate(() => window.__game?.debugBoard()?.busy ?? true);
    if (!busy) break;
    await wait(120);
  }
  const ok = await playBestMove(`move ${i}`);
  if (!ok) {
    await wait(500);
    continue;
  }
  // Catch the frame where particles are at their peak.
  await wait(330);
  if (i < 3) await shot(`0${shotIdx++}-cascade-${i}`);
  if (i === 1) await docShot('screen-cascade');
  await wait(1400);
}
await shot(`${String(shotIdx++).padStart(2, '0')}-after-play`);

// --- Force the showpiece effects -----------------------------------------
console.log('→ forcing special-candy effects');
await page.evaluate(() => window.__game?.debugSpawnSpecials?.());
await wait(900);
await shot(`${String(shotIdx++).padStart(2, '0')}-specials-on-board`);

await page.evaluate(() => window.__game?.debugDetonate?.('wrapped'));
await wait(260);
await shot(`${String(shotIdx++).padStart(2, '0')}-wrapped-blast`);
await wait(1600);

await page.evaluate(() => window.__game?.debugDetonate?.('bomb'));
await wait(300);
await shot(`${String(shotIdx++).padStart(2, '0')}-colorbomb`);
await docShot('screen-colorbomb');
await wait(1800);

// --- Lose screen ----------------------------------------------------------
console.log('→ forcing the lose state');
await page.evaluate(() => window.__game?.debugLose?.());
await wait(1200);
await shot(`${String(shotIdx++).padStart(2, '0')}-out-of-moves`);

// --- Win screen -----------------------------------------------------------
console.log('→ forcing the win state');
await page.evaluate(() => {
  const g = window.__game;
  g?.debugRestart?.();
});
await wait(900);
await page.evaluate(() => window.__game?.debugWin?.());
await wait(1400);
await shot(`${String(shotIdx++).padStart(2, '0')}-level-clear`);
await docShot('screen-levelclear');

// --- Performance probe ----------------------------------------------------
const perf = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const times = [];
      let last = performance.now();
      let n = 0;
      const tick = () => {
        const now = performance.now();
        times.push(now - last);
        last = now;
        if (++n < 90) requestAnimationFrame(tick);
        else {
          times.sort((a, b) => a - b);
          resolve({
            median: +times[Math.floor(times.length / 2)].toFixed(2),
            p95: +times[Math.floor(times.length * 0.95)].toFixed(2),
            particles: window.__game?.debugParticleCount?.() ?? -1,
          });
        }
      };
      requestAnimationFrame(tick);
    }),
);
console.log(`  frame time: median ${perf.median}ms  p95 ${perf.p95}ms  (live particles: ${perf.particles})`);

// --- Desktop / tablet sanity ---------------------------------------------
await page.setViewportSize({ width: 820, height: 1180 });
await wait(900);
await shot(`${String(shotIdx++).padStart(2, '0')}-tablet`);

await browser.close();

if (problems.length) {
  console.error('\n❌ page problems:\n' + problems.map((p) => '   - ' + p).join('\n'));
  process.exit(1);
}
console.log('\n✅ no console errors, no failed requests, canvas is painting');
