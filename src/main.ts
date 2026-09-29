import './style.css';
import { Game } from './core/game';

const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
if (!canvas) throw new Error('#stage canvas is missing');

function boot(): void {
  const game = new Game(canvas!);
  game.start();
  // Handle for the headless visual test harness (tools/shots.mjs).
  (window as unknown as { __game: Game }).__game = game;
}

// Give the display font a moment so canvas text doesn't reflow mid-game, but
// never let a slow/blocked font CDN hold the game hostage.
let booted = false;
const bootOnce = (): void => {
  if (booted) return;
  booted = true;
  boot();
};

if (document.fonts?.ready) {
  document.fonts.ready.then(bootOnce).catch(bootOnce);
  setTimeout(bootOnce, 1200);
} else {
  bootOnce();
}

// Keep the address bar from hijacking swipes on mobile Safari.
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.cancelable) e.preventDefault();
  },
  { passive: false },
);
