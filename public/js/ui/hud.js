// In-game HUD: health (+absorption), hotbar, kill feed, chat log, match leaderboard, kill banner, death screen.
import { $, clamp, esc } from '../core/util.js';
import { game } from '../core/state.js';
import { events } from '../core/events.js';
import { sfx } from '../core/audio.js';
import { ITEM_DEFS, itemAt, iconURL, paintIcon } from '../render/icons.js';
import { inSafeZone } from '../game/physics.js';
import { player, fighters } from '../game/entities.js';
import { session } from '../net/account.js';
import { rankedName, rankTag, levelTag } from './ranks.js';
import { levelFromXp } from '../shared/cosmetics.js';
import { MODES } from '../shared/modes.js';

const HP_SEGMENTS = 10;
const ABSORB_SEGMENTS = 2;
const MULTI_KILL_WINDOW = 4;
const MULTI_NAMES = ['ELIMINATED', 'DOUBLE KILL', 'TRIPLE KILL', 'MULTI KILL'];
const WEAPON_TEXT = { melee: 'Slashed with a sword', arrow: 'Shot with a bow', fall: 'Knocked to their doom', rod: 'Hooked', void: 'Knocked into the void', pearl: 'Pearled to their doom' };
const MODE_TIPS = {
  arena: ['Drop off the tower to start fighting.', 'Tip: rod to reset combos, sprint-hit, and <b>W-tap</b>. Press <b>F5</b> to see your skin.'],
  potpvp: ['Drop off the tower to start fighting. <b>There is no natural regen.</b>', 'Tip: look down and right-click a <b>Healing Splash</b> at your feet. Drink <b>Swiftness</b> first, and throw pearls to escape.'],
  sumo: ['Knock everyone off the ring. Hits deal no damage.', 'Tip: sprint-hit and <b>W-tap</b> for extra knockback, and keep your back to the middle.'],
  combo: ['Hits land almost every 3 ticks here. Keep the combo going.', 'Tip: chase after each hit, keep clicking, and drink flasks when you get low.'],
};

let boardTimer = 0;
let lastKillT = -99, multi = 0;
let hitTimer = 0, bannerTimer = 0, nameTimer = 0;
const slotEls = [];

// ---------------------------------------------------------------- building
function buildHotbar() {
  const bar = $('hotbar');
  bar.innerHTML = '';
  slotEls.length = 0;
  game.hotbar.forEach((id, i) => {
    const slot = document.createElement('div');
    slot.className = i === player.slot ? 'slot sel' : 'slot';
    slot.innerHTML = `<span class="slot-key">${i + 1}</span><canvas aria-hidden="true"></canvas><span class="slot-count"></span>`;
    paintIcon(slot.querySelector('canvas'), id);
    bar.appendChild(slot);
    slotEls.push({ el: slot, count: slot.querySelector('.slot-count') });
  });
}

function buildHealth() {
  paintIcon($('hpicon'), 'heart');
  const bar = $('hpbar');
  for (let i = 0; i < HP_SEGMENTS + ABSORB_SEGMENTS; i++) {
    const s = document.createElement('div');
    s.className = i < HP_SEGMENTS ? 'hp-seg' : 'hp-seg abs';
    s.innerHTML = '<i></i>';
    bar.appendChild(s);
  }
}

const nameOf = (f) => rankedName(f.name, f.rank, { extraClass: f === player ? 'me' : '' });

const clock = (t) => { const sec = Math.ceil(t); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };

// ---------------------------------------------------------------- feedback
/** Add a line to the HUD log (game messages and chat). Old lines hide, but stay visible while chat is open. */
export function logMsg(html, cls = '') {
  const log = $('log'), m = document.createElement('div');
  m.className = cls ? `log-line ${cls}` : 'log-line';
  m.innerHTML = html;
  log.appendChild(m);
  while (log.children.length > 60) log.firstChild.remove();
  setTimeout(() => { m.classList.add('fade'); setTimeout(() => m.classList.add('stale'), 800); }, 9000);
  log.scrollTop = log.scrollHeight;
  return m;
}

function hitmarker(isKill) {
  const h = $('hitm');
  h.classList.add('on');
  h.classList.toggle('kill', !!isKill);
  clearTimeout(hitTimer);
  hitTimer = setTimeout(() => h.classList.remove('on'), isKill ? 260 : 120);
}

function flashVignette() {
  const v = $('vig');
  v.classList.add('on');
  setTimeout(() => v.classList.remove('on'), 180);
}

function killBanner(victim, reward, xp) {
  multi = game.time - lastKillT < MULTI_KILL_WINDOW ? multi + 1 : 0;
  lastKillT = game.time;
  const el = $('killbanner');
  el.innerHTML = `<div class="kb-title">${MULTI_NAMES[Math.min(multi, MULTI_NAMES.length - 1)]}</div>
    <div class="kb-name">${rankedName(victim.name, victim.rank)}</div><div class="kb-reward">+${reward} coins · +${xp} XP</div>`;
  el.classList.remove('show');
  void el.offsetWidth; // restart the animation
  el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function addFeed(killer, victim, kind) {
  const feed = $('feed'), e = document.createElement('div');
  e.className = 'feed-item';
  if (killer) {
    const melee = game.hotbar.includes('sword') ? iconURL.sword : iconURL.fists;
    const icon = kind === 'arrow' ? iconURL.bow : kind === 'pearl' ? iconURL.pearl : kind === 'fall' || kind === 'void' ? (game.mode === 'sumo' ? iconURL.fists : iconURL.rod) : melee;
    e.innerHTML = `${nameOf(killer)}<img src="${icon}" alt="${esc(kind)}">${nameOf(victim)}`;
  } else {
    e.innerHTML = `${nameOf(victim)}<span class="muted">${kind === 'fall' ? 'hit the ground too hard' : kind === 'pearl' ? 'pearled too far' : 'fell out of the world'}</span>`;
  }
  feed.prepend(e);
  while (feed.children.length > 5) feed.lastChild.remove();
  setTimeout(() => { e.classList.add('fade'); setTimeout(() => e.remove(), 500); }, 6000);
}

function showItemName(i) {
  const n = $('itemname');
  n.textContent = ITEM_DEFS[itemAt(i)].name;
  n.classList.add('on');
  clearTimeout(nameTimer);
  nameTimer = setTimeout(() => n.classList.remove('on'), 1400);
}

// ---------------------------------------------------------------- death screen
function showDeath(killer, kind) {
  $('dby').innerHTML = killer ? `Taken out by ${rankedName(killer.name, killer.rank)}` : kind === 'fall' ? 'You hit the ground too hard' : 'You fell out of the world';
  const hpLeft = game.mode !== 'sumo' ? ` · they had <b class="hp-left">${(killer?.hp / 2).toFixed(1)} ♥</b> left` : '';
  $('drecap').innerHTML = killer && killer.alive ? `${WEAPON_TEXT[kind] || 'Defeated'}${hpLeft}` : '';
  $('dstats').innerHTML = [['Kills', player.kills], ['Best streak', player.best], ['Coins', player.coins]]
    .map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
  $('death').classList.remove('hidden');
  sfx('death');
}

// ---------------------------------------------------------------- per-frame
function updateBoard() {
  const sorted = [...fighters].sort((a, b) => b.kills - a.kills || b.streak - a.streak);
  $('top').innerHTML = sorted.slice(0, 5).map((f, i) =>
    `<li class="${f === player ? 'me' : ''}"><span class="rank">${i + 1}</span><span class="nm">${rankedName(f.name, f.rank, { badge: false })}</span><span class="kc">${f.kills}</span></li>`).join('');
  const P = player;
  $('sK').textContent = P.kills;
  $('sD').textContent = P.deaths;
  $('sKD').textContent = (P.kills / Math.max(1, P.deaths)).toFixed(2);
  $('sS').textContent = P.streak;
  $('sB').textContent = P.best;
  $('sC').textContent = P.coins;
  $('pcount').textContent = fighters.length;
}

export function updateHud(dt) {
  if (game.state !== 'playing') return;
  const P = player, segs = $('hpbar').children;
  for (let i = 0; i < HP_SEGMENTS; i++) segs[i].firstChild.style.width = clamp((P.hp - i * 2) / 2, 0, 1) * 100 + '%';
  for (let i = 0; i < ABSORB_SEGMENTS; i++) {
    const v = clamp((P.absorb - i * 2) / 2, 0, 1), seg = segs[HP_SEGMENTS + i];
    seg.classList.toggle('hidden', v <= 0);
    seg.firstChild.style.width = v * 100 + '%';
  }
  const low = P.alive && P.hp <= 6;
  $('hpbar').classList.toggle('low', low);
  $('hpbar').classList.toggle('regen', P.regenT > 0);
  $('lowhp').classList.toggle('on', low);
  $('hptext').textContent = `${Math.ceil(P.hp + P.absorb)}/${P.maxHp}`;
  $('streak').textContent = P.streak > 0 ? `${P.streak} streak` : '';
  const lv = levelFromXp(P.xp);
  $('lvlbadge').innerHTML = levelTag(lv.level);
  $('xpbar').firstChild.style.width = `${(lv.into / lv.need) * 100}%`;
  slotEls.forEach((s, i) => {
    const key = ITEM_DEFS[itemAt(i)].count, c = key ? P.inv[key] || 0 : null;
    s.count.textContent = c == null ? '' : c;
    s.el.classList.toggle('empty', c === 0);
  });
  const fx = [];
  if (P.speedT > 0) fx.push(`<span class="fx fx-speed">Swiftness ${clock(P.speedT)}</span>`);
  if (P.regenT > 0) fx.push(`<span class="fx fx-regen">Regen ${clock(P.regenT)}</span>`);
  const fxHtml = fx.join('');
  if ($('effects').innerHTML !== fxHtml) $('effects').innerHTML = fxHtml;
  const prog = P.drink > 0 ? P.drink : P.charge, ch = $('charge');
  ch.classList.toggle('on', prog > 0);
  ch.classList.toggle('full', P.charge >= 1);
  ch.firstChild.style.width = prog * 100 + '%';
  const safe = P.alive && inSafeZone(P), shielded = P.alive && P.protectT > 0;
  $('safe').classList.toggle('hidden', !(safe || shielded));
  $('safe').textContent = safe ? 'Safe zone' : `Spawn protection ${Math.ceil(P.protectT)}`;
  $('cross').classList.toggle('hidden', game.view !== 0);
  if (!P.alive) {
    const t = Math.max(0, P.respawnT);
    $('dtimer').textContent = `Respawning in ${Math.ceil(t)}…`;
    $('dbar').style.width = (1 - t / 3.5) * 100 + '%';
  }
  boardTimer -= dt;
  if (boardTimer <= 0) { boardTimer = 0.25; updateBoard(); }
}

// ---------------------------------------------------------------- wiring
export function initHud() {
  buildHealth();

  events.on('slot', ({ index }) => {
    slotEls.forEach((s, i) => s.el.classList.toggle('sel', i === index));
    showItemName(index);
  });
  events.on('hurt', ({ victim, attacker }) => {
    if (victim === player) flashVignette();
    if (attacker === player) hitmarker(false);
  });
  events.on('kill', ({ killer, victim, kind, reward, xp, endedStreak }) => {
    addFeed(killer, victim, kind);
    if (endedStreak >= 5) logMsg(`${nameOf(victim)}'s ${endedStreak} kill streak was ended!`);
    if (killer && (killer.streak === 3 || killer.streak % 5 === 0)) logMsg(`${nameOf(killer)} is on a ${killer.streak} kill streak!`);
    if (killer === player) {
      hitmarker(true);
      killBanner(victim, reward, xp);
      sfx(player.streak > 0 && player.streak % 5 === 0 ? 'streak' : 'kill');
    }
    if (victim === player) showDeath(killer, kind);
  });
  events.on('respawn', () => $('death').classList.add('hidden'));
  events.on('levelUp', ({ level }) => {
    const el = $('levelup');
    el.innerHTML = `<div class="lu-title">LEVEL UP</div><div class="lu-level">${levelTag(level)}</div>`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2400);
    sfx('streak');
    logMsg(`You reached level ${levelTag(level)}!`);
  });
  events.on('gameStart', () => {
    const mode = MODES[game.mode];
    buildHotbar();
    $('hud').classList.remove('hidden');
    $('hudmode').textContent = mode.short;
    $('tlmode').textContent = `${mode.name} · ${mode.map}`;
    $('log').innerHTML = '';
    $('feed').innerHTML = '';
    updateBoard();
    const [intro, tip] = MODE_TIPS[game.mode] || MODE_TIPS.arena;
    logMsg(`Welcome to <b>${mode.name}</b>! ${intro}`);
    logMsg(tip);
  });
  events.on('matchStarted', ({ online, saved, fellBack }) => {
    $('hud').classList.toggle('offline', !online);
    if (fellBack) logMsg("Couldn't reach the game server, so this is <b>offline practice</b> against bots. Nothing is saved.");
    else if (!online) logMsg('<b>Offline practice</b> against bots. Nothing is saved.');
    else if (saved) logMsg(`<b>Online</b> as ${rankTag(player.rank)} <b>${esc(player.name)}</b>. Your kills count on the world leaderboard.`);
    else logMsg(`<b>Online</b> as guest <b>${esc(player.name)}</b>. Log in to save your stats and earn ranks.`);
  });
  events.on('gameEnd', () => {
    $('hud').classList.add('hidden');
    $('death').classList.add('hidden');
  });
}
