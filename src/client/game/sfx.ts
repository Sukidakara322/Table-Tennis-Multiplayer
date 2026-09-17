import { clamp } from '../../shared/vec';

interface ToneOptions {
  type: OscillatorType;
  freq: number;
  to?: number;
  duration: number;
  gain: number;
  delay?: number;
}

/** Synthesised sound effects (no audio files). */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  /** Must be called from a user gesture before sounds can play. */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  hit(strength: number): void {
    const s = clamp(strength, 0, 1);
    this.tone({ type: 'square', freq: 480 + 420 * s, to: 220, duration: 0.07, gain: 0.12 + 0.18 * s });
    this.noise(0.035, 0.08 + 0.2 * s, 2800);
  }

  bounce(strength: number): void {
    const s = clamp(strength, 0, 1);
    this.tone({ type: 'sine', freq: 1300, to: 850, duration: 0.05, gain: 0.08 + 0.14 * s });
  }

  floor(): void {
    this.tone({ type: 'sine', freq: 520, to: 300, duration: 0.06, gain: 0.05 });
  }

  net(): void {
    this.tone({ type: 'triangle', freq: 170, to: 80, duration: 0.14, gain: 0.25 });
    this.noise(0.06, 0.08, 700);
  }

  toss(): void {
    this.tone({ type: 'sine', freq: 520, to: 880, duration: 0.09, gain: 0.05 });
  }

  point(won: boolean): void {
    const notes = won ? [523.25, 659.25, 783.99, 1046.5] : [392, 329.63, 261.63];
    notes.forEach((freq, i) => this.tone({ type: 'triangle', freq, duration: 0.14, gain: 0.12, delay: i * 0.08 }));
  }

  click(): void {
    this.tone({ type: 'square', freq: 900, to: 1200, duration: 0.03, gain: 0.04 });
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }

  private tone({ type, freq, to, duration, gain, delay = 0 }: ToneOptions): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(to, start + duration);
    env.gain.setValueAtTime(gain, start);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(env).connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  private noise(duration: number, gain: number, cutoff: number): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const length = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const env = ctx.createGain();
    env.gain.value = gain;
    source.connect(filter).connect(env).connect(master);
    source.start();
  }
}
