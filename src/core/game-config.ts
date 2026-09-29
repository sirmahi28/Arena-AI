/**
 * Board shape: 7 columns x 9 rows. A portrait phone is far taller than it is
 * wide, so a narrow/tall grid fills the screen instead of leaving dead space,
 * and the resulting candies are ~20% larger — a real difference for thumbs.
 *
 * Level tuning lives here, away from any DOM code, so the balance simulator
 * (`node tools/board-sim.mjs --calibrate`) can import the exact numbers the
 * game ships with.
 *
 * How these were derived
 * ----------------------
 * A greedy "skilled player" bot played 400 boards per level. The measured
 * yield is essentially flat per move and depends mostly on the colour count:
 *
 *   5 colours ≈ 630 pts/move   (cascades chain far more often)
 *   6 colours ≈ 365 pts/move
 *
 * So a linearly-growing target becomes unwinnable within a few levels. Instead
 * the target is expressed as a *fraction of what a good player is expected to
 * score*, and that fraction eases from a generous 45% up to an asymptote of
 * 95%. Difficulty therefore rises smoothly and never crosses into impossible.
 */

export interface LevelCfg {
  /** Moves the player gets. */
  moves: number;
  /** Score needed to clear the level (and earn the first star). */
  target: number;
  /** How many candy colours are in play (fewer = easier). */
  colors: number;
}

export const BOARD_COLS = 7;
export const BOARD_ROWS = 9;

/** Measured points-per-move for a competent player, keyed by colour count. */
const YIELD_PER_MOVE: Record<number, number> = { 4: 1080, 5: 630, 6: 365 };

/** Booster charges granted at the start of every level. */
export const BOOSTERS = { hammer: 3, shuffle: 3, hint: 5 } as const;

/** Reference move budget the target is priced against. */
const REFERENCE_MOVES = 25;

/** Fraction of the expected score you must hit, level by level. */
function pressure(lvl: number): number {
  return 0.45 + 0.38 * (1 - Math.exp(-(lvl - 1) / 6));
}

export function levelConfig(n: number): LevelCfg {
  const lvl = Math.max(1, Math.floor(n));
  // Level 1 is a short, cascade-heavy tutorial on a 5-colour board. Its move
  // count is trimmed so the *target* still rises into level 2 even though the
  // per-move yield falls when the 6th colour arrives.
  const colors = lvl === 1 ? 5 : 6;
  const moves = lvl === 1 ? 15 : Math.max(20, REFERENCE_MOVES - Math.floor((lvl - 2) / 6));

  // The target is priced against a *fixed* move budget, not the actual one.
  // That keeps targets strictly monotonic (a goal that shrinks as you level up
  // reads as a bug) while the shrinking move count supplies the difficulty.
  const budget = lvl === 1 ? moves : REFERENCE_MOVES;
  const expected = (YIELD_PER_MOVE[colors] ?? 360) * budget;
  const target = Math.round((expected * pressure(lvl)) / 250) * 250;
  return { moves, target, colors };
}

/** Score multipliers for the 2nd and 3rd star. */
export const STAR_GATES = [1, 1.3, 1.65] as const;

export function starsFor(score: number, target: number): number {
  if (score >= target * STAR_GATES[2]) return 3;
  if (score >= target * STAR_GATES[1]) return 2;
  if (score >= target) return 1;
  return 0;
}
