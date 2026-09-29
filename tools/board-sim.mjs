/**
 * Headless soak test for the match-3 rules.
 *
 * Runs the real Board class (it has no DOM dependencies) through thousands of
 * simulated moves at a fixed timestep and asserts the invariants that matter:
 *   - the grid never has holes once settled
 *   - no un-cleared matches are ever left on a settled board
 *   - a legal move always exists when the board hands control back
 *   - specials are forged at the right match sizes
 *   - the resolver always terminates
 *
 * Usage: node tools/board-sim.mjs [moves]
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Strip types on the fly so we can import the .ts sources directly.
register('./ts-loader.mjs', pathToFileURL('./tools/'));

const { Board } = await import('../src/core/board.ts');
const { idx } = await import('../src/core/types.ts');
const { BOARD_COLS, BOARD_ROWS, levelConfig, STAR_GATES } = await import('../src/core/game-config.ts');

// Always exercise the dimensions the game actually ships with.
const COLS = BOARD_COLS;
const ROWS = BOARD_ROWS;
const STEP = 1 / 60;
const MOVES = Number(process.argv[2] ?? 1500);

const stats = {
  moves: 0,
  rejected: 0,
  cleared: 0,
  cascades: 0,
  maxCascade: 0,
  forgeLog: [],
  forged: { stripeH: 0, stripeV: 0, wrapped: 0, cross: 0, nova: 0, bomb: 0 },
  fires: { stripeH: 0, stripeV: 0, wrapped: 0, cross: 0, nova: 0, bomb: 0 },
  shuffles: 0,
  points: 0,
};

let settledCount = 0;

const hooks = {
  onPop: () => { stats.cleared++; },
  onFire: (kind) => { stats.fires[kind]++; },
  onTracer: () => {},
  onLand: () => {},
  onCascade: (step) => {
    stats.cascades++;
    stats.maxCascade = Math.max(stats.maxCascade, step);
  },
  onForge: (special) => { stats.forged[special]++; stats.forgeLog.push(special); },
  onReject: () => { stats.rejected++; },
  onSwapStart: () => {},
  onScore: (p) => { stats.points += p; },
  onSettled: () => { settledCount++; },
  onShuffle: () => { stats.shuffles++; },
};

const board = new Board(COLS, ROWS, hooks);
board.reset(6);

const fail = (msg) => {
  console.error(`\n❌ ASSERTION FAILED: ${msg}`);
  process.exit(1);
};

/** Settle the board, with a hard cap so an infinite resolver is caught. */
function settle(label) {
  let frames = 0;
  while (board.busy) {
    board.update(STEP);
    if (++frames > 4000) fail(`resolver never settled (${label}); phase=${board.phase}`);
  }
  return frames;
}

function checkSettledInvariants(label) {
  // 1. No holes.
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!board.tiles[idx(c, r, COLS)]) fail(`hole at ${c},${r} after ${label}`);
    }
  }
  // 2. Tiles are visually where they logically are.
  for (const t of board.tiles) {
    if (Math.abs(t.x - t.col) > 0.02 || Math.abs(t.y - t.row) > 0.02) {
      fail(`tile ${t.id} desynced: logical ${t.col},${t.row} visual ${t.x.toFixed(2)},${t.y.toFixed(2)} after ${label}`);
    }
    if (t.state !== 'idle') fail(`tile ${t.id} stuck in state ${t.state} after ${label}`);
    // 3. Every settled tile must actually be drawable. A tile with scale 0 is
    //    invisible yet still occupies its cell, so gravity skips it and the
    //    player sees a permanent empty square. Mirrors the renderer's own
    //    `s <= 0.01 -> skip` test.
    const drawn = t.scale * (t.spawnT < 1 ? t.spawnT : 1);
    if (!(drawn > 0.01)) {
      fail(`tile ${t.id} at ${t.col},${t.row} is invisible after ${label} (scale=${t.scale}, spawnT=${t.spawnT}) — cell looks empty but never refills`);
    }
  }
  // 3. No leftover matches.
  const colorAt = (c, r) => (c < 0 || r < 0 || c >= COLS || r >= ROWS ? -99 : board.tiles[idx(c, r, COLS)].color);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = colorAt(c, r);
      if (v === -1) continue; // colour bombs are wildcards
      if (v === colorAt(c + 1, r) && v === colorAt(c + 2, r)) fail(`unresolved H match at ${c},${r} after ${label}`);
      if (v === colorAt(c, r + 1) && v === colorAt(c, r + 2)) fail(`unresolved V match at ${c},${r} after ${label}`);
    }
  }
  // 4. There is always something to do.
  if (!board.findAnyMove()) fail(`no legal moves available after ${label}`);
}

settle('initial deal');
checkSettledInvariants('initial deal');
console.log(`✓ initial deal (${COLS}x${ROWS}) is match-free and playable`);

let frameBudget = 0;
for (let m = 0; m < MOVES; m++) {
  const move = board.findAnyMove();
  if (!move) fail('findAnyMove returned null on an idle board');

  const a = { col: move.a % COLS, row: Math.floor(move.a / COLS) };
  const b = { col: move.b % COLS, row: Math.floor(move.b / COLS) };

  if (!board.trySwap(a.col, a.row, b.col, b.row)) fail(`legal move ${m} was refused`);
  stats.moves++;
  frameBudget += settle(`move ${m}`);
  checkSettledInvariants(`move ${m}`);
}

// --- Targeted rule checks -------------------------------------------------

/**
 * Base pattern `(c + 2r) % 6` is provably match-free: horizontal neighbours
 * differ by 1 and vertical neighbours differ by 2, so no run of three can
 * exist. That gives every fixture a clean canvas to paint on.
 */
function cleanBoard(paint = {}) {
  const b = new Board(COLS, ROWS, hooks);
  b.reset(6);
  while (b.busy) b.update(STEP);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = b.tiles[idx(c, r, COLS)];
      t.color = (c + 2 * r) % 6;
      t.special = 'none';
      t.fired = false;
    }
  }
  for (const [key, color] of Object.entries(paint)) {
    const [c, r] = key.split(',').map(Number);
    b.tiles[idx(c, r, COLS)].color = color;
  }
  return b;
}

function assertClean(b, label) {
  const at = (c, r) => (c < 0 || r < 0 || c >= COLS || r >= ROWS ? -99 : b.tiles[idx(c, r, COLS)].color);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = at(c, r);
      if (v === at(c + 1, r) && v === at(c + 2, r)) fail(`${label}: fixture already matches at ${c},${r} (H)`);
      if (v === at(c, r + 1) && v === at(c, r + 2)) fail(`${label}: fixture already matches at ${c},${r} (V)`);
    }
  }
}

function runTo(b, label) {
  let f = 0;
  while (b.busy) {
    b.update(STEP);
    if (++f > 6000) fail(`${label}: never settled`);
  }
}

// 4-in-a-row -> striped candy.
{
  // row 4 reads [0,0,X,0,...]; swapping the 0 at (2,3) down completes 0,0,0,0.
  const b = cleanBoard({ '0,4': 0, '1,4': 0, '3,4': 0, '4,4': 1, '2,3': 0 });
  assertClean(b, 'striped fixture');
  const before = stats.forged.stripeH + stats.forged.stripeV;
  if (!b.trySwap(2, 4, 2, 3)) fail('striped fixture: swap refused');
  runTo(b, 'striped fixture');
  const made = stats.forged.stripeH + stats.forged.stripeV - before;
  if (made !== 1) fail(`a 4-in-a-row should forge exactly 1 striped candy (got ${made})`);
  console.log('✓ 4-in-a-row forges a striped candy');
}

// 5-in-a-row -> colour bomb.
{
  const b = cleanBoard({ '0,4': 0, '1,4': 0, '3,4': 0, '4,4': 0, '2,3': 0 });
  assertClean(b, 'bomb fixture');
  const before = stats.forged.bomb;
  if (!b.trySwap(2, 4, 2, 3)) fail('bomb fixture: swap refused');
  runTo(b, 'bomb fixture');
  if (stats.forged.bomb - before !== 1) fail('a 5-in-a-row should forge a colour bomb');
  console.log('✓ 5-in-a-row forges a colour bomb');
}

// L-shape (3 across + 3 down) -> wrapped candy.
{
  const b = cleanBoard({ '0,4': 0, '1,4': 0, '2,5': 0, '2,6': 0, '2,3': 0 });
  assertClean(b, 'wrapped fixture');
  const mark = stats.forgeLog.length;
  if (!b.trySwap(2, 4, 2, 3)) fail('wrapped fixture: swap refused');
  runTo(b, 'wrapped fixture');
  // Only the first forge belongs to the fixture; anything after it came out
  // of the cascade that followed and is not what we are testing.
  if (stats.forgeLog[mark] !== 'wrapped') {
    fail(`an L-shaped match should forge a wrapped candy (got ${stats.forgeLog[mark]})`);
  }
  console.log('✓ L-shaped match forges a wrapped candy, not a cross');
}

// T-shape (3 across crossing the middle, 3 down from the end) -> cross candy.
//
// The shape ladder is the whole point of the matcher, so it needs a
// deterministic test and not just a tally from the random run. Note that only
// L and T can be built by a single swap at all: a plus needs its centre
// filled last, and every cell orthogonally adjacent to that centre is one of
// its own arms, so there is nothing left to swap in from. Same for a 2x2,
// which needs two complete parallel runs and therefore already matches before
// the final piece arrives. Both shapes are cascade-only in real play, and the
// random soak below is what covers them.
{
  const b = cleanBoard({ '1,4': 0, '3,4': 0, '4,4': 1, '2,5': 0, '2,6': 0, '2,3': 0 });
  assertClean(b, 'cross fixture');
  const mark = stats.forgeLog.length;
  if (!b.trySwap(2, 4, 2, 3)) fail('cross fixture: swap refused');
  runTo(b, 'cross fixture');
  if (stats.forgeLog[mark] !== 'cross') {
    fail(`a T-shaped match should forge a cross candy (got ${stats.forgeLog[mark]})`);
  }
  console.log('✓ T-shaped match forges a cross candy, not a wrapped');
}

/*
 * Plus and 2x2 cannot be reached through `trySwap` at all, so they are driven
 * a different way: paint the shape onto a settled board, then crush an
 * unrelated cell in a far corner. That clears one candy, runs gravity in that
 * column only, and ends in the same full-board `findMatches` sweep every
 * cascade uses — which is exactly the path these shapes arrive on in real
 * play.
 */

// Plus (3 across and 3 down crossing at the middle of both) -> nova candy.
{
  const b = cleanBoard({ '2,3': 0, '1,4': 0, '2,4': 0, '3,4': 0, '2,5': 0, '4,4': 1, '2,2': 1 });
  const mark = stats.forgeLog.length;
  if (!b.crushAt(6, 8)) fail('nova fixture: crush refused');
  runTo(b, 'nova fixture');
  if (stats.forgeLog[mark] !== 'nova') {
    fail(`a plus-shaped match should forge a nova candy (got ${stats.forgeLog[mark]})`);
  }
  console.log('✓ plus-shaped match forges a nova candy');
}

// 2x2 block (two parallel runs one line apart) -> wrapped candy.
{
  const b = cleanBoard({
    '1,4': 0, '2,4': 0, '3,4': 0,
    '1,5': 0, '2,5': 0, '3,5': 0,
    '4,4': 1,
  });
  const mark = stats.forgeLog.length;
  if (!b.crushAt(6, 8)) fail('square fixture: crush refused');
  runTo(b, 'square fixture');
  if (stats.forgeLog[mark] !== 'wrapped') {
    fail(`a 2x2 block should forge a wrapped candy (got ${stats.forgeLog[mark]})`);
  }
  console.log('✓ 2x2 square block forges a wrapped candy');
}

// A striped candy caught in a match clears its whole row.
{
  // Swapping (2,4) up completes 0,0,0 across row 4 — and (0,4) is striped,
  // so the chain reaction should take the entire row with it.
  const b = cleanBoard({ '0,4': 0, '1,4': 0, '2,3': 0, '4,4': 1 });
  assertClean(b, 'stripe fire fixture');
  b.tiles[idx(0, 4, COLS)].special = 'stripeH';
  // (2,4) is the cell the swap vacates, so track the candy that moves *into* it.
  const rowIds = [b.tiles[idx(2, 3, COLS)].id];
  for (let c = 0; c < COLS; c++) if (c !== 2) rowIds.push(b.tiles[idx(c, 4, COLS)].id);
  const before = stats.fires.stripeH;
  if (!b.trySwap(2, 4, 2, 3)) fail('stripe fire fixture: swap refused');
  runTo(b, 'stripe fire');
  if (stats.fires.stripeH === before) fail('striped candy never fired');
  const survivors = rowIds.filter((id) => b.tiles.some((x) => x && x.id === id));
  if (survivors.length !== 0) fail(`striped candy left ${survivors.length}/${rowIds.length} candies in its row`);
  console.log('✓ striped candy chain-clears its entire row');
}

// Colour bomb swapped onto a candy clears every candy of that colour.
{
  const b = cleanBoard();
  const bomb = b.tiles[idx(3, 3, COLS)];
  bomb.special = 'bomb';
  bomb.color = -1;
  const victim = b.tiles[idx(4, 3, COLS)];
  const targetColor = victim.color;
  const doomed = b.tiles.filter((t) => t.color === targetColor).map((t) => t.id);
  if (doomed.length < 3) fail('bomb fixture: not enough candies of the target colour');
  if (!b.trySwap(3, 3, 4, 3)) fail('bomb fixture: swap refused');
  runTo(b, 'colour bomb');
  const survivors = doomed.filter((id) => b.tiles.some((x) => x.id === id));
  if (survivors.length !== 0) fail(`colour bomb missed ${survivors.length} of ${doomed.length} candies`);
  console.log(`✓ colour bomb cleared all ${doomed.length} candies of one colour`);
}

// A board with no legal moves must auto-shuffle rather than deadlock.
{
  const b = cleanBoard();
  // Parity pattern: colour = (c%2) + 2*(r%2). No swap can ever make three
  // in a row, so the board is provably dead.
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      b.tiles[idx(c, r, COLS)].color = (c % 2) + 2 * (r % 2);
    }
  }
  if (b.findAnyMove()) fail('parity fixture should have zero legal moves');
  const before = stats.shuffles;
  if (!b.requestShuffle()) fail('shuffle request refused on an idle board');
  runTo(b, 'shuffle');
  if (stats.shuffles === before) fail('a dead board did not shuffle');
  if (!b.findAnyMove()) fail('shuffle produced another dead board');
  console.log('✓ dead board auto-shuffles into a playable one');
}

const avgFrames = (frameBudget / stats.moves).toFixed(1);
console.log(`
──────────── soak results ────────────
 moves simulated   ${stats.moves}
 candies cleared   ${stats.cleared}
 cascade steps     ${stats.cascades}  (deepest chain: ${stats.maxCascade + 1}x)
 specials forged   striped ${stats.forged.stripeH + stats.forged.stripeV} · wrapped ${stats.forged.wrapped} · cross ${stats.forged.cross} · nova ${stats.forged.nova} · bombs ${stats.forged.bomb}
 specials fired    striped ${stats.fires.stripeH + stats.fires.stripeV} · wrapped ${stats.fires.wrapped} · cross ${stats.fires.cross} · nova ${stats.fires.nova} · bombs ${stats.fires.bomb}
 auto-shuffles     ${stats.shuffles}
 total points      ${stats.points.toLocaleString()}
 avg frames/move   ${avgFrames}  (~${(avgFrames / 60).toFixed(2)}s of animation)
──────────────────────────────────────
✅ all invariants held`);

// --- Difficulty calibration ----------------------------------------------
// Replay with a greedy "skilled player" policy (always take the move that
// clears the most candies) to estimate what a real player scores per level.
if (process.argv.includes('--calibrate')) {
  const scoreOfMove = (b, a1, b1) => {
    const t1 = b.tiles[a1];
    const t2 = b.tiles[b1];
    if (!t1 || !t2) return -1;
    if (t1.special === 'bomb' || t2.special === 'bomb') return 40;
    let bonus = 0;
    if (t1.special !== 'none') bonus += 12;
    if (t2.special !== 'none') bonus += 12;
    b.tiles[a1] = t2;
    b.tiles[b1] = t1;
    let best = 0;
    for (const cell of [a1, b1]) {
      const c = cell % COLS;
      const r = Math.floor(cell / COLS);
      const col = b.tiles[cell].color;
      let h = 1;
      for (let k = c - 1; k >= 0 && b.tiles[idx(k, r, COLS)].color === col; k--) h++;
      for (let k = c + 1; k < COLS && b.tiles[idx(k, r, COLS)].color === col; k++) h++;
      let v = 1;
      for (let k = r - 1; k >= 0 && b.tiles[idx(c, k, COLS)].color === col; k--) v++;
      for (let k = r + 1; k < ROWS && b.tiles[idx(c, k, COLS)].color === col; k++) v++;
      const run = (h >= 3 ? h : 0) + (v >= 3 ? v : 0);
      if (run > best) best = run;
    }
    b.tiles[a1] = t1;
    b.tiles[b1] = t2;
    return best > 0 ? best * 4 + bonus : -1;
  };

  const bestMove = (b) => {
    let best = null;
    let bestScore = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (c + 1 < COLS) {
          const s = scoreOfMove(b, idx(c, r, COLS), idx(c + 1, r, COLS));
          if (s > bestScore) ((bestScore = s), (best = [c, r, c + 1, r]));
        }
        if (r + 1 < ROWS) {
          const s = scoreOfMove(b, idx(c, r, COLS), idx(c, r + 1, COLS));
          if (s > bestScore) ((bestScore = s), (best = [c, r, c, r + 1]));
        }
      }
    }
    return best;
  };

  console.log('\n──────── difficulty calibration (greedy player, 400 runs/level) ────────');
  console.log(' lvl  col  moves    target   median      p25      p75  clear  3-star');
  const RUNS = 400;
  for (const lvl of [1, 2, 3, 4, 5, 6, 8, 10, 14, 20]) {
    const cfg = levelConfig(lvl);
    const results = [];
    for (let run = 0; run < RUNS; run++) {
      let points = 0;
      const quiet = {
        ...hooks,
        onScore: (p) => { points += p; },
        onCascade: () => {},
        onPop: () => {},
        onForge: () => {},
        onFire: () => {},
        onShuffle: () => {},
      };
      const b = new Board(COLS, ROWS, quiet);
      b.reset(cfg.colors);
      while (b.busy) b.update(STEP);
      for (let m = 0; m < cfg.moves; m++) {
        const mv = bestMove(b) ?? (() => {
          const any = b.findAnyMove();
          return any ? [any.a % COLS, Math.floor(any.a / COLS), any.b % COLS, Math.floor(any.b / COLS)] : null;
        })();
        if (!mv) break;
        if (!b.trySwap(mv[0], mv[1], mv[2], mv[3])) break;
        let f = 0;
        while (b.busy && f++ < 6000) b.update(STEP);
      }
      results.push(points);
    }
    results.sort((a, z) => a - z);
    const q = (p) => results[Math.floor(results.length * p)];
    const cleared = results.filter((r) => r >= cfg.target).length / RUNS;
    const three = results.filter((r) => r >= cfg.target * STAR_GATES[2]).length / RUNS;
    console.log(
      ` ${String(lvl).padStart(3)}  ${String(cfg.colors).padStart(3)}  ${String(cfg.moves).padStart(5)}  ${cfg.target.toLocaleString().padStart(8)}  ` +
      `${q(0.5).toLocaleString().padStart(7)}  ${q(0.25).toLocaleString().padStart(7)}  ${q(0.75).toLocaleString().padStart(7)}  ` +
      `${(cleared * 100).toFixed(0).padStart(4)}%  ${(three * 100).toFixed(0).padStart(5)}%`,
    );
  }
  console.log('────────────────────────────────────────────────────────────────────────');
}
