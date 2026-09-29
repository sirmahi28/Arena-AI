/* Does a canvas shadow offset get scaled by the CTM? Chrome and the spec
 * have historically disagreed, and the answer changes whether the booster
 * shadow needs a dpr multiplier. Measure it instead of guessing. */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME_BIN, env: { LD_LIBRARY_PATH: process.env.CHROME_LIBS || '' } });
const p = await b.newPage();
const out = await p.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 400; c.height = 200;
  const x = c.getContext('2d');
  x.setTransform(2, 0, 0, 2, 0, 0);          // dpr-style transform
  x.shadowColor = '#000'; x.shadowBlur = 0; x.shadowOffsetY = 20; x.shadowOffsetX = 0;
  x.fillStyle = '#fff'; x.fillRect(10, 10, 20, 20);   // user-space rect -> device 20..60
  const d = x.getImageData(0, 0, 400, 200).data;
  // find the topmost row of the black shadow in column 40 (device px)
  let shadowTop = -1;
  for (let yy = 0; yy < 200; yy++) {
    const i = (yy * 400 + 40) * 4;
    if (d[i + 3] > 10 && d[i] < 40) { shadowTop = yy; break; }
  }
  return { rectTopDevice: 20, shadowTopDevice: shadowTop, delta: shadowTop - 20 };
});
console.log(JSON.stringify(out));
console.log(out.delta === 40 ? 'SCALED by CTM  -> do NOT multiply by dpr' : out.delta === 20 ? 'NOT scaled     -> multiply by dpr' : 'inconclusive');
await b.close();
