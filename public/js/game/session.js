// Starting and leaving a match, and the per-tick player/session update.
// Matches are online: a room on the game server with real players (topped up with server bots).
// If the server can't be reached, or the player picks practice, it's offline against local bots,
// and nothing is saved (the server only trusts fights it refereed itself).
import { game } from '../core/state.js';
import { events } from '../core/events.js';
import { initAudio } from '../core/audio.js';
import { TICK } from './physics.js';
import { player } from './entities.js';
import { respawnPlayer, tickPlayer } from './player.js';
import { ONLINE } from '../net/api.js';
import { net } from '../net/net.js';
import { joinOnline, leaveOnline, tickOnline } from '../net/multiplayer.js';
import { session, currentRank } from '../net/account.js';
import { levelFromXp } from '../shared/cosmetics.js';
import { loadMode } from './mode-loader.js';

/** profile: { mode, name, rank, xp, cosmetics, practice } */
export async function startGame({ mode, name, rank, xp, cosmetics, practice = false }) {
  initAudio();
  loadMode(mode);
  Object.assign(player, { name, rank, xp, level: levelFromXp(xp).level, cosmetics });
  let online = false;
  if (!practice && ONLINE) {
    try { await joinOnline({ name, cosmetics }); online = true; } catch { /* offline practice instead */ }
  }
  game.state = 'playing';
  game.view = 0;
  respawnPlayer();
  events.emit('gameStart');
  events.emit('matchStarted', { online, saved: online && !!session.user, fellBack: !practice && !online });
}

export function leaveGame() {
  leaveOnline();
  game.state = 'menu';
  player.alive = false;
  events.emit('gameEnd');
}

/** Reconnect to a room (after signing in mid-match, so the server knows who we are). */
async function rejoin() {
  leaveOnline();
  try {
    await joinOnline({ name: player.name, cosmetics: player.cosmetics });
    respawnPlayer();
    events.emit('matchStarted', { online: true, saved: !!session.user });
  } catch {
    events.emit('netLost');
  }
}

// keep the in-game player in sync with account changes (e.g. saving a new skin from the pause menu)
events.on('cosmetics', (c) => {
  player.cosmetics = c;
  events.emit('playerCosmetics');
});
events.on('account', () => {
  if (game.state !== 'playing' || !session.user) return;
  player.rank = currentRank().id;
  if (player.name === session.user.name) return;
  // a guest signed up / logged in mid-match: play on as that account (saved from now on)
  Object.assign(player, { name: session.user.name, xp: session.progress.xp, level: levelFromXp(session.progress.xp).level });
  if (net.online) rejoin();
});

export function tickSession() {
  if (game.state !== 'playing') return;
  tickPlayer();
  tickOnline();
  if (!player.alive) {
    player.respawnT -= TICK;
    if (player.respawnT <= 0) respawnPlayer();
  }
}
