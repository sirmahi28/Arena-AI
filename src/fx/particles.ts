import { rand, randInt, clamp } from '../core/rng';

export type ParticleShape = 'spark' | 'shard' | 'ring' | 'star' | 'confetti' | 'smoke' | 'streak';

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

function glowTex(color: string): HTMLCanvasElement {
  let cv = glowCache.get(color);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = cv.height = TEX;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(TEX / 2, TEX / 2, 0, TEX / 2, TEX / 2, TEX / 2);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, TEX, TEX);
  glowCache.set(color, cv);
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
  const g = c.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.65, color);
  g.addColorStop(1, '#ffffff');
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
    const fade = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
    const a = clamp(fade, 0, 1) * p.alpha;
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
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        const w = size;
        const h = size * 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -h);
        ctx.lineTo(w, 0);
        ctx.lineTo(0, h);
        ctx.lineTo(-w, 0);
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
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(0.5, p.thickness * (1 - t));
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, TAU);
        ctx.stroke();
        break;
      }
      case 'confetti': {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        const sy = Math.cos(p.flip);
        ctx.scale(1, Math.max(0.06, Math.abs(sy)));
        ctx.fillStyle = sy > 0 ? p.color : p.color2;
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
