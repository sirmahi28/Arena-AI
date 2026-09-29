import { rand } from '../core/rng';

/** Trauma-based screen shake (Jonas Tyroller / GDC style) + hit-stop + flash. */
export class ScreenShake {
  private trauma = 0;
  private time = 0;
  x = 0;
  y = 0;
  rot = 0;
  zoom = 1;

  /** Frames of frozen time for impact emphasis. */
  private hitStop = 0;
  /** Full-screen colour flash. */
  private flashA = 0;
  private flashColor = '#ffffff';

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  stop(seconds: number): void {
    this.hitStop = Math.max(this.hitStop, seconds);
  }

  flash(color: string, alpha: number): void {
    if (alpha > this.flashA) {
      this.flashA = alpha;
      this.flashColor = color;
    }
  }

  /** Returns the *effective* dt after hit-stop is applied. */
  consume(dt: number): number {
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      return dt * 0.12;
    }
    return dt;
  }

  update(dt: number): void {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.9);
    const s = this.trauma * this.trauma; // quadratic feels better than linear
    const amp = 26 * s;
    // Cheap pseudo-noise: layered sines with irrational frequencies.
    this.x = amp * Math.sin(this.time * 47.3 + 1.7) * Math.sin(this.time * 13.1);
    this.y = amp * Math.sin(this.time * 39.7 + 4.2) * Math.sin(this.time * 17.9);
    this.rot = 0.035 * s * Math.sin(this.time * 33.3);
    this.zoom = 1 + 0.02 * s;
    if (s > 0.25) {
      this.x += rand(-1, 1) * amp * 0.15;
      this.y += rand(-1, 1) * amp * 0.15;
    }
    this.flashA = Math.max(0, this.flashA - dt * 3.4);
  }

  renderFlash(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (this.flashA <= 0.003) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = this.flashA;
    ctx.fillStyle = this.flashColor;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  reset(): void {
    this.trauma = 0;
    this.hitStop = 0;
    this.flashA = 0;
    this.x = this.y = this.rot = 0;
    this.zoom = 1;
  }
}
