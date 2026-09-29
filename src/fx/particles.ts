import { rand, randInt, clamp } from '../core/rng';

export type ParticleShape =
  | 'spark'
  | 'shard'
  | 'ring'
  | 'star'
  | 'confetti'
  | 'smoke'
  | 'streak'
  | 'glint';

export interface Particle {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  drag: number;
  life: number;
  maxLife: number;
  size: number;
  sizeEnd: number;
  rot: number;
  vr: number;
  color: string;
  color2: string;
  alpha: number;
  shape: ParticleShape;
  additive: boolean;
  /** For confetti: simulated 3D flip. */
  flip: number;
  vflip: number;
  /** Ring thickness. */
  thickness: number;
  /** Trail length multiplier for streaks. */
  stretch: number;
  /** Twinkle phase and rate — high-frequency brightness flicker. */
  tw: number;
  twRate: number;
}

export interface EmitOptions {
  count?: number;
  x: number;
  y: number;
  /** Radius of the spawn disc. */
  spread?: number;
  speed?: [number, number];
  angle?: [number, number];
  life?: [number, number];
  size?: [number, number];
  sizeEnd?: number;
  gravity?: number;
  drag?: number;
  colors: readonly string[];
  shape?: ParticleShape;
  additive?: boolean;
  spin?: [number, number];
  thickness?: number;
  stretch?: number;
  /** 0 = steady, 1 = strong flicker. Default depends on shape. */
  twinkle?: number;
}

const TAU = Math.PI * 2;

/**
 * Gradient textures are baked once per colour and blitted afterwards.
 * Building `createRadialGradient` for every particle every frame is the
 * single biggest killer of particle throughput on mobile GPUs.
 */
const TEX = 64;
const glowCache = new Map<string, HTMLCanvasElement>();
const smokeCache = new Map<string, HTMLCanvasElement>();
const streakCache = new Map<string, HTMLCanvasElement>();
const glintCache = new Map<string, HTMLCanvasElement>();

/** '#rrggbb' -> [r,g,b]. Particle colours are always literal hex. */
function rgbOf(hex: string): [number, number, number] {
  const h = hex.charCodeAt(0) === 35 ? hex.slice(1) : hex;
  const n = parseInt(
    h.length === 3
      ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
      : h,
    16,
  );
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(c: [number, number, number], a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

/** Push a colour toward white by `k`, keeping its hue recognisable. */
function toward255(c: [number, number, number], k: number): [number, number, number] {
  return [
    Math.round(c[0] + (255 - c[0]) * k),
    Math.round(c[1] + (255 - c[1]) * k),
    Math.round(c[2] + (255 - c[2]) * k),
  ];
}

/**
 * The glow sprite, and the single most important texture in the game.
 *
 * The obvious build — white core, colour ring, transparent edge — is what
 * makes cheap particle systems look cheap. Under `lighter` blending every
 * overlap drives toward white, so a burst of six red candies renders as a
 * grey-white smear with a faint red fringe: maximum glow, zero information.
 *
 * Two rules fix it. The core is only pushed 55% toward white, so it still
 * reads as *its own colour* when saturated. And the falloff is tight, closer
 * to a gaussian than a linear ramp, so the bright part stays small and
 * overlaps add detail instead of flooding.
 */
function glowTex(color: string): HTMLCanvasElement {
  let cv = glowCache.get(color);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = cv.height = TEX;
  const c = cv.getContext('2d')!;
  const rgb = rgbOf(color);
  const core = toward255(rgb, 0.55);
  const g = c.createRadialGradient(TEX / 2, TEX / 2, 0, TEX / 2, TEX / 2, TEX / 2);
  g.addColorStop(0.0, rgba(core, 1));
  g.addColorStop(0.12, rgba(rgb, 0.95));
  g.addColorStop(0.3, rgba(rgb, 0.52));
  g.addColorStop(0.54, rgba(rgb, 0.18));
  g.addColorStop(0.78, rgba(rgb, 0.045));
  g.addColorStop(1.0, rgba(rgb, 0));
  c.fillStyle = g;
  c.fillRect(0, 0, TEX, TEX);
  glowCache.set(color, cv);
  return cv;
}

/**
 * A four-point lens glint: tapered spikes plus a tight core.
 *
 * Soft round blobs are the lowest-quality particle primitive there is — at
 * small sizes they are indistinguishable from noise or dirt on the screen.
 * A shaped highlight reads as something deliberate even two pixels across,
 * which is why real sparkle in polished games is nearly always spiked.
 */
function glintTex(color: string): HTMLCanvasElement {
  let cv = glintCache.get(color);
  if (cv) return cv;
  const S = 96;
  cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  const rgb = rgbOf(color);
  const m = S / 2;

  // Core bloom, kept deliberately small.
  const g = c.createRadialGradient(m, m, 0, m, m, S * 0.19);
  g.addColorStop(0, rgba(toward255(rgb, 0.7), 1));
  g.addColorStop(0.45, rgba(rgb, 0.5));
  g.addColorStop(1, rgba(rgb, 0));
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);

  // Spikes: long pair on the axes, short pair on the diagonals. Drawn as
  // needles that taper to nothing rather than lines, so they never terminate
  // in a visible hard end.
  c.globalCompositeOperation = 'lighter';
  const spike = (ang: number, len: number, wid: number, alpha: number) => {
    c.save();
    c.translate(m, m);
    c.rotate(ang);
    const lg = c.createLinearGradient(0, 0, len, 0);
    lg.addColorStop(0, rgba(toward255(rgb, 0.45), alpha));
    lg.addColorStop(0.35, rgba(rgb, alpha * 0.5));
    lg.addColorStop(1, rgba(rgb, 0));
    c.fillStyle = lg;
    c.beginPath();
    c.moveTo(0, -wid);
    c.lineTo(len, 0);
    c.lineTo(0, wid);
    c.closePath();
    c.fill();
    c.restore();
  };
  const L = S * 0.5;
  for (let i = 0; i < 4; i++) spike((i * Math.PI) / 2, L, S * 0.045, 0.95);
  for (let i = 0; i < 4; i++) spike(Math.PI / 4 + (i * Math.PI) / 2, L * 0.42, S * 0.03, 0.5);

  glintCache.set(color, cv);
  return cv;
}

function smokeTex(color: string): HTMLCanvasElement {
  let cv = smokeCache.get(color);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = cv.height = TEX;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(TEX / 2, TEX / 2, 0, TEX / 2, TEX / 2, TEX / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.55, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.globalAlpha = 0.55;
  c.fillStyle = g;
  c.fillRect(0, 0, TEX, TEX);
  smokeCache.set(color, cv);
  return cv;
}

/** A comet: transparent tail on the left, bright head on the right. */
function streakTex(color: string): HTMLCanvasElement {
  let cv = streakCache.get(color);
  if (cv) return cv;
  const W = 96;
  const H = 24;
  cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  const rgb = rgbOf(color);
  const g = c.createLinearGradient(0, 0, W, 0);
  // Tail fades in gradually; the head brightens but stops short of white so
  // the streak keeps its hue when a dozen of them overlap.
  g.addColorStop(0, rgba(rgb, 0));
  g.addColorStop(0.45, rgba(rgb, 0.35));
  g.addColorStop(0.82, rgba(rgb, 0.92));
  g.addColorStop(1, rgba(toward255(rgb, 0.6), 1));
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(0, H / 2);
  c.lineTo(W * 0.8, 0);
  c.lineTo(W, H / 2);
  c.lineTo(W * 0.8, H);
  c.closePath();
  c.fill();
  streakCache.set(color, cv);
  return cv;
}

/**
 * Per-colour tint caches. `rgbOf` parses a string, which is far too slow to
 * run per particle per frame, but shard facet shading needs a lighter and a
 * darker version of each colour. Resolve once, reuse forever.
 */
const liteCache = new Map<string, string>();
const darkCache = new Map<string, string>();

function lighten(color: string): string {
  let v = liteCache.get(color);
  if (v) return v;
  const c = toward255(rgbOf(color), 0.42);
  v = `rgb(${c[0]},${c[1]},${c[2]})`;
  liteCache.set(color, v);
  return v;
}

function darken(color: string): string {
  let v = darkCache.get(color);
  if (v) return v;
  const c = rgbOf(color);
  v = `rgb(${Math.round(c[0] * 0.72)},${Math.round(c[1] * 0.72)},${Math.round(c[2] * 0.72)})`;
  darkCache.set(color, v);
  return v;
}

function makeParticle(): Particle {
  return {
    alive: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    ax: 0,
    ay: 0,
    drag: 0,
    life: 0,
    maxLife: 1,
    size: 1,
    sizeEnd: 0,
    rot: 0,
    vr: 0,
    color: '#fff',
    color2: '#fff',
    alpha: 1,
    shape: 'spark',
    additive: true,
    flip: 0,
    vflip: 0,
    thickness: 2,
    stretch: 1,
    tw: 0,
    twRate: 0,
  };
}

/**
 * Fixed-capacity, zero-allocation particle pool.
 * Renders in two passes (additive glow first, then normal) so the
 * screen blooms without washing out the candy art.
 */
export class ParticleSystem {
  private pool: Particle[] = [];
  private cursor = 0;
  /** Scales particle counts, 0..1, for weaker devices. */
  quality = 1;

  constructor(public capacity = 2600) {
    for (let i = 0; i < capacity; i++) this.pool.push(makeParticle());
  }

  get liveCount(): number {
    let n = 0;
    for (const p of this.pool) if (p.alive) n++;
    return n;
  }

  clear(): void {
    for (const p of this.pool) p.alive = false;
  }

  private next(): Particle {
    // Round-robin; oldest slots get recycled when we run out.
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % this.pool.length;
      if (!p.alive) return p;
    }
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    return p;
  }

  emit(o: EmitOptions): void {
    const count = Math.max(1, Math.round((o.count ?? 10) * this.quality));
    const [s0, s1] = o.speed ?? [60, 220];
    const [a0, a1] = o.angle ?? [0, TAU];
    const [l0, l1] = o.life ?? [0.4, 0.9];
    const [z0, z1] = o.size ?? [2, 6];
    const [r0, r1] = o.spin ?? [-6, 6];
    const spread = o.spread ?? 0;

    for (let i = 0; i < count; i++) {
      const p = this.next();
      const ang = rand(a0, a1);
      const spd = rand(s0, s1);
      const sr = spread > 0 ? Math.sqrt(Math.random()) * spread : 0;
      const sa = rand(0, TAU);

      p.alive = true;
      p.x = o.x + Math.cos(sa) * sr;
      p.y = o.y + Math.sin(sa) * sr;
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd;
      p.ax = 0;
      p.ay = o.gravity ?? 0;
      p.drag = o.drag ?? 0.6;
      p.maxLife = rand(l0, l1);
      p.life = p.maxLife;
      p.size = rand(z0, z1);
      p.sizeEnd = o.sizeEnd ?? 0;
      p.rot = rand(0, TAU);
      p.vr = rand(r0, r1);
      p.color = o.colors[randInt(0, o.colors.length - 1)];
      p.color2 = o.colors[randInt(0, o.colors.length - 1)];
      p.alpha = 1;
      p.shape = o.shape ?? 'spark';
      p.additive = o.additive ?? true;
      p.flip = rand(0, TAU);
      p.vflip = rand(-9, 9);
      p.thickness = o.thickness ?? 3;
      p.stretch = o.stretch ?? 1;
      // Sparkle shapes flicker by default; debris and smoke never should.
      const twDefault = p.shape === 'glint' || p.shape === 'spark' ? 1 : 0;
      p.tw = rand(0, TAU);
      p.twRate = (o.twinkle ?? twDefault) * rand(16, 30);
    }
  }

  update(dt: number): void {
    const d = Math.min(dt, 1 / 30);
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= d;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      p.vx += p.ax * d;
      p.vy += p.ay * d;
      const damping = Math.exp(-p.drag * d * 6);
      p.vx *= damping;
      p.vy *= damping;
      p.x += p.vx * d;
      p.y += p.vy * d;
      p.rot += p.vr * d;
      p.flip += p.vflip * d;
      p.tw += p.twRate * d;
    }
  }

  /**
   * Draw only the additive particles, for the bloom buffer. The caller has
   * already set `lighter` and the world transform.
   */
  renderGlowOnly(ctx: CanvasRenderingContext2D): void {
    for (const p of this.pool) if (p.alive && p.additive) this.draw(ctx, p);
  }

  render(ctx: CanvasRenderingContext2D): void {
    // Pass 1: additive bloom
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.pool) if (p.alive && p.additive) this.draw(ctx, p);
    ctx.restore();

    // Pass 2: solid pieces
    ctx.save();
    for (const p of this.pool) if (p.alive && !p.additive) this.draw(ctx, p);
    ctx.restore();
  }

  private draw(ctx: CanvasRenderingContext2D, p: Particle): void {
    const t = 1 - p.life / p.maxLife; // 0 -> 1

    /*
     * Envelope. A linear fade is the giveaway of an untuned particle system:
     * everything dies at a constant rate, so a burst reads as one grey mass
     * thinning out rather than as individual bright things going out.
     *
     * Sparks get a near-instant attack and a steep decay with a long dim
     * tail — that shape is what the eye reads as "hot". Smoke gets the
     * opposite: a slow swell and a soft exit. Rings decay steeply so the
     * shockwave is gone before it can turn into a lingering outline.
     */
    let fade: number;
    if (p.shape === 'smoke') {
      const u = t < 0.22 ? t / 0.22 : 1 - (t - 0.22) / 0.78;
      fade = u * u * (3 - 2 * u); // smoothstep, in and out
    } else if (p.shape === 'ring') {
      fade = t < 0.06 ? t / 0.06 : Math.pow(1 - (t - 0.06) / 0.94, 2.4);
    } else if (p.shape === 'confetti' || p.shape === 'shard') {
      fade = t < 0.05 ? t / 0.05 : Math.min(1, (1 - t) / 0.3);
    } else {
      fade = t < 0.07 ? t / 0.07 : Math.pow(1 - (t - 0.07) / 0.93, 1.9);
    }

    let a = clamp(fade, 0, 1) * p.alpha;
    // Flicker. Sparkle in the real world is never steady; a little
    // high-frequency variation is the difference between "lights" and "dots".
    if (p.twRate > 0) a *= 0.72 + 0.28 * Math.sin(p.tw);
    if (a <= 0.002) return;
    const size = p.size + (p.sizeEnd - p.size) * t;
    if (size <= 0.05) return;

    ctx.globalAlpha = a;

    switch (p.shape) {
      case 'spark': {
        const tex = glowTex(p.color);
        ctx.drawImage(tex, p.x - size, p.y - size, size * 2, size * 2);
        break;
      }
      case 'smoke': {
        ctx.globalAlpha = a * 0.5;
        const tex = smokeTex(p.color);
        ctx.drawImage(tex, p.x - size, p.y - size, size * 2, size * 2);
        break;
      }
      case 'shard': {
        /*
         * Faceting a chip this small is a trap. The first version split the
         * diamond into a lit half and a shaded half, which is how you shade a
         * large object — on a 10px chip flying over a dark board it just
         * looks like dirt, and on the yellow candy it turned the debris
         * olive. A silhouette against a dark background does not need a dark
         * side; it needs a bright one.
         *
         * So: the body stays at full colour, and the depth cue is a single
         * lit facet across the top. One extra fill, and the chip reads as a
         * solid object catching the board light rather than a flat lozenge.
         */
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        const w = size;
        const h = size * 1.5;

        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(0, -h);
        ctx.lineTo(w, 0);
        ctx.lineTo(0, h);
        ctx.lineTo(-w, 0);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = lighten(p.color);
        ctx.beginPath();
        ctx.moveTo(0, -h);
        ctx.lineTo(w * 0.62, -h * 0.08);
        ctx.lineTo(-w * 0.62, -h * 0.08);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'star': {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const r = i % 2 === 0 ? size : size * 0.4;
          const ang = (i / 8) * TAU;
          const x = Math.cos(ang) * r;
          const y = Math.sin(ang) * r;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'ring': {
        /*
         * A shockwave drawn as one hard stroke reads as a drawn circle —
         * geometry homework, not energy. Worse, several at once look like a
         * Venn diagram.
         *
         * Two strokes was not enough: a wide stroke at low alpha still has a
         * hard edge on both sides, so it reads as a second circle rather than
         * as atmosphere around the first. What a glow actually needs is a
         * gradient across the stroke, which canvas cannot do directly — so
         * stack four, each roughly half the width and well over double the
         * opacity of the one beneath. That approximates the falloff closely
         * enough that no individual edge is findable.
         *
         * Cheap, too: rings are the rarest particle in the game, a handful
         * alive at once, so four strokes each is nothing next to the hundreds
         * of sprites around them.
         */
        const RING = [
          [3.2, 0.06],
          [1.8, 0.14],
          [0.85, 0.42],
          [0.34, 1.0],
        ] as const;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, TAU);
        ctx.strokeStyle = p.color;
        const thin = 1 - t * 0.55;
        for (const [w, al] of RING) {
          ctx.globalAlpha = a * al;
          ctx.lineWidth = Math.max(0.35, p.thickness * w * thin);
          ctx.stroke();
        }
        break;
      }
      case 'glint': {
        const tex = glintTex(p.color);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.drawImage(tex, -size * 2, -size * 2, size * 4, size * 4);
        ctx.restore();
        break;
      }
      case 'confetti': {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        const sy = Math.cos(p.flip);
        ctx.scale(1, Math.max(0.06, Math.abs(sy)));
        // Back face is the same paper in shadow, not a different colour —
        // that is what sells the flip as rotation rather than a blink.
        ctx.fillStyle = sy > 0 ? p.color : darken(p.color2);
        ctx.fillRect(-size, -size * 1.4, size * 2, size * 2.8);
        ctx.restore();
        break;
      }
      case 'streak': {
        const len = Math.max(size * 2, Math.hypot(p.vx, p.vy) * 0.022 * p.stretch);
        const ang = Math.atan2(p.vy, p.vx);
        const tex = streakTex(p.color);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(ang);
        ctx.drawImage(tex, -len, -size, len + size, size * 2);
        ctx.restore();
        break;
      }
    }
    ctx.globalAlpha = 1;
  }
}
