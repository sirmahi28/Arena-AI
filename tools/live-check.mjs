/* Proof the running dev server renders what we think it does. */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN, env: { LD_LIBRARY_PATH: process.env.CHROME_LIBS || '' } });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = [];
p.on('console', m => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED/.test(m.text())) errs.push(m.text()); });
p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForFunction(() => !!window.__game);
await p.evaluate(() => window.__game.debugRestart());
await p.waitForTimeout(1100);
await p.screenshot({ path: '/tmp/live.png' });
console.log('phase:', await p.evaluate(() => window.__game.debugPhase()));
console.log('console errors:', errs.length ? errs : 'none');
await b.close();
