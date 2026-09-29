import { rand } from '../core/rng';

interface Blob {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  tex: HTMLCanvasElement;
  a: number;
  phase: number;
}

const BOKEH_TEX = 128;
const bokehCache = new Map<number, HTMLCanvasElement>();

function bokehTex(hue: number): HTMLCanvasElement {
  const key = Math.round(hue / 30) * 30;
  let cv = bokehCache.get(key);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = cv.height = BOKEH_TEX;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(
    BOKEH_TEX / 2,
    BOKEH_TEX / 2,
    0,
    BOKEH_TEX / 2,
    BOKEH_TEX / 2,
    BOKEH_TEX / 2,
  );
  g.addColorStop(0, `hsla(${key}, 90%, 70%, 1)`);
  g.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
  c.fillStyle = g;
  c.fillRect(0, 0, BOKEH_TEX, BOKEH_TEX);
  bokehCache.set(key, cv);
  return cv;
}

/**
 * Animated candy-shop backdrop.
 *
 * Performance note: the gradient work (base wash, aurora, vignette) is baked
 * into offscreen canvases once per resize and blitted afterwards. Rebuilding
 * `createLinearGradient`/`createRadialGradient` and filling the full screen
 * five times per frame was costing ~20ms/frame on its own.
 */
export class Background {
  private blobs: Blob[] = [];
  private t = 0;
  private w = 0;
  private h = 0;

  private base: HTMLCanvasElement | null = null;
  private aurora: HTMLCanvasElement | null = null;
  private vignette: HTMLCanvasElement | null = null;

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.bake(w, h);

    const count = Math.round(Math.min(14, Math.max(7, (w * h) / 46000)));
    this.blobs = [];
    for (let i = 0; i < count; i++) {
      this.blobs.push({
        x: rand(0, w),
        y: rand(0, h),
        r: rand(w * 0.12, w * 0.36),
        vx: rand(-9, 9),
        vy: rand(-14, -3),
        tex: bokehTex(rand(0, 360)),
        a: rand(0.06, 0.16),
        phase: rand(0, Math.PI * 2),
      });
    }
  }

  private bake(w: number, h: number): void {
    // Low-res layers are fine: they are all smooth gradients, and scaling a
    // 1/4-size canvas up is visually identical but four times cheaper to make.
    const bw = Math.max(2, Math.round(w / 2));
    const bh = Math.max(2, Math.round(h / 2));

    const base = document.createElement('canvas');
    base.width = bw;
    base.height = bh;
    const bc = base.getContext('2d')!;
    const g = bc.createLinearGradient(0, 0, 0, bh);
    g.addColorStop(0, '#2b1155');
    g.addColorStop(0.45, '#1d0d3c');
    g.addColorStop(1, '#0f0722');
    bc.fillStyle = g;
    bc.fillRect(0, 0, bw, bh);
    this.base = base;

    const aur = document.createElement('canvas');
    aur.width = bw;
    aur.height = bh;
    const ac = aur.getContext('2d')!;
    const sweep = ac.createLinearGradient(0, bh * 0.1, bw, bh * 0.9);
    sweep.addColorStop(0, 'rgba(255,80,170,0.5)');
    sweep.addColorStop(0.5, 'rgba(120,90,255,0.42)');
    sweep.addColorStop(1, 'rgba(60,200,255,0.34)');
    ac.fillStyle = sweep;
    ac.fillRect(0, 0, bw, bh);
    this.aurora = aur;

    const vig = document.createElement('canvas');
    vig.width = 256;
    vig.height = 256;
    const vc = vig.getContext('2d')!;
    const v = vc.createRadialGradient(128, 116, 60, 128, 128, 190);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.58)');
    vc.fillStyle = v;
    vc.fillRect(0, 0, 256, 256);
    this.vignette = vig;
  }

  update(dt: number): void {
    this.t += dt;
    for (const b of this.blobs) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.phase += dt * 0.5;
      if (b.y + b.r < -40) {
        b.y = this.h + b.r;
        b.x = rand(0, this.w);
      }
      if (b.x < -b.r) b.x = this.w + b.r;
      if (b.x > this.w + b.r) b.x = -b.r;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const { w, h } = this;
    if (this.base) ctx.drawImage(this.base, 0, 0, w, h);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    if (this.aurora) {
      ctx.globalAlpha = 0.16 + 0.1 * Math.sin(this.t * 0.22);
      ctx.drawImage(this.aurora, 0, 0, w, h);
    }

    for (const b of this.blobs) {
      const rr = b.r * (1 + Math.sin(b.phase) * 0.08);
      ctx.globalAlpha = b.a;
      ctx.drawImage(b.tex, b.x - rr, b.y - rr, rr * 2, rr * 2);
    }
    ctx.restore();

    if (this.vignette) {
      ctx.drawImage(this.vignette, 0, 0, w, h);
    }
  }
}
