/**
 * Hand-drawn vector icons.
 *
 * Emoji were the obvious shortcut here, but they render as tofu boxes on any
 * device without an emoji font and their metrics vary wildly between
 * platforms. Paths are predictable and match the art style.
 */

export type IconId = 'sound-on' | 'sound-off' | 'restart' | 'shuffle' | 'hammer' | 'bulb';

const TAU = Math.PI * 2;

/** Draws an icon centred on (0,0) sized to roughly `s` across. */
export function drawIcon(ctx: CanvasRenderingContext2D, id: IconId, s: number, color = '#fff'): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.5, s * 0.11);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (id) {
    case 'sound-on':
    case 'sound-off': {
      const k = s * 0.5;
      // Speaker body
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
      // arrow head
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
      // handle
      ctx.beginPath();
      ctx.lineWidth = s * 0.14;
      ctx.moveTo(0, 0);
      ctx.lineTo(0, k);
      ctx.stroke();
      // head
      ctx.beginPath();
      const hw = k * 0.82;
      const hh = k * 0.4;
      ctx.moveTo(-hw, -k * 0.9);
      ctx.lineTo(hw, -k * 0.9);
      ctx.lineTo(hw * 0.78, -k * 0.9 + hh * 1.5);
      ctx.lineTo(-hw * 0.78, -k * 0.9 + hh * 1.5);
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
      ctx.fillRect(-k * 0.3, k * 0.3, k * 0.6, k * 0.18);
      ctx.fillRect(-k * 0.22, k * 0.58, k * 0.44, k * 0.16);
      // rays
      ctx.lineWidth = Math.max(1.4, s * 0.075);
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI + (i / 4) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * k * 0.85, -k * 0.25 + Math.sin(a) * k * 0.85);
        ctx.lineTo(Math.cos(a) * k * 1.15, -k * 0.25 + Math.sin(a) * k * 1.15);
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}
