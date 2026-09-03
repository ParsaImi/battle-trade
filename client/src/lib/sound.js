// Tiny Web Audio beeps — no external audio files. Every call is wrapped
// defensively since autoplay policies / unsupported browsers should never
// crash the game, just play nothing.

const MUTE_KEY = 'battle-trade:muted';

let ctx = null;
function getCtx() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    ctx = new AudioCtx();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function isMuted() {
  return localStorage.getItem(MUTE_KEY) === '1';
}

export function setMuted(muted) {
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  updateAmbientVolume();
}

function tone(freq, duration, { type = 'sine', gain = 0.15, delay = 0 } = {}) {
  if (isMuted()) return;
  try {
    const c = getCtx();
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = 0;
    osc.connect(g);
    g.connect(c.destination);
    const start = c.currentTime + delay;
    osc.start(start);
    g.gain.linearRampToValueAtTime(gain, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.stop(start + duration + 0.03);
  } catch {
    // audio unavailable — fail silently
  }
}

// Like tone(), but glides frequency from -> to (a literal "rising tone").
function sweep(fromFreq, toFreq, duration, { type = 'sine', gain = 0.15, delay = 0 } = {}) {
  if (isMuted()) return;
  try {
    const c = getCtx();
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    const start = c.currentTime + delay;
    osc.frequency.setValueAtTime(fromFreq, start);
    osc.frequency.exponentialRampToValueAtTime(toFreq, start + duration);
    g.gain.value = 0;
    osc.connect(g);
    g.connect(c.destination);
    osc.start(start);
    g.gain.linearRampToValueAtTime(gain, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.stop(start + duration + 0.03);
  } catch {
    // audio unavailable — fail silently
  }
}

// A scatter of short overlapping high tones — the closest a few oscillators
// can get to a "crowd reaction" without a sampled noise buffer.
function crowdBurst(delay = 0) {
  const freqs = [740, 880, 990, 1175, 1320, 1568];
  freqs.forEach((f, i) => {
    tone(f + (Math.random() * 50 - 25), 0.45, { type: 'sine', gain: 0.025, delay: delay + i * 0.02 + Math.random() * 0.03 });
  });
}

// Trade Open — a click into a metallic confirmation ping.
export function playClick() {
  tone(700, 0.03, { type: 'square', gain: 0.06 });
  tone(1200, 0.09, { type: 'triangle', gain: 0.05, delay: 0.02 });
  tone(1800, 0.07, { type: 'sine', gain: 0.03, delay: 0.03 });
}

// Profit (a correct round) — cha-ching.
export function playCorrect() {
  tone(1046.5, 0.1, { type: 'triangle', gain: 0.12 });
  tone(1568, 0.14, { type: 'triangle', gain: 0.1, delay: 0.06 });
  tone(2093, 0.08, { type: 'sine', gain: 0.05, delay: 0.08 });
}

// Loss (a wrong round) — short and dry, no sustain.
export function playWrong() {
  tone(180, 0.09, { type: 'square', gain: 0.1 });
}

// Match win. Streak scales the payout, so it scales the sound too:
// streak 1-2 is a "Big Profit" (rising tone + a deeper layer underneath),
// streak 3+ escalates to a "Massive Win" (bass hit + crowd + a full chord).
export function playWin(streak = 1) {
  if (streak >= 3) {
    tone(60, 0.32, { type: 'sine', gain: 0.16 });
    tone(46, 0.36, { type: 'sine', gain: 0.1, delay: 0.02 });
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, { type: 'triangle', gain: 0.12, delay: i * 0.07 }));
    crowdBurst(0.08);
  } else {
    tone(180, 0.4, { type: 'sine', gain: 0.12 });
    sweep(420, 940, 0.32, { type: 'sawtooth', gain: 0.09 });
  }
}

// Match loss — short and dry, like the round Loss cue but a touch bigger.
export function playLose() {
  tone(150, 0.16, { type: 'square', gain: 0.12 });
  tone(110, 0.2, { type: 'square', gain: 0.09, delay: 0.09 });
}

// Soft procedurally-generated ambient loop for the lobby — a handful of
// slow, quiet pad notes from a pentatonic scale, no external audio files.
const AMBIENT_NOTES = [130.81, 146.83, 164.81, 196.0, 220.0]; // C3 D3 E3 G3 A3
const AMBIENT_VOLUME = 0.045;

let ambientGain = null;
let ambientTimer = null;
let ambientRunning = false;

function scheduleAmbientNote() {
  if (!ambientRunning) return;
  try {
    const c = getCtx();
    const freq = AMBIENT_NOTES[Math.floor(Math.random() * AMBIENT_NOTES.length)];
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.value = 0;
    osc.connect(g);
    g.connect(ambientGain);
    const now = c.currentTime;
    osc.start(now);
    g.gain.linearRampToValueAtTime(1, now + 1.4);
    g.gain.linearRampToValueAtTime(0, now + 4);
    osc.stop(now + 4.1);
  } catch {
    // audio unavailable — fail silently
  }
  ambientTimer = setTimeout(scheduleAmbientNote, 2000 + Math.random() * 1600);
}

export function startAmbient() {
  if (ambientRunning) return;
  try {
    const c = getCtx();
    ambientGain = c.createGain();
    ambientGain.gain.value = isMuted() ? 0 : AMBIENT_VOLUME;
    ambientGain.connect(c.destination);
    ambientRunning = true;
    scheduleAmbientNote();
  } catch {
    // audio unavailable — fail silently
  }
}

export function stopAmbient() {
  ambientRunning = false;
  clearTimeout(ambientTimer);
  if (ambientGain) {
    const node = ambientGain;
    ambientGain = null;
    try {
      const c = getCtx();
      node.gain.linearRampToValueAtTime(0, c.currentTime + 0.4);
      setTimeout(() => node.disconnect(), 500);
    } catch {
      // ignore
    }
  }
}

function updateAmbientVolume() {
  if (!ambientGain) return;
  try {
    ambientGain.gain.linearRampToValueAtTime(isMuted() ? 0 : AMBIENT_VOLUME, getCtx().currentTime + 0.25);
  } catch {
    // ignore
  }
}
