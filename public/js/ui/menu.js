// Title screen (mode picker), account card and pause menu.
import { $, esc, randi, store, VERSION } from '../core/util.js';
import { game, input } from '../core/state.js';
import { events } from '../core/events.js';
import { paintIcon } from '../render/icons.js';
import { requestLock, releaseLock } from '../core/input.js';
import { player, fighters } from '../game/entities.js';
import { startGame, leaveGame } from '../game/session.js';
import { loadMode, MODE_KEY } from '../game/mode-loader.js';
import { MODES } from '../shared/modes.js';
import { session, refreshAccount, logout, currentRank, currentLevel } from '../net/account.js';
import { faceForSkin } from '../game/characters.js';
import { rankTag, levelTag } from './ranks.js';
import { ONLINE } from '../net/api.js';
import { screens } from './screens.js';
import { openAuth } from './auth.js';
import { beforePlay } from './nudge.js';
import { cg } from '../net/crazygames.js';
import { api } from '../net/api.js';
import { notify } from './toasts.js';

const NICK_KEY = 'bf_nick';
let lastLockChange = 0;

function cleanNick(s) {
  return s.trim().replace(/[^\w\- ]/g, '').slice(0, 16) || 'Brawler';
}

function renderAccountCard() {
  const el = $('acct'), { user, stats } = session;
  $('nickwrap').classList.toggle('hidden', !!user);
  if (!ONLINE) {
    el.innerHTML = `<div class="acc-head"><div class="avatar">!</div><div><div class="acc-label">Offline</div><div class="acc-name">No server</div></div></div>
      <p class="acc-blurb">Start the game server (<code>npm start</code>) to sign in and save stats.</p>`;
    return;
  }
  if (!user) {
    const viaCg = cg.active && cg.accounts;
    el.innerHTML = `<div class="acc-head"><div class="avatar guest">?</div><div><div class="acc-label">Playing as</div><div class="acc-name">Guest</div></div></div>
      <p class="acc-blurb"><b>Guest progress isn't saved.</b> Create a free account to keep your coins, XP and unlocks, get on the world leaderboard and chat.</p>
      <div class="btn-row">${viaCg
        ? '<button id="asignup" class="btn btn-primary btn-sm" type="button">Log in with CrazyGames</button>'
        : `<button id="asignup" class="btn btn-primary btn-sm" type="button">Sign up free</button>
           <button id="alogin" class="btn btn-ghost btn-sm" type="button">Log in</button>`}</div>`;
    $('asignup').onclick = () => openAuth('signup');
    if (!viaCg) $('alogin').onclick = () => openAuth('login');
    return;
  }
  const s = stats || { kills: 0, deaths: 0, kd: 0, bestStreak: 0 };
  const rank = currentRank(), lv = currentLevel();
  el.innerHTML = `<div class="acc-head"><div class="avatar avatar-face" id="accavatar"></div>
      <div class="acc-id"><div class="acc-label">${levelTag(lv.level)} ${rankTag(rank.id)}</div><div class="acc-name rank-${rank.id}">${esc(user.name)}</div></div>
      ${stats ? `<span class="rank-pill" title="Lifetime position by kills">#${stats.rank}</span>` : ''}</div>
    <div class="rank-progress"><div class="rank-progress-text"><span>Level ${lv.level}</span><span>${lv.into} / ${lv.need} XP</span></div>
      <div class="rank-bar"><i id="xpprog"></i></div></div>
    <div class="acc-mode">${esc(MODES[game.mode].name)} · lifetime</div>
    <div class="acc-stats">
      <div class="stat"><b>${s.kills}</b><span>Kills</span></div>
      <div class="stat"><b>${(s.kd ?? 0).toFixed(2)}</b><span>K/D</span></div>
      <div class="stat"><b>${s.bestStreak}</b><span>Best streak</span></div>
      <div class="stat coin-stat"><b>${session.wallet.coins.toLocaleString('en-US')}</b><span>Coins</span></div>
    </div>
    <div class="btn-row"><button id="accopen" class="btn btn-ghost btn-sm" type="button">Account</button>
    <button id="alogout" class="btn btn-ghost btn-sm" type="button">Log out</button></div>`;
  const face = faceForSkin(session.cosmetics.skin);
  face.className = 'avatar-canvas';
  $('accavatar').appendChild(face);
  $('xpprog').style.width = `${(lv.into / lv.need) * 100}%`;
  $('accopen').onclick = () => screens.open('account');
  // CrazyGames accounts follow the CrazyGames sign-in, so there's nothing to log out of here
  if (user.platform === 'crazygames') $('alogout').remove();
  else $('alogout').onclick = async () => { await logout(); notify('Logged out.'); };
}

// ---------------------------------------------------------------- mode picker
// players online per mode, refreshed while the menu is open
let onlineCounts = null, onlineTimer = 0;
const playersText = (id) => (onlineCounts ? `<span class="online-dot"></span>${onlineCounts[id] || 0} playing` : esc(MODES[id].map));

async function refreshOnline() {
  if (!ONLINE) return;
  try {
    onlineCounts = (await api('/api/online')).players;
    if (screens.top() === 'menu') renderModes();
  } catch { /* keep the old numbers */ }
}

function renderModes() {
  const grid = $('modegrid');
  grid.innerHTML = '';
  for (const [id, m] of Object.entries(MODES)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mode-tile';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(id === game.mode));
    b.innerHTML = `<span class="mode-icon"><canvas aria-hidden="true"></canvas></span>
      <span class="mode-text"><span class="mode-name">${esc(m.name)}</span><span class="mode-map">${playersText(id)}</span></span>`;
    paintIcon(b.querySelector('canvas'), m.icon);
    b.onclick = () => pickMode(id);
    grid.appendChild(b);
  }
  $('modedesc').textContent = MODES[game.mode].description;
  $('play').textContent = `Play ${MODES[game.mode].name}`;
}

function pickMode(id) {
  if (id === game.mode) return;
  store.set(MODE_KEY, id);
  loadMode(id); // the menu background switches to that mode's map
  renderModes();
  renderAccountCard();
  refreshAccount(); // the account card shows stats for the selected mode
}

function play() {
  beforePlay(startPlaying);
}

function startPlaying(practice = false) {
  const name = session.user ? session.user.name : cleanNick($('nick').value);
  if (!session.user) store.set(NICK_KEY, name);
  screens.reset();
  startGame({ mode: game.mode, name, rank: session.user ? currentRank().id : 'NONE', xp: session.user ? session.progress.xp : 0, cosmetics: session.cosmetics, practice });
  requestLock();
}

function resume() {
  screens.reset();
  requestLock();
}

function leave() {
  leaveGame();
  releaseLock();
  screens.reset('menu');
  setTimeout(refreshAccount, 800);
}

function renderPauseStats() {
  const P = player;
  $('pstats').innerHTML = [['Kills', P.kills], ['Deaths', P.deaths], ['K/D', (P.kills / Math.max(1, P.deaths)).toFixed(2)], ['Coins', P.coins]]
    .map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
}

export function initMenus() {
  renderModes();
  $('ver').textContent = `v${VERSION}`;
  $('mfighters').textContent = fighters.length;
  $('nick').value = store.get(NICK_KEY, '') || `Brawler${randi(100, 999)}`;
  if (matchMedia('(pointer:coarse)').matches) $('touchnote').classList.remove('hidden');

  $('play').onclick = play;
  $('practice').onclick = () => startPlaying(true);
  $('practice').classList.toggle('hidden', !ONLINE);
  $('nick').addEventListener('keydown', (e) => { if (e.key === 'Enter') play(); });
  $('menuboard').onclick = () => screens.open('board');
  $('menuhowto').onclick = () => screens.open('howto');
  $('menulocker').onclick = () => screens.open('locker');
  $('pauselocker').onclick = () => screens.open('locker');
  $('menuopts').onclick = () => screens.open('options');

  $('resume').onclick = resume;
  $('pauseboard').onclick = () => screens.open('board');
  $('pauseopts').onclick = () => screens.open('options');
  $('quit').onclick = leave;
  screens.register('pause', { onOpen: renderPauseStats });
  screens.register('menu', {
    onOpen() {
      renderAccountCard();
      refreshOnline();
      clearInterval(onlineTimer);
      onlineTimer = setInterval(refreshOnline, 10000);
    },
    onClose() { clearInterval(onlineTimer); },
  });
  // the connection dropped or this account started playing somewhere else
  events.on('netLost', () => { if (game.state === 'playing') { leave(); notify('Lost connection to the game server.', { type: 'error' }); } });
  events.on('netKicked', ({ reason }) => { if (game.state === 'playing') { leave(); notify(reason, { type: 'error' }); } });

  events.on('account', renderAccountCard);
  events.on('cosmetics', renderAccountCard);
  events.on('lockChange', ({ locked }) => {
    lastLockChange = performance.now();
    if (game.state !== 'playing') return;
    if (locked) screens.reset();
    else if (player.alive && screens.depth === 0 && !input.chatOpen) screens.open('pause');
  });

  addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || performance.now() - lastLockChange < 300) return;
    const top = screens.top();
    if (!top || top === 'menu') return;
    if (top === 'pause') resume();
    else screens.back();
  });
}
