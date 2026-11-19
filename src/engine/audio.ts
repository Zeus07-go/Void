// Tiny synthesized soundscape. Original tones only; nothing plays until the user interacts.

type ToneOpts = {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  decay?: number;
  when?: number;
  toFreq?: number;
  send?: number;
};

let shared: AudioEngine | null = null;
/** One audio engine for the whole site, so mute and context survive universe jumps. */
export function getSharedAudio(): AudioEngine {
  shared ??= new AudioEngine();
  return shared;
}

const SCALE = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 783.99, 880];
const MASTER = 0.6;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private send: GainNode | null = null;
  private muted = false;

  ensure(): void {
    if (!this.ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch {
        return;
      }
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER, ctx.currentTime, 0.4);
      this.master.connect(ctx.destination);

      // Simple space echo: feedback delay through a lowpass.
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.31;
      const fb = ctx.createGain();
      fb.gain.value = 0.38;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      this.send = ctx.createGain();
      this.send.gain.value = 0.35;
      this.send.connect(delay);
      delay.connect(lp);
      lp.connect(fb);
      fb.connect(delay);
      lp.connect(this.master);

      this.startDrone();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : MASTER, this.ctx.currentTime, 0.08);
    }
  }

  destroy(): void {
    void this.ctx?.close();
    this.ctx = null;
  }

  private startDrone(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.025;
    lfo.connect(lfoGain);
    lfoGain.connect(g.gain);
    for (const f of [55, 82.41, 110.3]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(lp);
      o.start();
    }
    lp.connect(g);
    g.connect(this.master);
    lfo.start();
  }

  private tone(freq: number, o: ToneOpts = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const { type = 'sine', gain = 0.08, attack = 0.006, decay = 1.2, when = 0, toFreq, send = 0.4 } = o;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (toFreq) osc.frequency.exponentialRampToValueAtTime(toFreq, t + attack + decay);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    osc.connect(g);
    g.connect(this.master);
    if (send > 0 && this.send) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s);
      s.connect(this.send);
    }
    osc.start(t);
    osc.stop(t + attack + decay + 0.05);
  }

  /** Absorption chime — consecutive absorptions climb the scale. */
  absorb(combo: number): void {
    const f = SCALE[Math.min(combo, SCALE.length - 1)] ?? 220;
    this.tone(f, { gain: 0.085, decay: 2.6 });
    this.tone(f * 2, { gain: 0.025, decay: 1.3 });
    this.tone(f * 3.01, { gain: 0.01, decay: 0.7 });
    this.tone(62, { gain: 0.13, decay: 0.55, toFreq: 38, send: 0 });
  }

  grab(): void {
    this.tone(620, { gain: 0.03, decay: 0.12, toFreq: 880, send: 0.1 });
  }

  release(speed: number): void {
    const s = Math.min(1, speed);
    if (s < 0.08) return;
    this.tone(360, { type: 'triangle', gain: 0.018 + 0.02 * s, decay: 0.35, toFreq: 180, send: 0.2 });
  }

  spawn(): void {
    const f = SCALE[5 + Math.floor(Math.random() * 6)] ?? 880;
    this.tone(f, { type: 'triangle', gain: 0.03, decay: 0.6 });
  }

  poke(): void {
    this.tone(74, { gain: 0.14, decay: 0.8, toFreq: 42, send: 0.2 });
  }

  private hum: { oscs: OscillatorNode[]; g: GainNode } | null = null;

  /** Low rising hum while the portal charges. */
  chargeStart(seconds: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted || this.hum) return;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + seconds);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(240, t);
    lp.frequency.exponentialRampToValueAtTime(1400, t + seconds);
    const oscs = [55, 82.5, 110.6].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 1 ? 'sawtooth' : 'sine';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 2, t + seconds);
      o.connect(lp);
      o.start(t);
      return o;
    });
    lp.connect(g);
    g.connect(this.master);
    this.hum = { oscs, g };
  }

  chargeStop(): void {
    const ctx = this.ctx;
    const hum = this.hum;
    if (!ctx || !hum) return;
    this.hum = null;
    const t = ctx.currentTime;
    hum.g.gain.cancelScheduledValues(t);
    hum.g.gain.setTargetAtTime(0.0001, t, 0.06);
    hum.oscs.forEach((o) => o.stop(t + 0.4));
  }

  /** Filtered-noise rush through the tunnel. */
  whoosh(seconds: number, reverse = false): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const t = ctx.currentTime;
    const len = Math.ceil(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    const [f0, f1, f2] = reverse ? [2400, 900, 160] : [160, 2600, 420];
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + seconds * 0.55);
    bp.frequency.exponentialRampToValueAtTime(f2, t + seconds);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + seconds * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    if (this.send) g.connect(this.send);
    src.start(t);
    src.stop(t + seconds);
    this.tone(reverse ? 220 : 110, { gain: 0.08, decay: seconds, toFreq: reverse ? 55 : 440, send: 0.3 });
  }

  /** Soft chord on arrival in a new universe. */
  arrive(reverse = false): void {
    const base = reverse ? [220, 277.18, 329.63, 440] : [293.66, 369.99, 440, 587.33];
    base.forEach((f, i) => this.tone(f, { gain: 0.04, decay: 2.8, when: i * 0.06, attack: 0.04 }));
  }

  reset(): void {
    this.tone(220, { gain: 0.06, decay: 1.2, toFreq: 50, send: 0.3 });
    [220, 277.18, 329.63, 440, 554.37].forEach((f, i) =>
      this.tone(f, { gain: 0.035, decay: 3.2, when: 1.05 + i * 0.05, attack: 0.03 }),
    );
  }
}
