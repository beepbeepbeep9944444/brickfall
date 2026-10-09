// On-screen controls for phones and tablets (landscape): a movement stick on the left (push it to
// the edge to sprint), drag anywhere else to look, and buttons for hit / use / jump. Tap a hotbar
// slot to switch items. Only active on touch-first devices (see core/platform.js).
import { $, clamp } from '../core/util.js';
import { game, input } from '../core/state.js';
import { settings } from '../core/settings.js';
import { events } from '../core/events.js';
import { TOUCH } from '../core/platform.js';
import { releaseLock } from '../core/input.js';
import { canvas } from '../render/scene.js';
import { player } from '../game/entities.js';
import { selectSlot } from '../game/player.js';
import { openChat } from './chat.js';

const DEAD_ZONE = 0.3, SPRINT_AT = 0.9;

/** Keep receiving a finger's moves even when it slides off the control (not supported everywhere). */
function capture(el, id) { try { el.setPointerCapture(id); } catch { /* fine without it */ } }
const LOOK_SCALE = 0.00075; // radians per pixel dragged, per sensitivity step (default 8: ~35 degrees per 100 px)
const HOLD_CPS = 7; // holding the hit button clicks this many times per second

function stick() {
  const el = $('tstick'), knob = el.firstElementChild;
  let id = null, cx = 0, cy = 0;
  const set = (dx, dy) => {
    const r = el.clientWidth / 2, len = Math.hypot(dx, dy), k = len > r ? r / len : 1;
    const x = dx * k, y = dy * k, nx = x / r, ny = y / r;
    knob.style.transform = `translate(${x}px, ${y}px)`;
    input.keys.KeyW = ny < -DEAD_ZONE;
    input.keys.KeyS = ny > DEAD_ZONE;
    input.keys.KeyA = nx < -DEAD_ZONE;
    input.keys.KeyD = nx > DEAD_ZONE;
    input.touchSprint = Math.hypot(nx, ny) > SPRINT_AT && ny < -0.5;
  };
  el.addEventListener('pointerdown', (e) => {
    if (id !== null) return;
    id = e.pointerId;
    capture(el, id);
    const r = el.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    set(e.clientX - cx, e.clientY - cy);
  });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e.clientX - cx, e.clientY - cy); });
  const end = (e) => { if (e.pointerId !== id) return; id = null; set(0, 0); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

/** Drag on the game view to look around. */
function look() {
  let id = null, lx = 0, ly = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || id !== null || game.state !== 'playing') return;
    id = e.pointerId;
    lx = e.clientX;
    ly = e.clientY;
  });
  addEventListener('pointermove', (e) => {
    if (e.pointerId !== id || !input.locked || !player.alive) return;
    const s = settings.sens * LOOK_SCALE;
    player.yaw -= (e.clientX - lx) * s;
    player.pitch = clamp(player.pitch - (e.clientY - ly) * s * (settings.invertY ? -1 : 1), -1.55, 1.55);
    lx = e.clientX;
    ly = e.clientY;
  });
  const end = (e) => { if (e.pointerId === id) id = null; };
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
}

/** A button that holds while pressed. */
function hold(elId, down, up) {
  const el = $(elId);
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); capture(el, e.pointerId); el.classList.add('on'); down(); });
  const end = () => { el.classList.remove('on'); up(); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

export function initTouch() {
  if (!TOUCH) return;
  document.body.classList.add('is-touch');
  $('touchnote').classList.add('hidden');
  stick();
  look();

  let repeat = 0;
  hold('tattack', () => {
    input.lmb = true;
    input.clicks = Math.min(input.clicks + 1, 4);
    repeat = setInterval(() => { input.clicks = Math.min(input.clicks + 1, 4); }, 1000 / HOLD_CPS);
  }, () => { input.lmb = false; clearInterval(repeat); });
  hold('tuse', () => { input.rmb = true; input.rmbEdge = true; }, () => { input.rmb = false; });
  hold('tjump', () => { input.keys.Space = true; }, () => { input.keys.Space = false; });
  $('tpause').onclick = () => releaseLock();
  $('tchat').onclick = () => openChat();

  // tap a hotbar slot to switch to it
  $('hotbar').addEventListener('pointerdown', (e) => {
    const slot = e.target.closest('.slot');
    if (!slot || game.state !== 'playing') return;
    selectSlot([...slot.parentNode.children].indexOf(slot));
  });

  events.on('gameStart', () => $('touch').classList.remove('hidden'));
  events.on('gameEnd', () => $('touch').classList.add('hidden'));
}
