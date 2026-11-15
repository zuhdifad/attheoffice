// Everything you hear is synthesised, so the game ships with no audio files and
// nothing has to download before the first footstep. One master gain means one
// mute button really does silence the whole thing.
//
// The context can only start from a gesture, so init() is called from the
// Clock-in click and every later call is a no-op.

let ctx = null;
let master = null;
let ambience = null;
let muted = false;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(ctx.destination);
  startAmbience();
}

export function setMuted(on) {
  muted = on;
  if (master) master.gain.setTargetAtTime(on ? 0 : 0.5, ctx.currentTime, 0.02);
  return muted;
}

export function isMuted() {
  return muted;
}

// Room tone: filtered noise, plus two detuned sines a fifth apart for the HVAC.
// Quiet enough that it reads as a room rather than as music.
function startAmbience() {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    d[i] = last * 3.2;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  noise.loop = true;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 520;

  const ng = ctx.createGain();
  ng.gain.value = 0.10;

  noise.connect(lp).connect(ng).connect(master);
  noise.start();

  const hum = ctx.createGain();
  hum.gain.value = 0.018;
  hum.connect(master);
  for (const f of [58, 87]) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    o.connect(hum);
    o.start();
  }
  ambience = ng;
}

// Ducked while a menu is up, so the room is heard but never competes with a
// completion chord.
export function setAmbience(level) {
  if (ambience && ctx) ambience.gain.setTargetAtTime(level, ctx.currentTime, 0.25);
}

function tone({ freq = 440, to = null, type = 'square', dur = 0.12, gain = 0.16, delay = 0, sweep = 'exp' }) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (to) {
    if (sweep === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    else o.frequency.linearRampToValueAtTime(to, t0 + dur);
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.03);
}

function noiseHit({ dur = 0.07, gain = 0.12, freq = 1800, q = 1, delay = 0 }) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + delay;
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(master);
  src.start(t0);
}

export const sfx = {
  step(alt) {
    noiseHit({ dur: 0.05, gain: 0.055, freq: alt ? 900 : 640, q: 1.4 });
  },
  ui() {
    tone({ freq: 620, to: 880, type: 'square', dur: 0.06, gain: 0.07 });
  },
  back() {
    tone({ freq: 520, to: 300, type: 'square', dur: 0.08, gain: 0.07 });
  },
  arrive() {
    tone({ freq: 740, type: 'triangle', dur: 0.09, gain: 0.09 });
    tone({ freq: 1110, type: 'triangle', dur: 0.10, gain: 0.06, delay: 0.06 });
  },
  key() {
    noiseHit({ dur: 0.03, gain: 0.05, freq: 2400 + Math.random() * 900, q: 3 });
  },
  sync() {
    tone({ freq: 880, to: 1760, type: 'triangle', dur: 0.14, gain: 0.14 });
    tone({ freq: 1320, type: 'sine', dur: 0.18, gain: 0.08, delay: 0.03 });
  },
  miss() {
    tone({ freq: 240, to: 150, type: 'sawtooth', dur: 0.10, gain: 0.06 });
  },
  task() {
    [523, 659, 784, 1046].forEach((f, i) => {
      tone({ freq: f, type: 'square', dur: 0.16, gain: 0.10, delay: i * 0.065 });
    });
  },
  clockIn() {
    tone({ freq: 392, type: 'square', dur: 0.10, gain: 0.10 });
    tone({ freq: 587, type: 'square', dur: 0.16, gain: 0.10, delay: 0.09 });
  },
  win() {
    [523, 659, 784, 1046, 1318].forEach((f, i) => {
      tone({ freq: f, type: 'square', dur: 0.26, gain: 0.11, delay: i * 0.10 });
    });
    tone({ freq: 261, type: 'triangle', dur: 0.9, gain: 0.07, delay: 0.4 });
  },
  overtime() {
    [440, 392, 330, 262].forEach((f, i) => {
      tone({ freq: f, type: 'triangle', dur: 0.30, gain: 0.11, delay: i * 0.14 });
    });
  },
  warn() {
    tone({ freq: 300, to: 220, type: 'sawtooth', dur: 0.18, gain: 0.08 });
  }
};