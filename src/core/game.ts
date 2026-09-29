import { Board, type BoardHooks, type FireKind } from './board';
import { Pointer } from './input';
import { BOMB_COLOR, idx, paletteOf, type ColorId, type Special, type Tile } from './types';
import { clamp, damp, easeOutBack, easeOutCubic, rand } from './rng';
import {
  BOARD_COLS,
  BOARD_ROWS,
  BOOSTERS,
  levelConfig,
  STAR_GATES,
  starsFor,
  type LevelCfg,
} from './game-config';
import { Background } from '../render/background';
import { SpriteCache } from '../render/sprites';
import { ParticleSystem } from '../fx/particles';
import { FX } from '../fx/emitters';
import { Floaters } from '../fx/floaters';
import { ScreenShake } from '../fx/shake';
import { buzz, sfx } from '../audio/sfx';
import {
  Banner,
  drawBadge,
  drawButton,
  drawStar,
  FONT,
  glassPanel,
  roundRectPath,
  Rolling,
  type ButtonId,
  type HudButton,
} from '../ui/hud';
import { drawIcon } from '../ui/icons';

const COLS = BOARD_COLS;
const ROWS = BOARD_ROWS;

type Phase = 'menu' | 'playing' | 'won' | 'lost';

const COMBO_WORDS = [
  '',
  'NICE!',
  'SWEET!',
  'TASTY!',
  'DELICIOUS!',
  'DIVINE!',
  'SUGAR RUSH!',
  'UNSTOPPABLE!',
  'LEGENDARY!',
];

interface Layout {
  w: number;
  h: number;
  pad: number;
  hudTop: number;
  hudH: number;
  bx: number;
  by: number;
  cell: number;
  boardW: number;
  boardH: number;
  footerY: number;
  footerH: number;
}

export class Game {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;

  private bg = new Background();
  private ps = new ParticleSystem(2600);
  private floaters = new Floaters(56);
  private shake = new ScreenShake();
  private sprites = new SpriteCache();
  private banner = new Banner();
  private scoreRoll = new Rolling();
  private movesRoll = new Rolling();

  private board: Board;
  private L: Layout = {
    w: 0,
    h: 0,
    pad: 0,
    hudTop: 0,
    hudH: 0,
    bx: 0,
    by: 0,
    cell: 0,
    boardW: 0,
    boardH: 0,
    footerY: 0,
    footerH: 0,
  };

  /** Board frame + cell grid, baked once per resize. */
  private boardLayer: HTMLCanvasElement | null = null;
  private boardLayerOff = 0;

  /** Booster charges for the current level. */
  private charges = { hammer: 0, shuffle: 0, hint: 0 };
  private armed: 'hammer' | null = null;

  private phase: Phase = 'menu';
  private level = 1;
  private cfg: LevelCfg = levelConfig(1);
  private score = 0;
  private best = 0;
  private starsEarned = 0;
  private overlayT = 0;
  private titleT = 0;

  // input state
  private selected: { col: number; row: number } | null = null;
  private dragFrom: { col: number; row: number } | null = null;
  private dragStart: [number, number] = [0, 0];
  private dragged = false;
  private buttons: HudButton[] = [];
  private heldButton: HudButton | null = null;

  private last = 0;
  private fpsSamples: number[] = [];
  private ambientT = 0;
  private progressGlow = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;

    const hooks: BoardHooks = {
      onPop: (t, cascade) => this.fxPop(t, cascade),
      onFire: (kind, col, row, color, span) => this.fxFire(kind, col, row, color, span),
      onTracer: (fc, fr, tc, tr, color) => this.fxTracer(fc, fr, tc, tr, color),
      onLand: (t, force) => this.fxLand(t, force),
      onCascade: (step, cleared, points, cx, cy) => this.fxCascade(step, cleared, points, cx, cy),
      onForge: (special, col, row, color) => this.fxForge(special, col, row, color),
      onReject: (col, row) => this.fxReject(col, row),
      onSwapStart: () => sfx.swap(),
      onScore: (pts) => this.addScore(pts),
      onSettled: () => this.onSettled(),
      onShuffle: () => this.fxShuffle(),
    };
    this.board = new Board(COLS, ROWS, hooks);

    this.best = Number(localStorage.getItem('sugarrush.best') ?? 0) || 0;
    this.level = Math.max(1, Number(localStorage.getItem('sugarrush.level') ?? 1) || 1);
    this.cfg = levelConfig(this.level);
    sfx.muted = localStorage.getItem('sugarrush.muted') === '1';

    new Pointer(canvas, {
      onDown: (x, y) => this.pointerDown(x, y),
      onMove: (x, y) => this.pointerMove(x, y),
      onUp: (x, y) => this.pointerUp(x, y),
      onCancel: () => this.pointerCancel(),
    });

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.last = performance.now();
    });

    this.resize();
    this.board.reset(this.cfg.colors);
    this.board.lock();
    this.movesRoll.hard(this.cfg.moves);
  }

  // ------------------------------------------------------------- layout

  private resize(): void {
    const w = Math.max(320, window.innerWidth);
    const h = Math.max(420, window.innerHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const safeTop = this.cssEnv('safe-area-inset-top', 0);
    const safeBottom = this.cssEnv('safe-area-inset-bottom', 0);

    const pad = clamp(w * 0.032, 8, 20);
    const hudTop = safeTop + clamp(h * 0.014, 6, 16);
    const hudH = clamp(h * 0.145, 104, 156);

    // The booster bar is pinned to the bottom; the board gets everything
    // between the two, which keeps a tall phone from looking half-empty.
    const footerH = clamp(h * 0.105, 70, 104);
    const footerY = h - safeBottom - footerH - clamp(h * 0.016, 8, 18);

    const gap = clamp(h * 0.014, 8, 18);
    const top = hudTop + hudH + gap;
    const availW = w - pad * 2;
    const availH = Math.max(80, footerY - gap - top);

    // Cap the cell size so the board stays a board on tablets/desktop instead
    // of blowing up into a handful of giant candies.
    const MAX_CELL = 96;
    const cell = Math.floor(Math.min(availW / COLS, availH / ROWS, MAX_CELL));
    const boardW = cell * COLS;
    const boardH = cell * ROWS;
    const bx = Math.round((w - boardW) / 2);
    const by = Math.round(top + (availH - boardH) / 2);

    this.L = { w, h, pad, hudTop, hudH, bx, by, cell, boardW, boardH, footerY, footerH };
    this.bg.resize(w, h);
    this.floaters.setBounds(w, h);
    this.sprites.ensure(cell, this.dpr);
    this.bakeBoardLayer();
    this.layoutButtons();
  }

  /**
   * The frame, its drop shadow and all 72 cell tiles never change, so they are
   * rendered once into an offscreen canvas. Doing this per frame cost more
   * than everything else in the renderer combined (`shadowBlur` especially).
   */
  private bakeBoardLayer(): void {
    const { cell, boardW, boardH } = this.L;
    if (cell <= 0) return;
    const framePad = cell * 0.16;
    const margin = Math.ceil(cell * 0.7);
    const wpx = boardW + framePad * 2 + margin * 2;
    const hpx = boardH + framePad * 2 + margin * 2;

    const cv = document.createElement('canvas');
    cv.width = Math.ceil(wpx * this.dpr);
    cv.height = Math.ceil(hpx * this.dpr);
    const c = cv.getContext('2d')!;
    c.scale(this.dpr, this.dpr);
    c.translate(margin + framePad, margin + framePad);

    c.save();
    c.shadowColor = 'rgba(0,0,0,0.5)';
    c.shadowBlur = 26;
    c.shadowOffsetY = 10;
    glassPanel(
      c,
      -framePad,
      -framePad,
      boardW + framePad * 2,
      boardH + framePad * 2,
      cell * 0.38,
      'rgba(38,16,72,0.66)',
    );
    c.restore();

    c.save();
    roundRectPath(c, -framePad * 0.4, -framePad * 0.4, boardW + framePad * 0.8, boardH + framePad * 0.8, cell * 0.3);
    c.clip();
    for (let r = 0; r < ROWS; r++) {
      for (let col = 0; col < COLS; col++) {
        c.fillStyle = (r + col) % 2 === 0 ? 'rgba(255,255,255,0.055)' : 'rgba(255,255,255,0.02)';
        roundRectPath(c, col * cell + 1.5, r * cell + 1.5, cell - 3, cell - 3, cell * 0.22);
        c.fill();
      }
    }
    c.restore();

    this.boardLayer = cv;
    this.boardLayerOff = margin + framePad;
  }

  private cssEnv(name: string, fallback: number): number {
    const probe = document.createElement('div');
    probe.style.position = 'fixed';
    probe.style.top = '0';
    probe.style.height = `env(${name}, 0px)`;
    document.body.appendChild(probe);
    const v = parseFloat(getComputedStyle(probe).height) || fallback;
    probe.remove();
    return v;
  }

  private layoutButtons(): void {
    const { w, pad, hudTop, footerY, footerH } = this.L;
    const r = clamp(w * 0.1, 34, 44);
    this.buttons = [
      {
        id: 'sound',
        x: w - pad - r,
        y: hudTop,
        w: r,
        h: r,
        label: '',
        icon: sfx.muted ? 'sound-off' : 'sound-on',
        round: true,
        pressed: 0,
      },
      {
        id: 'restart',
        x: w - pad - r * 2 - 8,
        y: hudTop,
        w: r,
        h: r,
        label: '',
        icon: 'restart',
        round: true,
        pressed: 0,
      },
    ];

    // Booster bar
    const bsize = Math.min(clamp(w * 0.17, 56, 76), footerH * 0.82);
    const spacing = bsize * 1.62;
    const cx = w / 2;
    const boosters: Array<[ButtonId, 'hammer' | 'shuffle' | 'hint', number]> = [
      ['hammer', 'hammer', -1],
      ['shuffle', 'shuffle', 0],
      ['hint', 'hint', 1],
    ];
    for (const [id, key, slot] of boosters) {
      this.buttons.push({
        id,
        x: cx + slot * spacing - bsize / 2,
        y: footerY + (footerH - bsize) / 2 - footerH * 0.08,
        w: bsize,
        h: bsize,
        label: '',
        icon: key === 'hammer' ? 'hammer' : key === 'shuffle' ? 'shuffle' : 'bulb',
        round: true,
        pressed: 0,
        charges: this.charges[key],
        armed: key === 'hammer' && this.armed === 'hammer',
        disabled: this.charges[key] <= 0,
      });
    }

    if (this.phase !== 'playing') {
      const bw = clamp(w * 0.58, 200, 300);
      const bh = clamp(w * 0.155, 54, 72);
      this.buttons.push({
        id: 'primary',
        x: (w - bw) / 2,
        y: this.L.h * 0.63,
        w: bw,
        h: bh,
        label: this.phase === 'menu' ? 'PLAY' : this.phase === 'won' ? 'NEXT LEVEL' : 'TRY AGAIN',
        round: true,
        pressed: 0,
      });
    }
  }

  // ------------------------------------------------------------- helpers

  private cellToPx(col: number, row: number): [number, number] {
    const { bx, by, cell } = this.L;
    return [bx + (col + 0.5) * cell, by + (row + 0.5) * cell];
  }

  private pxToCell(x: number, y: number): { col: number; row: number } | null {
    const { bx, by, cell } = this.L;
    const col = Math.floor((x - bx) / cell);
    const row = Math.floor((y - by) / cell);
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return null;
    return { col, row };
  }

  // ------------------------------------------------------------- FX hooks

  private fxPop(t: Tile, cascade: number): void {
    const [px, py] = this.cellToPx(t.x, t.y);
    const cell = this.L.cell;
    const power = clamp(1 + cascade * 0.14, 1, 1.9);
    FX.candyPop(this.ps, px, py, t.color, cell, power);
    if (cascade >= 2) FX.stars(this.ps, px, py, t.color, cell, 3 + cascade);
    this.shake.add(0.016 * power);
  }

  private fxFire(kind: FireKind, col: number, row: number, color: ColorId, span: number): void {
    const [px, py] = this.cellToPx(col, row);
    const cell = this.L.cell;
    const [, light] = paletteOf(color);

    if (kind === 'stripeH' || kind === 'stripeV') {
      FX.stripeBeam(this.ps, px, py, kind === 'stripeH', color, cell, span * cell * 0.5);
      this.shake.add(0.2);
      this.shake.flash(light, 0.1);
      sfx.stripe();
      buzz(18);
    } else if (kind === 'wrapped') {
      FX.explosion(this.ps, px, py, color, cell * (span >= 5 ? 1.5 : 1));
      this.shake.add(span >= 5 ? 0.48 : 0.34);
      this.shake.flash('#ffe6a8', 0.2);
      this.shake.stop(0.05);
      sfx.boom();
      buzz([0, 28]);
    } else {
      FX.bombBurst(this.ps, px, py, cell);
      this.shake.add(0.62);
      this.shake.flash('#ffffff', 0.34);
      this.shake.stop(0.09);
      sfx.rainbow();
      buzz([0, 40, 30, 60]);
      this.floaters.add('RAINBOW!', px, py - cell * 0.5, {
        size: this.L.cell * 0.46,
        color: '#ff7ab8',
        life: 1.1,
      });
    }
  }

  private fxTracer(fc: number, fr: number, tc: number, tr: number, color: ColorId): void {
    const [x0, y0] = this.cellToPx(fc, fr);
    const [x1, y1] = this.cellToPx(tc, tr);
    FX.bombTracer(this.ps, x0, y0, x1, y1, color, this.L.cell);
  }

  private fxLand(t: Tile, force: number): void {
    if (force < 0.45) return;
    const [px, py] = this.cellToPx(t.x, t.y);
    FX.land(this.ps, px, py, t.color, this.L.cell, force);
    if (force > 0.75 && Math.random() < 0.35) sfx.land(force);
  }

  private fxForge(special: Special, col: number, row: number, color: ColorId): void {
    const [px, py] = this.cellToPx(col, row);
    const cell = this.L.cell;
    const isBomb = special === 'bomb' || color === BOMB_COLOR;
    const colors = isBomb
      ? ['#ff3b6b', '#ffe03d', '#4ade80', '#38bdf8', '#a78bfa', '#ffffff']
      : [paletteOf(color)[1], paletteOf(color)[3], '#ffffff'];

    this.ps.emit({
      x: px,
      y: py,
      count: isBomb ? 30 : 18,
      spread: cell * 0.9,
      speed: [-260, -90],
      life: [0.3, 0.5],
      size: [cell * 0.06, cell * 0.14],
      sizeEnd: 0,
      drag: 0.8,
      colors,
      shape: 'spark',
      additive: true,
    });
    this.ps.emit({
      x: px,
      y: py,
      count: 2,
      speed: [0, 0],
      life: [0.45, 0.5],
      size: [cell * 1.4, cell * 1.6],
      sizeEnd: cell * 0.25,
      colors: ['#ffffff'],
      shape: 'ring',
      additive: true,
      thickness: cell * 0.1,
    });
    this.shake.flash('#ffffff', isBomb ? 0.2 : 0.1);
    const label = isBomb ? 'COLOR BOMB' : special === 'wrapped' ? 'WRAPPED' : 'STRIPED';
    this.floaters.add(label, px, py - cell * 0.6, {
      size: cell * 0.3,
      color: isBomb ? '#ffe03d' : '#9ee7ff',
      life: 0.85,
    });
  }

  private fxReject(col: number, row: number): void {
    const [px, py] = this.cellToPx(col, row);
    this.ps.emit({
      x: px,
      y: py,
      count: 8,
      spread: this.L.cell * 0.4,
      speed: [30, 110],
      life: [0.18, 0.34],
      size: [2, 5],
      sizeEnd: 0,
      drag: 1.6,
      colors: ['#ff5c7a', '#ffffff'],
      shape: 'spark',
      additive: true,
    });
    this.shake.add(0.07);
    sfx.invalid();
    buzz(10);
  }

  private fxCascade(step: number, cleared: number, points: number, cx: number, cy: number): void {
    const [px, py] = this.cellToPx(cx, cy);
    const cell = this.L.cell;
    sfx.pop(step, cleared);
    this.progressGlow = 1;

    this.floaters.add(`+${points}`, px, py, {
      size: clamp(cell * (0.34 + step * 0.05), cell * 0.3, cell * 0.72),
      color: step >= 3 ? '#ffe03d' : '#ffffff',
      life: 0.9 + step * 0.05,
      vy: -60 - step * 8,
    });

    if (step >= 1) {
      const word = COMBO_WORDS[Math.min(step, COMBO_WORDS.length - 1)];
      this.banner.show(word, `${step + 1}x COMBO`, step >= 4 ? '#ff7ab8' : '#ffd23f', 1.1);
      this.shake.add(0.05 + step * 0.035);
      if (step >= 3) {
        this.shake.stop(0.04);
        this.shake.flash('#ffd7f5', 0.12);
      }
      buzz(Math.min(40, 8 + step * 6));
    }
    if (cleared >= 8) {
      FX.confetti(this.ps, this.w, this.h, 30);
    }
  }

  private fxShuffle(): void {
    sfx.shuffle();
    this.banner.show('SHUFFLE!', 'no moves left', '#9ee7ff', 1.1);
    const { bx, by, boardW, boardH } = this.L;
    for (let i = 0; i < 26; i++) {
      FX.ambient(this.ps, bx + rand(0, boardW), by + rand(0, boardH));
    }
  }

  // ------------------------------------------------------------- game flow

  private addScore(pts: number): void {
    if (pts <= 0) return;
    this.score += pts;
    this.scoreRoll.set(this.score);
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem('sugarrush.best', String(this.best));
    }
  }

  private movesLeft(): number {
    return Math.max(0, this.cfg.moves - this.board.movesUsed);
  }

  private starsFor(score: number): number {
    return starsFor(score, this.cfg.target);
  }

  private onSettled(): void {
    if (this.phase !== 'playing') return;
    this.movesRoll.set(this.movesLeft());

    if (this.score >= this.cfg.target) {
      this.win();
    } else if (this.movesLeft() <= 0) {
      this.lose();
    }
  }

  private win(): void {
    this.phase = 'won';
    this.starsEarned = Math.max(1, this.starsFor(this.score));
    this.overlayT = 0;
    this.board.lock();
    this.level += 1;
    localStorage.setItem('sugarrush.level', String(this.level));
    sfx.win();
    buzz([0, 40, 60, 40, 60, 80]);
    FX.confetti(this.ps, this.w, this.h, 180);
    this.shake.flash('#ffffff', 0.4);
    this.layoutButtons();
  }

  private lose(): void {
    // Safety net: running out of moves while already past the target is a
    // win, never a loss. Keeps the two exit paths from ever disagreeing.
    if (this.score >= this.cfg.target) {
      this.win();
      return;
    }
    this.phase = 'lost';
    this.overlayT = 0;
    this.board.lock();
    sfx.lose();
    buzz([0, 80, 60, 120]);
    this.layoutButtons();
  }

  private startLevel(n: number): void {
    this.level = n;
    this.cfg = levelConfig(n);
    this.score = 0;
    this.scoreRoll.hard(0);
    this.movesRoll.hard(this.cfg.moves);
    this.phase = 'playing';
    this.overlayT = 0;
    this.selected = null;
    this.dragFrom = null;
    this.armed = null;
    this.charges = { ...BOOSTERS };
    this.ps.clear();
    this.floaters.clear();
    this.shake.reset();
    this.board.reset(this.cfg.colors);
    this.banner.show(`LEVEL ${n}`, `reach ${this.cfg.target.toLocaleString()}`, '#9ee7ff', 1.5);
    localStorage.setItem('sugarrush.level', String(n));
    this.layoutButtons();
  }

  // ------------------------------------------------------------- input

  private hitButton(x: number, y: number): HudButton | null {
    for (const b of this.buttons) {
      const pad = 6;
      if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) return b;
    }
    return null;
  }

  private pointerDown(x: number, y: number): void {
    sfx.unlock();

    const b = this.hitButton(x, y);
    if (b) {
      this.heldButton = b;
      b.pressed = 1;
      return;
    }
    if (this.phase !== 'playing' || this.board.busy) return;

    const c = this.pxToCell(x, y);
    if (!c) {
      this.armed = null;
      this.layoutButtons();
      return;
    }

    if (this.armed === 'hammer') {
      if (this.board.crushAt(c.col, c.row)) {
        this.charges.hammer--;
        this.armed = null;
        this.layoutButtons();
        this.shake.add(0.22);
        this.shake.stop(0.04);
        buzz(24);
        const [px, py] = this.cellToPx(c.col, c.row);
        this.ps.emit({
          x: px,
          y: py,
          count: 16,
          spread: this.L.cell * 0.3,
          speed: [120, 420],
          life: [0.3, 0.6],
          size: [this.L.cell * 0.06, this.L.cell * 0.14],
          sizeEnd: 0,
          gravity: 700,
          drag: 0.6,
          colors: ['#ffffff', '#ffe03d', '#ff9f1c'],
          shape: 'shard',
          additive: false,
          spin: [-14, 14],
        });
      }
      return;
    }

    this.dragFrom = c;
    this.dragStart = [x, y];
    this.dragged = false;
    const t = this.board.at(c.col, c.row);
    if (t) t.squash = 0.18;
  }

  private pointerMove(x: number, y: number): void {
    if (this.heldButton) {
      const still = this.hitButton(x, y) === this.heldButton;
      this.heldButton.pressed = still ? 1 : 0;
      return;
    }
    if (!this.dragFrom || this.dragged || this.phase !== 'playing') return;

    const dx = x - this.dragStart[0];
    const dy = y - this.dragStart[1];
    const dist = Math.hypot(dx, dy);
    if (dist < this.L.cell * 0.34) return;

    const horizontal = Math.abs(dx) > Math.abs(dy);
    const dc = horizontal ? Math.sign(dx) : 0;
    const dr = horizontal ? 0 : Math.sign(dy);
    const to = { col: this.dragFrom.col + dc, row: this.dragFrom.row + dr };
    this.dragged = true;
    this.selected = null;

    if (to.col < 0 || to.row < 0 || to.col >= COLS || to.row >= ROWS) {
      this.fxReject(this.dragFrom.col, this.dragFrom.row);
      this.dragFrom = null;
      return;
    }
    this.commitSwipe(this.dragFrom, to);
    this.dragFrom = null;
  }

  private pointerUp(x: number, y: number): void {
    if (this.heldButton) {
      const b = this.heldButton;
      this.heldButton = null;
      b.pressed = 0;
      if (this.hitButton(x, y) === b) this.pressButton(b.id);
      return;
    }
    if (this.phase !== 'playing') return;

    if (this.dragFrom && !this.dragged) {
      const c = this.dragFrom;
      const prev = this.selected;
      if (prev && Math.abs(prev.col - c.col) + Math.abs(prev.row - c.row) === 1) {
        this.commitSwipe(prev, c);
        this.selected = null;
      } else if (prev && prev.col === c.col && prev.row === c.row) {
        this.selected = null;
      } else {
        this.selected = c;
        sfx.ui();
        const [px, py] = this.cellToPx(c.col, c.row);
        this.ps.emit({
          x: px,
          y: py,
          count: 6,
          spread: this.L.cell * 0.45,
          speed: [20, 70],
          life: [0.2, 0.4],
          size: [2, 4.5],
          sizeEnd: 0,
          drag: 1.4,
          colors: ['#ffffff', '#ffe6ff'],
          shape: 'spark',
          additive: true,
        });
      }
    }
    this.dragFrom = null;
  }

  private pointerCancel(): void {
    if (this.heldButton) this.heldButton.pressed = 0;
    this.heldButton = null;
    this.dragFrom = null;
  }

  private commitSwipe(from: { col: number; row: number }, to: { col: number; row: number }): void {
    const ok = this.board.trySwap(from.col, from.row, to.col, to.row);
    if (!ok) return;
    const a = this.board.at(from.col, from.row);
    const b = this.board.at(to.col, to.row);
    if (a) {
      const [px, py] = this.cellToPx(a.x, a.y);
      FX.swapTrail(this.ps, px, py, a.color, this.L.cell);
    }
    if (b) {
      const [px, py] = this.cellToPx(b.x, b.y);
      FX.swapTrail(this.ps, px, py, b.color, this.L.cell);
    }
  }

  private pressButton(id: ButtonId): void {
    sfx.ui();
    switch (id) {
      case 'sound': {
        sfx.muted = !sfx.muted;
        localStorage.setItem('sugarrush.muted', sfx.muted ? '1' : '0');
        this.layoutButtons();
        if (!sfx.muted) sfx.ui();
        break;
      }

      case 'restart':
        this.startLevel(this.level);
        break;

      case 'hammer': {
        if (this.phase !== 'playing' || this.charges.hammer <= 0) return;
        this.armed = this.armed === 'hammer' ? null : 'hammer';
        this.selected = null;
        this.banner.show(
          this.armed ? 'TAP A CANDY' : 'CANCELLED',
          this.armed ? 'to smash it' : '',
          '#ff9f1c',
          0.9,
        );
        this.layoutButtons();
        break;
      }

      case 'shuffle': {
        if (this.phase !== 'playing' || this.charges.shuffle <= 0) return;
        if (this.board.requestShuffle()) {
          this.charges.shuffle--;
          this.layoutButtons();
        }
        break;
      }

      case 'hint': {
        if (this.phase !== 'playing' || this.charges.hint <= 0) return;
        const mv = this.board.findAnyMove();
        if (!mv) return;
        this.charges.hint--;
        this.board.hintMove = mv;
        this.layoutButtons();
        const a = this.board.tiles[mv.a];
        if (a) {
          const [px, py] = this.cellToPx(a.col, a.row);
          this.ps.emit({
            x: px,
            y: py,
            count: 14,
            spread: this.L.cell * 0.6,
            speed: [30, 120],
            life: [0.4, 0.8],
            size: [2, 5],
            sizeEnd: 0,
            drag: 1.2,
            colors: ['#ffe03d', '#ffffff'],
            shape: 'spark',
            additive: true,
          });
        }
        break;
      }

      case 'primary':
        // menu → start, won → next level (this.level was already advanced),
        // lost → retry the same level.
        this.startLevel(this.level);
        break;
    }
  }

  // ------------------------------------------------------------- loop

  start(): void {
    this.last = performance.now();
    const frame = (now: number) => {
      const raw = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.tick(raw);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private tick(raw: number): void {
    // Adaptive quality: drop particle counts if we start missing frames.
    this.fpsSamples.push(raw);
    if (this.fpsSamples.length > 50) {
      this.fpsSamples.shift();
      const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
      const target = avg > 0.026 ? 0.55 : avg > 0.021 ? 0.8 : 1;
      this.ps.quality = damp(this.ps.quality, target, 1.5, raw);
    }

    const dt = this.shake.consume(raw);

    this.bg.update(dt);
    this.board.update(dt);
    this.ps.update(dt);
    this.floaters.update(dt);
    this.shake.update(raw);
    this.banner.update(dt);
    this.scoreRoll.update(dt);
    this.movesRoll.update(dt);
    this.progressGlow = Math.max(0, this.progressGlow - dt * 1.6);
    this.titleT += dt;

    if (this.phase !== 'playing') this.overlayT = Math.min(1, this.overlayT + dt * 2.6);

    // Ambient sparkles drifting off the board.
    this.ambientT += dt;
    if (this.ambientT > 0.09) {
      this.ambientT = 0;
      const { bx, by, boardW, boardH } = this.L;
      FX.ambient(this.ps, bx + rand(-10, boardW + 10), by + boardH + rand(-6, 14));
    }

    // Hint pulse
    const hint = this.board.hintMove;
    if (hint && this.phase === 'playing') {
      const a = this.board.tiles[hint.a];
      const b = this.board.tiles[hint.b];
      if (a) a.hint = 1;
      if (b) b.hint = 1;
    }

    this.render();
  }

  // ------------------------------------------------------------- render

  private render(): void {
    const ctx = this.ctx;
    const { w, h } = this;

    this.bg.render(ctx);

    ctx.save();
    ctx.translate(w / 2 + this.shake.x, h / 2 + this.shake.y);
    ctx.rotate(this.shake.rot);
    ctx.scale(this.shake.zoom, this.shake.zoom);
    ctx.translate(-w / 2, -h / 2);

    this.drawBoard(ctx);
    this.ps.render(ctx);
    this.floaters.render(ctx);

    ctx.restore();

    this.drawHud(ctx);
    if (this.phase === 'playing') {
      this.banner.render(ctx, w, this.L.by + this.L.boardH * 0.42);
    } else {
      this.drawOverlay(ctx);
    }

    this.shake.renderFlash(ctx, w, h);
  }

  private drawBoard(ctx: CanvasRenderingContext2D): void {
    const { bx, by, cell, boardW, boardH } = this.L;
    const pad = cell * 0.16;

    // Pre-baked frame + cell grid (see bakeBoardLayer).
    if (this.boardLayer) {
      const off = this.boardLayerOff;
      ctx.drawImage(
        this.boardLayer,
        bx - off,
        by - off,
        this.boardLayer.width / this.dpr,
        this.boardLayer.height / this.dpr,
      );
    }

    // Selection ring
    if (this.selected) {
      const [px, py] = this.cellToPx(this.selected.col, this.selected.row);
      const pulse = 0.5 + 0.5 * Math.sin(this.titleT * 8);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255,255,255,${0.5 + pulse * 0.4})`;
      ctx.lineWidth = 3 + pulse * 2;
      roundRectPath(ctx, px - cell / 2 + 3, py - cell / 2 + 3, cell - 6, cell - 6, cell * 0.24);
      ctx.stroke();
      ctx.restore();
    }

    // Tiles (clipped so falling candies slide in from behind the frame)
    ctx.save();
    roundRectPath(ctx, bx - pad * 0.5, by - pad * 0.5, boardW + pad, boardH + pad, cell * 0.32);
    ctx.clip();
    const size = this.sprites.drawSize;
    const half = size / 2;

    for (const t of this.board.tiles) {
      if (!t) continue;
      const [px, py] = this.cellToPx(t.x, t.y);
      const spawn = t.spawnT < 1 ? easeOutBack(t.spawnT, 2.4) : 1;
      const hintPulse = t.hint > 0 ? Math.sin(this.titleT * 9) * 0.1 * t.hint : 0;
      const s = t.scale * spawn * (1 + hintPulse);
      if (s <= 0.01) continue;
      const sx = s * (1 + t.squash * 0.55);
      const sy = s * (1 - t.squash * 0.55);

      const img = this.sprites.get(t.color, t.special);

      // Special candies hum with an additive aura.
      if (t.special !== 'none' && t.state !== 'clearing') {
        const aura = 0.4 + 0.25 * Math.sin(this.titleT * 4 + t.id);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = aura * 0.5;
        const [, light] = paletteOf(t.color);
        const g = ctx.createRadialGradient(px, py, 0, px, py, cell * 0.78);
        g.addColorStop(0, t.special === 'bomb' ? '#c9b6ff' : light);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, cell * 0.78, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.translate(px, py);
      if (t.rot) ctx.rotate(t.rot);
      ctx.scale(sx, sy);
      ctx.drawImage(img, -half, -half, size, size);

      if (t.glow > 0.01) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, t.glow) * 0.85;
        ctx.drawImage(img, -half, -half, size, size);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  private drawHud(ctx: CanvasRenderingContext2D): void {
    const { w, pad, hudTop } = this.L;

    // --- Level label ---
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const lvlSize = clamp(w * 0.052, 17, 24);
    ctx.font = FONT(lvlSize, 900);
    ctx.lineWidth = lvlSize * 0.22;
    ctx.strokeStyle = 'rgba(20,6,40,0.75)';
    ctx.lineJoin = 'round';
    const lvlText = `LEVEL ${this.level}`;
    ctx.strokeText(lvlText, pad, hudTop + 6);
    const lg = ctx.createLinearGradient(0, hudTop, 0, hudTop + lvlSize * 1.3);
    lg.addColorStop(0, '#ffffff');
    lg.addColorStop(1, '#ffd23f');
    ctx.fillStyle = lg;
    ctx.fillText(lvlText, pad, hudTop + 6);
    ctx.restore();

    // --- Buttons (top-right) ---
    for (const b of this.buttons) {
      if (b.id === 'sound' || b.id === 'restart') {
        this.drawIconButton(ctx, b);
      }
    }

    // --- Moves pill ---
    const rowY = hudTop + clamp(this.L.hudH * 0.3, 32, 46);
    const pillW = clamp(w * 0.2, 64, 88);
    const pillH = clamp(this.L.hudH * 0.55, 56, 78);
    ctx.save();
    glassPanel(ctx, pad, rowY, pillW, pillH, pillH * 0.3, 'rgba(70,28,126,0.8)');
    const lowMoves = this.movesLeft() <= 5 && this.phase === 'playing';
    const wobble = lowMoves ? Math.sin(this.titleT * 11) * 0.06 : 0;
    ctx.translate(pad + pillW / 2, rowY + pillH * 0.44);
    ctx.rotate(wobble);
    const nScale = this.movesRoll.scale;
    ctx.scale(nScale, nScale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const numSize = pillH * 0.48;
    ctx.font = FONT(numSize, 900);
    ctx.lineWidth = numSize * 0.2;
    ctx.strokeStyle = 'rgba(20,6,40,0.8)';
    ctx.lineJoin = 'round';
    const movesText = String(Math.max(0, Math.round(this.movesRoll.display)));
    ctx.strokeText(movesText, 0, 0);
    ctx.fillStyle = lowMoves ? '#ff6b8a' : '#ffffff';
    ctx.fillText(movesText, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.font = FONT(pillH * 0.17, 800);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.textAlign = 'center';
    ctx.fillText('MOVES', pad + pillW / 2, rowY + pillH * 0.8);
    ctx.restore();

    // --- Score + progress ---
    const barX = pad + pillW + clamp(w * 0.035, 12, 20);
    const barW = w - barX - pad;
    const target = this.cfg.target;
    const shown = this.scoreRoll.value;
    const maxGate = STAR_GATES[STAR_GATES.length - 1];
    const prog = clamp(shown / (target * maxGate), 0, 1);

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // small caption
    ctx.font = FONT(clamp(w * 0.029, 10, 13), 800);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('SCORE', barX, rowY + pillH * 0.18);

    // big rolling number
    const sSize = clamp(w * 0.076, 25, 36);
    // Anchored low enough that the punch-scale never climbs into the caption.
    const baseline = rowY + pillH * 0.66;
    const scoreText = shown.toLocaleString();
    ctx.save();
    ctx.translate(barX, baseline);
    ctx.scale(this.scoreRoll.scale, this.scoreRoll.scale);
    ctx.font = FONT(sSize, 900);
    ctx.lineWidth = sSize * 0.18;
    ctx.strokeStyle = 'rgba(20,6,40,0.85)';
    ctx.lineJoin = 'round';
    ctx.strokeText(scoreText, 0, 0);
    const sg = ctx.createLinearGradient(0, -sSize * 0.8, 0, sSize * 0.1);
    sg.addColorStop(0, '#ffffff');
    sg.addColorStop(1, '#9ee7ff');
    ctx.fillStyle = sg;
    ctx.fillText(scoreText, 0, 0);
    ctx.restore();

    // "/ target" trailing the number
    ctx.font = FONT(sSize, 900);
    const numW = ctx.measureText(scoreText).width * this.scoreRoll.scale;
    ctx.font = FONT(clamp(w * 0.033, 12, 16), 800);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(`/ ${target.toLocaleString()}`, barX + numW + 8, baseline);
    ctx.restore();

    // --- Progress bar with star gates ---
    const starR = clamp(w * 0.028, 9, 13);
    const barH = clamp(pillH * 0.185, 9, 14);
    const barY = rowY + pillH * 0.81;
    // Inset so the final star sits fully on-screen.
    const trackX = barX;
    const trackW = barW - starR * 1.6;

    ctx.save();
    roundRectPath(ctx, trackX, barY, trackW, barH, barH / 2);
    ctx.fillStyle = 'rgba(15,6,34,0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    if (prog > 0.001) {
      ctx.save();
      roundRectPath(ctx, trackX, barY, trackW, barH, barH / 2);
      ctx.clip();
      const fg = ctx.createLinearGradient(trackX, 0, trackX + trackW, 0);
      fg.addColorStop(0, '#4ade80');
      fg.addColorStop(0.5, '#ffe03d');
      fg.addColorStop(1, '#ff3b6b');
      ctx.fillStyle = fg;
      ctx.fillRect(trackX, barY, trackW * prog, barH);
      const sheen = ((this.titleT * 0.4) % 1) * (trackW * prog + 60) - 30;
      const sg2 = ctx.createLinearGradient(trackX + sheen - 30, 0, trackX + sheen + 30, 0);
      sg2.addColorStop(0, 'rgba(255,255,255,0)');
      sg2.addColorStop(0.5, `rgba(255,255,255,${0.3 + this.progressGlow * 0.45})`);
      sg2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg2;
      ctx.fillRect(trackX, barY, trackW * prog, barH);
      ctx.restore();
    }
    ctx.restore();

    const got = this.starsFor(shown);
    STAR_GATES.forEach((gv, i) => {
      const gx = trackX + trackW * (gv / maxGate);
      const pulse = got > i ? 0.5 + 0.5 * Math.sin(this.titleT * 5 + i) : 0;
      drawStar(ctx, gx, barY + barH / 2, starR, got > i, pulse * 0.4);
    });

    // Booster bar
    for (const b of this.buttons) {
      if (b.id === 'hammer' || b.id === 'shuffle' || b.id === 'hint') this.drawBoosterButton(ctx, b);
    }
  }

  private drawIconButton(ctx: CanvasRenderingContext2D, b: HudButton): void {
    const press = b.pressed;
    const y = b.y + press * 3;
    ctx.save();
    roundRectPath(ctx, b.x, y + 3, b.w, b.h, b.h / 2);
    ctx.fillStyle = 'rgba(20,8,44,0.8)';
    ctx.fill();
    const g = ctx.createLinearGradient(0, y, 0, y + b.h);
    g.addColorStop(0, 'rgba(126,80,200,0.95)');
    g.addColorStop(1, 'rgba(72,34,132,0.95)');
    roundRectPath(ctx, b.x, y, b.w, b.h, b.h / 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    if (b.icon) {
      ctx.save();
      ctx.translate(b.x + b.w / 2, y + b.h / 2);
      drawIcon(ctx, b.icon, b.h * 0.52, '#fff');
      ctx.restore();
    }
    ctx.restore();
  }

  /** Booster button: round candy face, vector glyph, charge badge. */
  private drawBoosterButton(ctx: CanvasRenderingContext2D, b: HudButton): void {
    const usable = !b.disabled && this.phase === 'playing';
    const pulse = b.armed ? 0.5 + 0.5 * Math.sin(this.titleT * 9) : 0;
    const y = b.y + b.pressed * 3;
    const cx = b.x + b.w / 2;
    const cy = y + b.h / 2;

    ctx.save();
    ctx.globalAlpha = usable ? 1 : 0.42;

    if (b.armed) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + pulse * 0.4;
      ctx.fillStyle = '#ffb547';
      ctx.beginPath();
      ctx.arc(cx, cy, b.w * (0.62 + pulse * 0.12), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // lip
    ctx.beginPath();
    ctx.arc(cx, cy + 4, b.w / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#2a1152';
    ctx.fill();

    const g = ctx.createLinearGradient(0, y, 0, y + b.h);
    if (b.armed) {
      g.addColorStop(0, '#ffcf6b');
      g.addColorStop(1, '#f08b1c');
    } else {
      g.addColorStop(0, 'rgba(133,88,214,0.98)');
      g.addColorStop(1, 'rgba(76,36,140,0.98)');
    }
    ctx.beginPath();
    ctx.arc(cx, cy, b.w / 2, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.34)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // gloss
    ctx.save();
    ctx.clip();
    const gl = ctx.createLinearGradient(0, y, 0, y + b.h * 0.5);
    gl.addColorStop(0, 'rgba(255,255,255,0.4)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(b.x, y, b.w, b.h * 0.5);
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    drawIcon(ctx, b.icon ?? 'bulb', b.w * 0.52, '#fff');
    ctx.restore();

    drawBadge(ctx, cx + b.w * 0.36, y + b.h * 0.1, Math.max(8, b.w * 0.19), b.charges ?? 0);

    ctx.globalAlpha = usable ? 0.85 : 0.4;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = FONT(Math.max(9, b.w * 0.19), 800);
    ctx.fillStyle = '#fff';
    const name = b.id === 'hammer' ? 'SMASH' : b.id === 'shuffle' ? 'SHUFFLE' : 'HINT';
    ctx.fillText(name, cx, y + b.h + 5);
    ctx.restore();
  }

  /** Largest font size (<= `size`) at which `text` fits inside `maxW`. */
  private fitSize(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxW: number,
    size: number,
    weight = 900,
    strokeAllowance = 1.0,
  ): number {
    ctx.font = FONT(size, weight);
    const w = ctx.measureText(text).width * strokeAllowance;
    return w > maxW ? size * (maxW / w) : size;
  }

  private drawOverlay(ctx: CanvasRenderingContext2D): void {
    const { w, h } = this;
    const t = easeOutCubic(this.overlayT);
    const won = this.phase === 'won';
    const menu = this.phase === 'menu';

    ctx.save();
    ctx.fillStyle = `rgba(8,3,20,${0.74 * t})`;
    ctx.fillRect(0, 0, w, h);

    const panelW = Math.min(w * 0.88, 420);
    // Winning adds a star row, so that panel needs more height than the others.
    const panelH = won
      ? Math.min(h * 0.56, 460)
      : menu
        ? Math.min(h * 0.47, 390)
        : Math.min(h * 0.42, 350);
    const px = (w - panelW) / 2;
    const py = h * 0.5 - panelH * 0.54;
    const inner = panelW * 0.84;
    const slide = (1 - easeOutBack(clamp(this.overlayT, 0, 1), 1.5)) * h * 0.4;

    ctx.translate(0, slide);
    ctx.globalAlpha = t;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 36;
    ctx.shadowOffsetY = 14;
    glassPanel(ctx, px, py, panelW, panelH, 28, 'rgba(52,22,98,0.94)');
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // ---- title ----
    const title = menu ? 'SUGAR RUSH' : won ? 'LEVEL CLEAR!' : 'OUT OF MOVES';
    const titleSize = this.fitSize(ctx, title, inner, Math.min(panelW * 0.145, 48), 900, 1.2);
    const bob = Math.sin(this.titleT * 2.2) * 4;

    ctx.save();
    ctx.translate(w / 2, py + panelH * (won ? 0.16 : 0.19) + bob);
    ctx.rotate(Math.sin(this.titleT * 1.4) * 0.018);
    ctx.font = FONT(titleSize, 900);
    ctx.lineWidth = titleSize * 0.19;
    ctx.strokeStyle = 'rgba(25,8,45,0.9)';
    ctx.lineJoin = 'round';
    ctx.strokeText(title, 0, 0);
    const tg = ctx.createLinearGradient(0, -titleSize * 0.6, 0, titleSize * 0.7);
    tg.addColorStop(0, '#ffffff');
    tg.addColorStop(0.45, this.phase === 'lost' ? '#ff9fb4' : '#ffd23f');
    tg.addColorStop(1, this.phase === 'lost' ? '#ff3b6b' : '#ff7ab8');
    ctx.fillStyle = tg;
    ctx.fillText(title, 0, 0);
    ctx.restore();

    if (menu) {
      // ---- candy sampler ----
      const cs = Math.min(panelW * 0.17, 66);
      const specials: Array<[number, Special]> = [
        [0, 'stripeH'],
        [3, 'wrapped'],
        [-1, 'bomb'],
      ];
      specials.forEach(([color, sp], i) => {
        const cx = w / 2 + (i - 1) * cs * 1.35;
        const cy = py + panelH * 0.36 + Math.sin(this.titleT * 3 + i * 1.3) * 4;
        const img = this.sprites.get(color, sp);
        const d = this.sprites.drawSize * (cs / Math.max(1, this.L.cell));
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(Math.sin(this.titleT * 2 + i) * 0.1);
        ctx.drawImage(img, -d / 2, -d / 2, d, d);
        ctx.restore();
      });

      // ---- how to play ----
      const lines = ['Swipe to match 3 or more', 'Match 4+ to forge specials'];
      const lineSize = this.fitSize(ctx, lines[1], inner, Math.min(panelW * 0.055, 19), 800);
      ctx.font = FONT(lineSize, 800);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      lines.forEach((ln, i) => {
        ctx.fillText(ln, w / 2, py + panelH * 0.53 + i * lineSize * 1.5);
      });
      ctx.font = FONT(lineSize * 0.92, 800);
      ctx.fillStyle = 'rgba(255,255,255,0.48)';
      ctx.fillText(`Best  ${this.best.toLocaleString()}`, w / 2, py + panelH * 0.675);
    } else {
      if (won) {
        const sy = py + panelH * 0.37;
        const sr = panelW * 0.1;
        for (let i = 0; i < 3; i++) {
          const filled = i < this.starsEarned;
          const local = clamp((this.overlayT * 1.6 - (0.25 + i * 0.22)) / 0.4, 0, 1);
          const pop = filled ? easeOutBack(local, 3) : local;
          if (pop <= 0) continue;
          const cx = w / 2 + (i - 1) * sr * 2.5;
          const bobY = filled ? Math.sin(this.titleT * 4 + i) * 3 : 0;
          ctx.save();
          ctx.translate(cx, sy + bobY);
          ctx.scale(pop, pop);
          ctx.rotate((1 - pop) * 0.8);
          drawStar(ctx, 0, 0, sr, filled, filled ? 0.5 + 0.5 * Math.sin(this.titleT * 5 + i) : 0);
          ctx.restore();
        }
      }

      const capY = py + panelH * (won ? 0.57 : 0.36);
      ctx.font = FONT(Math.min(panelW * 0.045, 15), 800);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(won ? 'SCORE' : 'YOU SCORED', w / 2, capY);

      const scoreText = this.score.toLocaleString();
      const bigSize = this.fitSize(ctx, scoreText, inner, Math.min(panelW * 0.115, 40), 900, 1.15);
      ctx.font = FONT(bigSize, 900);
      ctx.lineWidth = bigSize * 0.14;
      ctx.strokeStyle = 'rgba(25,8,45,0.85)';
      ctx.lineJoin = 'round';
      const bigY = capY + bigSize * 0.92;
      ctx.strokeText(scoreText, w / 2, bigY);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(scoreText, w / 2, bigY);

      const sub = won
        ? `Target ${this.cfg.target.toLocaleString()} · Best ${this.best.toLocaleString()}`
        : `You needed ${this.cfg.target.toLocaleString()}`;
      const subSize = this.fitSize(ctx, sub, inner, Math.min(panelW * 0.045, 15), 800);
      ctx.font = FONT(subSize, 800);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(sub, w / 2, bigY + bigSize * 0.82);
    }

    for (const b of this.buttons) {
      if (b.id !== 'primary') continue;
      b.y = py + panelH - b.h - panelH * 0.09;
      const colors: [string, string, string] =
        this.phase === 'lost' ? ['#ff6b8a', '#e01f4d', '#8a0d2c'] : ['#5fe08a', '#22a55a', '#0f6134'];
      const label = b.label;
      const fit = this.fitSize(ctx, label, b.w * 0.82, Math.min(b.h * 0.42, 26), 900, 1.15);
      drawButton(ctx, b, colors, fit);
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------- test hooks
  // Small, read-mostly surface used by tools/shots.mjs to drive the real game
  // in a headless browser. Harmless in production.

  debugBoard(): Board {
    return this.board;
  }

  debugPhase(): Phase {
    return this.phase;
  }

  debugParticleCount(): number {
    return this.ps.liveCount;
  }

  debugLayout(): { cols: number; rows: number; bx: number; by: number; cell: number } {
    return { cols: COLS, rows: ROWS, bx: this.L.bx, by: this.L.by, cell: this.L.cell };
  }

  debugButtonCenter(id: ButtonId): { x: number; y: number } | null {
    const b = this.buttons.find((x) => x.id === id);
    return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null;
  }

  debugSpawnSpecials(): void {
    this.board.setSpecial(1, 5, 'stripeH');
    this.board.setSpecial(3, 2, 'stripeV');
    this.board.setSpecial(5, 5, 'wrapped');
    this.board.setSpecial(6, 2, 'bomb');
  }

  debugDetonate(kind: Special): boolean {
    const at = this.board.findSpecial(kind);
    if (!at) return false;
    return this.board.activateAt(at.col, at.row);
  }

  debugRestart(): void {
    this.startLevel(this.level);
  }

  debugLose(): void {
    this.score = Math.floor(this.cfg.target * 0.6);
    this.scoreRoll.hard(this.score);
    this.lose();
  }

  debugWin(): void {
    this.addScore(Math.max(0, this.cfg.target * 2 - this.score));
    this.scoreRoll.hard(this.score);
    this.win();
  }
}

/** Convenience for the debug overlay / tests. */
export { COLS, ROWS, levelConfig, idx };
export type { LevelCfg };
