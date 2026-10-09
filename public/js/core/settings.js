// Player settings, persisted in localStorage.
import { store } from './util.js';

export const SETTINGS_DEFAULT = Object.freeze({
  fov: 78,
  renderDist: 125,
  brightness: 50,
  quality: 1,
  particles: 2,
  guiScale: 1,
  crosshair: 'plus',
  bobbing: true,
  clouds: true,
  showFps: false,
  sens: 8,
  invertY: false,
  toggleSprint: false,
  volume: 70,
  uiSounds: true,
  chat: true,
});

const KEY = 'bf_settings';

function load() {
  let saved = {};
  try { saved = JSON.parse(store.get(KEY, '{}')) || {}; } catch { saved = {}; }
  // keep only known keys with the right type, so a corrupted save can't break the game
  const clean = {};
  for (const [k, v] of Object.entries(saved)) {
    if (k in SETTINGS_DEFAULT && typeof v === typeof SETTINGS_DEFAULT[k]) clean[k] = v;
  }
  return clean;
}

export const settings = { ...SETTINGS_DEFAULT, ...load() };

export function saveSettings() {
  store.set(KEY, JSON.stringify(settings));
}

export function resetSettings() {
  Object.assign(settings, SETTINGS_DEFAULT);
  saveSettings();
}
