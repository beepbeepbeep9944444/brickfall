// Keyboard, mouse and pointer-lock handling. Writes into `input` and the player's look angles.
import { clamp } from './util.js';
import { game, input } from './state.js';
import { settings } from './settings.js';
import { events } from './events.js';
import { canvas } from '../render/scene.js';
import { TOUCH } from './platform.js';
import { player } from '../game/entities.js';
import { selectSlot } from '../game/player.js';

const LOOK_SCALE = 0.00028;
const DOUBLE_TAP_MS = 350; // 7 ticks
let lastWDown = 0;

/** Touch devices have no pointer lock: "locked" just means the game has control. */
function setTouchLock(locked) {
  if (input.locked === locked) return;
  input.locked = locked;
  if (!locked) { input.lmb = input.rmb = false; input.clicks = 0; for (const k in input.keys) input.keys[k] = false; }
  events.emit('lockChange', { locked });
}

export function requestLock() {
  if (TOUCH) {
    try { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); } catch { /* not allowed here */ }
    setTouchLock(true);
    return;
  }
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {}); // the browser refuses re-locks for ~1s after Esc
  } catch { /* unsupported */ }
}

export function releaseLock() {
  if (TOUCH) { setTouchLock(false); return; }
  if (document.pointerLockElement) document.exitPointerLock();
}

const isTyping = (e) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
const SLOT_KEY = /^Digit[1-9]$/;

export function initInput() {
  addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    const playing = game.state === 'playing';
    if (e.code === 'KeyW' && !e.repeat) {
      const now = performance.now();
      if (now - lastWDown < DOUBLE_TAP_MS) input.dtSprint = true;
      lastWDown = now;
    }
    input.keys[e.code] = true;
    if (playing && SLOT_KEY.test(e.code) && +e.code[5] <= game.hotbar.length) selectSlot(+e.code[5] - 1);
    if (playing && e.code === 'F5') { e.preventDefault(); game.view = (game.view + 1) % 3; }
    if (settings.toggleSprint && !e.repeat && (e.code === 'ShiftLeft' || e.code === 'ControlLeft')) input.sprintToggled = !input.sprintToggled;
    if (input.locked && (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'ControlLeft')) e.preventDefault();
  });
  addEventListener('keyup', (e) => { input.keys[e.code] = false; });
  addEventListener('blur', () => {
    for (const k in input.keys) input.keys[k] = false;
    input.lmb = input.rmb = false;
  });

  canvas.addEventListener('mousedown', (e) => {
    if (game.state !== 'playing') return;
    if (!input.locked) { requestLock(); return; }
    if (e.button === 0) { input.lmb = true; input.clicks = Math.min(input.clicks + 1, 4); }
    if (e.button === 2) { input.rmb = true; input.rmbEdge = true; }
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) input.lmb = false;
    if (e.button === 2) input.rmb = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  addEventListener('mousemove', (e) => {
    if (!input.locked || game.state !== 'playing' || !player.alive) return;
    const s = settings.sens * LOOK_SCALE;
    player.yaw -= e.movementX * s;
    player.pitch = clamp(player.pitch - e.movementY * s * (settings.invertY ? -1 : 1), -1.55, 1.55);
  });
  addEventListener('wheel', (e) => {
    if (game.state !== 'playing' || !input.locked) return;
    const n = game.hotbar.length;
    selectSlot((player.slot + (e.deltaY > 0 ? 1 : -1) + n) % n);
  }, { passive: true });

  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (!input.locked) { input.lmb = input.rmb = false; input.clicks = 0; }
    events.emit('lockChange', { locked: input.locked });
  });
}
