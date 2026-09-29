import { rand } from '../core/rng';
import bgUrl from '../assets/bg.webp';

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

  /**
   * The painted backdrop. Everything else in here (rays, stars, bokeh,
   * vignette) is still drawn live on top of it — a static image alone reads
   * as a dead wallpaper, and the moving layers are what sell it as a place.
   *
   * Until it decodes we fall back to `base`, the procedural gradient that
   * used to be the whole background. That also covers the case where the
   * canvas is a wildly different aspect ratio to the artwork.
   */
  private photo: HTMLImageElement | null = null;
  private base: HTMLCanvasElement | null = null;
  private vignette: HTMLCanvasElement | null = null;
  private rays: HTMLCanvasElement | null = null;
  private starTex: HTMLCanvasElement | null = null;
  private stars: { x: number; y: number; r: number; phase: number; rate: number }[] = [];

  constructor() {
    const img = new Image();
    img.decoding = 'async';
    img.src = bgUrl;
    img.onload = () => {
      this.photo = img;
    };
  }

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
    g.addColorStop(0, '#36166b');
    g.addColorStop(0.3, '#251050');
    g.addColorStop(0.62, '#180b36');
    g.addColorStop(1, '#0b0519');
    bc.fillStyle = g;
    bc.fillRect(0, 0, bw, bh);
    // A cool counter-tint low-left keeps the wash from being one flat hue.
    const cool = bc.createRadialGradient(bw * 0.15, bh * 0.92, 0, bw * 0.15, bh * 0.92, bw * 0.9);
    cool.addColorStop(0, 'rgba(24,90,150,0.3)');
    cool.addColorStop(1, 'rgba(24,90,150,0)');
    bc.fillStyle = cool;
    bc.fillRect(0, 0, bw, bh);
    // Fold the aurora sweep and the stage light straight into the base. Both
    // are effectively static, and every separate full-screen 'lighter' blend
    // was costing more than the animation was worth. The rays, stars and
    // blobs still move, which is plenty of life.
    bc.save();
    bc.globalCompositeOperation = 'lighter';
    const sweepB = bc.createLinearGradient(0, bh * 0.1, bw, bh * 0.9);
    sweepB.addColorStop(0, 'rgba(255,80,170,0.5)');
    sweepB.addColorStop(0.5, 'rgba(120,90,255,0.42)');
    sweepB.addColorStop(1, 'rgba(60,200,255,0.34)');
    bc.globalAlpha = 0.21;
    bc.fillStyle = sweepB;
    bc.fillRect(0, 0, bw, bh);

    bc.globalAlpha = 0.55;
    const pool = bc.createRadialGradient(bw / 2, bh * 0.46, 0, bw / 2, bh * 0.46, bw * 0.78);
    pool.addColorStop(0, 'rgba(180,120,255,0.5)');
    pool.addColorStop(0.45, 'rgba(130,80,220,0.22)');
    pool.addColorStop(1, 'rgba(90,50,180,0)');
    bc.fillStyle = pool;
    bc.fillRect(0, 0, bw, bh);
    bc.restore();
    this.base = base;


    // Light rays: soft diagonal shafts, baked once and panned. Drawn twice at
    // different speeds and alphas so the motion never looks like a loop.
    const rw = 256;
    const rh = 256;
    const ry = document.createElement('canvas');
    ry.width = rw;
    ry.height = rh;
    const ryc = ry.getContext('2d')!;
    ryc.translate(rw / 2, rh / 2);
    ryc.rotate(-0.42);
    for (let i = 0; i < 9; i++) {
      const x = -rw * 0.75 + i * (rw * 0.19);
      const wdt = rw * (0.012 + (i % 3) * 0.016);
      const lg = ryc.createLinearGradient(x, -rh, x, rh);
      lg.addColorStop(0, 'rgba(255,225,255,0)');
      lg.addColorStop(0.45, `rgba(255,220,255,${0.05 + (i % 4) * 0.018})`);
      lg.addColorStop(1, 'rgba(180,200,255,0)');
      ryc.fillStyle = lg;
      ryc.fillRect(x - wdt, -rh, wdt * 2, rh * 2);
    }
    this.rays = ry;

    // Twinkle texture: one tiny 4-point sparkle, reused for every star.
    const st = document.createElement('canvas');
    st.width = 32;
    st.height = 32;
    const stc = st.getContext('2d')!;
    const sgrad = stc.createRadialGradient(16, 16, 0, 16, 16, 16);
    sgrad.addColorStop(0, 'rgba(255,255,255,1)');
    sgrad.addColorStop(0.25, 'rgba(220,225,255,0.5)');
    sgrad.addColorStop(1, 'rgba(180,200,255,0)');
    stc.fillStyle = sgrad;
    stc.fillRect(0, 0, 32, 32);
    this.starTex = st;

    this.stars = [];
    const count = Math.round((w * h) / 26000);
    for (let i = 0; i < count; i++) {
      this.stars.push({
        x: rand(0, w),
        y: rand(0, h),
        r: rand(0.9, 2.6),
        phase: rand(0, Math.PI * 2),
        rate: rand(0.5, 1.9),
      });
    }


    const vig = document.createElement('canvas');
    vig.width = 256;
    vig.height = 256;
    const vc = vig.getContext('2d')!;
    const v = vc.createRadialGradient(128, 112, 44, 128, 128, 196);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(0.55, 'rgba(6,2,16,0.2)');
    v.addColorStop(1, 'rgba(4,1,12,0.72)');
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
    // The procedural wash always goes down first: it is the fallback before
    // the artwork decodes, and it fills the letterbox if the viewport is a
    // very different shape to the painting.
    if (this.base) ctx.drawImage(this.base, 0, 0, w, h);

    if (this.photo) {
      // Cover fit, anchored slightly low so the candy hills along the bottom
      // of the painting stay in frame on short screens — that horizon is the
      // most interesting part of it.
      const iw = this.photo.naturalWidth;
      const ih = this.photo.naturalHeight;
      const scale = Math.max(w / iw, h / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      ctx.drawImage(this.photo, (w - dw) / 2, (h - dh) * 0.62, dw, dh);
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // The aurora sweep and the stage-light pool are pre-composited into the
    // base layer during bake(). They barely move, and each separate
    // full-screen 'lighter' blend cost more than the animation was worth.

    // One panning ray layer. A second offset copy read marginally richer and
    // cost another full-screen blend, so it went.
    if (this.rays) {
      const rw = w * 1.9;
      const rh = h * 1.05;
      // Low: the painting already has shafts baked into it. These exist only
      // to make that light appear to drift.
      ctx.globalAlpha = 0.28;
      ctx.drawImage(this.rays, -((this.t * 6) % rw) - w * 0.3, -h * 0.16, rw, rh);
    }

    // Twinkling stars.
    if (this.starTex) {
      for (const st of this.stars) {
        const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.t * st.rate + st.phase));
        ctx.globalAlpha = tw * 0.75;
        const rr = st.r * (0.8 + tw * 0.5);
        ctx.drawImage(this.starTex, st.x - rr, st.y - rr, rr * 2, rr * 2);
      }
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
