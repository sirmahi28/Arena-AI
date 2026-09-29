#!/usr/bin/env node
/**
 * Stress the paths tools/board-sim.mjs never touches: the boosters.
 *
 *   node tools/booster-sim.mjs [moves]
 *
 * board-sim.mjs only ever swaps. Real play also fires the hammer (crushAt) and
 * the shuffle button, and it fires them at arbitrary moments. This mixes all
 * three and, after every settle, checks for the failure the player actually
 * sees: a cell that looks empty and never refills.
 *
 * That can happen two ways, and only one of them is a null:
 *   • a genuine hole   — tiles[i] === null
 *   • a "zombie" tile  — still in the array, so gravity skips the cell, but
 *                        left in a cleared//invisible state, so nothing is drawn
 */
import { createRequire } from 'node:module';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./ts-loader.mjs', pathToFileURL('./tools/'));
const { Board } = await import('../src/core/board.ts');
const { BOARD_COLS: COLS, BOARD_ROWS: ROWS } = await import('../src/core/game-config.ts');
const { idx } = await import('../src/core/types.ts');
void createRequire;

const MOVES = Number(process.argv[2] ?? 1200);
const STEP = 1 / 60;

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const randInt = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const noop = () => {};
const board = new Board(COLS, ROWS, {
  onPop: noop, onFire: noop, onTracer: noop, onLand: noop, onCascade: noop,
  onForge: noop, onReject: noop, onSwapStart: noop, onScore: noop,
  onSettled: noop, onShuffle: noop,
});
board.reset(6);

const failures = [];
const fail = (m) => {
  if (failures.length < 6) failures.push(m);
};

function settle(label) {
  let frames = 0;
  while (board.busy) {
    board.update(STEP);
    if (++frames > 4000) {
      fail(`resolver never settled (${label}); phase=${board.phase}`);
      return frames;
    }
  }
  return frames;
}

/** The player-visible check: is every cell occupied by something drawable? */
function checkVisible(label) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = board.tiles[idx(c, r, COLS)];
      if (!t) {
        fail(`HOLE at (${c},${r}) after ${label}`);
        return false;
      }
      if (t.state !== 'idle') {
        fail(`ZOMBIE at (${c},${r}) after ${label}: state='${t.state}' — occupies the cell but is not drawn`);
        return false;
      }
      if (!(t.scale > 0.05)) {
        fail(`INVISIBLE at (${c},${r}) after ${label}: scale=${t.scale}`);
        return false;
      }
    }
  }
  return true;
}

const stats = { swaps: 0, hammers: 0, shuffles: 0, rejected: 0 };

for (let m = 0; m < MOVES; m++) {
  const roll = rnd();
  let label;

  if (roll < 0.18) {
    // Hammer: smash a random candy.
    const c = randInt(0, COLS - 1);
    const r = randInt(0, ROWS - 1);
    label = `hammer(${c},${r}) #${m}`;
    if (board.crushAt(c, r)) stats.hammers++;
    else stats.rejected++;
  } else if (roll < 0.24) {
    label = `shuffle #${m}`;
    if (board.requestShuffle()) stats.shuffles++;
    else stats.rejected++;
  } else {
    const mv = board.findAnyMove();
    if (!mv) {
      fail(`no legal move available at move ${m}`);
      break;
    }
    label = `swap ${mv.a}->${mv.b} #${m}`;
    if (board.trySwap(mv.a % COLS, (mv.a / COLS) | 0, mv.b % COLS, (mv.b / COLS) | 0)) stats.swaps++;
    else stats.rejected++;
  }

  settle(label);
  if (!checkVisible(label)) break;
}

console.log(`\n  swaps ${stats.swaps} · hammers ${stats.hammers} · shuffles ${stats.shuffles} · rejected ${stats.rejected}`);

if (failures.length) {
  console.error('\n❌ booster stress FAILED:');
  for (const f of failures) console.error(`   • ${f}`);
  process.exit(1);
}
console.log('✅ every cell stayed filled and drawable through all booster use\n');
