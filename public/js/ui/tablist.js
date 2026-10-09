// Player list shown while Tab is held: everyone in the arena, highest rank first.
import { $ } from '../core/util.js';
import { game } from '../core/state.js';
import { events } from '../core/events.js';
import { rankById } from '../shared/cosmetics.js';
import { player, fighters } from '../game/entities.js';
import { rankedName } from './ranks.js';
import { net } from '../net/net.js';
import { online } from '../net/multiplayer.js';

const REFRESH_MS = 250;
let timer = 0;

function sorted() {
  return [...fighters].sort((a, b) =>
    rankById(b.rank).tier - rankById(a.rank).tier || (b.level || 1) - (a.level || 1) || a.name.localeCompare(b.name));
}

function render() {
  const list = sorted();
  $('tlrows').innerHTML = list.map((f) => `
    <div class="tl-row${f === player ? ' me' : ''}${f.alive ? '' : ' dead'}">
      <span class="tl-name">${rankedName(f.name, f.rank, { level: f.level || 1 })}${f.isBot ? '<span class="tl-bot">BOT</span>' : ''}</span>
      <span class="tl-num">${f.kills}</span><span class="tl-num">${f.deaths}</span>
    </div>`).join('');
  const people = list.filter((f) => !f.isBot && (f.remote || f === player)).length;
  $('tlcount').textContent = net.online
    ? `${people} player${people === 1 ? '' : 's'} + ${list.length - people} bot${list.length - people === 1 ? '' : 's'} · ${online.ping} ms`
    : `Offline practice · ${list.length - 1} bots`;
}

function show() {
  if (timer) return;
  render();
  $('tablist').classList.remove('hidden');
  timer = setInterval(render, REFRESH_MS);
}

function hide() {
  clearInterval(timer);
  timer = 0;
  $('tablist').classList.add('hidden');
}

export function initTablist() {
  addEventListener('keydown', (e) => {
    if (e.code !== 'Tab' || game.state !== 'playing') return;
    e.preventDefault(); // don't move keyboard focus while playing
    show();
  });
  addEventListener('keyup', (e) => { if (e.code === 'Tab') hide(); });
  addEventListener('blur', hide);
  events.on('gameEnd', hide);
}
