import {
  BOMB_COLOR,
  idx,
  type ColorId,
  type Special,
  type Tile,
} from './types';
import { clamp, easeInCubic, easeOutBack, easeOutCubic, randInt } from './rng';

export type FireKind =
  | 'stripeH'
  | 'stripeV'
  | 'wrapped'
  | 'cross'
  | 'nova'
  | 'laserH'
  | 'laserV'
  | 'vortex'
  | 'bomb';

export interface BoardHooks {
  /** A tile reached the peak of its pop animation — spawn the burst. */
  onPop(tile: Tile, cascade: number): void;
  /** A special candy detonated. */
  onFire(kind: FireKind, col: number, row: number, color: ColorId, span: number): void;
  /** Colour-bomb zap line. */
  /**
   * One colour-bomb bolt was fired. `step`/`total` let the presentation
   * build — rising pitch, growing spark — across the sequence, which is the
   * whole point of firing them one at a time.
   */
  onTracer(
    fromCol: number,
    fromRow: number,
    toCol: number,
    toRow: number,
    color: ColorId,
    step: number,
    total: number,
  ): void;
  /** A falling tile touched down. `force` is 0..1. */
  onLand(tile: Tile, force: number): void;
  /** One cascade step finished resolving. */
  onCascade(step: number, cleared: number, points: number, cx: number, cy: number): void;
  /** A new special candy was forged. */
  onForge(special: Special, col: number, row: number, color: ColorId): void;
  /** Player attempted an illegal swap. */
  onReject(col: number, row: number): void;
  onSwapStart(): void;
  onScore(points: number): void;
  onSettled(movesUsed: number): void;
  onShuffle(): void;
}

const SWAP_TIME = 0.15;
const CLEAR_TIME = 0.26;
const GRAVITY = 62; // cells / s^2
const MAX_FALL = 30; // cells / s
const SHUFFLE_TIME = 0.75;

const TAU = Math.PI * 2;

// Neighbour impact spring. Tuned so a pop shoves the cells around it roughly a
// fifth of a cell and they bounce back in ~0.35s with one visible overshoot —
// springy, not floaty, and settled well before the next cascade lands.
const IMPULSE_PUSH = 3.2; // cells/s of initial velocity at distance 1
const IMPULSE_K = 260; // spring stiffness
const IMPULSE_DAMP = 13; // damping

type Phase =
  | 'idle'
  | 'swapping'
  | 'rejecting'
  | 'zapping'
  | 'clearing'
  | 'falling'
  | 'shuffling'
  | 'locked';

/** One colour-bomb bolt, fired on a stagger during the `zapping` phase. */
interface Zap {
  fromCol: number;
  fromRow: number;
  to: number;
  color: ColorId;
  /**
   * Draw the bolt travelling target -> source instead of source -> target.
   *
   * A colour bomb reaches out and a vortex pulls in. Same queue, same
   * stagger, same lock-on marks — only the direction of the streak differs,
   * so one flag is cheaper and far less error-prone than a parallel
   * sequencing path for the second special.
   */
  inward?: boolean;
}

/**
 * How long each bolt waits behind the one before it, and how long the board
 * holds after the last one lands before everything goes off together.
 *
 * The whole sequence has to stay under about a fifth of a second. Any longer
 * and it stops reading as one event and starts feeling like the game has
 * taken the turn away from you.
 */
/**
 * Colour-bomb targeting rhythm.
 *
 * These were 16ms / 0.1s / 0.34s, which is not a sequence — it is a single
 * flash with a slight smear. Every target lit at once, the board went white,
 * and the one thing a colour bomb should communicate (look how many of these
 * I just found) was over before the eye could follow it.
 *
 * 75ms per bolt is slow enough to read individually and fast enough to feel
 * like a machine gun rather than a queue. The total is capped so a 25-target
 * wipe does not outstay its welcome, and `HOLD` is the beat of silence after
 * the last bolt lands — the pause is what makes the simultaneous detonation
 * land as a payoff instead of as the tail of the same animation.
 */
/** How many same-coloured candies a vortex drags in. */
const VORTEX_PULL = 9;

const ZAP_STAGGER = 0.075;
const ZAP_HOLD = 0.19;
const ZAP_MAX_TOTAL = 1.15;

/**
 * The geometry of a match, which decides what it forges.
 *
 * `line`   — a plain run of 3, 4 or 5+.
 * `square` — the group contains a 2x2 block of one colour.
 * `block`  — it contains a 2x3 or larger slab, which is strictly harder to
 *            build than a 2x2 and now forges accordingly.
 * `L`      — two runs crossing at the end of both: a corner.
 * `T`      — crossing at the middle of one run and the end of the other.
 * `plus`   — crossing at the middle of both.
 */
export type MatchShape = 'line' | 'square' | 'block' | 'L' | 'T' | 'plus';

interface Run {
  cells: number[];
  horizontal: boolean;
  /** Row for a horizontal run, column for a vertical one. */
  line: number;
  /** First and last index along the run's axis, inclusive. */
  from: number;
  to: number;
  color: ColorId;
}

interface MatchGroup {
  cells: number[];
  color: ColorId;
  maxH: number;
  maxV: number;
  /** Cell where a forged special should appear. */
  anchor: number;
  shape: MatchShape;
}

export class Board {
  readonly cols: number;
  readonly rows: number;
  tiles: Array<Tile | null> = [];

  phase: Phase = 'idle';
  cascade = 0;
  colorCount = 6;
  movesUsed = 0;

  /** Cells the player just swapped — used to anchor forged specials. */
  private swapA = -1;
  private swapB = -1;
  private swapT = 0;
  private swapAx = 0;
  private swapAy = 0;
  private swapBx = 0;
  private swapBy = 0;

  private clearT = 0;
  private clearing: Tile[] = [];
  private pendingForge: Array<{ cell: number; color: ColorId; special: Special }> = [];
  private zapQueue: Zap[] = [];
  private zapCursor = 0;
  private zapT = 0;
  private zapStep = ZAP_STAGGER;
  private pendingMarked: Set<number> | null = null;
  private cascadePoints = 0;
  private cascadeCleared = 0;
  private cascadeCx = 0;
  private cascadeCy = 0;

  private shuffleT = 0;
  private nextId = 1;
  private time = 0;

  /** Idle timer used by the hint system. */
  idleTime = 0;
  hintMove: { a: number; b: number } | null = null;

  constructor(cols: number, rows: number, private hooks: BoardHooks) {
    this.cols = cols;
    this.rows = rows;
  }

  // ---------------------------------------------------------------- setup

  private makeTile(col: number, row: number, color: ColorId, special: Special = 'none'): Tile {
    return {
      id: this.nextId++,
      color,
      special,
      col,
      row,
      x: col,
      y: row,
      state: 'idle',
      vy: 0,
      scale: 1,
      squash: 0,
      rot: 0,
      spawnT: 1,
      glow: 0,
      clearT: 0,
      fired: false,
      burst: false,
      hint: 0,
      ox: 0,
      oy: 0,
      ovx: 0,
      ovy: 0,
      jelly: 0,
      jellyPhase: (this.nextId * 1.7) % TAU,
    };
  }

  /**
   * Shove everything around (col,row) outward, as if a candy just detonated
   * there. Neighbours are pushed along the vector away from the blast and left
   * to spring back, which is what sells the hit as physical rather than
   * decorative. Diagonals get less, distant cells get less again.
   *
   * @param power 1 = an ordinary pop, 2-3 = a special going off.
   */
  impulseAt(col: number, row: number, power = 1): void {
    const reach = power >= 2.5 ? 2 : 1;
    for (let dr = -reach; dr <= reach; dr++) {
      for (let dc = -reach; dc <= reach; dc++) {
        if (dc === 0 && dr === 0) continue;
        const t = this.at(col + dc, row + dr);
        if (!t || t.state === 'clearing') continue;
        const dist = Math.hypot(dc, dr);
        if (dist > reach + 0.2) continue;
        // Inverse falloff, so the ring next to the blast takes most of it.
        const falloff = 1 / (dist * dist);
        const push = IMPULSE_PUSH * power * falloff;
        t.ovx += (dc / dist) * push;
        t.ovy += (dr / dist) * push;
        t.jelly = Math.min(1, t.jelly + 0.55 * power * falloff);
      }
    }
  }

  /** Spring the impact displacement back to rest. Semi-implicit Euler. */
  private updateImpacts(dt: number): void {
    // Sub-step so a big impulse can't overshoot into instability at low fps.
    const steps = dt > 1 / 45 ? 2 : 1;
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (const t of this.tiles) {
        if (!t) continue;
        if (t.ox === 0 && t.oy === 0 && t.ovx === 0 && t.ovy === 0) continue;
        t.ovx += (-IMPULSE_K * t.ox - IMPULSE_DAMP * t.ovx) * h;
        t.ovy += (-IMPULSE_K * t.oy - IMPULSE_DAMP * t.ovy) * h;
        t.ox += t.ovx * h;
        t.oy += t.ovy * h;
        // Snap to rest once the motion is imperceptible, so tiles leave the
        // hot loop instead of jittering forever.
        if (Math.abs(t.ox) < 1e-4 && Math.abs(t.oy) < 1e-4 && Math.abs(t.ovx) < 1e-3 && Math.abs(t.ovy) < 1e-3) {
          t.ox = t.oy = t.ovx = t.ovy = 0;
        }
      }
    }
  }

  reset(colorCount = 6): void {
    this.colorCount = clamp(colorCount, 4, 6);
    this.tiles = new Array(this.cols * this.rows).fill(null);
    this.cascade = 0;
    this.movesUsed = 0;
    this.zapQueue = [];
    this.pendingMarked = null;
    this.zapCursor = 0;
    this.zapT = 0;
    this.phase = 'idle';
    this.clearing = [];
    this.pendingForge = [];
    this.hintMove = null;
    this.idleTime = 0;

    // Deal a board with zero starting matches.
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        let color = 0;
        let guard = 0;
        do {
          color = randInt(0, this.colorCount - 1);
          guard++;
        } while (guard < 40 && this.wouldMatch(col, row, color));
        const t = this.makeTile(col, row, color);
        t.y = row - this.rows - 1 - Math.random() * 3;
        t.state = 'falling';
        t.spawnT = 0;
        this.tiles[idx(col, row, this.cols)] = t;
      }
    }
    // Guarantee at least one legal move.
    let guard = 0;
    while (!this.findAnyMove() && guard++ < 30) this.shuffleColors();
    this.phase = 'falling';
  }

  private wouldMatch(col: number, row: number, color: ColorId): boolean {
    const at = (c: number, r: number) => {
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return null;
      return this.tiles[idx(c, r, this.cols)];
    };
    const h1 = at(col - 1, row);
    const h2 = at(col - 2, row);
    if (h1 && h2 && h1.color === color && h2.color === color) return true;
    const v1 = at(col, row - 1);
    const v2 = at(col, row - 2);
    if (v1 && v2 && v1.color === color && v2.color === color) return true;
    return false;
  }

  // ---------------------------------------------------------------- access

  at(col: number, row: number): Tile | null {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return null;
    return this.tiles[idx(col, row, this.cols)];
  }

  get busy(): boolean {
    return this.phase !== 'idle';
  }

  // ---------------------------------------------------------------- input

  /** Returns true if the swap was accepted (animation started). */
  trySwap(aCol: number, aRow: number, bCol: number, bRow: number): boolean {
    if (this.phase !== 'idle') return false;
    if (Math.abs(aCol - bCol) + Math.abs(aRow - bRow) !== 1) return false;
    const a = this.at(aCol, aRow);
    const b = this.at(bCol, bRow);
    if (!a || !b) return false;

    this.swapA = idx(aCol, aRow, this.cols);
    this.swapB = idx(bCol, bRow, this.cols);
    this.swapAx = a.x;
    this.swapAy = a.y;
    this.swapBx = b.x;
    this.swapBy = b.y;
    this.swapT = 0;
    a.state = 'swapping';
    b.state = 'swapping';
    this.phase = 'swapping';
    this.idleTime = 0;
    this.hintMove = null;
    this.hooks.onSwapStart();
    return true;
  }

  private commitSwap(): void {
    const a = this.tiles[this.swapA];
    const b = this.tiles[this.swapB];
    if (!a || !b) return;
    this.tiles[this.swapA] = b;
    this.tiles[this.swapB] = a;
    const ac = a.col;
    const ar = a.row;
    a.col = b.col;
    a.row = b.row;
    b.col = ac;
    b.row = ar;
  }

  // ---------------------------------------------------------------- update

  update(dt: number): void {
    this.time += dt;
    this.updateVisuals(dt);
    this.updateImpacts(dt);

    switch (this.phase) {
      case 'idle':
        this.idleTime += dt;
        if (this.idleTime > 4 && !this.hintMove) this.hintMove = this.findAnyMove();
        break;

      case 'swapping':
      case 'rejecting':
        this.updateSwap(dt);
        break;

      case 'zapping':
        this.updateZapping(dt);
        break;

      case 'clearing':
        this.updateClearing(dt);
        break;

      case 'falling':
        this.updateFalling(dt);
        break;

      case 'shuffling':
        this.updateShuffle(dt);
        break;

      case 'locked':
        break;
    }
  }

  private updateVisuals(dt: number): void {
    for (const t of this.tiles) {
      if (!t) continue;
      // Spring the squash back to rest.
      t.squash += (0 - t.squash) * Math.min(1, dt * 11);
      t.glow = Math.max(0, t.glow - dt * 2.4);
      if (t.spawnT < 1) t.spawnT = Math.min(1, t.spawnT + dt * 3.4);
      if (t.hint > 0) t.hint = Math.max(0, t.hint - dt * 2);
      if (t.jelly > 0) t.jelly = Math.max(0, t.jelly - dt * 2.6);
      // Specials idle-wobble to advertise themselves, but a candy that is
      // *popping* must not rotate. `commitClear` zeroes `rot`, and this line
      // used to put it straight back the very next frame, so every special
      // caught in a match spun through its whole pop. On a lacquered candy
      // that is especially bad: the painted highlight swims around the body
      // and the piece stops reading as a solid object at exactly the moment
      // it is under the most attention.
      if (t.special !== 'none' && t.state !== 'clearing') {
        t.rot = Math.sin(this.time * 2.2 + t.id) * 0.08;
      }
    }
  }

  private updateSwap(dt: number): void {
    const a = this.tiles[this.swapA];
    const b = this.tiles[this.swapB];
    if (!a || !b) {
      this.phase = 'idle';
      return;
    }
    const rejecting = this.phase === 'rejecting';
    const dur = rejecting ? SWAP_TIME * 1.5 : SWAP_TIME;
    this.swapT += dt / dur;

    if (rejecting) {
      // Out and back — a little "nope" nudge.
      const p = clamp(this.swapT, 0, 1);
      const k = Math.sin(p * Math.PI) * 0.42;
      a.x = this.swapAx + (this.swapBx - this.swapAx) * k;
      a.y = this.swapAy + (this.swapBy - this.swapAy) * k;
      b.x = this.swapBx + (this.swapAx - this.swapBx) * k;
      b.y = this.swapBy + (this.swapAy - this.swapBy) * k;
      a.rot = Math.sin(p * Math.PI * 4) * 0.2;
      b.rot = -Math.sin(p * Math.PI * 4) * 0.2;
      if (this.swapT >= 1) {
        a.x = this.swapAx;
        a.y = this.swapAy;
        b.x = this.swapBx;
        b.y = this.swapBy;
        a.rot = b.rot = 0;
        a.state = b.state = 'idle';
        this.phase = 'idle';
        this.idleTime = 0;
      }
      return;
    }

    const p = easeOutCubic(clamp(this.swapT, 0, 1));
    // Slight arc so the two candies orbit each other instead of sliding flat.
    const nx = -(this.swapBy - this.swapAy);
    const ny = this.swapBx - this.swapAx;
    const arc = Math.sin(p * Math.PI) * 0.16;
    a.x = this.swapAx + (this.swapBx - this.swapAx) * p + nx * arc;
    a.y = this.swapAy + (this.swapBy - this.swapAy) * p + ny * arc;
    b.x = this.swapBx + (this.swapAx - this.swapBx) * p - nx * arc;
    b.y = this.swapBy + (this.swapAy - this.swapBy) * p - ny * arc;
    a.scale = 1 + Math.sin(p * Math.PI) * 0.14;
    b.scale = 1 + Math.sin(p * Math.PI) * 0.14;

    if (this.swapT >= 1) {
      a.scale = b.scale = 1;
      this.commitSwap();
      const ta = this.tiles[this.swapA]!;
      const tb = this.tiles[this.swapB]!;
      ta.x = ta.col;
      ta.y = ta.row;
      tb.x = tb.col;
      tb.y = tb.row;
      ta.state = 'idle';
      tb.state = 'idle';
      this.resolveAfterSwap();
    }
  }

  private resolveAfterSwap(): void {
    const a = this.tiles[this.swapA]!;
    const b = this.tiles[this.swapB]!;

    // 1) Special + special / special + candy combos triggered by the swap.
    const combo = this.swapComboSeeds(a, b);
    if (combo) {
      this.movesUsed++;
      this.cascade = 0;
      this.beginClear(combo);
      return;
    }

    // 2) Ordinary matches.
    const groups = this.findMatches();
    if (groups.length > 0) {
      this.movesUsed++;
      this.cascade = 0;
      this.consumeGroups(groups, this.swapA, this.swapB);
      return;
    }

    // 3) Nothing — bounce back.
    this.commitSwap(); // undo the logical swap
    const ra = this.tiles[this.swapA]!;
    const rb = this.tiles[this.swapB]!;
    this.swapAx = ra.col;
    this.swapAy = ra.row;
    this.swapBx = rb.col;
    this.swapBy = rb.row;
    ra.x = ra.col;
    ra.y = ra.row;
    rb.x = rb.col;
    rb.y = rb.row;
    this.swapT = 0;
    this.phase = 'rejecting';
    this.hooks.onReject(rb.col, rb.row);
  }

  // ---------------------------------------------------------------- matching

  private findMatches(): MatchGroup[] {
    const { cols, rows } = this;
    const runs: Run[] = [];

    // horizontal
    for (let r = 0; r < rows; r++) {
      let start = 0;
      for (let c = 1; c <= cols; c++) {
        const prev = this.at(c - 1, r);
        const cur = c < cols ? this.at(c, r) : null;
        const same =
          cur && prev && cur.color === prev.color && cur.color !== BOMB_COLOR && prev.color !== BOMB_COLOR;
        if (!same) {
          const len = c - start;
          if (len >= 3) {
            const cells: number[] = [];
            for (let k = start; k < c; k++) cells.push(idx(k, r, cols));
            runs.push({
              cells,
              horizontal: true,
              line: r,
              from: start,
              to: c - 1,
              color: this.at(start, r)!.color,
            });
          }
          start = c;
        }
      }
    }

    // vertical
    for (let c = 0; c < cols; c++) {
      let start = 0;
      for (let r = 1; r <= rows; r++) {
        const prev = this.at(c, r - 1);
        const cur = r < rows ? this.at(c, r) : null;
        const same =
          cur && prev && cur.color === prev.color && cur.color !== BOMB_COLOR && prev.color !== BOMB_COLOR;
        if (!same) {
          const len = r - start;
          if (len >= 3) {
            const cells: number[] = [];
            for (let k = start; k < r; k++) cells.push(idx(c, k, cols));
            runs.push({
              cells,
              horizontal: false,
              line: c,
              from: start,
              to: r - 1,
              color: this.at(c, start)!.color,
            });
          }
          start = r;
        }
      }
    }

    if (runs.length === 0) return [];

    const parent = new Map<number, number>();
    const find = (x: number): number => {
      let p = parent.get(x) ?? x;
      if (p !== x) {
        p = find(p);
        parent.set(x, p);
      }
      return p;
    };
    const union = (x: number, y: number) => {
      const rx = find(x);
      const ry = find(y);
      if (rx !== ry) parent.set(rx, ry);
    };

    /*
     * Two runs belong to the same match if they touch — the classic L and T
     * case, where they share a cell.
     *
     * They also belong together if they are parallel, one line apart, the
     * same colour, and overlap by two or more. That is a 2x2 block of one
     * colour, which no amount of single-axis scanning will ever notice
     * because neither run contains a cell of the other. Merging them is what
     * makes a square pattern detectable at all, and it costs nothing: any
     * arrangement it merges was already going to clear this turn, so no
     * previously-legal move changes meaning.
     */
    const cellSetOf = (r: Run) => r.cells;
    runs.forEach((run, i) => {
      if (!parent.has(i)) parent.set(i, i);
      for (let j = i + 1; j < runs.length; j++) {
        if (!parent.has(j)) parent.set(j, j);
        const other = runs[j];
        const shares = cellSetOf(run).some((c) => other.cells.includes(c));
        const parallelBlock =
          run.horizontal === other.horizontal &&
          run.color === other.color &&
          Math.abs(run.line - other.line) === 1 &&
          Math.min(run.to, other.to) - Math.max(run.from, other.from) + 1 >= 2;
        if (shares || parallelBlock) union(i, j);
      }
    });

    const buckets = new Map<number, number[]>();
    runs.forEach((_, i) => {
      const root = find(i);
      const arr = buckets.get(root) ?? [];
      arr.push(i);
      buckets.set(root, arr);
    });

    const groups: MatchGroup[] = [];
    for (const runIdxs of buckets.values()) {
      const cellSet = new Set<number>();
      let maxH = 0;
      let maxV = 0;
      let intersection = -1;
      const counts = new Map<number, number>();

      for (const ri of runIdxs) {
        const run = runs[ri];
        if (run.horizontal) maxH = Math.max(maxH, run.cells.length);
        else maxV = Math.max(maxV, run.cells.length);
        for (const c of run.cells) {
          cellSet.add(c);
          const n = (counts.get(c) ?? 0) + 1;
          counts.set(c, n);
          if (n > 1) intersection = c;
        }
      }

      const cells = [...cellSet];
      const first = this.tiles[cells[0]];
      if (!first) continue;

      groups.push({
        cells,
        color: first.color,
        maxH,
        maxV,
        anchor: intersection >= 0 ? intersection : cells[Math.floor(cells.length / 2)],
        shape: this.classify(runIdxs.map((i) => runs[i]), cellSet, maxH, maxV, intersection),
      });
    }
    return groups;
  }

  /**
   * Works out which shape a merged group is, which is what decides the
   * special it forges.
   *
   * The discriminator for L versus T versus plus is simply where the two
   * runs cross. If the crossing cell sits at an end of both runs it is a
   * corner; at the middle of one it is a tee; at the middle of both it is a
   * plus. Three shapes, one comparison each, no pattern templates to
   * maintain.
   */
  private classify(
    groupRuns: Run[],
    cellSet: Set<number>,
    maxH: number,
    maxV: number,
    intersection: number,
  ): MatchShape {
    const { cols } = this;

    // A straight 5 outranks everything; it is the colour bomb.
    if (maxH >= 5 || maxV >= 5) return 'line';

    if (maxH >= 3 && maxV >= 3 && intersection >= 0) {
      const ic = intersection % cols;
      const ir = Math.floor(intersection / cols);
      const h = groupRuns.find((r) => r.horizontal && r.line === ir && ic >= r.from && ic <= r.to);
      const v = groupRuns.find((r) => !r.horizontal && r.line === ic && ir >= r.from && ir <= r.to);
      if (h && v) {
        const hMid = ic > h.from && ic < h.to;
        const vMid = ir > v.from && ir < v.to;
        if (hMid && vMid) return 'plus';
        if (hMid || vMid) return 'T';
        return 'L';
      }
    }

    /*
     * Slabs, largest first.
     *
     * A 2x3 contains a 2x2, so the order here is the whole test: checking
     * for the bigger shape first is what stops every slab on the board from
     * being rounded down to `square`. The two orientations are checked
     * separately rather than by transposing the set, which would cost an
     * allocation per group on a path that runs for every match.
     */
    const inSet = (c: number, r: number) =>
      c >= 0 && r >= 0 && c < cols && cellSet.has(r * cols + c);

    for (const cell of cellSet) {
      const c0 = cell % cols;
      const r0 = Math.floor(cell / cols);
      // 2 rows x 3 columns.
      if (
        inSet(c0 + 1, r0) &&
        inSet(c0 + 2, r0) &&
        inSet(c0, r0 + 1) &&
        inSet(c0 + 1, r0 + 1) &&
        inSet(c0 + 2, r0 + 1)
      ) {
        return 'block';
      }
      // 3 rows x 2 columns.
      if (
        inSet(c0 + 1, r0) &&
        inSet(c0, r0 + 1) &&
        inSet(c0 + 1, r0 + 1) &&
        inSet(c0, r0 + 2) &&
        inSet(c0 + 1, r0 + 2)
      ) {
        return 'block';
      }
    }

    // Plain 2x2 anywhere inside the group.
    for (const c of cellSet) {
      if (c % cols === cols - 1) continue;
      if (cellSet.has(c + 1) && cellSet.has(c + cols) && cellSet.has(c + cols + 1)) return 'square';
    }

    return 'line';
  }

  private hasMatchAt(col: number, row: number): boolean {
    const t = this.at(col, row);
    if (!t || t.color === BOMB_COLOR) return false;
    const color = t.color;
    let n = 1;
    for (let c = col - 1; c >= 0 && this.at(c, row)?.color === color; c--) n++;
    for (let c = col + 1; c < this.cols && this.at(c, row)?.color === color; c++) n++;
    if (n >= 3) return true;
    n = 1;
    for (let r = row - 1; r >= 0 && this.at(col, r)?.color === color; r--) n++;
    for (let r = row + 1; r < this.rows && this.at(col, r)?.color === color; r++) n++;
    return n >= 3;
  }

  /** Brute-force scan for any legal move (also used for hints). */
  findAnyMove(): { a: number; b: number } | null {
    const { cols, rows } = this;
    const test = (c1: number, r1: number, c2: number, r2: number): boolean => {
      const i1 = idx(c1, r1, cols);
      const i2 = idx(c2, r2, cols);
      const t1 = this.tiles[i1];
      const t2 = this.tiles[i2];
      if (!t1 || !t2) return false;
      // Colour bombs can always be swapped.
      if (t1.special === 'bomb' || t2.special === 'bomb') return true;
      this.tiles[i1] = t2;
      this.tiles[i2] = t1;
      const ok = this.hasMatchAt(c1, r1) || this.hasMatchAt(c2, r2);
      this.tiles[i1] = t1;
      this.tiles[i2] = t2;
      return ok;
    };

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (c + 1 < cols && test(c, r, c + 1, r)) return { a: idx(c, r, cols), b: idx(c + 1, r, cols) };
        if (r + 1 < rows && test(c, r, c, r + 1)) return { a: idx(c, r, cols), b: idx(c, r + 1, cols) };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- clearing

  private consumeGroups(groups: MatchGroup[], preferA = -1, preferB = -1): void {
    const seeds = new Set<number>();
    this.pendingForge = [];

    for (const g of groups) {
      const size = g.cells.length;
      /*
       * The forging table. Shape first, then length — a plus built out of
       * two threes is a harder thing to engineer than a straight four, so it
       * has to pay better, or the player learns to ignore shapes entirely.
       *
       * A straight five still outranks everything: the colour bomb stays the
       * top of the ladder.
       */
      /*
       * The forge ladder, strongest shape first.
       *
       * Six-and-up is tested before five so a long run stops being rounded
       * down to a colour bomb, and `block` before `square` so a slab is not
       * rounded down to the 2x2 hiding inside it.
       *
       * The `square` rung moved from wrapped to vortex to fix a duplicate
       * that had been there from the start: a corner and a 2x2 are quite
       * different things to build and both paid out the same wrapped candy,
       * so one of the two shapes was effectively invisible. Giving 2x2 its
       * own special is also what makes the vortex *reachable* — gated behind
       * a 2x3 slab it forged about once every 1500 moves, which is to say
       * most players would never once have seen it.
       */
      let special: Special = 'none';
      if (g.maxH >= 6) special = 'laserH';
      else if (g.maxV >= 6) special = 'laserV';
      else if (g.maxH >= 5 || g.maxV >= 5) special = 'bomb';
      else if (g.shape === 'block') special = 'nova';
      else if (g.shape === 'plus') special = 'nova';
      else if (g.shape === 'T') special = 'cross';
      else if (g.shape === 'L') special = 'wrapped';
      else if (g.shape === 'square') special = 'vortex';
      else if (g.maxH === 4) special = 'stripeH';
      else if (g.maxV === 4) special = 'stripeV';

      let anchor = g.anchor;
      if (preferA >= 0 && g.cells.includes(preferA)) anchor = preferA;
      else if (preferB >= 0 && g.cells.includes(preferB)) anchor = preferB;

      if (special !== 'none') {
        this.pendingForge.push({
          cell: anchor,
          color: special === 'bomb' ? BOMB_COLOR : g.color,
          special,
        });
      }
      for (const c of g.cells) if (c !== anchor || special === 'none') seeds.add(c);
      // The anchor still pops visually, then is replaced by the special.
      if (special !== 'none') seeds.add(anchor);
      this.cascadePoints += size * 20;
    }

    this.beginClear(seeds);
  }

  /** Expands seeds through special-candy chain reactions, then starts the pop. */
  private beginClear(seeds: Set<number>): void {
    const queue = [...seeds];
    const marked = new Set<number>(seeds);

    while (queue.length > 0) {
      const cell = queue.shift()!;
      const t = this.tiles[cell];
      if (!t || t.fired) continue;
      if (t.special === 'none') continue;
      t.fired = true;
      const extra = this.detonate(t);
      for (const c of extra) {
        if (!marked.has(c)) {
          marked.add(c);
          queue.push(c);
        }
      }
    }

    /*
     * A colour bomb used to delete its targets on the same frame it fired,
     * which is the least satisfying way to spend the best piece in the game:
     * a third of the board simply vanished. The bolts now go out first, one
     * per target on a tight stagger, and the targets all detonate together
     * once the last bolt lands.
     *
     * Nothing about *what* gets cleared changes — `marked` is already
     * final here. This only delays the visual, which keeps the rule simple
     * and means no cascade or scoring path had to learn a new shape.
     */
    if (this.zapQueue.length > 0) {
      this.pendingMarked = marked;
      this.zapCursor = 0;
      this.zapT = 0;
      /*
       * Fire nearest-first. The queue comes out of a left-to-right scan of
       * the tile array, so unsorted it hops around the board at random and
       * the sequence reads as noise. Ordering by distance from the bomb
       * turns the same bolts into a wavefront spreading outwards, which is
       * legible at a glance and costs one sort of at most a few dozen items.
       */
      this.zapQueue.sort((p, q) => {
        const dp = (p.to % this.cols - p.fromCol) ** 2 + (Math.floor(p.to / this.cols) - p.fromRow) ** 2;
        const dq = (q.to % this.cols - q.fromCol) ** 2 + (Math.floor(q.to / this.cols) - q.fromRow) ** 2;
        return dp - dq;
      });
      // Big clears would otherwise run long, so the stagger tightens to keep
      // the whole sequence inside its budget however many targets there are.
      this.zapStep = Math.min(ZAP_STAGGER, ZAP_MAX_TOTAL / Math.max(1, this.zapQueue.length));
      this.phase = 'zapping';
      return;
    }

    this.commitClear(marked);
  }

  private updateZapping(dt: number): void {
    this.zapT += dt;
    const total = this.zapQueue.length;
    while (this.zapCursor < total && this.zapT >= this.zapCursor * this.zapStep) {
      const z = this.zapQueue[this.zapCursor++];
      const t = this.tiles[z.to];
      if (!t) continue;
      if (z.inward) {
        this.hooks.onTracer(t.col, t.row, z.fromCol, z.fromRow, z.color, this.zapCursor, total);
      } else {
        this.hooks.onTracer(z.fromCol, z.fromRow, t.col, t.row, z.color, this.zapCursor, total);
      }
      t.squash = Math.max(t.squash, 0.26);
      t.jelly = 1;
      t.jellyPhase = this.time * 6;
    }

    /*
     * Hold every target already claimed at full glow until the blast.
     *
     * `updateVisuals` decays glow at 2.4/s, which over a sequence that now
     * runs the better part of a second means the first candies hit have gone
     * dark again by the time the last one is marked. Re-asserting it every
     * frame is what turns the sequence into an accumulating lock-on — the
     * player watches the set of doomed candies *grow*, and the simultaneous
     * detonation then reads as one decision rather than as a series of them.
     */
    for (let i = 0; i < this.zapCursor; i++) {
      const t = this.tiles[this.zapQueue[i].to];
      if (t) t.glow = 1;
    }

    const done = this.zapQueue.length * this.zapStep + ZAP_HOLD;
    if (this.zapCursor >= this.zapQueue.length && this.zapT >= done) {
      const marked = this.pendingMarked ?? new Set<number>();
      this.pendingMarked = null;
      this.zapQueue = [];
      this.commitClear(marked);
    }
  }

  /** Puts every marked tile into its pop animation and starts the clock. */
  private commitClear(marked: Set<number>): void {
    this.zapQueue = [];
    this.clearing = [];
    let cx = 0;

    let cy = 0;
    let n = 0;
    for (const cell of marked) {
      const t = this.tiles[cell];
      if (!t || t.state === 'clearing') continue;
      t.state = 'clearing';
      t.clearT = 0;
      t.burst = false;
      t.rot = 0;
      this.clearing.push(t);
      cx += t.col;
      cy += t.row;
      n++;
    }

    if (n === 0) {
      this.finishResolve();
      return;
    }

    this.cascadeCx = cx / n;
    this.cascadeCy = cy / n;
    this.cascadeCleared += n;
    this.cascadePoints += n * (40 + this.cascade * 25);
    this.clearT = 0;
    this.phase = 'clearing';
  }

  /** Returns the cells affected by a special candy going off. */
  private detonate(t: Tile): number[] {
    const out: number[] = [];
    const { cols, rows } = this;

    if (t.special === 'stripeH') {
      for (let c = 0; c < cols; c++) out.push(idx(c, t.row, cols));
      this.hooks.onFire('stripeH', t.col, t.row, t.color, cols);
    } else if (t.special === 'stripeV') {
      for (let r = 0; r < rows; r++) out.push(idx(t.col, r, cols));
      this.hooks.onFire('stripeV', t.col, t.row, t.color, rows);
    } else if (t.special === 'wrapped') {
      for (let r = t.row - 1; r <= t.row + 1; r++)
        for (let c = t.col - 1; c <= t.col + 1; c++)
          if (c >= 0 && r >= 0 && c < cols && r < rows) out.push(idx(c, r, cols));
      this.hooks.onFire('wrapped', t.col, t.row, t.color, 3);
    } else if (t.special === 'cross') {
      // Forged by a tee. Takes the whole row *and* the whole column.
      for (let c = 0; c < cols; c++) out.push(idx(c, t.row, cols));
      for (let r = 0; r < rows; r++) out.push(idx(t.col, r, cols));
      this.hooks.onFire('cross', t.col, t.row, t.color, Math.max(cols, rows));
    } else if (t.special === 'nova') {
      // Forged by a plus. A 5x5 with the corners cut, so the blast reads as
      // a burst rather than as a rectangle stamped on the board.
      for (let r = t.row - 2; r <= t.row + 2; r++) {
        for (let c = t.col - 2; c <= t.col + 2; c++) {
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
          if (Math.abs(c - t.col) === 2 && Math.abs(r - t.row) === 2) continue;
          out.push(idx(c, r, cols));
        }
      }
      this.hooks.onFire('nova', t.col, t.row, t.color, 5);
    } else if (t.special === 'laserH' || t.special === 'laserV') {
      // Three lanes, not one. The centre lane is the run that forged it and
      // the two outriders are what make it worth building six of a colour.
      const horizontal = t.special === 'laserH';
      const centre = horizontal ? t.row : t.col;
      const limit = horizontal ? rows : cols;
      for (let d = -1; d <= 1; d++) {
        const lane = centre + d;
        if (lane < 0 || lane >= limit) continue;
        if (horizontal) {
          for (let c = 0; c < cols; c++) out.push(idx(c, lane, cols));
        } else {
          for (let r = 0; r < rows; r++) out.push(idx(lane, r, cols));
        }
      }
      this.hooks.onFire(t.special, t.col, t.row, t.color, horizontal ? cols : rows);
    } else if (t.special === 'vortex') {
      /*
       * Reaches across the board for its own colour, nearest first.
       *
       * Capped at VORTEX_PULL because uncapped it is a colour bomb with a
       * different sprite — on a board that has drifted colour-heavy it would
       * routinely take twenty-plus candies and make the actual colour bomb
       * pointless. A fixed, smallish catch keeps it a precision tool: strong
       * because you can see exactly what it will take, not because it takes
       * everything.
       */
      const mine: Array<{ i: number; d: number }> = [];
      for (let i = 0; i < this.tiles.length; i++) {
        const o = this.tiles[i];
        if (!o || o === t || o.color !== t.color || o.color === BOMB_COLOR) continue;
        mine.push({ i, d: (o.col - t.col) ** 2 + (o.row - t.row) ** 2 });
      }
      mine.sort((a, b) => a.d - b.d);
      out.push(idx(t.col, t.row, cols));
      for (const m of mine.slice(0, VORTEX_PULL)) {
        out.push(m.i);
        this.zapQueue.push({
          fromCol: t.col,
          fromRow: t.row,
          to: m.i,
          color: t.color,
          inward: true,
        });
      }
      this.hooks.onFire('vortex', t.col, t.row, t.color, mine.length);
    } else if (t.special === 'bomb') {
      // Caught in a chain: vaporise the most common colour on the board.
      const tally = new Map<ColorId, number>();
      for (const o of this.tiles) {
        if (!o || o.color === BOMB_COLOR) continue;
        tally.set(o.color, (tally.get(o.color) ?? 0) + 1);
      }
      let best: ColorId = 0;
      let bestN = -1;
      for (const [c, n] of tally) if (n > bestN) ((bestN = n), (best = c));
      for (let i = 0; i < this.tiles.length; i++) {
        const o = this.tiles[i];
        if (o && o.color === best) {
          out.push(i);
          this.zapQueue.push({ fromCol: t.col, fromRow: t.row, to: i, color: best });
        }
      }
      this.hooks.onFire('bomb', t.col, t.row, best, 0);
    }
    return out;
  }

  /** Special-on-special swaps produce the showstopper effects. */
  private swapComboSeeds(a: Tile, b: Tile): Set<number> | null {
    const { cols, rows } = this;
    const seeds = new Set<number>();
    const add = (c: number, r: number) => {
      if (c >= 0 && r >= 0 && c < cols && r < rows) seeds.add(idx(c, r, cols));
    };
    const sa = a.special;
    const sb = b.special;
    /*
     * The two new specials slot into the existing combo table rather than
     * doubling its size. A cross is a line special that happens to point
     * both ways, and a nova is an area special that happens to be bigger,
     * so every pairing that already worked keeps working and only the reach
     * changes. Sixteen new branches would have been sixteen new ways to be
     * subtly wrong.
     */
    // A laser is a line special that happens to be three lanes thick and a
    // vortex is an area special that happens to choose its own area, so both
    // classify into the pairings that already exist rather than adding a
    // second dimension to the table.
    const stripe = (s: Special) =>
      s === 'stripeH' || s === 'stripeV' || s === 'cross' || s === 'laserH' || s === 'laserV';
    const area = (s: Special) => s === 'wrapped' || s === 'nova' || s === 'vortex';
    const big = sa === 'nova' || sb === 'nova' ? 2 : 1;

    // Bomb + bomb: wipe the board.
    if (sa === 'bomb' && sb === 'bomb') {
      for (let i = 0; i < this.tiles.length; i++) seeds.add(i);
      a.fired = b.fired = true;
      this.hooks.onFire('bomb', a.col, a.row, BOMB_COLOR, 99);
      this.hooks.onFire('bomb', b.col, b.row, BOMB_COLOR, 99);
      return seeds;
    }

    // Bomb + anything: clear that colour (and upgrade them if the partner is special).
    if (sa === 'bomb' || sb === 'bomb') {
      const bomb = sa === 'bomb' ? a : b;
      const other = sa === 'bomb' ? b : a;
      if (other.color === BOMB_COLOR) return null;
      bomb.fired = true;
      const targetColor = other.color;
      const partner = other.special;
      let upgraded = 0;
      for (let i = 0; i < this.tiles.length; i++) {
        const t = this.tiles[i];
        if (!t) continue;
        if (t.color === targetColor || t === other) {
          this.zapQueue.push({ fromCol: bomb.col, fromRow: bomb.row, to: i, color: targetColor });
          if (stripe(partner) && upgraded < 12 && t !== other) {
            t.special = partner === 'cross' ? 'cross' : upgraded % 2 === 0 ? 'stripeH' : 'stripeV';
            upgraded++;
          } else if (area(partner) && upgraded < 6 && t !== other) {
            t.special = partner;
            upgraded++;
          }
          seeds.add(i);
        }
      }
      seeds.add(idx(bomb.col, bomb.row, cols));
      this.hooks.onFire('bomb', bomb.col, bomb.row, targetColor, 0);
      return seeds;
    }

    // Striped + striped: full cross.
    if (stripe(sa) && stripe(sb)) {
      a.fired = b.fired = true;
      for (let c = 0; c < cols; c++) add(c, b.row);
      for (let r = 0; r < rows; r++) add(b.col, r);
      this.hooks.onFire('stripeH', b.col, b.row, a.color, cols);
      this.hooks.onFire('stripeV', b.col, b.row, b.color, rows);
      return seeds;
    }

    // Line + area: a band of rows and columns, wider if a nova is involved.
    if ((stripe(sa) && area(sb)) || (area(sa) && stripe(sb))) {
      a.fired = b.fired = true;
      const p = area(sa) ? a : b;
      const w = big; // 1 -> three lines each way, 2 -> five
      for (let d = -w; d <= w; d++) {
        for (let c = 0; c < cols; c++) add(c, p.row + d);
        for (let r = 0; r < rows; r++) add(p.col + d, r);
      }
      this.hooks.onFire(p.special === 'nova' ? 'nova' : 'wrapped', p.col, p.row, p.color, 3);
      for (let d = -w; d <= w; d++) {
        this.hooks.onFire('stripeH', p.col, p.row + d, p.color, cols);
        this.hooks.onFire('stripeV', p.col + d, p.row, p.color, rows);
      }
      return seeds;
    }

    // Area + area: one giant blast, 5x5 or 7x7.
    if (area(sa) && area(sb)) {
      a.fired = b.fired = true;
      const rad = big + 1;
      for (let r = b.row - rad; r <= b.row + rad; r++)
        for (let c = b.col - rad; c <= b.col + rad; c++) add(c, r);
      this.hooks.onFire(big > 1 ? 'nova' : 'wrapped', b.col, b.row, b.color, rad * 2 + 1);
      return seeds;
    }

    return null;
  }

  private updateClearing(dt: number): void {
    this.clearT += dt / CLEAR_TIME;
    const p = clamp(this.clearT, 0, 1);

    for (const t of this.clearing) {
      t.clearT = p;
      /*
       * The pop used to spin the candy as it went. Spin is the cheapest
       * possible way to signal "something is happening", and it fights the
       * art: these pieces have a fixed light source and a painted highlight,
       * so rotating them makes the highlight swim and the candy read as a
       * flat sticker being twirled.
       *
       * The shape does the work instead. A quick anticipatory squat, then an
       * overshooting inflate, then a fast implode — with the squash axis
       * flipping between the two halves so the candy visibly *stretches*
       * before it goes. Same three frames of information, no spin.
       */
      if (p < 0.18) {
        const u = p / 0.18;
        t.scale = 1 - 0.1 * Math.sin(u * Math.PI * 0.5);
        t.squash = 0.16 * u; // squat: wide and low
      } else if (p < 0.46) {
        const u = (p - 0.18) / 0.28;
        t.scale = 0.9 + easeOutBack(u, 3.4) * 0.56;
        t.squash = 0.16 - 0.34 * u; // snap through to tall and narrow
      } else {
        const u = (p - 0.46) / 0.54;
        t.scale = 1.46 * (1 - easeInCubic(u));
        t.squash = -0.18 * (1 - u);
      }
      t.glow = Math.min(1, p * 2.4);
      if (!t.burst && p >= 0.45) {
        t.burst = true;
        // Shove the surrounding candies away from the blast.
        const power =
          t.special === 'none'
            ? 1
            : t.special === 'nova' || t.special === 'bomb'
              ? 3.6
              : t.special === 'wrapped' || t.special === 'cross'
                ? 3
                : 2;
        this.impulseAt(t.col, t.row, power);
        this.hooks.onPop(t, this.cascade);
      }
    }

    if (this.clearT >= 1) {
      for (const t of this.clearing) {
        const i = idx(t.col, t.row, this.cols);
        if (this.tiles[i] === t) this.tiles[i] = null;
      }
      this.clearing = [];

      // Forge specials into the holes they came from.
      for (const f of this.pendingForge) {
        const col = f.cell % this.cols;
        const row = Math.floor(f.cell / this.cols);
        const t = this.makeTile(col, row, f.color, f.special);
        // spawnT drives the pop-in (easeOutBack at render time). Do NOT also
        // zero t.scale: nothing ever animates that back up for an idle tile,
        // so the candy would stay invisible forever while still occupying the
        // cell — gravity would skip it and the board would show a permanent
        // gap. This was the "random empty square" bug.
        t.spawnT = 0;
        this.tiles[f.cell] = t;
        this.hooks.onForge(f.special, col, row, f.color);
      }
      this.pendingForge = [];

      this.hooks.onScore(this.cascadePoints);
      this.hooks.onCascade(this.cascade, this.cascadeCleared, this.cascadePoints, this.cascadeCx, this.cascadeCy);
      this.cascadePoints = 0;
      this.cascadeCleared = 0;

      this.applyGravity();
      this.phase = 'falling';
    }
  }

  private applyGravity(): void {
    const { cols, rows } = this;
    for (let c = 0; c < cols; c++) {
      let write = rows - 1;
      for (let r = rows - 1; r >= 0; r--) {
        const t = this.tiles[idx(c, r, cols)];
        if (!t) continue;
        if (write !== r) {
          this.tiles[idx(c, write, cols)] = t;
          this.tiles[idx(c, r, cols)] = null;
          t.row = write;
          t.state = 'falling';
        }
        write--;
      }
      // Refill from above.
      let above = 1;
      for (let r = write; r >= 0; r--) {
        const t = this.makeTile(c, r, randInt(0, this.colorCount - 1));
        t.y = -above - 0.35 * Math.random();
        t.state = 'falling';
        t.spawnT = 1;
        this.tiles[idx(c, r, cols)] = t;
        above++;
      }
    }
    // Anything already out of place should fall too.
    for (const t of this.tiles) {
      if (t && Math.abs(t.y - t.row) > 0.001 && t.state !== 'clearing') t.state = 'falling';
    }
  }

  private updateFalling(dt: number): void {
    let moving = false;
    for (const t of this.tiles) {
      if (!t) continue;
      t.x += (t.col - t.x) * Math.min(1, dt * 22);
      if (t.state !== 'falling') continue;
      t.vy = Math.min(MAX_FALL, t.vy + GRAVITY * dt);
      t.y += t.vy * dt;
      if (t.y >= t.row) {
        const force = clamp(t.vy / 18, 0.15, 1);
        t.y = t.row;
        t.state = 'idle';
        t.squash = force * 0.52;
        t.vy = 0;
        // A landing candy thumps whatever it lands on, and jiggles itself.
        t.jelly = Math.min(1, t.jelly + force * 0.5);
        const below = this.at(t.col, t.row + 1);
        if (below && below.state === 'idle') {
          below.ovy += force * 1.9;
          below.jelly = Math.min(1, below.jelly + force * 0.32);
        }
        this.hooks.onLand(t, force);
      } else {
        moving = true;
      }
    }

    if (!moving) {
      const groups = this.findMatches();
      if (groups.length > 0) {
        this.cascade++;
        this.consumeGroups(groups);
      } else {
        this.finishResolve();
      }
    }
  }

  private finishResolve(): void {
    for (const t of this.tiles) if (t) t.fired = false;
    this.cascade = 0;
    this.idleTime = 0;
    this.hintMove = null;

    if (!this.findAnyMove()) {
      this.beginShuffle();
      return;
    }
    this.phase = 'idle';
    this.hooks.onSettled(this.movesUsed);
  }

  // ---------------------------------------------------------------- shuffle

  private shuffleColors(): void {
    const colors: ColorId[] = [];
    for (const t of this.tiles) if (t) colors.push(t.color);
    for (let i = colors.length - 1; i > 0; i--) {
      const j = randInt(0, i);
      [colors[i], colors[j]] = [colors[j], colors[i]];
    }
    let k = 0;
    for (const t of this.tiles) if (t) t.color = colors[k++];
  }

  private beginShuffle(): void {
    this.phase = 'shuffling';
    this.shuffleT = 0;
    this.hooks.onShuffle();
  }

  private updateShuffle(dt: number): void {
    const prev = this.shuffleT;
    this.shuffleT += dt / SHUFFLE_TIME;
    const p = clamp(this.shuffleT, 0, 1);

    for (const t of this.tiles) {
      if (!t) continue;
      const wob = Math.sin(p * Math.PI);
      t.scale = 1 - wob * 0.75;
      t.rot = wob * 7 * (t.id % 2 === 0 ? 1 : -1);
      const cx = (this.cols - 1) / 2;
      const cy = (this.rows - 1) / 2;
      t.x = t.col + (cx - t.col) * wob * 0.6;
      t.y = t.row + (cy - t.row) * wob * 0.6;
    }

    if (prev < 0.5 && p >= 0.5) {
      let guard = 0;
      do {
        this.shuffleColors();
        guard++;
      } while (guard < 60 && (this.anyImmediateMatch() || !this.findAnyMove()));
    }

    if (this.shuffleT >= 1) {
      for (const t of this.tiles) {
        if (!t) continue;
        t.scale = 1;
        t.rot = 0;
        t.x = t.col;
        t.y = t.row;
      }
      if (this.anyImmediateMatch()) {
        const groups = this.findMatches();
        this.cascade = 0;
        this.consumeGroups(groups);
      } else {
        this.phase = 'idle';
        this.idleTime = 0;
        this.hooks.onSettled(this.movesUsed);
      }
    }
  }

  private anyImmediateMatch(): boolean {
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) if (this.hasMatchAt(c, r)) return true;
    return false;
  }

  // ---------------------------------------------------------------- boosters

  /**
   * Set off the special candy in a cell without needing a match.
   * Powers booster items (and the visual test harness).
   */
  /**
   * Fire a special in place, without swapping it. Costs a move, exactly as a
   * swap would: a special you already own should not be free to set off, or
   * tapping strictly dominates swapping and the move economy the levels are
   * tuned against quietly stops meaning anything.
   */
  activateAt(col: number, row: number): boolean {
    if (this.phase !== 'idle') return false;
    const t = this.at(col, row);
    if (!t || t.special === 'none') return false;
    this.cascade = 0;
    this.movesUsed++;
    this.beginClear(new Set([idx(col, row, this.cols)]));
    return true;
  }

  /**
   * Smash a single candy regardless of whether it is special (hammer booster).
   * Does not consume a move.
   */
  crushAt(col: number, row: number): boolean {
    if (this.phase !== 'idle') return false;
    const t = this.at(col, row);
    if (!t) return false;
    this.cascade = 0;
    this.beginClear(new Set([idx(col, row, this.cols)]));
    return true;
  }

  /** Stamp a special onto an existing candy. Returns false if the cell is empty. */
  setSpecial(col: number, row: number, special: Special, color?: ColorId): boolean {
    const t = this.at(col, row);
    if (!t) return false;
    t.special = special;
    if (color !== undefined) t.color = color;
    else if (special === 'bomb') t.color = BOMB_COLOR;
    t.spawnT = 0;
    return true;
  }

  /** First cell holding a special of this kind, or null. */
  findSpecial(special: Special): { col: number; row: number } | null {
    for (const t of this.tiles) {
      if (t && t.special === special) return { col: t.col, row: t.row };
    }
    return null;
  }

  /** Free shuffle from the HUD button. */
  requestShuffle(): boolean {
    if (this.phase !== 'idle') return false;
    this.beginShuffle();
    return true;
  }

  lock(): void {
    this.phase = 'locked';
  }

  unlock(): void {
    if (this.phase === 'locked') this.phase = 'idle';
  }
}
