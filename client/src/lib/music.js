// Generated match music — no audio files, same as the rest of the sound engine.
//
// Written rather than loaded for three reasons that actually matter here:
// players on filtered networks cannot be relied on to reach a CDN, one MP3
// would be several times the size of the whole JS bundle, and nothing that is
// generated can have a licence problem.
//
// It also buys the thing a fixed loop cannot: the music follows the match.
// Layers come in as a round gets tense and drop away when it resolves, so the
// last seconds of a guess phase sound different from the reveal.

const MUSIC_KEY = 'battle-trade:music';
const MUTE_KEY = 'battle-trade:muted';

const BPM = 112;
const BEAT = 60 / BPM;
const STEP = BEAT / 4; // sixteenth note
const STEPS_PER_BAR = 16;
const BARS = 8;
const TOTAL_STEPS = BARS * STEPS_PER_BAR;

// How far ahead notes are scheduled, and how often we top the queue up.
// Web Audio needs its own clock: setInterval alone drifts audibly.
const LOOKAHEAD_S = 0.25;
const TICK_MS = 40;

const MASTER_VOLUME = 0.3;

// A minor, i–VI–III–VII. Two bars each: the progression that carries most
// driving game music, and it stays out of the way of the sound effects.
const PROGRESSION = [
  { bass: 45, tones: [57, 60, 64] }, // Am
  { bass: 41, tones: [53, 57, 60] }, // F
  { bass: 48, tones: [52, 55, 60] }, // C
  { bass: 43, tones: [55, 59, 62] }, // G
];

// A minor pentatonic, for the lead phrases.
const PENTATONIC = [69, 72, 74, 76, 79, 81];

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

function musicEnabled() {
  // Muting everything mutes the music too; the music has its own switch on
  // top of that, because plenty of people want the effects and not a track.
  if (localStorage.getItem(MUTE_KEY) === '1') return false;
  return localStorage.getItem(MUSIC_KEY) !== '0';
}

export function isMusicOn() {
  return localStorage.getItem(MUSIC_KEY) !== '0';
}

export function setMusicOn(on) {
  localStorage.setItem(MUSIC_KEY, on ? '1' : '0');
  applyVolume();
}

let ctx = null;
let master = null;
let running = false;
let timer = null;
let step = 0;
let nextTime = 0;
// 0 = calm (reveal / results), 1 = playing, 2 = the clock is running out.
let intensity = 0;
let noiseBuffer = null;

function getCtx() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    ctx = new AudioCtx();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function applyVolume() {
  if (!master) return;
  try {
    const c = getCtx();
    master.gain.linearRampToValueAtTime(musicEnabled() ? MASTER_VOLUME : 0, c.currentTime + 0.3);
  } catch {
    // ignore
  }
}

// --- voices ---------------------------------------------------------------
// Each note builds and tears down its own nodes. At this tempo that is a few
// per second, which is far cheaper than keeping voices alive and gating them.

function pluck(freq, at, dur, { gain = 0.18, type = 'triangle', cutoff = 2600 } = {}) {
  const c = getCtx();
  const osc = c.createOscillator();
  const filt = c.createBiquadFilter();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(cutoff, at);
  filt.frequency.exponentialRampToValueAtTime(Math.max(400, cutoff * 0.35), at + dur);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(filt).connect(g).connect(master);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

// Two detuned saws an octave apart — reads as a bass guitar rather than a beep.
function bass(freq, at, dur, gain = 0.3) {
  const c = getCtx();
  const g = c.createGain();
  const filt = c.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 900;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.02);
  g.gain.setValueAtTime(gain, at + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  g.connect(filt).connect(master);

  for (const [mult, detune, level] of [[1, 0, 1], [1, 7, 0.6], [0.5, 0, 0.8]]) {
    const osc = c.createOscillator();
    const og = c.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = freq * mult;
    osc.detune.value = detune;
    og.gain.value = level;
    osc.connect(og).connect(g);
    osc.start(at);
    osc.stop(at + dur + 0.03);
  }
}

// Slow, quiet chord bed. This is the layer that is always on, so the music
// never fully disappears between rounds.
function pad(freqs, at, dur, gain = 0.055) {
  const c = getCtx();
  const g = c.createGain();
  const filt = c.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 1500;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + dur * 0.35);
  g.gain.linearRampToValueAtTime(0.0001, at + dur);
  g.connect(filt).connect(master);

  for (const f of freqs) {
    for (const detune of [-6, 6]) {
      const osc = c.createOscillator();
      const og = c.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = detune;
      og.gain.value = 0.33;
      osc.connect(og).connect(g);
      osc.start(at);
      osc.stop(at + dur + 0.05);
    }
  }
}

function kick(at, gain = 0.5) {
  const c = getCtx();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, at);
  osc.frequency.exponentialRampToValueAtTime(42, at + 0.12);
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);
  osc.connect(g).connect(master);
  osc.start(at);
  osc.stop(at + 0.26);
}

function getNoise() {
  if (noiseBuffer) return noiseBuffer;
  const c = getCtx();
  const len = Math.floor(c.sampleRate * 0.4);
  noiseBuffer = c.createBuffer(1, len, c.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

function noiseHit(at, dur, { gain = 0.12, hp = 3000, lp = 12000 } = {}) {
  const c = getCtx();
  const src = c.createBufferSource();
  src.buffer = getNoise();
  const hpf = c.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = hp;
  const lpf = c.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = lp;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(hpf).connect(lpf).connect(g).connect(master);
  src.start(at);
  src.stop(at + dur + 0.02);
}

// --- the sequencer --------------------------------------------------------

function scheduleStep(i, at) {
  const bar = Math.floor(i / STEPS_PER_BAR);
  const inBar = i % STEPS_PER_BAR;
  const chord = PROGRESSION[Math.floor(bar / 2) % PROGRESSION.length];
  const tense = intensity >= 2;
  const playing = intensity >= 1;

  // Pad: once per chord change. Always present, so silence never feels broken.
  if (inBar === 0 && bar % 2 === 0) {
    pad(chord.tones.map(midi), at, BEAT * 8, playing ? 0.055 : 0.075);
  }

  // Bass on the beat; eighths when the clock is running down.
  if (inBar % 8 === 0 || (tense && inBar % 4 === 0)) {
    bass(midi(chord.bass), at, BEAT * 0.9, playing ? 0.3 : 0.16);
  }

  if (!playing) return;

  // Four on the floor, with a pickup kick once the round gets tense.
  if (inBar % 4 === 0) kick(at, 0.5);
  if (tense && inBar === 14) kick(at, 0.32);

  // Backbeat.
  if (inBar === 4 || inBar === 12) {
    noiseHit(at, 0.16, { gain: 0.16, hp: 1400, lp: 9000 });
  }

  // Hats: eighths normally, sixteenths when tense.
  if (inBar % 2 === 0 || tense) {
    noiseHit(at, 0.035, { gain: inBar % 4 === 0 ? 0.05 : 0.032, hp: 7000 });
  }

  // Arpeggio through the chord, an octave up, one note per sixteenth.
  const arp = [...chord.tones, chord.tones[1] + 12, chord.tones[2] + 12, chord.tones[1] + 12];
  const note = arp[i % arp.length];
  pluck(midi(note + 12), at, tense ? STEP * 2.4 : STEP * 3.2, {
    gain: tense ? 0.13 : 0.085,
    cutoff: tense ? 4200 : 2400,
  });

  // A lead phrase every other bar once things are tense — the part that makes
  // it sound written rather than looped.
  if (tense && inBar === 0 && bar % 2 === 1) {
    const start = Math.floor(Math.random() * (PENTATONIC.length - 3));
    for (let k = 0; k < 4; k++) {
      pluck(midi(PENTATONIC[start + (k % 3)]), at + k * STEP * 2, STEP * 3, {
        gain: 0.1,
        type: 'square',
        cutoff: 3000,
      });
    }
  }
}

function tick() {
  try {
    const c = getCtx();
    while (nextTime < c.currentTime + LOOKAHEAD_S) {
      // Never schedule in the past: a backgrounded tab can leave nextTime well
      // behind, and catching up would fire hundreds of notes at once.
      if (nextTime > c.currentTime) scheduleStep(step, nextTime);
      step = (step + 1) % TOTAL_STEPS;
      nextTime += STEP;
    }
    if (nextTime < c.currentTime) nextTime = c.currentTime + STEP;
  } catch {
    // audio unavailable — stop trying rather than throwing every tick
    stopMusic();
  }
}

export function startMusic() {
  if (running) return;
  try {
    const c = getCtx();
    master = c.createGain();
    master.gain.value = musicEnabled() ? MASTER_VOLUME : 0;
    master.connect(c.destination);
    step = 0;
    nextTime = c.currentTime + 0.1;
    running = true;
    timer = setInterval(tick, TICK_MS);
  } catch {
    // audio unavailable — the game is perfectly playable in silence
  }
}

export function stopMusic() {
  running = false;
  clearInterval(timer);
  timer = null;
  intensity = 0;
  if (master) {
    const node = master;
    master = null;
    try {
      const c = getCtx();
      node.gain.linearRampToValueAtTime(0, c.currentTime + 0.35);
      setTimeout(() => node.disconnect(), 600);
    } catch {
      // ignore
    }
  }
}

/** 0 calm, 1 playing, 2 the clock is running out. */
export function setMusicIntensity(level) {
  intensity = level;
}

export function refreshMusicVolume() {
  applyVolume();
}
