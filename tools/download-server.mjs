/*
 * A one-file download server for the standalone build.
 *
 * The sandbox preview is the only channel that reaches the owner's browser
 * directly, so this serves dist-standalone/sugar-rush.html twice: once as a
 * landing page with a download button, and once at /sugar-rush.html with a
 * Content-Disposition attachment header so the browser saves it instead of
 * rendering it.
 *
 * Binds 0.0.0.0 because the preview proxy is not localhost.
 */
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';

const FILE = 'dist-standalone/sugar-rush.html';
const PORT = Number(process.env.PORT || 8080);

const bytes = statSync(FILE).size;
const kb = Math.round(bytes / 1024);

const page = `<!doctype html>
<html lang="ta">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sugar Rush — download</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    padding: 24px;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: radial-gradient(ellipse at 50% 0%, #4a2a7a 0%, #241141 55%, #150a28 100%);
    color: #f3e9ff;
  }
  .card {
    width: min(440px, 100%); text-align: center;
    background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.14);
    border-radius: 24px; padding: 40px 32px;
    box-shadow: 0 24px 60px rgba(0,0,0,.45);
    backdrop-filter: blur(12px);
  }
  h1 {
    margin: 0 0 6px; font-size: 30px; letter-spacing: -.02em;
    background: linear-gradient(180deg, #fff 0%, #ffc8e6 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  p { margin: 0 0 26px; color: #c3b0dd; font-size: 15px; line-height: 1.6; }
  .size { font-variant-numeric: tabular-nums; color: #8f7bb0; font-size: 13px; }
  a.btn {
    display: block; text-decoration: none; padding: 17px 24px;
    border-radius: 15px; font-size: 17px; font-weight: 650; color: #3d0a20;
    background: linear-gradient(180deg, #ff9ec4 0%, #f5457f 100%);
    box-shadow: 0 8px 22px rgba(245,69,127,.4), inset 0 1px 0 rgba(255,255,255,.55);
    transition: transform .12s ease, box-shadow .12s ease;
  }
  a.btn:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(245,69,127,.5), inset 0 1px 0 rgba(255,255,255,.55); }
  a.btn:active { transform: translateY(0); }
  a.play {
    display: block; margin-top: 12px; text-decoration: none; padding: 15px 24px;
    border-radius: 15px; font-size: 15px; font-weight: 600; color: #e7d8ff;
    background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.16);
  }
  a.play:hover { background: rgba(255,255,255,.12); }
  .note { margin: 22px 0 0; font-size: 13px; color: #9c86bb; line-height: 1.65; }
</style>
</head>
<body>
  <div class="card">
    <h1>Sugar Rush</h1>
    <p>
      ஒரே ஒரு file. Download பண்ணி, double-click பண்ணா போதும் —<br>
      internet, install, server எதுவும் வேண்டாம்.<br>
      <span class="size">sugar-rush.html &middot; ${kb} KB</span>
    </p>
    <a class="btn" href="/sugar-rush.html" download>Download the game</a>
    <a class="play" href="/play" target="_blank" rel="noopener">அல்லது இங்கேயே விளையாடு</a>
    <p class="note">
      Download ஆனதும் Downloads folder-ல <b>sugar-rush.html</b> இருக்கும்.<br>
      அதை browser-ல இழுத்து விட்டாலும் திறக்கும்.
    </p>
  </div>
</body>
</html>`;

createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];

  if (url === '/sugar-rush.html') {
    const buf = readFileSync(FILE);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="sugar-rush.html"',
      'Content-Length': buf.length,
      'Cache-Control': 'no-store',
    });
    return res.end(buf);
  }

  if (url === '/play') {
    const buf = readFileSync(FILE);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(buf);
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(page);
}).listen(PORT, '0.0.0.0', () => {
  console.log(`download server on 0.0.0.0:${PORT}  (${FILE}, ${kb} KB)`);
});
