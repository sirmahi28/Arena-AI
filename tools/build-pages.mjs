/*
 * Publish the standalone build to docs/, which is where GitHub Pages can
 * serve from without any build step on their side.
 *
 * Pages only offers two source folders when deploying from a branch: the
 * repository root and /docs. The root is out, because index.html there is
 * the Vite dev entry and points at /src/main.ts — TypeScript that nothing
 * would compile. So /docs it is, and what goes in is the single-file build,
 * which already inlines every script, style and image. No Actions workflow,
 * no github-pages environment rules, no branch policy to argue with: two
 * dropdowns in Settings and the game is live.
 *
 * .nojekyll stops Pages running the file through Jekyll. Nothing here starts
 * with an underscore so it would probably survive anyway, but the file costs
 * nothing and removes a whole category of silent breakage.
 */
import { copyFileSync, writeFileSync, statSync, existsSync } from 'node:fs';

const SRC = 'dist-standalone/sugar-rush.html';
const OUT = 'docs/index.html';

if (!existsSync(SRC)) {
  console.error(`✗ ${SRC} is missing — run \`npm run build:standalone\` first.`);
  process.exit(1);
}

copyFileSync(SRC, OUT);
writeFileSync('docs/.nojekyll', '');

const kb = Math.round(statSync(OUT).size / 1024);
console.log(`\n✅ ${OUT}  (${kb} KB)`);
console.log('   GitHub Pages → Deploy from a branch → arena/01a0ebb1-arena-ai → /docs\n');
