// Short sounds made with WebAudio (no sound files). Nothing plays until the player has touched the page,
// nothing plays while muted, and `?mute` in the URL forces silence (for automated tests).

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
const forced = typeof location !== 'undefined' && /[?&]mute\b/.test(location.search);

export function setMuted(m: boolean): void {
  muted = m;
  if (master) master.gain.value = m || forced ? 0 : 0.2;
}

export function isMuted(): boolean {
  return muted || forced;
}

function audio(): AudioContext | null {
  if (isMuted()) return null;
  if (!ctx) {
    const AC = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.2;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

let touched = false;
/** Browsers only allow sound after a gesture; call from a pointer/key handler. */
export function unlock(): void {
  touched = true;
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, at = 0, slideTo?: number): void {
  const a = touched ? audio() : null;
  if (!a || !master) return;
  const t0 = a.currentTime + at;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur: number, gain: number, cutoff: number, at = 0): void {
  const a = touched ? audio() : null;
  if (!a || !master) return;
  const t0 = a.currentTime + at;
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

// A pentatonic scale for the steps: higher stairs sound higher.
const SCALE = [0, 2, 4, 7, 9];
function pitch(height: number): number {
  const i = Math.max(-10, Math.min(14, Math.round(height)));
  const octave = Math.floor(i / 5);
  const semis = SCALE[((i % 5) + 5) % 5]! + 12 * octave;
  return 330 * 2 ** (semis / 12);
}

export const sfx = {
  /** One step down onto a stair of this height. */
  step(height: number): void {
    tone(pitch(height), 0.09, 'triangle', 0.5);
    noise(0.04, 0.25, 1800);
  },
  /** Back on the ground: the loop has ended. */
  land(): void {
    tone(150, 0.18, 'sine', 0.7, 0, 70);
    noise(0.08, 0.3, 700);
    tone(660, 0.25, 'triangle', 0.25, 0.12);
    tone(990, 0.3, 'triangle', 0.18, 0.2);
  },
  /** A step that does not go down, or a fall below ground. */
  fail(): void {
    tone(240, 0.16, 'square', 0.18);
    tone(180, 0.28, 'square', 0.16, 0.14, 150);
  },
  fall(): void {
    tone(420, 0.45, 'sawtooth', 0.12, 0, 90);
    noise(0.12, 0.35, 500, 0.4);
  },
  solve(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.22, 'triangle', 0.35, i * 0.09));
  },
  click(): void {
    tone(880, 0.04, 'sine', 0.2);
  },
};
