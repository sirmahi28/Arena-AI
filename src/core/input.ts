export interface PointerHandlers {
  onDown(x: number, y: number): void;
  onMove(x: number, y: number): void;
  onUp(x: number, y: number): void;
  onCancel(): void;
}

/**
 * Unified pointer plumbing. Uses Pointer Events where available and falls
 * back to touch/mouse, so it behaves the same on phones and desktop.
 */
export class Pointer {
  private active = false;
  private id = -1;

  constructor(private el: HTMLElement, private h: PointerHandlers) {
    const supportsPointer = 'onpointerdown' in window;

    if (supportsPointer) {
      el.addEventListener('pointerdown', this.pDown, { passive: false });
      window.addEventListener('pointermove', this.pMove, { passive: false });
      window.addEventListener('pointerup', this.pUp);
      window.addEventListener('pointercancel', this.pCancel);
    } else {
      el.addEventListener('touchstart', this.tStart, { passive: false });
      window.addEventListener('touchmove', this.tMove, { passive: false });
      window.addEventListener('touchend', this.tEnd);
      el.addEventListener('mousedown', this.mDown);
      window.addEventListener('mousemove', this.mMove);
      window.addEventListener('mouseup', this.mUp);
    }

    // Kill browser gestures that would fight the game.
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('dragstart', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  private local(cx: number, cy: number): [number, number] {
    const r = this.el.getBoundingClientRect();
    return [cx - r.left, cy - r.top];
  }

  private pDown = (e: PointerEvent) => {
    if (this.active) return;
    e.preventDefault();
    this.active = true;
    this.id = e.pointerId;
    const [x, y] = this.local(e.clientX, e.clientY);
    this.h.onDown(x, y);
  };

  private pMove = (e: PointerEvent) => {
    if (!this.active || e.pointerId !== this.id) return;
    e.preventDefault();
    const [x, y] = this.local(e.clientX, e.clientY);
    this.h.onMove(x, y);
  };

  private pUp = (e: PointerEvent) => {
    if (!this.active || e.pointerId !== this.id) return;
    this.active = false;
    const [x, y] = this.local(e.clientX, e.clientY);
    this.h.onUp(x, y);
  };

  private pCancel = () => {
    if (!this.active) return;
    this.active = false;
    this.h.onCancel();
  };

  private tStart = (e: TouchEvent) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    this.active = true;
    const [x, y] = this.local(t.clientX, t.clientY);
    this.h.onDown(x, y);
  };

  private tMove = (e: TouchEvent) => {
    if (!this.active) return;
    e.preventDefault();
    const t = e.changedTouches[0];
    const [x, y] = this.local(t.clientX, t.clientY);
    this.h.onMove(x, y);
  };

  private tEnd = (e: TouchEvent) => {
    if (!this.active) return;
    this.active = false;
    const t = e.changedTouches[0];
    const [x, y] = this.local(t.clientX, t.clientY);
    this.h.onUp(x, y);
  };

  private mDown = (e: MouseEvent) => {
    this.active = true;
    const [x, y] = this.local(e.clientX, e.clientY);
    this.h.onDown(x, y);
  };

  private mMove = (e: MouseEvent) => {
    if (!this.active) return;
    const [x, y] = this.local(e.clientX, e.clientY);
    this.h.onMove(x, y);
  };

  private mUp = (e: MouseEvent) => {
    if (!this.active) return;
    this.active = false;
    const [x, y] = this.local(e.clientX, e.clientY);
    this.h.onUp(x, y);
  };
}
