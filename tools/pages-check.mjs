/* GitHub Pages would serve the standalone build over HTTP as index.html.
 * It is verified over file://, but HTTP is the case that will actually ship,
 * so prove the game boots and plays there before telling anyone it works. */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN, env: { LD_LIBRARY_PATH: process.env.CHROME_LIBS || '' } });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://localhost:8080/play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__game, { timeout: 15000 });
await p.evaluate(() => window.__game.debugRestart());
await p.waitForTimeout(1200);
const st = await p.evaluate(() => {
  const c = document.querySelector('canvas');
  const x = c.getContext('2d');
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 400) if (d[i] + d[i+1] + d[i+2] > 90) lit++;
  return { phase: window.__game.debugPhase(), w: c.width, h: c.height, lit };
});
await p.screenshot({ path: '/tmp/pages.png' });
console.log('served over HTTP as a page:', JSON.stringify(st));
console.log('page errors:', errs.length ? errs : 'none');
await b.close();
