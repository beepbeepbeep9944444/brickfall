// Procedural sound effects (Web Audio, no audio files). Tones are layered with
// filtered noise so hits and blocks sound percussive rather than beepy.
import { settings } from './settings.js';

let ctx = null;
let master = null;
let platformMuted = false; // the host site (CrazyGames) asked for silence
let noiseBuffer = null;

/** Must be called from a user gesture (browsers block audio until then). */
export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.connect(ctx.destination);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    setVolume();
  } catch {
    ctx = null;
  }
}

export function setVolume() {
  if (master) master.gain.value = platformMuted ? 0 : (settings.volume / 100) * 0.9;
}

/** Mute everything regardless of the volume setting (CrazyGames' mute button). */
export function setPlatformMute(muted) {
  platformMuted = !!muted;
  setVolume();
}

function envelope(gainNode, t, peak, dur) {
  gainNode.gain.setValueAtTime(0.0001, t);
  gainNode.gain.linearRampToValueAtTime(peak, t + 0.005);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

function tone({ type = 'sine', f0, f1 = f0, dur, gain, delay = 0 }) {
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  envelope(g, t, gain, dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise({ dur, gain, freq = 1000, q = 1, filter = 'bandpass', sweepTo, delay = 0 }) {
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  src.buffer = noiseBuffer;
  f.type = filter;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = q;
  envelope(g, t, gain, dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

const SOUNDS = {
  hit() { noise({ dur: 0.08, gain: 0.4, freq: 900, q: 0.8 }); tone({ type: 'square', f0: 220, f1: 110, dur: 0.07, gain: 0.05 }); },
  crit() { noise({ dur: 0.11, gain: 0.45, freq: 1800, q: 1 }); tone({ type: 'square', f0: 560, f1: 210, dur: 0.1, gain: 0.06 }); },
  hurt() { noise({ dur: 0.13, gain: 0.32, freq: 480, q: 0.7 }); tone({ type: 'sawtooth', f0: 210, f1: 80, dur: 0.16, gain: 0.07 }); },
  swing() { noise({ dur: 0.1, gain: 0.07, freq: 1200, q: 0.7, sweepTo: 3200 }); },
  bow() { tone({ type: 'triangle', f0: 900, f1: 180, dur: 0.14, gain: 0.09 }); noise({ dur: 0.12, gain: 0.12, freq: 3000, q: 2 }); },
  place() { noise({ dur: 0.05, gain: 0.3, freq: 420, q: 1.2 }); tone({ f0: 180, f1: 120, dur: 0.06, gain: 0.07 }); },
  break() { noise({ dur: 0.13, gain: 0.32, freq: 320, q: 0.9 }); },
  drink() { for (let i = 0; i < 3; i++) tone({ f0: 420 + i * 130, f1: 620 + i * 130, dur: 0.08, gain: 0.06, delay: i * 0.09 }); },
  splash() { noise({ dur: 0.18, gain: 0.3, freq: 4200, q: 1.5, sweepTo: 1800 }); [1900, 2600, 3300].forEach((f, i) => tone({ type: 'triangle', f0: f, f1: f * 0.8, dur: 0.07, gain: 0.03, delay: 0.02 + i * 0.03 })); },
  pearl() { tone({ type: 'sine', f0: 300, f1: 1400, dur: 0.18, gain: 0.08 }); noise({ dur: 0.2, gain: 0.12, freq: 900, q: 0.8, sweepTo: 3000 }); },
  kill() { [660, 880, 1320].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.15, gain: 0.1, delay: i * 0.07 })); },
  streak() { [523, 659, 784, 1046].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.16, gain: 0.08, delay: i * 0.06 })); },
  death() { [440, 330, 220].forEach((f, i) => tone({ type: 'triangle', f0: f, f1: f * 0.94, dur: 0.24, gain: 0.09, delay: i * 0.13 })); },
  click() { tone({ f0: 620, f1: 500, dur: 0.05, gain: 0.05 }); },
  hover() { tone({ f0: 1100, dur: 0.025, gain: 0.012 }); },
  error() { tone({ type: 'square', f0: 220, f1: 180, dur: 0.12, gain: 0.04 }); tone({ type: 'square', f0: 180, f1: 150, dur: 0.14, gain: 0.04, delay: 0.1 }); },
};

/** Play a named sound. Silently does nothing before audio is unlocked. */
export function sfx(name) {
  if (!ctx || !SOUNDS[name]) return;
  if ((name === 'click' || name === 'hover') && !settings.uiSounds) return;
  if (ctx.state === 'suspended') ctx.resume();
  SOUNDS[name]();
}
