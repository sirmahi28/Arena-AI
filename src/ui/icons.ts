/**
 * Vector icons, rendered with a 3D treatment.
 *
 * Emoji were the obvious shortcut and a bad one: they render as tofu boxes
 * without an emoji font and their metrics vary wildly between platforms.
 *
 * The first version of these was flat white strokes, which was worse than it
 * sounds. Every other thing on screen — candies, buttons, the logo — has a
 * light source coming from the upper left and a visible sense of thickness,
 * so flat glyphs read as placeholder art sitting on top of a finished game.
 *
 * The fix is structural rather than per-icon. Each icon here defines nothing
 * but geometry, using whatever fill and stroke the caller has set, and
 * `drawIcon` renders that geometry four times: a drop shadow, a dark
 * extrusion offset downward, the lit face, and a top-edge catchlight. Add an
 * icon and it gets the treatment for free; change the lighting once and
 * every icon follows.
 */

export type IconId =
  | 'sound-on'
  | 'sound-off'
  | 'restart'
  | 'shuffle'
  | 'hammer'
  | 'bulb'
  | 'play'
  | 'next';

const TAU = Math.PI * 2;

/**
 * Per-icon tint, as [upper, lower].
 *
 * These started out near-white at both ends, which defeated the whole
 * exercise: the face ramp reached the upper tint within a third of the
 * height, so every icon rendered as a white glyph with a coloured sliver
 * along the bottom and no readable form. The upper stop has to be a real
 * colour and the lower one genuinely dark, or there is no bevel to see.
 *
 * The two chrome icons stay neutral on purpose — they are controls, not
 * toys, and colouring them would pull attention off the board.
 */
const TINT: Record<IconId, [string, string]> = {
  'sound-on': ['#e8ecff', '#7b85c0'],
  'sound-off': ['#e8ecff', '#7b85c0'],
  restart: ['#e8ecff', '#7b85c0'],
  shuffle: ['#93e9ff', '#1d7cb5'],
  hammer: ['#ffd98d', '#b0661a'],
  bulb: ['#ffef94', '#cf9105'],
  play: ['#eaffe8', '#63a86a'],
  next: ['#eaffe8', '#63a86a'],
};

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * t);
  const g = Math.round(((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * t);
  const bl = Math.round((pa & 255) + ((pb & 255) - (pa & 255)) * t);
  return `rgb(${r},${g},${bl})`;
}

/**
 * Pure geometry. No colours are set in here — the renderer below decides
 * those, and calls this several times with different ones.
 */
function trace(ctx: CanvasRenderingContext2D, id: IconId, s: number): void {
  switch (id) {
    case 'sound-on':
    case 'sound-off': {
      const k = s * 0.5;
      ctx.beginPath();
      ctx.moveTo(-k * 0.85, -k * 0.35);
      ctx.lineTo(-k * 0.35, -k * 0.35);
      ctx.lineTo(0.05 * k, -k * 0.85);
      ctx.lineTo(0.05 * k, k * 0.85);
      ctx.lineTo(-k * 0.35, k * 0.35);
      ctx.lineTo(-k * 0.85, k * 0.35);
      ctx.closePath();
      ctx.fill();

      if (id === 'sound-on') {
        for (let i = 1; i <= 2; i++) {
          ctx.beginPath();
          ctx.arc(k * 0.15, 0, k * (0.28 + i * 0.3), -0.85, 0.85);
          ctx.stroke();
        }
      } else {
        ctx.beginPath();
        ctx.moveTo(k * 0.38, -k * 0.38);
        ctx.lineTo(k * 0.95, k * 0.38);
        ctx.moveTo(k * 0.95, -k * 0.38);
        ctx.lineTo(k * 0.38, k * 0.38);
        ctx.stroke();
      }
      break;
    }

    case 'restart': {
      const r = s * 0.36;
      ctx.beginPath();
      ctx.arc(0, 0, r, -Math.PI * 0.35, Math.PI * 1.45);
      ctx.stroke();
      const a = -Math.PI * 0.35;
      const hx = Math.cos(a) * r;
      const hy = Math.sin(a) * r;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx - s * 0.05, hy - s * 0.26);
      ctx.lineTo(hx + s * 0.22, hy - s * 0.12);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case 'shuffle': {
      const k = s * 0.42;
      const arrow = (flip: number) => {
        ctx.beginPath();
        ctx.moveTo(-k, flip * k * 0.55);
        ctx.lineTo(-k * 0.3, flip * k * 0.55);
        ctx.quadraticCurveTo(0, flip * k * 0.55, k * 0.3, -flip * k * 0.55);
        ctx.lineTo(k * 0.72, -flip * k * 0.55);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(k * 0.98, -flip * k * 0.55);
        ctx.lineTo(k * 0.5, -flip * k * 0.55 - k * 0.32);
        ctx.lineTo(k * 0.5, -flip * k * 0.55 + k * 0.32);
        ctx.closePath();
        ctx.fill();
      };
      arrow(1);
      arrow(-1);
      break;
    }

    case 'hammer': {
      const k = s * 0.46;
      ctx.save();
      ctx.rotate(-0.5);
      ctx.beginPath();
      ctx.lineWidth = s * 0.16;
      ctx.moveTo(0, -k * 0.1);
      ctx.lineTo(0, k);
      ctx.stroke();
      ctx.beginPath();
      const hw = k * 0.86;
      const hh = k * 0.42;
      // Slight taper and rounded corners: a plain rectangle reads as a
      // placeholder no matter how well it is lit.
      ctx.moveTo(-hw, -k * 0.95 + hh * 0.3);
      ctx.quadraticCurveTo(-hw, -k * 0.95, -hw + hh * 0.3, -k * 0.95);
      ctx.lineTo(hw - hh * 0.3, -k * 0.95);
      ctx.quadraticCurveTo(hw, -k * 0.95, hw, -k * 0.95 + hh * 0.3);
      ctx.lineTo(hw * 0.8, -k * 0.95 + hh * 1.6);
      ctx.lineTo(-hw * 0.8, -k * 0.95 + hh * 1.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;
    }

    case 'bulb': {
      const k = s * 0.4;
      ctx.beginPath();
      ctx.arc(0, -k * 0.25, k * 0.6, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect?.(-k * 0.3, k * 0.28, k * 0.6, k * 0.2, k * 0.08);
      if (!ctx.roundRect) ctx.rect(-k * 0.3, k * 0.28, k * 0.6, k * 0.2);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect?.(-k * 0.22, k * 0.56, k * 0.44, k * 0.18, k * 0.07);
      if (!ctx.roundRect) ctx.rect(-k * 0.22, k * 0.56, k * 0.44, k * 0.18);
      ctx.fill();
      ctx.lineWidth = Math.max(1.4, s * 0.085);
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI + (i / 4) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * k * 0.88, -k * 0.25 + Math.sin(a) * k * 0.88);
        ctx.lineTo(Math.cos(a) * k * 1.2, -k * 0.25 + Math.sin(a) * k * 1.2);
        ctx.stroke();
      }
      break;
    }

    case 'play': {
      const k = s * 0.44;
      ctx.beginPath();
      ctx.moveTo(-k * 0.6, -k);
      ctx.lineTo(k * 0.92, 0);
      ctx.lineTo(-k * 0.6, k);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case 'next': {
      const k = s * 0.4;
      for (const dx of [-k * 0.45, k * 0.45]) {
        ctx.beginPath();
        ctx.moveTo(dx - k * 0.32, -k * 0.78);
        ctx.lineTo(dx + k * 0.5, 0);
        ctx.lineTo(dx - k * 0.32, k * 0.78);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
  }
}

/**
 * Baked icon bitmaps, keyed by id + size + tint.
 *
 * The 3D treatment traces each icon's geometry four times and blurs the
 * shadow pass, which measured at 380 ms a frame when it ran live — a five-
 * fold regression, because the HUD and footer redraw seven icons every
 * frame and `ctx.filter` is brutally slow on a software rasteriser.
 *
 * None of that work depends on anything that changes between frames, so it
 * happens once per distinct icon and the frame itself does a single blit.
 * That ends up *cheaper* than the flat stroked version it replaced, which
 * was re-tracing its paths every frame for a worse result.
 */
const bakeCache = new Map<string, HTMLCanvasElement>();

function bake(id: IconId, s: number, color: string | undefined, dpr: number): HTMLCanvasElement {
  // Generous margin: the extrusion and its shadow both sit below the glyph,
  // and the bulb's rays reach past its nominal size.
  const pad = s * 1.7;
  const cv = document.createElement('canvas');
  cv.width = cv.height = Math.ceil(pad * dpr);
  const ctx = cv.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.translate(pad / 2, pad / 2);
  paint(ctx, id, s, color);
  return cv;
}

export function drawIcon(
  ctx: CanvasRenderingContext2D,
  id: IconId,
  s: number,
  color?: string,
): void {
  const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  // Quantised so a pixel of layout drift cannot spawn a new bitmap.
  const q = Math.round(s * 2) / 2;
  const key = `${id}|${q}|${color ?? ''}|${dpr}`;
  let cv = bakeCache.get(key);
  if (!cv) {
    cv = bake(id, q, color, dpr);
    bakeCache.set(key, cv);
  }
  const w = cv.width / dpr;
  ctx.drawImage(cv, -w / 2, -w / 2, w, w);
}

/** The actual 3D render. Runs once per cache entry, never per frame. */
function paint(
  ctx: CanvasRenderingContext2D,
  id: IconId,
  s: number,
  color?: string,
): void {
  const [hi, lo] = color ? [color, mix(color, '#20143a', 0.55)] : TINT[id];
  const depth = Math.max(1, s * 0.07);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const lw = Math.max(1.5, s * 0.12);

  // 1. Contact shadow. Soft and low so the icon sits *on* the button face.
  //    Only affordable at all because this is baked once, not per frame.
  ctx.save();
  ctx.translate(0, depth * 1.8);
  ctx.globalAlpha = 0.26;
  ctx.filter = 'blur(2px)';
  ctx.fillStyle = '#130820';
  ctx.strokeStyle = '#130820';
  ctx.lineWidth = lw;
  trace(ctx, id, s);
  ctx.restore();

  // 2. Extrusion: the side wall. It has to be a much darker version of the
  //    icon's *own* colour. The first attempt mixed it toward purple, which
  //    at icon size read as a blue ghost copy offset a pixel down — like a
  //    misregistered print rather than thickness.
  ctx.save();
  ctx.translate(0, depth);
  const wall = mix(lo, '#000000', 0.55);
  ctx.fillStyle = wall;
  ctx.strokeStyle = wall;
  ctx.lineWidth = lw;
  trace(ctx, id, s);
  ctx.restore();

  // 3. Lit face. The white stop is a narrow specular band at the very top
  //    rather than a third of the glyph, so the tint underneath survives.
  const g = ctx.createLinearGradient(0, -s * 0.5, 0, s * 0.5);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.14, hi);
  g.addColorStop(0.62, mix(hi, lo, 0.55));
  g.addColorStop(1, lo);
  ctx.save();
  ctx.fillStyle = g;
  ctx.strokeStyle = g;
  ctx.lineWidth = lw;
  trace(ctx, id, s);
  ctx.restore();

  // 4. Catchlight along the top edge only. Clipping to the upper third and
  //    over-drawing in white gives a bevel without a second set of paths.
  ctx.save();
  ctx.beginPath();
  ctx.rect(-s, -s, s * 2, s * 0.5);
  ctx.clip();
  ctx.globalAlpha = 0.42;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = lw * 0.42;
  trace(ctx, id, s);
  ctx.restore();

  ctx.restore();
}
