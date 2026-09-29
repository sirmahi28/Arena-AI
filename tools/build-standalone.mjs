#!/usr/bin/env node
/**
 * Bundle the whole game into ONE self-contained .html file.
 *
 *   node tools/build-standalone.mjs   →  dist-standalone/sugar-rush.html
 *
 * No server, no install, no network: open it by double-clicking, email it to
 * yourself, drop it on a USB stick, or copy it to a phone. Everything — the
 * JS, the CSS, the candy art (drawn at runtime) and the sound effects
 * (synthesised at runtime) — lives inside that single file.
 *
 * The only remote reference is the Google Fonts stylesheet for Baloo 2, which
 * is left as a <link> on purpose: it upgrades the typeface when you happen to
 * be online and falls back to system fonts when you aren't. Nothing about the
 * game depends on it loading.
 */
import { build } from 'vite';
import { mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = 'dist-standalone';
const RAW = join(OUT_DIR, '.raw');
const TARGET = join(OUT_DIR, 'sugar-rush.html');

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

await build({
  configFile: false,
  base: './',
  logLevel: 'warn',
  build: {
    outDir: RAW,
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: false,
    // Inline every asset rather than emitting sibling files.
    assetsInlineLimit: 100 * 1024 * 1024,
    rollupOptions: {
      output: {
        // IIFE, not ESM: an external module script can't be loaded over
        // file:// (CORS blocks it), and a classic script sidesteps the whole
        // question. Single entry, so there's nothing to code-split anyway.
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
});

let html = readFileSync(join(RAW, 'index.html'), 'utf8');
const js = readFileSync(join(RAW, 'app.js'), 'utf8');

let css = '';
try {
  css = readFileSync(join(RAW, 'app.css'), 'utf8');
} catch {
  /* no stylesheet emitted */
}

// Swap the emitted <link> for its inlined contents. Using a replacer function
// keeps `$&`-style sequences in the file from being treated as replacement
// patterns.
html = html.replace(/<link[^>]*href="[^"]*app\.css"[^>]*>/, () => `<style>\n${css}\n</style>`);

// The script needs more care. Vite emits it in <head> as type="module", which
// is implicitly deferred — it runs after the DOM is parsed. An inline classic
// script has no such deferral and would execute before <body> exists, so the
// game would boot to "#stage canvas is missing". Drop the original tag and
// re-insert the bundle at the end of <body> instead.
html = html.replace(/<script[^>]*src="[^"]*app\.js"[^>]*><\/script>\s*/, () => '');
html = html.replace(/<\/body>/, () => `  <script>\n${js}\n  </script>\n</body>`);

if (html.includes('app.js')) throw new Error('failed to inline the script bundle');
if (css && html.includes('app.css')) throw new Error('failed to inline the stylesheet');
if (!/<\/body>\s*<\/html>/.test(html.replace(/\s+/g, (m) => (m.includes('\n') ? '\n' : ' '))))
  throw new Error('unexpected document structure after inlining');
// The bundle must land after the canvas it looks for, not before it.
if (html.indexOf('id="stage"') > html.lastIndexOf('<script>'))
  throw new Error('script was inlined before #stage — it would boot too early');

writeFileSync(TARGET, html);
rmSync(RAW, { recursive: true, force: true });

const kb = (statSync(TARGET).size / 1024).toFixed(0);
console.log(`\n✅ ${TARGET}  (${kb} KB, single file, opens with no server)`);
