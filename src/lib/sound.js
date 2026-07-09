/**
 * sound.js — procedural cyberpunk SFX via the Web Audio API.
 * No audio files needed; everything is synthesized. Respects a global mute flag.
 */
let ctx = null;
let muted = false;
let master = null;

function ensure() {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setMuted(v) { muted = !!v; } // mute só dos efeitos (SFX); a música tem on/off próprio
export function isMuted() { return muted; }

function tone({ freq = 440, type = 'sine', dur = 0.12, gain = 0.2, slideTo = null, delay = 0 }) {
  const c = ensure();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

function noiseBurst({ dur = 0.18, gain = 0.12 }) {
  const c = ensure();
  if (!c || muted) return;
  const buffer = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = c.createBufferSource();
  const g = c.createGain();
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass'; filter.frequency.value = 1200; filter.Q.value = 0.8;
  g.gain.value = gain;
  src.buffer = buffer; src.connect(filter); filter.connect(g); g.connect(master);
  src.start();
}

// ─────────────────────────────────────────────────────────────────────────
// Música em loop (synthwave) p/ a tela de login — sequenciador Web Audio.
// Progressão Am–F–C–G (cativante), com baixo, arpejo, kick e hi-hat.
// ─────────────────────────────────────────────────────────────────────────
let musicGain = null;
let musicOn = false;
let schedulerId = null;
let nextStepTime = 0;
let musicStep = 0;
let bgMode = false;                  // após o login: volume de fundo
let transitionTimer = null;          // troca de trilha com crossfade
const MUSIC_FG = 0.34;               // volume na tela de login
const MUSIC_BG = 0.17;               // volume de fundo (após login)
const LOOKAHEAD = 0.12;
const musicVol = () => (bgMode ? MUSIC_BG : MUSIC_FG);

// 5 trilhas em loop (cada uma com sua progressão, andamento e timbre).
export const MUSIC_TRACKS = [
  { id: 'synthwave', name: 'Synthwave', bpm: 112, bassType: 'sawtooth', arpType: 'square',   cutoff: 1900, bassGain: 0.30, arpGain: 0.085, kick: true,  hat: true,  lead: true,
    chords: [ { bass: 110.00, tones: [220.00, 261.63, 329.63] }, { bass: 87.31, tones: [174.61, 220.00, 261.63] }, { bass: 130.81, tones: [261.63, 329.63, 392.00] }, { bass: 98.00, tones: [196.00, 246.94, 293.66] } ] },
  { id: 'chill',     name: 'Lo-Fi Chill', bpm: 82, bassType: 'sine', arpType: 'triangle', cutoff: 1300, bassGain: 0.26, arpGain: 0.07, kick: true, hat: true, lead: false,
    chords: [ { bass: 146.83, tones: [293.66, 349.23, 440.00] }, { bass: 98.00, tones: [196.00, 246.94, 293.66] }, { bass: 130.81, tones: [261.63, 329.63, 392.00] }, { bass: 110.00, tones: [220.00, 261.63, 329.63] } ] },
  { id: 'dark',      name: 'Dark Drift', bpm: 96, bassType: 'sawtooth', arpType: 'sawtooth', cutoff: 900, bassGain: 0.30, arpGain: 0.075, kick: true, hat: true, lead: false,
    chords: [ { bass: 82.41, tones: [164.81, 196.00, 246.94] }, { bass: 110.00, tones: [220.00, 261.63, 329.63] }, { bass: 146.83, tones: [293.66, 349.23, 440.00] }, { bass: 82.41, tones: [164.81, 196.00, 246.94] } ] },
  { id: 'dream',     name: 'Dream Pad', bpm: 70, bassType: 'sine', arpType: 'sine', cutoff: 1200, bassGain: 0.12, arpGain: 0.05, kick: false, hat: false, lead: true, pad: true,
    chords: [ { bass: 87.31, tones: [174.61, 220.00, 261.63] }, { bass: 130.81, tones: [261.63, 329.63, 392.00] }, { bass: 98.00, tones: [196.00, 246.94, 293.66] }, { bass: 110.00, tones: [220.00, 261.63, 329.63] } ] },
];
let currentTrack = MUSIC_TRACKS[0];
const stepDur = () => 60 / currentTrack.bpm / 4;
const totalSteps = () => currentTrack.chords.length * 16;

function mvoice(t0, freq, dur, gain, type, cutoff) {
  const c = ctx; if (!c) return;
  const osc = c.createOscillator(); const g = c.createGain(); const f = c.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = cutoff || 2000;
  osc.type = type; osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(f); f.connect(g); g.connect(musicGain);
  osc.start(t0); osc.stop(t0 + dur + 0.03);
}
function mkick(t0) {
  const c = ctx; if (!c) return;
  const osc = c.createOscillator(); const g = c.createGain();
  osc.type = 'sine'; osc.frequency.setValueAtTime(135, t0); osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.12);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.85, t0 + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.19);
  osc.connect(g); g.connect(musicGain); osc.start(t0); osc.stop(t0 + 0.22);
}
function mhat(t0, gain) {
  const c = ctx; if (!c) return;
  const dur = 0.03; const b = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate); const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = c.createBufferSource(); const f = c.createBiquadFilter(); const g = c.createGain();
  f.type = 'highpass'; f.frequency.value = 7000; g.gain.value = gain;
  s.buffer = b; s.connect(f); f.connect(g); g.connect(musicGain); s.start(t0);
}
function scheduleMusicStep(stepIndex, t0) {
  const T = currentTrack;
  const nBars = T.chords.length;
  const bar = Math.floor(stepIndex / 16) % nBars;
  const s = stepIndex % 16;
  const chord = T.chords[bar];
  if (T.pad) { // modo ambiente: pad sustentado por compasso
    const barDur = stepDur() * 16;
    if (s === 0) {
      for (const f of chord.tones) mvoice(t0, f, barDur * 0.95, 0.05, T.arpType, T.cutoff);
      mvoice(t0, chord.bass, barDur * 0.95, 0.11, T.bassType, 700);
    }
    if (T.lead && s === 8) mvoice(t0, chord.tones[2] * 2, barDur * 0.4, 0.045, 'triangle', 2600);
    return;
  }
  if (s % 4 === 0) { const f = (s === 8) ? chord.bass * 2 : chord.bass; mvoice(t0, f, 0.26, T.bassGain, T.bassType, 650); }
  const arpSeq = [0, 1, 2, 1];
  const idx = arpSeq[s % 4];
  const oct = (Math.floor(s / 8) % 2) ? 2 : 1; // sobe uma oitava na 2ª metade do compasso
  mvoice(t0, chord.tones[idx] * oct, 0.13, T.arpGain, T.arpType, T.cutoff);
  if (T.kick && (s === 0 || s === 8)) mkick(t0);
  if (T.hat && s % 2 === 1) mhat(t0, s % 4 === 3 ? 0.045 : 0.028);
  if (T.lead && bar === nBars - 1 && (s === 12 || s === 14)) mvoice(t0, chord.tones[2] * 2, 0.18, 0.07, 'triangle', 2600);
}
function musicScheduler() {
  if (!ctx) return;
  while (nextStepTime < ctx.currentTime + LOOKAHEAD) {
    scheduleMusicStep(musicStep, nextStepTime);
    nextStepTime += stepDur();
    musicStep = (musicStep + 1) % totalSteps();
  }
}

export const music = {
  tracks: MUSIC_TRACKS,
  current() { return currentTrack.id; },
  setTrack(id) {
    const t = MUSIC_TRACKS.find((x) => x.id === id);
    if (!t || t === currentTrack) return;
    currentTrack = t;
    if (musicOn && ctx) { musicStep = 0; nextStepTime = ctx.currentTime + 0.05; } // recomeça o loop na nova trilha
    try { localStorage.setItem('tng_music_track', id); } catch {}
  },
  // background=true → volume mais baixo (de fundo, após o login)
  setBackground(b) {
    bgMode = !!b;
    if (musicGain && ctx) { const now = ctx.currentTime; musicGain.gain.cancelScheduledValues(now); musicGain.gain.setValueAtTime(musicGain.gain.value, now); musicGain.gain.linearRampToValueAtTime(musicVol(), now + 1.0); }
  },
  // Troca de trilha com CROSSFADE: baixa a atual gradualmente até ~0, troca a
  // trilha e sobe a nova gradualmente até o volume-alvo (FG no login, 0.17 fundo).
  transition(trackId, background, opts = {}) {
    const c = ensure(); if (!c) return;
    bgMode = !!background;
    const target = musicVol();
    if (!musicOn || !musicGain) { const t = MUSIC_TRACKS.find((x) => x.id === trackId); if (t) currentTrack = t; return; }
    if (currentTrack.id === trackId && Math.abs((musicGain.gain.value || 0) - target) < 0.001) return;
    const fadeOut = opts.fadeOut != null ? opts.fadeOut : 1.4; // s
    const fadeIn = opts.fadeIn != null ? opts.fadeIn : 1.8;    // s
    const now = c.currentTime;
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setValueAtTime(Math.max(0.0001, musicGain.gain.value), now);
    musicGain.gain.linearRampToValueAtTime(0.0001, now + fadeOut); // fade-out da anterior
    if (transitionTimer) clearTimeout(transitionTimer);
    transitionTimer = setTimeout(() => {
      transitionTimer = null;
      if (!musicOn || !ctx || !musicGain) return;
      const t = MUSIC_TRACKS.find((x) => x.id === trackId);
      if (t) { currentTrack = t; musicStep = 0; nextStepTime = ctx.currentTime + 0.05; try { localStorage.setItem('tng_music_track', trackId); } catch {} }
      const n2 = ctx.currentTime;
      musicGain.gain.cancelScheduledValues(n2);
      musicGain.gain.setValueAtTime(0.0001, n2);
      musicGain.gain.linearRampToValueAtTime(target, n2 + fadeIn); // fade-in da nova
    }, fadeOut * 1000 + 40);
  },
  start(trackId) {
    const c = ensure(); if (!c) return;
    if (trackId) { const t = MUSIC_TRACKS.find((x) => x.id === trackId); if (t) currentTrack = t; }
    if (musicOn) return;
    if (!musicGain) { musicGain = c.createGain(); musicGain.gain.value = 0.0001; musicGain.connect(master); }
    musicOn = true;
    const now = c.currentTime;
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setValueAtTime(0.0001, now);
    musicGain.gain.linearRampToValueAtTime(musicVol(), now + 1.6); // fade-in
    musicStep = 0; nextStepTime = c.currentTime + 0.08;
    if (schedulerId) clearInterval(schedulerId);
    schedulerId = setInterval(musicScheduler, 25);
  },
  stop() {
    if (!musicOn) return;
    musicOn = false;
    if (transitionTimer) { clearTimeout(transitionTimer); transitionTimer = null; }
    if (schedulerId) { clearInterval(schedulerId); schedulerId = null; }
    if (musicGain && ctx) { const now = ctx.currentTime; musicGain.gain.cancelScheduledValues(now); musicGain.gain.setValueAtTime(musicGain.gain.value, now); musicGain.gain.linearRampToValueAtTime(0.0001, now + 0.5); }
  },
  isPlaying() { return musicOn; },
};

export const sfx = {
  hover()   { tone({ freq: 880, type: 'sine', dur: 0.05, gain: 0.05 }); },
  click()   { tone({ freq: 660, type: 'square', dur: 0.07, gain: 0.1, slideTo: 990 }); },
  toggle()  { tone({ freq: 520, type: 'triangle', dur: 0.09, gain: 0.12, slideTo: 720 }); },
  open()    { tone({ freq: 300, slideTo: 900, type: 'sawtooth', dur: 0.22, gain: 0.12 }); },
  close()   { tone({ freq: 700, slideTo: 220, type: 'sawtooth', dur: 0.2, gain: 0.1 }); },
  connect() { tone({ freq: 440, slideTo: 880, type: 'sawtooth', dur: 0.16, gain: 0.14 }); tone({ freq: 660, slideTo: 1320, type: 'square', dur: 0.18, gain: 0.1, delay: 0.12 }); },
  success() { tone({ freq: 523, type: 'sine', dur: 0.12, gain: 0.16 }); tone({ freq: 784, type: 'sine', dur: 0.14, gain: 0.16, delay: 0.1 }); tone({ freq: 1046, type: 'sine', dur: 0.22, gain: 0.16, delay: 0.2 }); },
  error()   { tone({ freq: 220, slideTo: 90, type: 'sawtooth', dur: 0.32, gain: 0.18 }); noiseBurst({ dur: 0.2, gain: 0.08 }); },
  alarm()   { tone({ freq: 880, slideTo: 440, type: 'square', dur: 0.5, gain: 0.12 }); },
  boot()    { tone({ freq: 120, slideTo: 1200, type: 'sawtooth', dur: 0.6, gain: 0.14 }); noiseBurst({ dur: 0.3, gain: 0.05 }); },
  type()    { tone({ freq: 1400 + Math.random() * 400, type: 'square', dur: 0.02, gain: 0.03 }); },
};
