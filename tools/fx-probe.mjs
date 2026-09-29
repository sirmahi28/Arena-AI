/**
 * Particle-quality probe.
 *
 * `npm run shots` captures whatever frame it happens to land on, which is
 * useless for judging an effect that lives for 400ms. This fires one specific
 * effect and captures the board at fixed offsets afterwards, so two versions
 * of the particle code can be compared frame for frame.
 *
 * Usage: node tools/fx-probe.mjs <outDir> [effect] [baseUrl]
 *        effect = wrapped | bomb | pop      (default wrapped)
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? 'tools/fx';
const EFFECT = process.argv[3] ?? 'wrapped';
const BASE = process.argv[4] ?? 'http://localhost:5173/';
mkdirSync(OUT, { recursive: true });

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
      LD_LIBRARY_PATH: [process.env.CHROME_LIBS, process.env.LD_LIBRARY_PATH]
        .filter(Boolean)
        .join(':'),
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
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  console error:', m.text());
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 });

// Into the board.
const play = await page.evaluate(() => window.__game?.debugButtonCenter('primary') ?? null);
if (play) await page.mouse.click(play.x, play.y);
await page.waitForFunction(() => window.__game?.debugPhase() === 'playing', null, {
  timeout: 10000,
});
await page.waitForFunction(() => window.__game?.debugBoard()?.busy === false, null, {
  timeout: 15000,
});
await page.waitForTimeout(400);

const geo = await page.evaluate(() => window.__game?.debugLayout() ?? null);
// Crop to the board, which is where the effect happens.
const clip = geo
  ? (() => {
      const x = Math.max(0, geo.bx - 10);
      const y = Math.max(0, geo.by - 10);
      return {
        x,
        y,
        width: Math.min(390 - x, geo.cell * geo.cols + 20),
        height: Math.min(844 - y, geo.cell * geo.rows + 20),
      };
    })()
  : undefined;
console.log('  board geo:', JSON.stringify(geo), '-> clip', JSON.stringify(clip));

if (EFFECT !== 'pop') {
  await page.evaluate(() => window.__game?.debugSpawnSpecials?.());
  await page.waitForTimeout(500);
}

// Freeze time so the captures land on exact offsets rather than whenever the
// screenshot round-trip happens to complete.
await page.evaluate(() => {
  window.__fxClock = 0;
  const raf = window.requestAnimationFrame;
  window.__realRaf = raf;
});

const t0 = Date.now();
await page.evaluate((e) => {
  if (e === 'pop') {
    const b = window.__game?.debugBoard();
    window.__game?.debugDetonate?.('stripe');
  } else {
    window.__game?.debugDetonate?.(e);
  }
}, EFFECT);

const OFFSETS = [60, 120, 200, 320, 460];
let prev = 0;
for (const off of OFFSETS) {
  const wait = off - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  const n = await page.evaluate(() => window.__game?.debugParticleCount?.() ?? -1);
  const file = `${OUT}/${EFFECT}-${String(off).padStart(3, '0')}ms.png`;
  await page.screenshot({ path: file, clip });
  console.log(`  ${file}   live particles: ${n}`);
  prev = off;
}

await browser.close();
