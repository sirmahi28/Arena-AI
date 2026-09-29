/**
 * Fully synthesised sound — no asset downloads, no licensing, tiny footprint.
 * Everything is built from oscillators + a noise buffer.
 */

const NOTES = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31]; // pentatonic ladder

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;

  /** Must be called from a user gesture on iOS/Safari. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.34;

      // Gentle bus compression so stacked cascades don't clip.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 24;
      comp.ratio.value = 8;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;

      this.master.connect(comp);
      comp.connect(this.ctx.destination);

      const len = Math.floor(this.ctx.sampleRate * 0.5);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  private get t(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private ready(): boolean {
    return !!this.ctx && !!this.master && !this.muted;
  }

  private tone(
    freq: number,
    dur: number,
    opts: {
      type?: OscillatorType;
      gain?: number;
      delay?: number;
      slideTo?: number;
      attack?: number;
      detune?: number;
    } = {},
  ): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t0 = this.t + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), t0 + dur);
    if (opts.detune) osc.detune.setValueAtTime(opts.detune, t0);

    const peak = opts.gain ?? 0.3;
    const atk = opts.attack ?? 0.006;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g);
    g.connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  private noise(
    dur: number,
    opts: { gain?: number; delay?: number; from?: number; to?: number; q?: number } = {},
  ): void {
    if (!this.ready() || !this.noiseBuf) return;
    const ctx = this.ctx!;
    const t0 = this.t + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.Q.value = opts.q ?? 1.1;
    filt.frequency.setValueAtTime(opts.from ?? 1800, t0);
    filt.frequency.exponentialRampToValueAtTime(Math.max(60, opts.to ?? 300), t0 + dur);

    const g = ctx.createGain();
    const peak = opts.gain ?? 0.22;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(filt);
    filt.connect(g);
    g.connect(this.master!);
    src.start(t0);
    src.stop(t0 + dur + 0.03);
  }

  /** Match pop — pitch climbs with the cascade depth for that "combo ladder" feel. */
  pop(cascade = 0, size = 3): void {
    const step = NOTES[Math.min(cascade, NOTES.length - 1)];
    const base = 523.25 * Math.pow(2, step / 12);
    this.tone(base, 0.16, { type: 'triangle', gain: 0.26 });
    this.tone(base * 2, 0.1, { type: 'sine', gain: 0.12, delay: 0.005 });
    if (size >= 4) this.tone(base * 1.5, 0.2, { type: 'sine', gain: 0.14, delay: 0.02 });
    this.noise(0.09, { gain: 0.1, from: 5200, to: 900, q: 0.8 });
  }

  swap(): void {
    this.tone(760, 0.075, { type: 'sine', gain: 0.14, slideTo: 1180 });
    this.noise(0.05, { gain: 0.045, from: 3200, to: 1400 });
  }

  invalid(): void {
    this.tone(200, 0.14, { type: 'sawtooth', gain: 0.1, slideTo: 130 });
    this.tone(150, 0.16, { type: 'square', gain: 0.05, slideTo: 100 });
  }

  stripe(): void {
    this.tone(1400, 0.3, { type: 'sawtooth', gain: 0.1, slideTo: 260 });
    this.noise(0.34, { gain: 0.2, from: 7000, to: 500, q: 0.6 });
    this.tone(220, 0.22, { type: 'sine', gain: 0.18, slideTo: 90 });
  }

  boom(): void {
    this.tone(150, 0.45, { type: 'sine', gain: 0.4, slideTo: 40 });
    this.tone(90, 0.5, { type: 'triangle', gain: 0.3, slideTo: 30 });
    this.noise(0.4, { gain: 0.3, from: 3200, to: 110, q: 0.5 });
  }

  rainbow(): void {
    for (let i = 0; i < 8; i++) {
      this.tone(392 * Math.pow(2, NOTES[i] / 12), 0.28, {
        type: 'triangle',
        gain: 0.14,
        delay: i * 0.045,
      });
    }
    this.noise(0.6, { gain: 0.2, from: 9000, to: 400, q: 0.4 });
    this.tone(120, 0.5, { type: 'sine', gain: 0.3, slideTo: 50 });
  }

  land(force = 0.5): void {
    this.tone(180 + force * 90, 0.07, { type: 'sine', gain: 0.07 * force, slideTo: 90 });
    this.noise(0.05, { gain: 0.035 * force, from: 1400, to: 320 });
  }

  win(): void {
    const seq = [0, 4, 7, 12, 16, 19, 24];
    seq.forEach((n, i) => {
      this.tone(523.25 * Math.pow(2, n / 12), 0.42, {
        type: 'triangle',
        gain: 0.2,
        delay: i * 0.09,
      });
      this.tone(523.25 * Math.pow(2, (n + 7) / 12), 0.3, {
        type: 'sine',
        gain: 0.09,
        delay: i * 0.09 + 0.02,
      });
    });
  }

  lose(): void {
    const seq = [12, 9, 5, 0];
    seq.forEach((n, i) => {
      this.tone(392 * Math.pow(2, n / 12), 0.42, {
        type: 'triangle',
        gain: 0.16,
        delay: i * 0.16,
      });
    });
    this.tone(110, 0.9, { type: 'sine', gain: 0.18, slideTo: 55, delay: 0.5 });
  }

  ui(): void {
    this.tone(880, 0.06, { type: 'square', gain: 0.07 });
    this.tone(1320, 0.07, { type: 'sine', gain: 0.06, delay: 0.03 });
  }

  shuffle(): void {
    for (let i = 0; i < 6; i++) {
      this.tone(400 + i * 130, 0.09, { type: 'sine', gain: 0.07, delay: i * 0.035 });
    }
  }
}

export const sfx = new Sfx();

/** Haptics where supported (Android Chrome). */
export function buzz(pattern: number | number[]): void {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* ignore */
    }
  }
}
