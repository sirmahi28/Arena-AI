/**
 * A cheap light-bloom pass.
 *
 * Everything that should glow is drawn a second time into a small offscreen
 * buffer, which is then scaled back up over the frame with `lighter`. The
 * upscale *is* the blur — the browser's bilinear filtering does the work for
 * free, which is the only reason this is affordable in Canvas 2D. A real
 * separable gaussian would cost several full-resolution passes and buy very
 * little at these sizes.
 *
 * Two buffers at different scales are composited together: a tight one for the
 * hot core and a very coarse one for the wide atmospheric halo. Stacking two
 * radii is what stops the result looking like a uniform smear.
 */
export class BloomPass {
  private core: HTMLCanvasElement;
  private coreCtx: CanvasRenderingContext2D;
  private halo: HTMLCanvasElement;
  private haloCtx: CanvasRenderingContext2D;

  /** Divisors applied to the CSS-pixel frame size. */
  private static readonly CORE_DIV = 4;
  private static readonly HALO_DIV = 10;

  private w = 0;
  private h = 0;
  /** 2 = core + halo, 1 = core only, 0 = off. */
  private tier = 2;

  constructor() {
    this.core = document.createElement('canvas');
    this.coreCtx = this.core.getContext('2d')!;
    this.halo = document.createElement('canvas');
    this.haloCtx = this.halo.getContext('2d')!;
  }

  /**
   * Degrade rather than drop frames: 2 = core + wide halo, 1 = core only,
   * 0 = off entirely. Driven by the same rolling frame average that scales
   * particle counts.
   */
  setTier(tier: number): void {
    this.tier = tier;
  }

  get active(): boolean {
    return this.tier > 0;
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.core.width = Math.max(1, Math.round(w / BloomPass.CORE_DIV));
    this.core.height = Math.max(1, Math.round(h / BloomPass.CORE_DIV));
    this.halo.width = Math.max(1, Math.round(w / BloomPass.HALO_DIV));
    this.halo.height = Math.max(1, Math.round(h / BloomPass.HALO_DIV));
  }

  /**
   * Clear both buffers and hand back contexts already scaled into CSS-pixel
   * space, so callers can draw with the same coordinates they use on screen.
   * `worldTransform` should replay whatever transform the main context is
   * under (screen shake), so the glow lands on top of what produced it.
   */
  begin(worldTransform?: (c: CanvasRenderingContext2D) => void): CanvasRenderingContext2D[] {
    const out: CanvasRenderingContext2D[] = [];
    const buffers =
      this.tier >= 2
        ? ([
            [this.coreCtx, BloomPass.CORE_DIV],
            [this.haloCtx, BloomPass.HALO_DIV],
          ] as const)
        : ([[this.coreCtx, BloomPass.CORE_DIV]] as const);
    for (const [ctx, div] of buffers) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.setTransform(1 / div, 0, 0, 1 / div, 0, 0);
      if (worldTransform) worldTransform(ctx);
      ctx.globalCompositeOperation = 'lighter';
      out.push(ctx);
    }
    return out;
  }

  /** Add the blurred buffers back over the frame. */
  composite(dst: CanvasRenderingContext2D, coreStrength = 0.85, haloStrength = 0.55): void {
    if (this.tier <= 0) return;
    dst.save();
    dst.globalCompositeOperation = 'lighter';
    dst.imageSmoothingEnabled = true;
    dst.imageSmoothingQuality = 'low';
    if (this.tier >= 2) {
      dst.globalAlpha = haloStrength;
      dst.drawImage(this.halo, 0, 0, this.w, this.h);
    }
    dst.globalAlpha = coreStrength;
    dst.drawImage(this.core, 0, 0, this.w, this.h);
    dst.restore();
  }
}
