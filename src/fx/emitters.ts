import { ParticleSystem } from './particles';
import { paletteOf, type ColorId } from '../core/types';
import { rand } from '../core/rng';

const TAU = Math.PI * 2;

/*
 * A note on white.
 *
 * Pure white was previously mixed into almost every burst, on the theory
 * that white = bright = exciting. It does the opposite. Additive blending
 * already drives overlapping particles toward white, so seeding white on top
 * of that guarantees every effect collapses into the same colourless flare —
 * a red candy and a blue candy explode identically.
 *
 * Bursts now use the candy's own bright tint instead, and white appears only
 * where nothing else can do the job: the leading edge of a shockwave, and
 * confetti, which is unlit paper rather than light.
 */

/**
 * Preset bursts. Every visual "event" in the game routes through here so the
 * look stays consistent and tuning is one place.
 */
export const FX = {
  /** Standard candy pop: shards + sparks + a shockwave ring + sugar dust. */
  candyPop(ps: ParticleSystem, x: number, y: number, color: ColorId, cell: number, power = 1) {
    const [base, light, , spark] = paletteOf(color);

    // 1. Chunky shards — the candy itself coming apart. Heavy, spinning,
    //    falling out of the blast under real gravity.
    ps.emit({
      x,
      y,
      count: Math.round(9 * power),
      spread: cell * 0.22,
      speed: [120 * power, 380 * power],
      life: [0.36, 0.72],
      size: [cell * 0.06, cell * 0.145],
      sizeEnd: 0,
      gravity: 980,
      drag: 0.32,
      colors: [base, light, spark],
      shape: 'shard',
      additive: false,
      spin: [-18, 18],
    });

    // 2. Fine glitter — fast, weightless, additive, gone almost instantly.
    //    This is what reads as "sparkle" rather than "debris".
    ps.emit({
      x,
      y,
      count: Math.round(11 * power),
      spread: cell * 0.2,
      speed: [80, 360 * power],
      life: [0.2, 0.46],
      size: [cell * 0.04, cell * 0.15],
      sizeEnd: 0,
      gravity: 90,
      drag: 0.92,
      colors: [light, spark, base],
      shape: 'spark',
      additive: true,
    });

    // 3. Radiating speed lines, sold as motion rather than matter.
    ps.emit({
      x,
      y,
      count: Math.round(5 * power),
      spread: cell * 0.06,
      speed: [260 * power, 520 * power],
      life: [0.14, 0.26],
      size: [cell * 0.05, cell * 0.09],
      sizeEnd: 0,
      gravity: 0,
      drag: 0.6,
      colors: [spark, light],
      shape: 'streak',
      additive: true,
    });

    // 4. A few shaped glints, slow enough to actually register. These are
    //    the premium note in the whole burst: four-point highlights read as
    //    deliberate craft where another soft blob would read as noise.
    ps.emit({
      x,
      y,
      count: Math.round(3 * power),
      spread: cell * 0.3,
      speed: [40, 170 * power],
      life: [0.3, 0.62],
      size: [cell * 0.07, cell * 0.13],
      sizeEnd: 0,
      gravity: 60,
      drag: 1.1,
      colors: [spark, light],
      shape: 'glint',
      additive: true,
      spin: [-2.5, 2.5],
    });

    /*
     * 5. Shockwave — but only one, and only a faint one.
     *
     * This used to be a double pulse, which looks great on a single candy
     * and awful everywhere else: `candyPop` runs once per cleared candy, so
     * a colour bomb taking out ten reds drew twenty expanding circles and
     * the board turned into a field of soap bubbles. A ring is a punctuation
     * mark. Spend it once per pop, keep it thin, and let the second pulse be
     * something a *big* pop earns rather than something every pop gets.
     */
    ps.emit({
      x,
      y,
      count: 1,
      speed: [0, 0],
      life: [0.26, 0.26],
      size: [cell * 0.18, cell * 0.18],
      sizeEnd: cell * 0.92 * power,
      colors: [light],
      shape: 'ring',
      additive: true,
      thickness: cell * 0.055,
    });

    // 6. The second pulse, reserved for boosted pops (cascades, specials).
    if (power > 1.08) {
      ps.emit({
        x,
        y,
        count: 1,
        speed: [0, 0],
        life: [0.19, 0.19],
        size: [cell * 0.1, cell * 0.1],
        sizeEnd: cell * 0.72 * power,
        colors: [spark],
        shape: 'ring',
        additive: true,
        thickness: cell * 0.035,
      });
    }

    // 7. Sugar-dust puff drifting up. Light palette entries only — the dark
    //    ones read as muddy brown smudges against the deep purple board.
    ps.emit({
      x,
      y,
      count: Math.round(2 * power),
      spread: cell * 0.26,
      speed: [10, 55],
      life: [0.3, 0.52],
      size: [cell * 0.13, cell * 0.22],
      sizeEnd: cell * 0.38,
      gravity: -80,
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
      colors: [light, spark, base],
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
      /*
       * One wide spread of speeds rather than a narrow fast one.
       *
       * With `speed` spanning barely 2x and drag at 1.6, every streak
       * reached its stopping distance at almost the same moment: a single
       * hard blast front that was gone in a fifth of a second. Spanning 5x
       * with light drag means there is always material in flight at every
       * distance from the candy, which is what makes the beam read as
       * pouring continuously out of the cell rather than being fired from
       * it. The long tail of the life range does the same job in time.
       */
      ps.emit({
        x,
        y,
        count: 30,
        spread: cell * 0.16,
        speed: [length * 0.55, length * 2.8],
        angle: [d - 0.055, d + 0.055],
        life: [0.3, 0.64],
        size: [cell * 0.08, cell * 0.26],
        sizeEnd: 0,
        drag: 0.85,
        colors: [light, spark, base],
        shape: 'streak',
        additive: true,
        stretch: 2.6,
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
      colors: [spark, light],
      shape: 'ring',
      additive: true,
      thickness: cell * 0.08,
    });
  },

  /** Wrapped candy detonation. */
  explosion(ps: ParticleSystem, x: number, y: number, color: ColorId, cell: number) {
    const [base, light, , spark] = paletteOf(color);

    ps.emit({
      x,
      y,
      count: 26,
      spread: cell * 0.34,
      speed: [260, 820],
      life: [0.35, 0.75],
      size: [cell * 0.06, cell * 0.16],
      sizeEnd: 0,
      gravity: 800,
      drag: 0.5,
      colors: [base, light, spark],
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
      colors: [light, spark],
      shape: 'spark',
      additive: true,
    });

    ps.emit({
      x,
      y,
      count: 2,
      speed: [0, 0],
      life: [0.42, 0.55],
      size: [cell * 0.25, cell * 0.4],
      sizeEnd: cell * 3.1,
      colors: [spark, light],
      shape: 'ring',
      additive: true,
      thickness: cell * 0.11,
    });

    // Shaped glints riding the blast front.
    ps.emit({
      x,
      y,
      count: 6,
      spread: cell * 0.3,
      speed: [120, 430],
      life: [0.3, 0.6],
      size: [cell * 0.08, cell * 0.14],
      sizeEnd: 0,
      drag: 1.0,
      colors: [spark, light],
      shape: 'glint',
      additive: true,
      spin: [-3, 3],
    });

    ps.emit({
      x,
      y,
      count: 5,
      spread: cell * 0.5,
      speed: [40, 170],
      life: [0.4, 0.72],
      size: [cell * 0.24, cell * 0.4],
      sizeEnd: cell * 0.85,
      gravity: -140,
      drag: 1.5,
      colors: [light, base, spark],
      shape: 'smoke',
      additive: true,
    });
  },

  /**
   * The core of a cross detonation. The four beams are already drawn by two
   * `stripeBeam` calls; this is the thing at the middle that stops them
   * reading as two unrelated effects that happened to fire on the same
   * frame.
   */
  /**
   * The tee-forged cross going off.
   *
   * The first version fired everything outward on the same frame at high
   * speed with heavy drag, which looks like a firework and reads as
   * *happening to* the candy rather than coming *out of* it. Three changes
   * fix that, and all three are about legible direction:
   *
   * 1. An implosion. Particles spawned out at radius with negative speed
   *    collapse inward, so the eye is pulled to the source cell a beat
   *    before anything leaves it.
   * 2. A graded sweep. Streaks leave at a spread of speeds with light drag
   *    and long life, so instead of one blast front there is a continuous
   *    ribbon of material still travelling outward from the candy for the
   *    whole effect.
   * 3. Two rings rather than one, the second lagging and thinner, which
   *    gives the shockwave a leading and a trailing edge instead of a single
   *    hoop that appears and disappears.
   */
  crossCore(ps: ParticleSystem, x: number, y: number, color: ColorId, cell: number) {
    const [base, light, , spark] = paletteOf(color);

    // 1. Implosion: spawned on a wide ring, flying in.
    ps.emit({
      x,
      y,
      count: 18,
      spread: cell * 2.1,
      speed: [-420, -190],
      life: [0.16, 0.3],
      size: [cell * 0.05, cell * 0.12],
      sizeEnd: 0,
      drag: 0.3,
      colors: [spark, light],
      shape: 'spark',
      additive: true,
    });

    // 2. Core flash, held briefly so the beams have something to leave from.
    ps.emit({
      x,
      y,
      count: 1,
      speed: [0, 0],
      life: [0.26, 0.26],
      size: [cell * 0.85, cell * 0.85],
      sizeEnd: cell * 0.1,
      colors: ['#ffffff'],
      shape: 'glint',
      additive: true,
    });

    // 3. Leading and trailing shockwave rings.
    ps.emit({
      x,
      y,
      count: 1,
      speed: [0, 0],
      life: [0.34, 0.34],
      size: [cell * 0.18, cell * 0.18],
      sizeEnd: cell * 1.7,
      colors: [spark],
      shape: 'ring',
      additive: true,
      thickness: cell * 0.1,
    });
    ps.emit({
      x,
      y,
      count: 1,
      speed: [0, 0],
      life: [0.5, 0.5],
      size: [cell * 0.1, cell * 0.1],
      sizeEnd: cell * 2.4,
      colors: [light],
      shape: 'ring',
      additive: true,
      thickness: cell * 0.045,
    });

    // 4. Slow glinting motes that hang in the air after the beams have gone.
    ps.emit({
      x,
      y,
      count: 12,
      spread: cell * 0.22,
      speed: [40, 210],
      life: [0.45, 0.85],
      size: [cell * 0.07, cell * 0.15],
      sizeEnd: 0,
      drag: 0.9,
      colors: [spark, light, '#ffffff'],
      shape: 'glint',
      additive: true,
      spin: [-3, 3],
    });

    // 5. Solid debris, thrown with gravity so the cell feels like it broke.
    ps.emit({
      x,
      y,
      count: 12,
      spread: cell * 0.25,
      speed: [150, 430],
      life: [0.35, 0.7],
      size: [cell * 0.05, cell * 0.13],
      sizeEnd: 0,
      gravity: 700,
      drag: 0.5,
      colors: [base, light, spark],
      shape: 'shard',
      additive: false,
      spin: [-16, 16],
    });
  },

  /**
   * The laser firing: three lanes of light leaving the candy at once.
   *
   * Built from the same streak vocabulary as `stripeBeam` so the two are
   * obviously related, but emitted from three parallel origins offset across
   * the axis. That is what sells "three rows" rather than "one very bright
   * row" — a single thick beam at this scale just looks like a stripe with
   * the brightness turned up.
   */
  laserBeam(
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
    for (const lane of [-1, 0, 1]) {
      const ox = horizontal ? 0 : lane * cell;
      const oy = horizontal ? lane * cell : 0;
      const heat = lane === 0 ? 1 : 0.6;
      for (const d of dirs) {
        ps.emit({
          x: x + ox,
          y: y + oy,
          count: Math.round(22 * heat),
          spread: cell * 0.14,
          speed: [length * 0.6, length * 2.9],
          angle: [d - 0.04, d + 0.04],
          life: [0.3, 0.68],
          size: [cell * 0.07, cell * 0.24 * heat],
          sizeEnd: 0,
          drag: 0.8,
          colors: lane === 0 ? ['#ffffff', spark, light] : [light, spark, base],
          shape: 'streak',
          additive: true,
          stretch: 2.8,
        });
      }
    }
    // One wide ring to bind the three lanes into a single event.
    ps.emit({
      x,
      y,
      count: 1,
      speed: [0, 0],
      life: [0.42, 0.42],
      size: [cell * 0.3, cell * 0.3],
      sizeEnd: cell * 3,
      colors: [spark],
      shape: 'ring',
      additive: true,
      thickness: cell * 0.075,
    });
    ps.emit({
      x,
      y,
      count: 14,
      spread: cell * 0.3,
      speed: [120, 380],
      life: [0.35, 0.7],
      size: [cell * 0.05, cell * 0.13],
      sizeEnd: 0,
      gravity: 660,
      drag: 0.5,
      colors: [base, light, spark],
      shape: 'shard',
      additive: false,
      spin: [-14, 14],
    });
  },

  /**
   * The vortex spinning up, before it starts reeling candies in.
   *
   * Everything here moves *inward* — negative speeds from a wide spawn ring,
   * plus contracting rings. The whole point of the special is that it pulls,
   * and if the birth effect throws material outward like every other
   * detonation does, the player has to be told what it does instead of
   * seeing it.
   */
  vortexPull(ps: ParticleSystem, x: number, y: number, color: ColorId, cell: number) {
    const [, light, , spark] = paletteOf(color);
    ps.emit({
      x,
      y,
      count: 26,
      spread: cell * 2.6,
      speed: [-460, -200],
      life: [0.24, 0.48],
      size: [cell * 0.05, cell * 0.13],
      sizeEnd: 0,
      drag: 0.25,
      colors: [spark, light, '#ffffff'],
      shape: 'streak',
      additive: true,
      stretch: 2.2,
    });
    // Contracting rings: size shrinking rather than growing.
    for (const [life, from] of [
      [0.36, 2.6],
      [0.5, 3.4],
    ] as Array<[number, number]>) {
      ps.emit({
        x,
        y,
        count: 1,
        speed: [0, 0],
        life: [life, life],
        size: [cell * from, cell * from],
        sizeEnd: cell * 0.2,
        colors: [spark],
        shape: 'ring',
        additive: true,
        thickness: cell * 0.06,
      });
    }
    ps.emit({
      x,
      y,
      count: 1,
      speed: [0, 0],
      life: [0.34, 0.34],
      size: [cell * 0.2, cell * 0.2],
      sizeEnd: cell * 1.1,
      colors: ['#ffffff'],
      shape: 'glint',
      additive: true,
    });
  },

  /**
   * The mark a colour-bomb bolt leaves on a candy it has claimed.
   *
   * Long-lived on purpose: the targeting sequence now runs up to a second,
   * and a mark that fades in 300ms would leave the early targets looking
   * untouched by the time the last one is hit. These have to still be on
   * screen when the whole set detonates together.
   */
  zapLock(ps: ParticleSystem, x: number, y: number, color: ColorId, cell: number) {
    const [, light, , spark] = paletteOf(color);
    ps.emit({
      x,
      y,
      count: 1,
      speed: [0, 0],
      life: [0.7, 0.7],
      size: [cell * 0.9, cell * 0.9],
      sizeEnd: cell * 0.62,
      colors: [spark],
      shape: 'ring',
      additive: true,
      thickness: cell * 0.055,
    });
    ps.emit({
      x,
      y,
      count: 4,
      spread: cell * 0.3,
      speed: [20, 90],
      life: [0.24, 0.44],
      size: [cell * 0.05, cell * 0.1],
      sizeEnd: 0,
      drag: 1.4,
      colors: [light, '#ffffff'],
      shape: 'spark',
      additive: true,
    });
  },


  /**
   * Nova: the plus-shape detonation. Reads as an upgrade of the wrapped
   * explosion rather than a different thing — same vocabulary, more of it,
   * plus four bright arms so the plus that forged it is still legible in
   * the blast.
   */
  nova(ps: ParticleSystem, x: number, y: number, color: ColorId, cell: number) {
    const [base, light, , spark] = paletteOf(color);

    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ps.emit({
        x,
        y,
        count: 12,
        spread: cell * 0.12,
        speed: [420, 1000],
        angle: [a - 0.1, a + 0.1],
        life: [0.26, 0.5],
        size: [cell * 0.08, cell * 0.2],
        sizeEnd: 0,
        drag: 1.5,
        colors: [spark, light],
        shape: 'streak',
        additive: true,
        stretch: 2.2,
      });
    }

    ps.emit({
      x,
      y,
      count: 30,
      spread: cell * 0.35,
      speed: [280, 860],
      life: [0.35, 0.8],
      size: [cell * 0.06, cell * 0.17],
      sizeEnd: 0,
      gravity: 820,
      drag: 0.5,
      colors: [base, light, spark],
      shape: 'shard',
      additive: false,
      spin: [-18, 18],
    });

    ps.emit({
      x,
      y,
      count: 14,
      spread: cell * 0.3,
      speed: [120, 500],
      life: [0.35, 0.7],
      size: [cell * 0.09, cell * 0.16],
      sizeEnd: 0,
      drag: 0.95,
      colors: [spark, light],
      shape: 'glint',
      additive: true,
      spin: [-3, 3],
    });

    for (let i = 0; i < 2; i++) {
      ps.emit({
        x,
        y,
        count: 1,
        speed: [0, 0],
        life: [0.4 + i * 0.1, 0.4 + i * 0.1],
        size: [cell * 0.3, cell * 0.3],
        sizeEnd: cell * (2.6 + i * 1.6),
        colors: [i === 0 ? spark : light],
        shape: 'ring',
        additive: true,
        thickness: cell * (0.11 - i * 0.035),
      });
    }

    ps.emit({
      x,
      y,
      count: 5,
      spread: cell * 0.5,
      speed: [40, 170],
      life: [0.4, 0.72],
      size: [cell * 0.24, cell * 0.4],
      sizeEnd: cell * 0.9,
      gravity: -140,
      drag: 1.5,
      colors: [light, base],
      shape: 'smoke',
      additive: true,
    });
  },

  /** Rainbow colour-bomb ignition. */
  bombBurst(ps: ParticleSystem, x: number, y: number, cell: number) {
    // Saturated hues only. The bomb is the one effect that *should* read as
    // every colour at once, which only works if each streak keeps its own.
    const rainbow = ['#ff3b6b', '#ff9f1c', '#ffe03d', '#4ade80', '#38bdf8', '#a78bfa'];
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
    // Two staggered rings, not four. Concentric circles stop reading as a
    // shockwave and start reading as a diagram somewhere around the third.
    for (let i = 0; i < 2; i++) {
      ps.emit({
        x,
        y,
        count: 1,
        speed: [0, 0],
        life: [0.46 + i * 0.12, 0.46 + i * 0.12],
        size: [cell * 0.3, cell * 0.3],
        sizeEnd: cell * (2.6 + i * 2.2),
        // Warm white rather than pure — a hard white hoop is the most
        // artificial thing that can be drawn over painted candy art.
        colors: ['#fff0fa'],
        shape: 'ring',
        additive: true,
        thickness: cell * (0.1 - i * 0.03),
      });
    }

    ps.emit({
      x,
      y,
      count: 10,
      spread: cell * 0.35,
      speed: [90, 380],
      life: [0.4, 0.8],
      size: [cell * 0.09, cell * 0.16],
      sizeEnd: 0,
      drag: 1.0,
      colors: rainbow,
      shape: 'glint',
      additive: true,
      spin: [-3, 3],
    });
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
        colors: [light, spark],
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
      colors: [light, spark],
      shape: 'spark',
      additive: true,
    });
  },

  /** Level-complete celebration. */
  confetti(ps: ParticleSystem, w: number, h: number, count = 120) {
    // Cream rather than pure white: confetti is paper, so its back face is
    // drawn shaded, and shaded white is grey — which reads as ash, not
    // celebration. A warm tint keeps the shadow side looking like paper.
    const colors = ['#ff3b6b', '#ff9f1c', '#ffe03d', '#4ade80', '#38bdf8', '#a78bfa', '#fff1c9'];
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
      colors: ['#ffd2f5', '#c7b3ff', '#fff3fb', '#9ee7ff'],
      shape: 'glint',
      additive: true,
    });
  },
};
