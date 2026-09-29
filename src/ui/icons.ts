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

import atlasUrl from '../assets/icon-atlas.webp';

/*
 * The icons ship as artwork now, not as shaded vector paths.
 *
 * The vector version below is still here and still runs — it is what draws
 * the HUD for the ~100ms before the atlas decodes — but it is no longer what
 * players see, and the reason is worth writing down because the code looked
 * completely reasonable.
 *
 * Every technique that makes a vector glyph read as a solid object needs
 * pixels to land in: a swept side wall, an upper-left gloss, ambient
 * occlusion at the bottom, a rim light along the top. Those were all
 * implemented and all correct. They were also being asked to fit inside a
 * **33 CSS pixel** icon, where each of them occupies two or three pixels and
 * averages straight back out into a flat coloured shape. Rendered at 256px
 * the same code looks genuinely three-dimensional; at the size the game
 * actually draws it, it looks like a sticker. That gap is the whole lesson —
 * judge icon shading at the size it ships, never at the size you author it.
 *
 * Rendering once at 192px and downscaling keeps all of the shading, costs
 * 41 KB, and turns out to be *cheaper* per frame than the baked vector path
 * it replaces: one `drawImage` against a decoded bitmap, no cache at all.
 */
let atlas: HTMLImageElement | null = null;
{
  const img = new Image();
  img.decoding = 'async';
  img.src = atlasUrl;
  img.onload = () => {
    atlas = img;
  };
}

/** Cell size and grid of `src/assets/icon-atlas.webp`. */
const ATLAS_CELL = 192;
const ATLAS_COLS = 4;

/** Atlas cell index per icon, in the order `tools/build-art.mjs` packs them. */
const ATLAS_INDEX: Record<string, number> = {
  hammer: 0,
  shuffle: 1,
  bulb: 2,
  restart: 3,
  'sound-on': 4,
  'sound-off': 5,
  play: 6,
  next: 7,
};

/**
 * How much bigger than `s` the atlas cell is blitted.
 *
 * Each icon is normalised to ~0.9 of its cell by the build, so blitting the
 * cell at exactly `s` would render the icon itself at ~0.9s and every button
 * would quietly lose a tenth of its icon in the switch from vectors. 1.18
 * lands them a touch *larger* than the old paths, which is what the art is
 * for.
 */
const ATLAS_SCALE = 1.18;

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
  // Every filled path is also stroked with a round-joined pen. That single
  // change is what separates "vector glyph" from "moulded object": corners
  // gain a real radius, thin necks thicken, and the silhouette stops having
  // the mathematically sharp points that read as flat no matter how well the
  // face is lit. Icons that want a chunkier or finer pen override lineWidth.
  const solid = () => {
    ctx.fill();
    ctx.stroke();
  };
  ctx.lineWidth = Math.max(1.5, s * 0.1);
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
      solid();

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
      solid();
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
        solid();
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
      solid();
      ctx.restore();
      break;
    }

    case 'bulb': {
      const k = s * 0.4;
      ctx.beginPath();
      ctx.arc(0, -k * 0.25, k * 0.6, 0, TAU);
      solid();
      ctx.beginPath();
      ctx.roundRect?.(-k * 0.3, k * 0.28, k * 0.6, k * 0.2, k * 0.08);
      if (!ctx.roundRect) ctx.rect(-k * 0.3, k * 0.28, k * 0.6, k * 0.2);
      solid();
      ctx.beginPath();
      ctx.roundRect?.(-k * 0.22, k * 0.56, k * 0.44, k * 0.18, k * 0.07);
      if (!ctx.roundRect) ctx.rect(-k * 0.22, k * 0.56, k * 0.44, k * 0.18);
      solid();
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
      solid();
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
        solid();
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

/**
 * Draw an icon centred on the current origin, `s` CSS pixels across.
 *
 * `color` only affects the vector fallback; the atlas art carries its own
 * colour. The parameter stays because callers may still pass one and a
 * silently-ignored tint is far better than a compile break for a path that
 * is only live for the first few frames.
 */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  id: IconId,
  s: number,
  color?: string,
): void {
  const cell = ATLAS_INDEX[id];
  if (atlas && cell !== undefined) {
    const d = s * ATLAS_SCALE;
    ctx.drawImage(
      atlas,
      (cell % ATLAS_COLS) * ATLAS_CELL,
      Math.floor(cell / ATLAS_COLS) * ATLAS_CELL,
      ATLAS_CELL,
      ATLAS_CELL,
      -d / 2,
      -d / 2,
      d,
      d,
    );
    return;
  }

  // Fallback: the shaded vector path, baked once per size/tint.
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

/**
 * The actual 3D render. Runs once per cache entry, never per frame.
 *
 * The earlier version stamped the glyph three times — shadow, one offset
 * extrusion, face — which gives a *bevel*, not a form. At icon size a single
 * offset copy reads as a hard step: you can see the exact pixel where the
 * side wall stops and the face begins, and the result looks like letterpress
 * rather than like an object.
 *
 * Smoothness comes from sweeping the extrusion instead of stepping it. The
 * wall is drawn as a stack of copies from `depth` up to 0, each one a shade
 * lighter, so the side turns continuously into the face with no visible
 * seam. On top of that goes a soft upper-left gloss and a bottom ambient
 * occlusion, both composited `source-atop` so they can only ever land on the
 * icon itself. None of this could run per frame; all of it is free once baked.
 */
function paint(
  ctx: CanvasRenderingContext2D,
  id: IconId,
  s: number,
  color?: string,
): void {
  const [hi, lo] = color ? [color, mix(color, '#20143a', 0.55)] : TINT[id];
  const depth = Math.max(1.5, s * 0.085);
  const lw = Math.max(1.5, s * 0.12);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1. Contact shadow. Soft, low and slightly wide, so the icon sits *on*
  //    the surface instead of floating over it.
  ctx.save();
  ctx.translate(0, depth * 2.1);
  ctx.globalAlpha = 0.3;
  ctx.filter = 'blur(2.5px)';
  ctx.fillStyle = '#120720';
  ctx.strokeStyle = '#120720';
  ctx.lineWidth = lw;
  trace(ctx, id, s);
  ctx.restore();

  // 2. Swept side wall. Bottom of the sweep is nearly black, the top meets
  //    the darkest stop of the face gradient, so wall and face join without
  //    a seam. Step count follows depth: enough copies that consecutive
  //    offsets are under a pixel apart.
  const deep = mix(lo, '#000000', 0.62);
  const steps = Math.max(4, Math.ceil(depth * 2.2));
  ctx.save();
  ctx.lineWidth = lw;
  for (let i = steps; i >= 1; i--) {
    const k = i / steps;
    const c = mix(lo, deep, k);
    ctx.save();
    ctx.translate(0, depth * k);
    ctx.fillStyle = c;
    ctx.strokeStyle = c;
    trace(ctx, id, s);
    ctx.restore();
  }
  ctx.restore();

  // 3. Lit face. The white stop stays a narrow specular band at the very
  //    top; letting it reach a third of the way down washes the tint out
  //    completely and the icon goes back to looking white.
  const g = ctx.createLinearGradient(0, -s * 0.52, 0, s * 0.52);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.16, hi);
  g.addColorStop(0.58, mix(hi, lo, 0.5));
  g.addColorStop(1, lo);
  ctx.save();
  ctx.fillStyle = g;
  ctx.strokeStyle = g;
  ctx.lineWidth = lw;
  trace(ctx, id, s);
  ctx.restore();

  // 4. Gloss and occlusion, both clipped to what is already painted.
  //    `source-atop` is doing the clipping, which means no second set of
  //    paths and no clip region to get wrong.
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';

  // Upper-left sheen: the highlight every other surface in the game has.
  const gloss = ctx.createRadialGradient(
    -s * 0.22,
    -s * 0.34,
    s * 0.02,
    -s * 0.22,
    -s * 0.34,
    s * 0.78,
  );
  gloss.addColorStop(0, 'rgba(255,255,255,0.62)');
  gloss.addColorStop(0.45, 'rgba(255,255,255,0.16)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(-s, -s, s * 2, s * 2);

  // Ambient occlusion along the bottom, so the form turns away from the
  // light rather than ending flat.
  const ao = ctx.createLinearGradient(0, s * 0.08, 0, s * 0.6);
  ao.addColorStop(0, 'rgba(24,10,44,0)');
  ao.addColorStop(1, 'rgba(24,10,44,0.34)');
  ctx.fillStyle = ao;
  ctx.fillRect(-s, -s * 0.1, s * 2, s * 1.2);
  ctx.restore();

  // 5. Rim light along the very top edge. Thin, additive, and clipped to the
  //    upper band — it reads as the light catching a rounded edge.
  ctx.save();
  ctx.beginPath();
  ctx.rect(-s, -s, s * 2, s * 0.46);
  ctx.clip();
  ctx.globalAlpha = 0.5;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = lw * 0.34;
  trace(ctx, id, s);
  ctx.restore();

  ctx.restore();
}
