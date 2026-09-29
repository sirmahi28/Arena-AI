/**
 * Renders every UI icon at the size it is *actually* drawn at in game, on the
 * real button background, and writes a contact sheet.
 *
 * Judging icons from a full screenshot is hopeless — they are 33 CSS pixels
 * across in a 390x844 frame. Judging them from a 256px art render is worse
 * than hopeless, because it flatters shading that disappears completely at
 * the size a player sees. This renders at 1x and 2x device pixels and then
 * upscales the *result* with nearest-neighbour, so what you are looking at is
 * exactly the pixels the phone gets, only bigger.
 *
 * Usage: node tools/icon-probe.mjs [outPath]
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const OUT = process.argv[2] ?? 'tools/shots/icon-probe.png';
const BASE = 'http://localhost:5173/';

const launchOpts = {
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--font-render-hinting=none',
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
const page = await browser.newPage({ viewport: { width: 900, height: 400 }, deviceScaleFactor: 2 });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

const b64 = await page.evaluate(async () => {
  const mod = await import('/src/ui/icons.ts');
  const ids = ['hammer', 'shuffle', 'bulb', 'restart', 'sound-on', 'sound-off', 'play', 'next'];
  // The two sizes the game actually uses: footer booster and HUD chrome.
  const sizes = [33, 22];

  const padX = 78;
  const padY = 78;
  const cv = document.createElement('canvas');
  cv.width = padX * ids.length;
  cv.height = padY * sizes.length;
  const ctx = cv.getContext('2d');

  // Same purple the buttons sit on, so contrast is judged fairly.
  ctx.fillStyle = '#3a2160';
  ctx.fillRect(0, 0, cv.width, cv.height);

  sizes.forEach((s, row) => {
    ids.forEach((id, col) => {
      const cx = col * padX + padX / 2;
      const cy = row * padY + padY / 2;
      // Button disc underneath, roughly what drawButton produces.
      const g = ctx.createLinearGradient(cx - s, cy - s, cx + s * 0.4, cy + s);
      g.addColorStop(0, 'rgba(139,92,246,0.5)');
      g.addColorStop(1, 'rgba(60,30,110,0.6)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.95, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.translate(cx, cy);
      mod.drawIcon(ctx, id, s);
      ctx.restore();
    });
  });

  return cv.toDataURL('image/png').split(',')[1];
});

writeFileSync(OUT, Buffer.from(b64, 'base64'));
console.log(`wrote ${OUT}`);
await browser.close();
