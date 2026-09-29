/**
 * Loads the running game, drives it the way `shots.mjs` does, and prints the
 * *full stack* of any uncaught error.
 *
 * `shots.mjs` reports the message only, which for "Maximum call stack size
 * exceeded" tells you nothing at all — the whole point of that error is the
 * frame it repeats on.
 *
 * Usage: node tools/err-probe.mjs [baseUrl]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5173/';

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
      LD_LIBRARY_PATH: [process.env.CHROME_LIBS, process.env.LD_LIBRARY_PATH]
        .filter(Boolean)
        .join(':'),
    };
  }
}

const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});

const errors = [];
page.on('pageerror', (e) => errors.push(e.stack || String(e)));
// Vite's HMR socket cannot reach the host through the sandbox proxy, and it
// retries forever. That noise is not what this probe is looking for.
const NOISE = /ERR_CONNECTION|WebSocket|Failed to load resource/;
page.on('console', (m) => {
  if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(`console.error: ${m.text()}`);
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);

const dump = async (label) => {
  if (errors.length) {
    console.log(`\n===== errors after ${label} =====`);
    for (const e of errors) console.log(e.split('\n').slice(0, 14).join('\n'));
    errors.length = 0;
    return true;
  }
  console.log(`  ok: ${label}`);
  return false;
};

// Into the game.
await page.evaluate(() => window.__game.debugRestart());
await page.waitForTimeout(400);
await dump('restart');

const state = async () =>
  page.evaluate(() => ({
    phase: window.__game.debugPhase(),
    busy: window.__game.debugBoard().busy,
    boardPhase: window.__game.debugBoard().phase,
  }));

console.log('state after restart:', await state());

for (const kind of ['stripeH', 'stripeV', 'wrapped', 'cross', 'nova', 'laserH', 'laserV', 'vortex', 'bomb']) {
  await page.evaluate(() => window.__game.debugSpawnSpecials());
  await page.waitForTimeout(120);
  const fired = await page.evaluate((k) => window.__game.debugDetonate(k), kind);
  await page.waitForTimeout(900);
  const broke = await dump(`detonate ${kind} (fired=${fired})`);
  const st = await state();
  console.log(`    state: ${JSON.stringify(st)}`);
  if (broke) break;
  // Let any long sequence finish before the next one.
  for (let i = 0; i < 40 && (await state()).busy; i++) await page.waitForTimeout(100);
}

console.log('\nfinal state:', await state());
await browser.close();
