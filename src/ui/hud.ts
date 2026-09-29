import { clamp, easeOutBack, easeOutCubic } from '../core/rng';
import { drawIcon, type IconId } from './icons';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ButtonId = 'sound' | 'restart' | 'primary' | 'hammer' | 'shuffle' | 'hint';

export interface HudButton extends Rect {
  id: ButtonId;
  label: string;
  round: boolean;
  pressed: number;
  /** Vector glyph drawn on the face (preferred over emoji). */
  icon?: IconId;
  /** Remaining charges, rendered as a corner badge. */
  charges?: number;
  /** Armed boosters pulse. */
  armed?: boolean;
  disabled?: boolean;
}

export const FONT = (size: number, weight = 800) =>
  `${weight} ${size.toFixed(1)}px 'Baloo 2', 'Nunito', 'Trebuchet MS', system-ui, sans-serif`;

export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function glassPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  tint = 'rgba(58,26,105,0.72)',
): void {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = tint;
  ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(255,255,255,0.18)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.03)');
  g.addColorStop(1, 'rgba(255,255,255,0.09)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  filled: boolean,
  pulse = 0,
): void {
  const rr = r * (1 + pulse * 0.25);
  ctx.save();
  if (filled) {
    ctx.shadowColor = 'rgba(255,214,64,0.9)';
    ctx.shadowBlur = r * (0.8 + pulse * 1.6);
    const g = ctx.createLinearGradient(cx, cy - rr, cx, cy + rr);
    g.addColorStop(0, '#fff6c2');
    g.addColorStop(0.5, '#ffd23f');
    g.addColorStop(1, '#ff9f1c');
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
  }
  starPath(ctx, cx, cy, rr);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = filled ? 'rgba(160,70,0,0.55)' : 'rgba(255,255,255,0.18)';
  ctx.lineWidth = Math.max(1, r * 0.11);
  ctx.stroke();
  ctx.restore();
}

/** Big candy-coloured button with a 3D lip. */
/**
 * A pressable button with real depth.
 *
 * The earlier version was a gradient rectangle with a gloss strip, which is
 * the house style of every flat UI kit and reads as a web form control
 * dropped into a game. Four things separate that from a moulded plastic
 * button, and all of them are cheap:
 *
 *  - a *deep* lip in a darker shade of the face colour, not a grey drop
 *    shadow, so the side wall looks like the same material;
 *  - a dark outer keyline, which is what stops the button dissolving into a
 *    busy background;
 *  - bounce light along the bottom inside edge, where a real moulded surface
 *    catches light reflected back up off the lip;
 *  - a specular sheen that is an arc rather than a rectangle, because a
 *    straight-edged highlight is the single clearest tell of a flat shape.
 *
 * Pressing sinks the face into the lip rather than moving the whole button,
 * so the travel is visible against a fixed silhouette.
 */
export function drawButton(
  ctx: CanvasRenderingContext2D,
  b: HudButton,
  colors: [string, string, string],
  fontSize: number,
  iconSize = 0,
): void {
  const press = b.pressed;
  const depth = b.h * 0.13;
  const lift = depth * (1 - press);
  const y = b.y + depth - lift;
  const rad = b.round ? b.h / 2 : b.h * 0.3;

  ctx.save();

  // Outer keyline + lip, drawn as one taller shape behind the face.
  roundRectPath(ctx, b.x, b.y, b.w, b.h + depth, rad);
  ctx.fillStyle = 'rgba(18,7,34,0.55)';
  ctx.fill();
  roundRectPath(ctx, b.x + 1, b.y + 1, b.w - 2, b.h + depth - 2, rad);
  ctx.fillStyle = colors[2];
  ctx.fill();

  // Face.
  const g = ctx.createLinearGradient(0, y, 0, y + b.h);
  g.addColorStop(0, colors[0]);
  g.addColorStop(0.55, colors[1]);
  g.addColorStop(1, shadeHex(colors[1], 0.86));
  roundRectPath(ctx, b.x + 1.5, y, b.w - 3, b.h, rad);
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  ctx.clip();

  // Specular sheen: a wide flattened arc across the top third.
  ctx.beginPath();
  ctx.ellipse(
    b.x + b.w / 2,
    y - b.h * 0.42,
    b.w * 0.46,
    b.h * 0.62,
    0,
    0,
    Math.PI * 2,
  );
  const sheen = ctx.createLinearGradient(0, y, 0, y + b.h * 0.6);
  sheen.addColorStop(0, 'rgba(255,255,255,0.5)');
  sheen.addColorStop(1, 'rgba(255,255,255,0.06)');
  ctx.fillStyle = sheen;
  ctx.fill();

  // Bounce light off the lip, along the bottom inside edge.
  const bounce = ctx.createLinearGradient(0, y + b.h, 0, y + b.h * 0.68);
  bounce.addColorStop(0, 'rgba(255,255,255,0.3)');
  bounce.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = bounce;
  ctx.fillRect(b.x, y + b.h * 0.68, b.w, b.h * 0.32);
  ctx.restore();

  // Rim light along the very top.
  roundRectPath(ctx, b.x + 1.5, y, b.w - 3, b.h, rad);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  const cx = b.x + b.w / 2;
  const cy = y + b.h / 2;

  if (b.icon && iconSize > 0 && !b.label) {
    ctx.save();
    ctx.translate(cx, cy);
    drawIcon(ctx, b.icon, iconSize);
    ctx.restore();
  } else if (b.icon && iconSize > 0) {
    const gap = iconSize * 0.42;
    ctx.font = FONT(fontSize, 900);
    const tw = ctx.measureText(b.label).width;
    const total = iconSize + gap + tw;
    ctx.save();
    ctx.translate(cx - total / 2 + iconSize / 2, cy);
    drawIcon(ctx, b.icon, iconSize);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, fontSize * 0.16);
    ctx.strokeStyle = 'rgba(70,20,10,0.4)';
    ctx.strokeText(b.label, cx - total / 2 + iconSize + gap, cy);
    ctx.fillStyle = '#fff';
    ctx.fillText(b.label, cx - total / 2 + iconSize + gap, cy);
  } else {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = FONT(fontSize, 900);
    ctx.lineWidth = Math.max(2, fontSize * 0.18);
    ctx.strokeStyle = 'rgba(52,14,8,0.5)';
    ctx.strokeText(b.label, cx, cy);
    const tg = ctx.createLinearGradient(0, cy - fontSize * 0.6, 0, cy + fontSize * 0.6);
    tg.addColorStop(0, '#ffffff');
    tg.addColorStop(1, '#ffe4f2');
    ctx.fillStyle = tg;
    ctx.fillText(b.label, cx, cy);
  }
  ctx.restore();
}

/** Multiply a hex colour toward black, for deriving a button's lower face. */
function shadeHex(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

/** Small count bubble in the top-right corner of a booster button. */
export function drawBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  n: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = n > 0 ? '#ff3b6b' : '#4b3a6b';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = FONT(r * 1.25, 900);
  ctx.fillStyle = '#fff';
  ctx.fillText(String(n), x, y + r * 0.06);
  ctx.restore();
}

/** Animated number that rolls toward its target. */
export class Rolling {
  display = 0;
  target = 0;
  punch = 0;

  set(v: number): void {
    if (v > this.target) this.punch = 1;
    this.target = v;
  }

  hard(v: number): void {
    this.target = v;
    this.display = v;
    this.punch = 0;
  }

  update(dt: number): void {
    const diff = this.target - this.display;
    if (Math.abs(diff) < 0.5) this.display = this.target;
    else this.display += diff * Math.min(1, dt * 7) + Math.sign(diff) * dt * 40;
    this.punch = Math.max(0, this.punch - dt * 3.2);
  }

  get scale(): number {
    return 1 + easeOutCubic(this.punch) * 0.12;
  }

  get value(): number {
    return Math.round(this.display);
  }
}

/** Slide-in banner used for "SWEET!", "LEVEL UP" etc. */
export class Banner {
  private text = '';
  private sub = '';
  private t = 0;
  private dur = 1.4;
  private color = '#ffd23f';

  show(text: string, sub = '', color = '#ffd23f', dur = 1.4): void {
    this.text = text;
    this.sub = sub;
    this.color = color;
    this.dur = dur;
    this.t = 0;
  }

  get active(): boolean {
    return this.text !== '' && this.t < this.dur;
  }

  update(dt: number): void {
    if (this.text) this.t += dt;
  }

  render(ctx: CanvasRenderingContext2D, w: number, y: number): void {
    if (!this.active) return;
    const p = this.t / this.dur;
    const inT = clamp(p / 0.18, 0, 1);
    const outT = clamp((p - 0.78) / 0.22, 0, 1);
    const slide = (1 - easeOutBack(inT, 2.2)) * w * 0.9 + outT * w * 0.9;
    const alpha = 1 - outT;
    const size = Math.min(w * 0.115, 54);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(w / 2 + slide, y);
    ctx.rotate(-0.045 + Math.sin(this.t * 9) * 0.012);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = FONT(size, 900);
    const tw = ctx.measureText(this.text).width;
    ctx.save();
    ctx.globalAlpha = alpha * 0.35;
    ctx.fillStyle = this.color;
    ctx.filter = 'blur(14px)';
    roundRectPath(ctx, -tw / 2 - 26, -size * 0.75, tw + 52, size * 1.5, size * 0.6);
    ctx.fill();
    ctx.restore();

    ctx.lineWidth = size * 0.18;
    ctx.strokeStyle = 'rgba(40,10,60,0.85)';
    ctx.lineJoin = 'round';
    ctx.strokeText(this.text, 0, 0);
    const g = ctx.createLinearGradient(0, -size * 0.6, 0, size * 0.6);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, this.color);
    g.addColorStop(1, '#ff7ab8');
    ctx.fillStyle = g;
    ctx.fillText(this.text, 0, 0);

    if (this.sub) {
      ctx.font = FONT(size * 0.4, 800);
      ctx.lineWidth = size * 0.09;
      ctx.strokeText(this.sub, 0, size * 0.78);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(this.sub, 0, size * 0.78);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
