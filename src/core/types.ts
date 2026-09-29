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
}

export interface Cell {
  col: number;
  row: number;
}

export const idx = (col: number, row: number, cols: number): number => row * cols + col;

/** Candy palette: [base, light, dark, spark] */
export const PALETTE: ReadonlyArray<readonly [string, string, string, string]> = [
  ['#ff3b6b', '#ff97b0', '#a3103b', '#ffd2dd'], // 0 strawberry
  ['#ff9f1c', '#ffd08a', '#b35a00', '#ffe9c7'], // 1 orange
  ['#ffe03d', '#fff7a8', '#c79500', '#fffbd8'], // 2 lemon
  ['#4ade80', '#a9f5c4', '#12894a', '#d9fce8'], // 3 apple
  ['#38bdf8', '#a5e6ff', '#0b6d9e', '#d6f3ff'], // 4 blueberry
  ['#a78bfa', '#d9ccff', '#5b34c4', '#ece4ff'], // 5 grape
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
