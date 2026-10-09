// Options screen (video / controls / audio).
import { $ } from '../core/util.js';
import { settings, saveSettings, resetSettings } from '../core/settings.js';
import { setVolume } from '../core/audio.js';
import { events } from '../core/events.js';
import { applyVideoSettings } from '../render/scene.js';
import { screens } from './screens.js';

const OPTIONS = {
  video: [
    { k: 'fov', label: 'Field of view', type: 'range', min: 50, max: 110, fmt: (v) => `${v}°` },
    { k: 'renderDist', label: 'Render distance', type: 'range', min: 40, max: 200, step: 5, fmt: (v) => `${v} blocks` },
    { k: 'brightness', label: 'Brightness', type: 'range', min: 0, max: 100, fmt: (v) => (v === 0 ? 'Dim' : v === 100 ? 'Bright' : `${v}%`) },
    { k: 'quality', label: 'Render quality', type: 'cycle', opts: [[0.5, 'Retro'], [0.75, 'Fast'], [1, 'Balanced'], [1.5, 'Sharp']] },
    { k: 'particles', label: 'Particles', type: 'cycle', opts: [[2, 'All'], [1, 'Fewer'], [0, 'Minimal']] },
    { k: 'guiScale', label: 'Interface size', type: 'cycle', opts: [[0.85, 'Small'], [1, 'Normal'], [1.15, 'Large']] },
    { k: 'crosshair', label: 'Crosshair', type: 'cycle', opts: [['plus', 'Plus'], ['dot', 'Dot'], ['ring', 'Ring']] },
    { k: 'bobbing', label: 'View bobbing', type: 'toggle' },
    { k: 'clouds', label: 'Clouds', type: 'toggle' },
    { k: 'showFps', label: 'Show FPS (F3)', type: 'toggle' },
  ],
  controls: [
    { k: 'sens', label: 'Mouse sensitivity', type: 'range', min: 1, max: 20 },
    { k: 'invertY', label: 'Invert mouse Y', type: 'toggle' },
    { k: 'toggleSprint', label: 'Sprint', type: 'cycle', opts: [[false, 'Hold'], [true, 'Toggle']] },
    { k: 'chat', label: 'Chat (T to talk)', type: 'toggle' },
  ],
  audio: [
    { k: 'volume', label: 'Master volume', type: 'range', min: 0, max: 100, fmt: (v) => (v === 0 ? 'Off' : `${v}%`) },
    { k: 'uiSounds', label: 'Menu sounds', type: 'toggle' },
  ],
};

let tab = 'video';

/** Push every setting into the game (3D scene, DOM, audio). */
export function applyAllSettings() {
  applyVideoSettings();
  document.documentElement.style.setProperty('--gui', settings.guiScale);
  $('fps').classList.toggle('hidden', !settings.showFps);
  $('cross').dataset.style = settings.crosshair;
  setVolume();
}

function changed() {
  applyAllSettings();
  saveSettings();
  events.emit('settingsChanged');
}

function rangeRow(o) {
  const el = document.createElement('div');
  el.className = 'opt';
  const id = `opt-${o.k}`;
  el.innerHTML = `<div class="opt-label"><label for="${id}">${o.label}</label><b></b></div>
    <input id="${id}" type="range" min="${o.min}" max="${o.max}" step="${o.step || 1}">`;
  const inp = el.querySelector('input'), out = el.querySelector('b');
  inp.value = settings[o.k];
  const show = () => { out.textContent = o.fmt ? o.fmt(+inp.value) : inp.value; };
  show();
  inp.oninput = () => { settings[o.k] = +inp.value; show(); changed(); };
  return el;
}

function buttonRow(o) {
  const el = document.createElement('div');
  el.className = 'opt opt-row';
  el.innerHTML = `<div class="opt-label"><span>${o.label}</span></div><button class="opt-btn" type="button"></button>`;
  const btn = el.querySelector('button');
  const label = () => {
    if (o.type === 'toggle') {
      btn.textContent = settings[o.k] ? 'On' : 'Off';
      btn.classList.toggle('off', !settings[o.k]);
      btn.setAttribute('aria-pressed', String(settings[o.k]));
    } else {
      btn.textContent = (o.opts.find((x) => x[0] === settings[o.k]) || o.opts[0])[1];
    }
  };
  label();
  btn.onclick = () => {
    if (o.type === 'toggle') settings[o.k] = !settings[o.k];
    else { const i = o.opts.findIndex((x) => x[0] === settings[o.k]); settings[o.k] = o.opts[(i + 1) % o.opts.length][0]; }
    label();
    changed();
  };
  return el;
}

function render() {
  document.querySelectorAll('#otabs button').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  const body = $('optbody');
  body.innerHTML = '';
  for (const o of OPTIONS[tab]) body.appendChild(o.type === 'range' ? rangeRow(o) : buttonRow(o));
}

export function initOptions() {
  document.querySelectorAll('#otabs button').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; render(); }; });
  $('optreset').onclick = () => { resetSettings(); applyAllSettings(); render(); events.emit('settingsChanged'); };
  screens.register('options', { onOpen: render });
  addEventListener('keydown', (e) => {
    if (e.code !== 'F3') return;
    e.preventDefault();
    settings.showFps = !settings.showFps;
    changed();
  });
}
