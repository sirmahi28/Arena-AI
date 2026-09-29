/* The armed booster used to be an orange disc. With the disc gone the only
 * cue left is the glow, so check it actually reads. */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN, env: { LD_LIBRARY_PATH: process.env.CHROME_LIBS || '' } });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForFunction(() => !!window.__game);
await p.evaluate(() => window.__game.debugRestart());
await p.waitForTimeout(900);
console.log('phase:', await p.evaluate(() => window.__game.debugPhase()));
const c = await p.evaluate(() => window.__game.debugButtonCenter('hammer'));
await p.mouse.click(c.x, c.y);
await p.waitForTimeout(260);           // catch the glow mid-pulse
await p.screenshot({ path: '/tmp/armed.png' });
console.log('clicked hammer at', JSON.stringify(c));
await b.close();
