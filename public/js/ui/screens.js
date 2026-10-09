// Screen stack for full-screen panels (menu, pause, options, leaderboard, ...).
// Opening a screen covers the current one; back() returns to it.
import { $ } from '../core/util.js';
import { sfx } from '../core/audio.js';

const stack = [];
const hooks = {};

function show(id, returning) {
  const el = $(id);
  el.classList.remove('hidden');
  hooks[id]?.onOpen?.({ returning });
  if (!returning) {
    const focusable = el.querySelector('[autofocus], input:not([type=range]), .btn-primary');
    if (focusable && matchMedia('(pointer:fine)').matches) focusable.focus({ preventScroll: true });
  }
}

function hide(id, closing) {
  $(id).classList.add('hidden');
  if (closing) hooks[id]?.onClose?.();
}

export const screens = {
  /** Register lifecycle hooks: { onOpen({returning}), onClose() }. */
  register(id, h) { hooks[id] = h; },
  open(id) {
    if (stack.at(-1) === id) return;
    if (stack.length) hide(stack.at(-1), false);
    stack.push(id);
    show(id, false);
  },
  back() {
    const id = stack.pop();
    if (id) hide(id, true);
    if (stack.length) show(stack.at(-1), true);
  },
  /** Close everything, then optionally open `id`. */
  reset(id) {
    while (stack.length) hide(stack.pop(), true);
    if (id) this.open(id);
  },
  top() { return stack.at(-1) || null; },
  get depth() { return stack.length; },
};

/** Shared UI behaviour: [data-back] buttons, button sounds. */
export function initScreens() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    sfx('click');
    if (btn.hasAttribute('data-back')) screens.back();
  });
  document.addEventListener('mouseover', (e) => {
    const btn = e.target.closest('button');
    if (btn && !btn.disabled && !btn.contains(e.relatedTarget)) sfx('hover');
  });
}
