import { clamp, easeOutBack, easeOutCubic } from '../core/rng';

interface Floater {
  alive: boolean;
  text: string;
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  stroke: string;
  weight: number;
  wobble: number;
}

/** Score / combo text that pops, drifts up and fades out. */
export class Floaters {
  private pool: Floater[] = [];
  /** Screen size, so popups near the board edge stay fully readable. */
  private bounds = { w: 9999, h: 9999 };

  setBounds(w: number, h: number): void {
    this.bounds = { w, h };
  }

  constructor(capacity = 48) {
    for (let i = 0; i < capacity; i++) {
      this.pool.push({
        alive: false,
        text: '',
        x: 0,
        y: 0,
        vy: 0,
        life: 0,
        maxLife: 1,
        size: 20,
        color: '#fff',
        stroke: '#000',
        weight: 900,
        wobble: 0,
      });
    }
  }

  clear(): void {
    for (const f of this.pool) f.alive = false;
  }

  add(
    text: string,
    x: number,
    y: number,
    opts: { size?: number; color?: string; stroke?: string; life?: number; vy?: number } = {},
  ): void {
    const f = this.pool.find((p) => !p.alive) ?? this.pool[0];
    const size = opts.size ?? 22;
    f.alive = true;
    f.text = text;
    // x is clamped at render time, where the text can actually be measured.
    f.x = x;
    f.y = clamp(y, size * 0.9, Math.max(size, this.bounds.h - size));
    f.vy = opts.vy ?? -46;
    f.maxLife = opts.life ?? 0.95;
    f.life = f.maxLife;
    f.size = opts.size ?? 22;
    f.color = opts.color ?? '#ffffff';
    f.stroke = opts.stroke ?? 'rgba(25,8,45,0.85)';
    f.wobble = Math.random() * Math.PI * 2;
  }

  update(dt: number): void {
    for (const f of this.pool) {
      if (!f.alive) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.alive = false;
        continue;
      }
      f.y += f.vy * dt;
      f.vy *= Math.exp(-2.2 * dt);
      f.wobble += dt * 7;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const f of this.pool) {
      if (!f.alive) continue;
      const t = 1 - f.life / f.maxLife;
      const pop = t < 0.3 ? easeOutBack(t / 0.3, 2.6) : 1;
      const fade = t > 0.6 ? 1 - easeOutCubic((t - 0.6) / 0.4) : 1;
      const scale = pop * (1 + (t > 0.6 ? (t - 0.6) * 0.4 : 0));
      const size = f.size * scale;
      if (size < 1) continue;

      ctx.globalAlpha = clamp(fade, 0, 1);

      // Keep the popup fully on screen: measure at the *current* size
      // (it grows while popping) and clamp the centre accordingly.
      ctx.font = `${f.weight} ${size.toFixed(1)}px 'Baloo 2', 'Nunito', system-ui, sans-serif`;
      const halfW = ctx.measureText(f.text).width / 2 + size * 0.22;
      const minX = Math.min(halfW + 4, this.bounds.w / 2);
      const maxX = Math.max(this.bounds.w - halfW - 4, this.bounds.w / 2);
      ctx.translate(clamp(f.x, minX, maxX), f.y);
      ctx.rotate(Math.sin(f.wobble) * 0.035);

      ctx.lineWidth = Math.max(2, size * 0.2);
      ctx.strokeStyle = f.stroke;
      ctx.strokeText(f.text, 0, 0);

      const grad = ctx.createLinearGradient(0, -size * 0.6, 0, size * 0.6);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.55, f.color);
      grad.addColorStop(1, f.color);
      ctx.fillStyle = grad;
      ctx.fillText(f.text, 0, 0);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
