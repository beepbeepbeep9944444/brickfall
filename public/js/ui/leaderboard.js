// World leaderboard: one board per game mode, ranked by kills, daily / weekly / lifetime.
import { $, esc } from '../core/util.js';
import { game } from '../core/state.js';
import { paintIcon } from '../render/icons.js';
import { faceForSkin } from '../game/characters.js';
import { api, ONLINE } from '../net/api.js';
import { session } from '../net/account.js';
import { screens } from './screens.js';
import { rankedName } from './ranks.js';
import { MODES } from '../shared/modes.js';

const view = { mode: game.mode, period: 'day' };
let modes = MODES;
let requestId = 0;

const isMe = (row) => session.user && row.name.toLowerCase() === session.user.name.toLowerCase();

function avatar(skinId, className = 'lb-face') {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  c.className = className;
  c.getContext('2d').drawImage(faceForSkin(skinId), 0, 0);
  return c;
}

function el(tag, className, html = '') {
  const e = document.createElement(tag);
  if (className) e.className = className;
  e.innerHTML = html;
  return e;
}

// ---------------------------------------------------------------- mode list
function renderModes() {
  const box = $('lbmodes');
  box.innerHTML = '';
  for (const [id, m] of Object.entries(modes)) {
    const b = el('button', `lb-mode${id === view.mode ? ' on' : ''}`);
    b.type = 'button';
    const icon = document.createElement('canvas');
    paintIcon(icon, m.icon && MODES[id] ? m.icon : 'sword');
    b.append(icon, el('span', '', esc(m.name)));
    b.onclick = () => { view.mode = id; load(); };
    box.appendChild(b);
  }
  box.appendChild(el('div', 'lb-mode soon', '<span>More modes coming soon</span>'));
}

// ---------------------------------------------------------------- podium + table
function podiumSpot(row, place) {
  const spot = el('div', `podium-spot place-${place}`);
  if (!row) { spot.classList.add('empty'); spot.appendChild(el('div', 'podium-name muted', '—')); spot.appendChild(el('div', 'podium-base')); return spot; }
  const frame = el('div', 'podium-frame');
  if (place === 1) frame.appendChild(el('div', 'podium-crown', '♛'));
  frame.appendChild(avatar(row.skin, 'podium-face'));
  frame.appendChild(el('span', 'podium-medal', String(place)));
  spot.appendChild(frame);
  spot.appendChild(el('div', `podium-name${isMe(row) ? ' me' : ''}`, rankedName(row.name, row.rankId, { badge: false })));
  spot.appendChild(el('div', 'podium-kills', `${row.kills.toLocaleString('en-US')} Kills`));
  spot.appendChild(el('div', 'podium-kd', `K/D ${row.kd.toFixed(2)}`));
  spot.appendChild(el('div', 'podium-base'));
  return spot;
}

function tableRow(row, { pinned = false } = {}) {
  const r = el('div', `lb-row${isMe(row) ? ' me' : ''}${pinned ? ' pinned' : ''}`);
  r.setAttribute('role', 'row');
  r.appendChild(el('span', 'lb-pos', String(row.rank)));
  const who = el('span', 'lb-player');
  who.appendChild(avatar(row.skin));
  who.appendChild(el('span', 'lb-name', rankedName(row.name, row.rankId, { level: row.level }) + (isMe(row) ? ' <span class="you-pill">YOU</span>' : '')));
  r.appendChild(who);
  r.appendChild(el('span', 'lb-num', row.kd.toFixed(2)));
  r.appendChild(el('span', 'lb-num lb-kills', row.kills.toLocaleString('en-US')));
  return r;
}

async function load() {
  renderModes();
  document.querySelectorAll('#lbperiod button').forEach((b) => {
    const on = b.dataset.v === view.period;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  $('lbtitle').textContent = modes[view.mode]?.name || 'Leaderboard';
  const podium = $('lbpodium'), table = $('lbtable'), me = $('lbme');
  me.innerHTML = '';
  if (!ONLINE) { podium.innerHTML = ''; table.innerHTML = '<div class="lb-empty">The leaderboard needs the game server running.</div>'; return; }
  table.innerHTML = '<div class="lb-empty">Loading…</div>';
  const id = ++requestId;
  try {
    const r = await api(`/api/leaderboard?mode=${view.mode}&period=${view.period}&limit=100`);
    if (id !== requestId) return; // a newer request superseded this one
    if (r.modes) modes = r.modes;
    renderModes();
    $('lbtitle').textContent = modes[view.mode]?.name || 'Leaderboard';

    podium.innerHTML = '';
    [[r.rows[1], 2], [r.rows[0], 1], [r.rows[2], 3]].forEach(([row, place]) => podium.appendChild(podiumSpot(row, place)));

    table.innerHTML = '';
    table.appendChild(el('div', 'lb-row lb-head', '<span>#</span><span>Player</span><span class="lb-num">K/D</span><span class="lb-num">Kills</span>'));
    const rest = r.rows.slice(3);
    if (rest.length) rest.forEach((row) => table.appendChild(tableRow(row)));
    else table.appendChild(el('div', 'lb-empty', r.rows.length ? 'No one else yet.' : `No kills ${view.period === 'day' ? 'today' : view.period === 'week' ? 'this week' : 'yet'} — be the first!`));

    if (r.me) me.appendChild(tableRow(r.me, { pinned: true }));
    else me.appendChild(el('div', 'lb-note', session.user ? 'Get a kill to appear on this board.' : 'Log in to get your name on the board.'));
  } catch (e) {
    if (id === requestId) table.innerHTML = `<div class="lb-empty">${esc(e.message)}</div>`;
  }
}

export function initLeaderboard() {
  screens.register('board', { onOpen: () => { view.mode = game.mode; load(); } });
  document.querySelectorAll('#lbperiod button').forEach((b) => { b.onclick = () => { view.period = b.dataset.v; load(); }; });
}
