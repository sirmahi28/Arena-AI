/** Shared vocabulary for the whole game. */

/** Candy colour index. `BOMB_COLOR` marks the rainbow colour-bomb. */
export type ColorId = number;

export const BOMB_COLOR: ColorId = -1;

export const COLOR_COUNT = 6;

export type Special = 'none' | 'stripeH' | 'stripeV' | 'wrapped' | 'bomb';

export type TileState = 'idle' | 'falling' | 'swapping' | 'clearing';

export interface Tile {
  id: number;
  color: ColorId;
  special: Special;

  /** Logical cell. */
  col: number;
  row: number;

  /** Rendered position in *cell units* (lerps toward col/row). */
  x: number;
  y: number;

  state: TileState;

  /** Vertical velocity in cells/second while falling. */
  vy: number;

  /** Visual flourishes. */
  scale: number;
  squash: number;
  rot: number;
  spawnT: number;
  glow: number;

  /** Clear animation progress 0 -> 1. */
  clearT: number;

  /** Set when a special has already fired, to stop infinite chains. */
  fired: boolean;

  /** Set once the pop particles have been emitted for this tile. */
  burst: boolean;

  /** Used by the hint system. */
  hint: number;

  // --- Impact response -----------------------------------------------------
  // A candy popping shoves its neighbours around. These are a spring-damper
  // displacement in *cell units*, layered on top of x/y at render time, so the
  // logical grid is never disturbed.
  /** Displacement from rest. */
  ox: number;
  oy: number;
  /** Displacement velocity. */
  ovx: number;
  ovy: number;
  /** Jelly wobble amount 0..1, decays; drives a sine ripple in the sprite. */
  jelly: number;
  /** Per-tile phase so neighbours don't wobble in lockstep. */
  jellyPhase: number;
}

export interface Cell {
  col: number;
  row: number;
}

export const idx = (col: number, row: number, cols: number): number => row * cols + col;

/** Candy palette: [base, light, dark, spark] */
/**
 * Sampled from the candy atlas rather than hand-picked, so particles, glows
 * and combo text match the painted art exactly. Regenerate with the sampler
 * documented in docs/art-notes.md if the atlas is ever redrawn.
 *
 * base = mid-tone body (specular hotspot and lacquer rim excluded from the
 * sample), then light / dark / spark derived from it. Saturation is pushed
 * *up* as lightness rises: these feed additive particles, and a desaturated
 * tint there reads as grey ash rather than candy.
 */
export const PALETTE: ReadonlyArray<readonly [string, string, string, string]> = [
  ['#cf1c40', '#f65b7a', '#5b0819', '#f4aebc'], // 0 strawberry
  ['#f4810c', '#ffb467', '#6c3600', '#fcdcbc'], // 1 orange
  ['#f2b815', '#ffd96e', '#6e5101', '#fcedc3'], // 2 lemon
  ['#25c624', '#62ef61', '#0c570c', '#b1f1b1'], // 3 apple
  ['#43aeee', '#99d8fe', '#054f7b', '#ebf7fd'], // 4 blueberry
  ['#af3ad6', '#d586f0', '#4e1062', '#edd2f6'], // 5 grape
];

export const BOMB_PALETTE: readonly [string, string, string, string] = [
  '#2b2350',
  '#7f6bff',
  '#0d0920',
  '#ffffff',
];

export function paletteOf(color: ColorId) {
  return color === BOMB_COLOR ? BOMB_PALETTE : PALETTE[color % PALETTE.length];
}
