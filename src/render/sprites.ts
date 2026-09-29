import { BOMB_COLOR, PALETTE, type ColorId, type Special } from '../core/types';
import atlasUrl from '../assets/candy-atlas.webp';

const TAU = Math.PI * 2;

/** Rounded regular polygon. */
/**
 * The candy bodies are a 3x2 sprite atlas: six shapes, six hues, one file.
 *
 * They were procedural until they weren't. Canvas gradients can fake a lit
 * surface, but they cannot do a proper lacquered edge, a luminous core and a
 * tight specular hotspot at the same time, and at 63 pieces on screen the
 * difference between "shaded" and "rendered" is the whole look of the game.
 *
 * Everything the procedural version was *good* at is still procedural: the
 * contact shadow below, and the stripe / wrapper overlays on top. So a candy
 * is still composited at runtime, it just has a painted body now.
 *
 * Layout is 3x3. Cells 0-5 are the six candy hues in the same order as
 * PALETTE and candyPath(); cell 6 is the colour bomb, which has no hue.
 *
 * `atlasGen` exists because SpriteCache memoises aggressively and the image
 * decodes asynchronously — without it, every sprite built during the first
 * few frames would be permanently cached in its fallback form.
 */
const ATLAS_COLS = 3;
const ATLAS_CELL = 256;
/** Cell 6 of the atlas is the colour bomb; it has no hue of its own. */
const ATLAS_BOMB = 6;
let atlas: HTMLImageElement | null = null;
let atlasGen = 0;
/** Mean luminance of each atlas cell's opaque pixels, measured on load. */
const cellLum: number[] = [];

/**
 * Overlay strength has to be calibrated against how bright the art actually
 * renders, and PALETTE is a poor proxy for that: these bodies are
 * translucent, so their lit cores come out far paler than the mid-tone the
 * palette samples. Driving stripe opacity off the palette bleached the orange
 * teardrop to beige.
 *
 * So measure the art. Six 8x8 downsamples, once, on load — the GPU does the
 * averaging during the downscale. Self-calibrating: redraw the atlas and the
 * overlays retune themselves.
 */
function measureAtlas(img: HTMLImageElement): void {
  const S = 8;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const c = cv.getContext('2d', { willReadFrequently: true });
  if (!c) return;
  for (let i = 0; i < 7; i++) {
    c.clearRect(0, 0, S, S);
    c.drawImage(
      img,
      (i % ATLAS_COLS) * ATLAS_CELL,
      Math.floor(i / ATLAS_COLS) * ATLAS_CELL,
      ATLAS_CELL,
      ATLAS_CELL,
      0,
      0,
      S,
      S,
    );
    const d = c.getImageData(0, 0, S, S).data;
    let sum = 0;
    let n = 0;
    for (let p = 0; p < d.length; p += 4) {
      if (d[p + 3] < 200) continue;
      sum += (0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) / 255;
      n++;
    }
    cellLum[i] = n ? sum / n : 0.5;
  }
}

{
  const img = new Image();
  img.decoding = 'async';
  img.src = atlasUrl;
  img.onload = () => {
    atlas = img;
    measureAtlas(img);
    atlasGen++;
  };
}

function blitAtlas(ctx: CanvasRenderingContext2D, index: number, r: number): void {
  ctx.drawImage(
    atlas!,
    (index % ATLAS_COLS) * ATLAS_CELL,
    Math.floor(index / ATLAS_COLS) * ATLAS_CELL,
    ATLAS_CELL,
    ATLAS_CELL,
    -r,
    -r,
    r * 2,
    r * 2,
  );
}

function roundedPoly(
  ctx: CanvasRenderingContext2D,
  sides: number,
  r: number,
  round: number,
  rotation = 0,
): void {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * TAU;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % sides];
    const mx = (p0[0] + p1[0]) / 2;
    const my = (p0[1] + p1[1]) / 2;
    if (i === 0) ctx.moveTo(mx, my);
    const p2 = pts[(i + 1) % sides];
    ctx.arcTo(p2[0], p2[1], (p2[0] + pts[(i + 2) % sides][0]) / 2, (p2[1] + pts[(i + 2) % sides][1]) / 2, round);
  }
  ctx.closePath();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function starPath(ctx: CanvasRenderingContext2D, points: number, outer: number, inner: number): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i / (points * 2)) * TAU;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function dropPath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.05);
  ctx.bezierCurveTo(r * 0.62, -r * 0.42, r, r * 0.06, r, r * 0.34);
  ctx.arc(0, r * 0.34, r, 0, Math.PI);
  ctx.bezierCurveTo(-r, r * 0.06, -r * 0.62, -r * 0.42, 0, -r * 1.05);
  ctx.closePath();
}

/** Outline of each candy family, drawn in a space where `r` is the radius. */
function candyPath(ctx: CanvasRenderingContext2D, kind: number, r: number): void {
  switch (kind % 6) {
    case 0: // strawberry jelly square
      roundRect(ctx, -r * 0.88, -r * 0.88, r * 1.76, r * 1.76, r * 0.42);
      break;
    case 1: // orange drop
      dropPath(ctx, r * 0.84);
      break;
    case 2: // lemon star
      starPath(ctx, 5, r, r * 0.52);
      break;
    case 3: // apple hexagon
      roundedPoly(ctx, 6, r * 0.97, r * 0.22, -Math.PI / 2);
      break;
    case 4: // blueberry sphere
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.93, 0, TAU);
      ctx.closePath();
      break;
    default: {
      // grape rhombus
      const k = r * 0.99;
      ctx.beginPath();
      ctx.moveTo(0, -k);
      ctx.quadraticCurveTo(k * 0.34, -k * 0.34, k, 0);
      ctx.quadraticCurveTo(k * 0.34, k * 0.34, 0, k);
      ctx.quadraticCurveTo(-k * 0.34, k * 0.34, -k, 0);
      ctx.quadraticCurveTo(-k * 0.34, -k * 0.34, 0, -k);
      ctx.closePath();
      break;
    }
  }
}

/**
 * Contact shadow, drawn *last* with `destination-over` so it lands behind the
 * finished piece. It used to be drawn first, but the special overlays now
 * clip themselves with `source-atop` — which respects whatever is already on
 * the canvas — and a shadow painted first would have caught the stripes.
 */
function drawContactShadow(ctx: CanvasRenderingContext2D, color: ColorId, r: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.translate(0, r * 0.16);
  ctx.fillStyle = 'rgba(10,3,24,0.42)';
  ctx.filter = `blur(${Math.max(1.5, r * 0.16)}px)`;
  candyPath(ctx, color, r * 0.94);
  ctx.fill();
  ctx.restore();
}

function drawBody(ctx: CanvasRenderingContext2D, color: ColorId, r: number): void {
  const [base, light, dark, spark] = PALETTE[color % PALETTE.length];

  // ------------------------------------------------------------- painted body
  if (atlas) {
    blitAtlas(ctx, color % 6, r);
    return;
  }

  // ---------------------------------------------- procedural body (fallback)
  // Still here, and still worth keeping: it is what shows for the handful of
  // frames before the atlas decodes, and it is the reference the painted art
  // was matched against.
  // Key light from the upper-left. Four stops instead of three: the extra
  // mid-tone is what stops the sphere reading as a flat disc.
  // Form comes from the *dark* end of the ramp, not from piling on white —
  // washing the midtones out just makes every candy look like pastel chalk.
  const g = ctx.createRadialGradient(-r * 0.34, -r * 0.46, r * 0.04, -r * 0.05, r * 0.2, r * 1.45);
  g.addColorStop(0, light);
  g.addColorStop(0.3, base);
  g.addColorStop(0.72, base);
  g.addColorStop(0.92, dark);
  g.addColorStop(1, shade(dark, 0.66));
  ctx.fillStyle = g;
  candyPath(ctx, color, r);
  ctx.fill();

  ctx.save();
  candyPath(ctx, color, r);
  ctx.clip();

  // Subsurface scattering: light bleeding through the translucent middle,
  // the trick that makes boiled sweets and gummies look edible.
  const sss = ctx.createRadialGradient(r * 0.1, r * 0.36, 0, r * 0.1, r * 0.36, r * 0.9);
  sss.addColorStop(0, withAlpha(light, 0.26));
  sss.addColorStop(0.6, withAlpha(base, 0.08));
  sss.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sss;
  ctx.fillRect(-r, -r, r * 2, r * 2);

  // Occlusion in the lower-right, opposite the key light.
  const occ = ctx.createRadialGradient(r * 0.58, r * 0.62, r * 0.05, r * 0.3, r * 0.4, r * 1.2);
  occ.addColorStop(0, 'rgba(18,4,38,0.42)');
  occ.addColorStop(1, 'rgba(18,4,38,0)');
  ctx.fillStyle = occ;
  ctx.fillRect(-r, -r, r * 2, r * 2);

  // Bounce light climbing the bottom edge, tinted with the candy's own hue.
  const rim = ctx.createLinearGradient(0, r * 0.35, 0, r);
  rim.addColorStop(0, 'rgba(255,255,255,0)');
  rim.addColorStop(0.75, withAlpha(light, 0.16));
  rim.addColorStop(1, withAlpha(light, 0.42));
  ctx.fillStyle = rim;
  ctx.fillRect(-r, -r, r * 2, r * 2);

  // Bevel: a bright inner lip along the top-left edge.
  ctx.globalCompositeOperation = 'source-atop';
  ctx.strokeStyle = withAlpha(spark, 0.3);
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.save();
  ctx.translate(-r * 0.045, -r * 0.055);
  candyPath(ctx, color, r * 0.985);
  ctx.stroke();
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();

  // --------------------------------------------------------------- outline
  ctx.strokeStyle = 'rgba(26,8,48,0.5)';
  ctx.lineWidth = Math.max(1, r * 0.07);
  candyPath(ctx, color, r);
  ctx.stroke();

  // ------------------------------------------------------------- highlights
  ctx.save();
  candyPath(ctx, color, r);
  ctx.clip();

  // Broad soft specular.
  const hl = ctx.createRadialGradient(-r * 0.3, -r * 0.46, 0, -r * 0.3, -r * 0.46, r * 0.66);
  hl.addColorStop(0, 'rgba(255,255,255,0.62)');
  hl.addColorStop(0.5, 'rgba(255,255,255,0.14)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl;
  ctx.beginPath();
  ctx.ellipse(-r * 0.29, -r * 0.45, r * 0.4, r * 0.29, -0.5, 0, TAU);
  ctx.fill();

  // Tight hot spot — the glassy "wet" pinpoint.
  ctx.fillStyle = 'rgba(255,255,255,0.97)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.34, -r * 0.5, r * 0.17, r * 0.12, -0.5, 0, TAU);
  ctx.fill();

  // Secondary glint low-right, from the bounce light.
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(r * 0.38, r * 0.36, r * 0.16, r * 0.09, 0.7, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** Darken a hex colour toward black by `k` (0..1 = black..unchanged). */
/** Perceptual-ish luminance, 0..1, for deciding how hard an overlay can push. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

/** Same colour, explicit alpha. */
function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function drawStripes(ctx: CanvasRenderingContext2D, color: ColorId, r: number, horizontal: boolean): void {
  const [base, , dark] = PALETTE[color % PALETTE.length];
  // White ribs read beautifully on the strawberry and hopelessly on the lemon:
  // a light candy under light stripes just turns white, and a piece you can't
  // identify by colour is a piece you can't plan a match with. So the ribs get
  // weaker as the body gets brighter, and earn their contrast from a dark
  // separator line instead of from sheer brightness.
  // Measured off the art when it loaded; PALETTE is only the fallback for the
  // few frames before that.
  const lum = cellLum[color % 6] ?? luminance(base);
  // Light ribs alone have to be near-opaque before they read, and at that
  // strength they bleach the candy. Pairing each light rib with a dark one
  // doubles the contrast for half the brightness push, so the body keeps its
  // hue. Both halves scale with luminance, in opposite directions: a pale
  // body wants less white and more shadow, a dark one the reverse.
  const peak = 0.62 - 0.46 * lum;
  const shadow = 0.22 + 0.4 * lum;
  ctx.save();
  // `source-atop` clips to the pixels already painted — which is the candy
  // itself. That matters now the body is a painted sprite: a geometric clip
  // path would no longer line up with the real silhouette, and the stripes
  // would spill past the edge.
  ctx.globalCompositeOperation = 'source-atop';

  // Wide and few. Nine thin ribs turned into mush at 52px a cell; four fat
  // ones still read as "striped" at a glance, which is the entire job.
  const band = r * 0.25;
  for (let i = -3; i <= 3; i++) {
    const o = i * band * 2.05;
    // Each band gets a cross-gradient so it reads as a raised rib rather than
    // a flat painted line, and stays translucent at the edges so the body's
    // own shading still shows through underneath.
    const grad = horizontal
      ? ctx.createLinearGradient(0, o - band, 0, o + band)
      : ctx.createLinearGradient(o - band, 0, o + band, 0);
    // Translucent on purpose: at full opacity the ribs replaced the candy
    // instead of marking it, and a striped piece stopped being recognisable
    // as the colour it still has to match against.
    grad.addColorStop(0, `rgba(255,255,255,${peak * 0.06})`);
    grad.addColorStop(0.35, `rgba(255,252,244,${peak * 0.89})`);
    grad.addColorStop(0.65, `rgba(255,255,255,${peak})`);
    grad.addColorStop(1, `rgba(255,255,255,${peak * 0.06})`);
    ctx.fillStyle = grad;
    if (horizontal) ctx.fillRect(-r * 1.2, o - band * 0.55, r * 2.4, band * 1.1);
    else ctx.fillRect(o - band * 0.55, -r * 1.2, band * 1.1, r * 2.4);

    // The dark half of the pair, sitting in the gap. This is what actually
    // makes the rib visible on a pale body.
    const od = o + band * 1.03;
    const dg = horizontal
      ? ctx.createLinearGradient(0, od - band * 0.5, 0, od + band * 0.5)
      : ctx.createLinearGradient(od - band * 0.5, 0, od + band * 0.5, 0);
    dg.addColorStop(0, withAlpha(dark, 0));
    dg.addColorStop(0.5, withAlpha(dark, shadow));
    dg.addColorStop(1, withAlpha(dark, 0));
    ctx.fillStyle = dg;
    if (horizontal) ctx.fillRect(-r * 1.2, od - band * 0.5, r * 2.4, band);
    else ctx.fillRect(od - band * 0.5, -r * 1.2, band, r * 2.4);
  }

  // Painting opaque white ribs over the body flattens the gloss that made it
  // look 3D, so put a key-light sweep back on top of the whole piece.
  const gloss = ctx.createRadialGradient(-r * 0.34, -r * 0.46, r * 0.02, -r * 0.1, -r * 0.2, r * 1.25);
  gloss.addColorStop(0, 'rgba(255,255,255,0.4)');
  gloss.addColorStop(0.45, 'rgba(255,255,255,0.08)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(-r * 1.3, -r * 1.3, r * 2.6, r * 2.6);

  // And a shade in the lower-right, or it reads as a flat sticker.
  const occ = ctx.createRadialGradient(r * 0.5, r * 0.55, r * 0.05, r * 0.25, r * 0.3, r * 1.15);
  occ.addColorStop(0, 'rgba(40,10,70,0.34)');
  occ.addColorStop(1, 'rgba(40,10,70,0)');
  ctx.fillStyle = occ;
  ctx.fillRect(-r * 1.3, -r * 1.3, r * 2.6, r * 2.6);
  ctx.restore();

  // Blast-direction arrows.
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = 'rgba(40,12,70,0.8)';
  const a = r * 0.22;
  const drawTri = (x: number, y: number, rot: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(a, 0);
    ctx.lineTo(-a * 0.6, -a * 0.72);
    ctx.lineTo(-a * 0.6, a * 0.72);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  if (horizontal) {
    drawTri(r * 0.6, 0, 0);
    drawTri(-r * 0.6, 0, Math.PI);
  } else {
    drawTri(0, r * 0.6, Math.PI / 2);
    drawTri(0, -r * 0.6, -Math.PI / 2);
  }
  ctx.restore();
}

function drawWrapped(ctx: CanvasRenderingContext2D, color: ColorId, r: number): void {
  const [, light, dark] = PALETTE[color % PALETTE.length];

  // Foil corners. These deliberately stick out past the candy, so they are
  // drawn with normal compositing rather than clipped to it — they are the
  // silhouette cue that says "wrapped" from across the board.
  ctx.save();
  const corners: Array<[number, number, number]> = [
    [-r * 0.82, -r * 0.82, -Math.PI / 4],
    [r * 0.82, -r * 0.82, -Math.PI * 0.75],
    [r * 0.82, r * 0.82, Math.PI * 0.75],
    [-r * 0.82, r * 0.82, Math.PI / 4],
  ];
  for (const [cx, cy, rot] of corners) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    // Folded foil: lit along the top fold, dark in the crease.
    const foil = ctx.createLinearGradient(0, -r * 0.34, 0, r * 0.34);
    foil.addColorStop(0, withAlpha('#ffffff', 0.78));
    foil.addColorStop(0.42, light);
    foil.addColorStop(1, shade(dark, 0.8));
    ctx.fillStyle = foil;
    ctx.strokeStyle = shade(dark, 0.55);
    ctx.lineWidth = Math.max(1, r * 0.055);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(r * 0.5, -r * 0.34);
    ctx.lineTo(r * 0.5, r * 0.34);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Crease highlight down the middle of the fold.
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = Math.max(1, r * 0.035);
    ctx.beginPath();
    ctx.moveTo(r * 0.06, 0);
    ctx.lineTo(r * 0.44, 0);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // Ribbon and core sit *on* the candy, so they clip to what is painted.
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';

  const ribbon = ctx.createLinearGradient(0, -r * 0.16, 0, r * 0.16);
  ribbon.addColorStop(0, 'rgba(255,255,255,0.06)');
  ribbon.addColorStop(0.5, 'rgba(255,255,255,0.46)');
  ribbon.addColorStop(1, 'rgba(255,255,255,0.06)');
  ctx.fillStyle = ribbon;
  ctx.fillRect(-r * 1.2, -r * 0.13, r * 2.4, r * 0.26);
  const ribbonV = ctx.createLinearGradient(-r * 0.16, 0, r * 0.16, 0);
  ribbonV.addColorStop(0, 'rgba(255,255,255,0.06)');
  ribbonV.addColorStop(0.5, 'rgba(255,255,255,0.46)');
  ribbonV.addColorStop(1, 'rgba(255,255,255,0.06)');
  ctx.fillStyle = ribbonV;
  ctx.fillRect(-r * 0.13, -r * 1.2, r * 0.26, r * 2.4);

  // Charged core — this is the piece that is about to go off.
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.52);
  core.addColorStop(0, 'rgba(255,255,255,0.62)');
  core.addColorStop(0.35, 'rgba(255,255,255,0.24)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.fillRect(-r * 1.2, -r * 1.2, r * 2.4, r * 2.4);
  ctx.restore();
}

function drawBomb(ctx: CanvasRenderingContext2D, r: number): void {
  if (atlas) {
    blitAtlas(ctx, ATLAS_BOMB, r);
    // Same contact shadow the candies get, tucked behind.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.translate(0, r * 0.12);
    ctx.fillStyle = 'rgba(10,4,26,0.45)';
    ctx.filter = `blur(${Math.max(1, r * 0.12)}px)`;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.94, 0, TAU);
    ctx.fill();
    ctx.restore();
    return;
  }

  // ------------------------------------------- procedural bomb (fallback)
  // Shadow
  ctx.save();
  ctx.translate(0, r * 0.12);
  ctx.fillStyle = 'rgba(10,4,26,0.45)';
  ctx.filter = `blur(${Math.max(1, r * 0.12)}px)`;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.94, 0, TAU);
  ctx.fill();
  ctx.restore();

  // Dark chrome sphere
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.05, 0, r * 0.1, r * 1.25);
  g.addColorStop(0, '#6b5bd6');
  g.addColorStop(0.4, '#2c2158');
  g.addColorStop(1, '#0c0720');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.95, 0, TAU);
  ctx.fill();

  // Rainbow sprinkles orbiting the core
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.95, 0, TAU);
  ctx.clip();
  const hues = ['#ff3b6b', '#ff9f1c', '#ffe03d', '#4ade80', '#38bdf8', '#a78bfa'];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * TAU * 3.1;
    const rr = r * (0.22 + ((i * 37) % 60) / 100);
    const x = Math.cos(a) * rr;
    const y = Math.sin(a * 1.3) * rr * 0.9;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = hues[i % hues.length];
    ctx.globalAlpha = 0.95;
    roundRect(ctx, -r * 0.1, -r * 0.035, r * 0.2, r * 0.07, r * 0.035);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // Glass highlight + rim
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.95, 0, TAU);
  ctx.clip();
  const hl = ctx.createRadialGradient(-r * 0.34, -r * 0.46, 0, -r * 0.34, -r * 0.46, r * 0.7);
  hl.addColorStop(0, 'rgba(255,255,255,0.9)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl;
  ctx.beginPath();
  ctx.ellipse(-r * 0.32, -r * 0.44, r * 0.44, r * 0.3, -0.5, 0, TAU);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(200,180,255,0.5)';
  ctx.lineWidth = Math.max(1, r * 0.07);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.95, 0, TAU);
  ctx.stroke();
}

/**
 * Renders every candy variant once into offscreen canvases and reuses them.
 * Rebuilt only when the cell size changes.
 */
export class SpriteCache {
  private cache = new Map<string, HTMLCanvasElement>();
  private cell = 0;
  private dpr = 1;
  private gen = -1;

  ensure(cell: number, dpr: number): void {
    const c = Math.round(cell);
    if (c === this.cell && dpr === this.dpr) return;
    this.cell = c;
    this.dpr = dpr;
    this.cache.clear();
  }

  get(color: ColorId, special: Special): HTMLCanvasElement {
    // The atlas decodes after the first sprites are already built and cached.
    if (this.gen !== atlasGen) {
      this.gen = atlasGen;
      this.cache.clear();
    }
    const key = `${color}|${special}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const pad = 1.34; // room for shadow / wrapper corners
    const px = Math.ceil(this.cell * pad * this.dpr);
    const cv = document.createElement('canvas');
    cv.width = px;
    cv.height = px;
    const ctx = cv.getContext('2d')!;
    ctx.scale(this.dpr, this.dpr);
    const size = this.cell * pad;
    ctx.translate(size / 2, size / 2);
    const r = (this.cell / 2) * 0.86;

    if (special === 'bomb' || color === BOMB_COLOR) {
      drawBomb(ctx, r * 1.02);
    } else {
      drawBody(ctx, color, r);
      if (special === 'stripeH') drawStripes(ctx, color, r, true);
      else if (special === 'stripeV') drawStripes(ctx, color, r, false);
      else if (special === 'wrapped') drawWrapped(ctx, color, r);
      // Last, so `destination-over` tucks it behind the finished piece.
      drawContactShadow(ctx, color, r);
    }

    this.cache.set(key, cv);
    return cv;
  }

  /** Size, in CSS pixels, at which sprites should be blitted. */
  get drawSize(): number {
    return this.cell * 1.34;
  }
}
