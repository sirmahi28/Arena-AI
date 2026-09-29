import { ParticleSystem } from './particles';
import { paletteOf, type ColorId } from '../core/types';
import { rand } from '../core/rng';

const TAU = Math.PI * 2;

/**
 * Preset bursts. Every visual "event" in the game routes through here so the
 * look stays consistent and tuning is one place.
 */
export const FX = {
  /** Standard candy pop: shards + sparks + a shockwave ring + sugar dust. */
  candyPop(ps: ParticleSystem, x: number, y: number, color: ColorId, cell: number, power = 1) {
    const [base, light, , spark] = paletteOf(color);

    ps.emit({
      x,
      y,
      count: Math.round(9 * power),
      spread: cell * 0.18,
      speed: [90 * power, 320 * power],
      life: [0.32, 0.6],
      size: [cell * 0.07, cell * 0.16],
      sizeEnd: 0,
      gravity: 900,
      drag: 0.35,
      colors: [base, light, spark],
      shape: 'shard',
      additive: false,
      spin: [-14, 14],
    });

    ps.emit({
      x,
      y,
      count: Math.round(12 * power),
      spread: cell * 0.2,
      speed: [70, 300 * power],
      life: [0.22, 0.5],
      size: [cell * 0.05, cell * 0.17],
      sizeEnd: 0,
      gravity: 120,
      drag: 0.9,
      colors: [light, spark, '#ffffff'],
      shape: 'spark',
      additive: true,
    });

    ps.emit({
      x,
      y,
      count: 1,
      speed: [0, 0],
      life: [0.3, 0.3],
      size: [cell * 0.18, cell * 0.18],
      sizeEnd: cell * 0.95 * power,
      colors: [light],
      shape: 'ring',
      additive: true,
      thickness: cell * 0.09,
    });

    // A light sugar-dust puff. Using the dark palette entry here read as
    // muddy brown smudges against the deep purple board.
    ps.emit({
      x,
      y,
      count: Math.round(3 * power),
      spread: cell * 0.28,
      speed: [10, 55],
      life: [0.35, 0.6],
      size: [cell * 0.16, cell * 0.28],
      sizeEnd: cell * 0.44,
      gravity: -70,
      drag: 1.5,
      colors: [light, base],
      shape: 'smoke',
      additive: true,
    });
  },

  /** Star pops used for big combos. */
  stars(ps: ParticleSystem, x: number, y: number, color: ColorId, cell: number, count = 6) {
    const [base, light, , spark] = paletteOf(color);
    ps.emit({
      x,
      y,
      count,
      spread: cell * 0.3,
      speed: [120, 420],
      life: [0.45, 0.85],
      size: [cell * 0.08, cell * 0.18],
      sizeEnd: 0,
      gravity: 700,
      drag: 0.4,
      colors: [light, spark, base, '#ffffff'],
      shape: 'star',
      additive: true,
      spin: [-12, 12],
    });
  },

  /** Beam of light along a cleared row/column. */
  stripeBeam(
    ps: ParticleSystem,
    x: number,
    y: number,
    horizontal: boolean,
    color: ColorId,
    cell: number,
    length: number,
  ) {
    const [base, light, , spark] = paletteOf(color);
    const dirs = horizontal ? [0, Math.PI] : [Math.PI / 2, -Math.PI / 2];
    for (const d of dirs) {
      ps.emit({
        x,
        y,
        count: 26,
        spread: cell * 0.2,
        speed: [length * 1.1, length * 2.6],
        angle: [d - 0.07, d + 0.07],
        life: [0.25, 0.5],
        size: [cell * 0.09, cell * 0.24],
        sizeEnd: 0,
        drag: 1.6,
        colors: ['#ffffff', light, spark, base],
        shape: 'streak',
        additive: true,
        stretch: 2.4,
      });
    }
    ps.emit({
      x,
      y,
      count: 2,
      speed: [0, 0],
      life: [0.35, 0.45],
      size: [cell * 0.2, cell * 0.3],
      sizeEnd: cell * 2.2,
      colors: ['#ffffff', light],
      shape: 'ring',
      additive: true,
      thickness: cell * 0.14,
    });
  },

  /** Wrapped candy detonation. */
  explosion(ps: ParticleSystem, x: number, y: number, color: ColorId, cell: number) {
    const [base, light, , spark] = paletteOf(color);

    ps.emit({
      x,
      y,
      count: 30,
      spread: cell * 0.25,
      speed: [220, 780],
      life: [0.35, 0.75],
      size: [cell * 0.08, cell * 0.22],
      sizeEnd: 0,
      gravity: 800,
      drag: 0.5,
      colors: [base, light, spark, '#ffffff'],
      shape: 'shard',
      additive: false,
      spin: [-18, 18],
    });

    ps.emit({
      x,
      y,
      count: 26,
      spread: cell * 0.2,
      speed: [180, 700],
      life: [0.25, 0.55],
      size: [cell * 0.08, cell * 0.24],
      sizeEnd: 0,
      drag: 1.1,
      colors: ['#ffffff', light, spark],
      shape: 'spark',
      additive: true,
    });

    ps.emit({
      x,
      y,
      count: 3,
      speed: [0, 0],
      life: [0.42, 0.55],
      size: [cell * 0.25, cell * 0.4],
      sizeEnd: cell * 3.1,
      colors: ['#ffffff', light, base],
      shape: 'ring',
      additive: true,
      thickness: cell * 0.2,
    });

    ps.emit({
      x,
      y,
      count: 9,
      spread: cell * 0.55,
      speed: [40, 180],
      life: [0.45, 0.85],
      size: [cell * 0.3, cell * 0.5],
      sizeEnd: cell * 1.15,
      gravity: -140,
      drag: 1.5,
      colors: [light, base, spark],
      shape: 'smoke',
      additive: true,
    });
  },

  /** Rainbow colour-bomb ignition. */
  bombBurst(ps: ParticleSystem, x: number, y: number, cell: number) {
    const rainbow = ['#ff3b6b', '#ff9f1c', '#ffe03d', '#4ade80', '#38bdf8', '#a78bfa', '#ffffff'];
    ps.emit({
      x,
      y,
      count: 46,
      spread: cell * 0.3,
      speed: [260, 900],
      life: [0.4, 0.9],
      size: [cell * 0.07, cell * 0.2],
      sizeEnd: 0,
      drag: 0.9,
      colors: rainbow,
      shape: 'streak',
      additive: true,
      stretch: 1.6,
    });
    ps.emit({
      x,
      y,
      count: 24,
      spread: cell * 0.2,
      speed: [100, 500],
      life: [0.5, 1.0],
      size: [cell * 0.1, cell * 0.22],
      sizeEnd: 0,
      gravity: 420,
      drag: 0.5,
      colors: rainbow,
      shape: 'star',
      additive: true,
      spin: [-16, 16],
    });
    for (let i = 0; i < 4; i++) {
      ps.emit({
        x,
        y,
        count: 1,
        speed: [0, 0],
        life: [0.5 + i * 0.07, 0.5 + i * 0.07],
        size: [cell * 0.3, cell * 0.3],
        sizeEnd: cell * (2.4 + i * 1.3),
        colors: [rainbow[i % rainbow.length]],
        shape: 'ring',
        additive: true,
        thickness: cell * 0.16,
      });
    }
  },

  /** Little trail that flies from a bomb toward each matching candy. */
  bombTracer(
    ps: ParticleSystem,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: ColorId,
    cell: number,
  ) {
    const [, light, , spark] = paletteOf(color);
    const steps = 9;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      ps.emit({
        x: x0 + (x1 - x0) * t + rand(-4, 4),
        y: y0 + (y1 - y0) * t + rand(-4, 4),
        count: 1,
        speed: [0, 40],
        life: [0.16 + t * 0.22, 0.24 + t * 0.26],
        size: [cell * 0.07, cell * 0.14],
        sizeEnd: 0,
        drag: 1.2,
        colors: [light, spark, '#ffffff'],
        shape: 'spark',
        additive: true,
      });
    }
  },

  /** Soft glow when two candies swap. */
  swapTrail(ps: ParticleSystem, x: number, y: number, color: ColorId, cell: number) {
    const [, light, , spark] = paletteOf(color);
    ps.emit({
      x,
      y,
      count: 3,
      spread: cell * 0.22,
      speed: [10, 60],
      life: [0.18, 0.34],
      size: [cell * 0.05, cell * 0.11],
      sizeEnd: 0,
      drag: 1.4,
      colors: [light, spark],
      shape: 'spark',
      additive: true,
    });
  },

  /** Dust puff when a falling candy lands. */
  land(ps: ParticleSystem, x: number, y: number, color: ColorId, cell: number, force: number) {
    const [, light, , spark] = paletteOf(color);
    ps.emit({
      x,
      y: y + cell * 0.36,
      count: Math.round(3 + force * 5),
      spread: cell * 0.28,
      speed: [40, 130 * (0.6 + force)],
      angle: [Math.PI, TAU],
      life: [0.16, 0.34],
      size: [cell * 0.04, cell * 0.1],
      sizeEnd: 0,
      gravity: 260,
      drag: 1.6,
      colors: [light, spark, '#ffffff'],
      shape: 'spark',
      additive: true,
    });
  },

  /** Level-complete celebration. */
  confetti(ps: ParticleSystem, w: number, h: number, count = 120) {
    const colors = ['#ff3b6b', '#ff9f1c', '#ffe03d', '#4ade80', '#38bdf8', '#a78bfa', '#ffffff'];
    for (let i = 0; i < 3; i++) {
      ps.emit({
        x: w * (0.15 + i * 0.35),
        y: h * 0.28,
        count: Math.round(count / 3),
        spread: 20,
        speed: [260, 820],
        angle: [-Math.PI * 0.95, -Math.PI * 0.05],
        life: [1.3, 2.4],
        size: [4, 9],
        sizeEnd: 4,
        gravity: 780,
        drag: 0.32,
        colors,
        shape: 'confetti',
        additive: false,
        spin: [-9, 9],
      });
    }
  },

  /** Sparkle motes that idle around the board. */
  ambient(ps: ParticleSystem, x: number, y: number) {
    ps.emit({
      x,
      y,
      count: 1,
      speed: [6, 26],
      angle: [-Math.PI * 0.8, -Math.PI * 0.2],
      life: [1.1, 2.2],
      size: [1.4, 3.4],
      sizeEnd: 0,
      drag: 0.3,
      colors: ['#ffd2f5', '#c7b3ff', '#ffffff', '#9ee7ff'],
      shape: 'spark',
      additive: true,
    });
  },
};
