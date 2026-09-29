/** Shared vocabulary for the whole game. */

/** Candy colour index. `BOMB_COLOR` marks the rainbow colour-bomb. */
export type ColorId = number;

export const BOMB_COLOR: ColorId = -1;

export const COLOR_COUNT = 6;

/**
 * Special candies, in ascending power.
 *
 * `cross` and `nova` exist because L, T and plus shapes used to forge the
 * same wrapped candy, which threw away the information the player had just
 * created. A tee is a harder shape to build than a corner and a plus is
 * harder still, so each now forges something visibly different.
 */
export type Special =
  | 'none'
  | 'stripeH'
  | 'stripeV'
  | 'wrapped'
  | 'cross'
  | 'nova'
  | 'bomb';

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
 * and combo text match the painted art exactly. Regenerate with `npm run art`, which
 * prints a fresh block to paste here whenever the atlas is rebuilt.
 *
 * base = mid-tone body (specular hotspot and lacquer rim excluded from the
 * sample), then light / dark / spark derived from it. Saturation is pushed
 * *up* as lightness rises: these feed additive particles, and a desaturated
 * tint there reads as grey ash rather than candy.
 */
export const PALETTE: ReadonlyArray<readonly [string, string, string, string]> = [
  ['#bb2237', '#ee556a', '#520b15', '#efa6b0'], // 0 strawberry
  ['#df720f', '#ffa655', '#623002', '#f9d1ac'], // 1 orange
  ['#e4be1c', '#fadf6c', '#645307', '#f8edc0'], // 2 lemon
  ['#2eb419', '#57f43f', '#114f07', '#a1f094'], // 3 apple
  ['#1378cb', '#47abfd', '#043359', '#a0cff6'], // 4 blueberry
  ['#9628b8', '#c85de9', '#410e50', '#ddabed'], // 5 grape
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
