// Small notification toasts (top center) for system messages.
import { $ } from '../core/util.js';
import { sfx } from '../core/audio.js';

const MAX = 3;

/** type: 'info' | 'success' | 'error' */
export function notify(text, { type = 'info', ms = 3600 } = {}) {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = text;
  box.appendChild(el);
  while (box.children.length > MAX) box.firstChild.remove();
  if (type === 'error') sfx('error');
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 300);
  }, ms);
}
