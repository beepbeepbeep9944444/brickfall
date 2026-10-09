// Guests can play, but we keep reminding them to sign up: a "save your progress" screen before
// their first match each visit, reminders as they earn coins, and a note on the death screen.
import { $ } from '../core/util.js';
import { events } from '../core/events.js';
import { player } from '../game/entities.js';
import { session } from '../net/account.js';
import { ONLINE } from '../net/api.js';
import { cg } from '../net/crazygames.js';
import { openAuth } from './auth.js';
import { logMsg } from './hud.js';
import { screens } from './screens.js';

const SEEN_KEY = 'bf_nudged'; // once per browser session
const REMIND_AT = [1, 5, 15, 30, 50];
let pendingPlay = null;

const isGuest = () => ONLINE && !session.user;
const onCrazyGames = () => cg.active && cg.accounts;

function seen() { try { return sessionStorage.getItem(SEEN_KEY) === '1'; } catch { return false; } }
function markSeen() { try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* storage blocked */ } }

/** Run `start` now, or after the guest has seen the sign-up screen. */
export function beforePlay(start) {
  if (!isGuest() || seen()) { start(); return; }
  pendingPlay = start;
  screens.open('nudge');
}

function guestNote(text) {
  const btn = onCrazyGames() ? 'Log in' : 'Sign up';
  return `${text} <b>${btn}</b> free from the pause menu to save your progress.`;
}

export function initNudge() {
  screens.register('nudge', {
    onOpen({ returning }) {
      if (returning && session.user) { // signed up / logged in from here: start the match they asked for
        const start = pendingPlay;
        setTimeout(() => { if (screens.top() === 'nudge') screens.back(); start?.(); }, 0);
        return;
      }
      markSeen();
      $('nudgesignup').textContent = onCrazyGames() ? 'Log in with CrazyGames' : "Sign up — it's free";
      $('nudgelogin').classList.toggle('hidden', onCrazyGames());
    },
    onClose() { pendingPlay = null; },
  });
  $('nudgesignup').onclick = () => openAuth('signup');
  $('nudgelogin').onclick = () => openAuth('login');
  $('nudgeguest').onclick = () => {
    const start = pendingPlay;
    pendingPlay = null;
    screens.back();
    start?.();
  };
  // signed in while the nudge is on top (the CrazyGames dialog): start the match they asked for
  events.on('account', ({ user }) => {
    if (!user || screens.top() !== 'nudge') return;
    const start = pendingPlay;
    screens.back();
    start?.();
  });

  $('pausesignup').onclick = () => openAuth('signup');
  const refreshPause = () => {
    $('pausesignup').textContent = onCrazyGames() ? 'Log in to save progress' : 'Sign up to save progress';
    $('pausesignup').classList.toggle('hidden', !isGuest());
  };
  events.on('account', refreshPause);
  refreshPause();

  // in-game reminders for guests
  events.on('kill', ({ killer, victim }) => {
    if (!isGuest()) return;
    if (killer === player && REMIND_AT.includes(player.kills)) {
      logMsg(guestNote(`You have <b>${player.coins} coins</b> and <b>${player.kills} kill${player.kills === 1 ? '' : 's'}</b> — guests lose them when they leave.`), 'nudge-line');
    }
    if (victim === player) {
      $('dguest').innerHTML = guestNote(player.coins ? `Playing as a guest: your ${player.coins} coins won't be saved.` : 'Playing as a guest: nothing is saved.');
      $('dguest').classList.remove('hidden');
    }
  });
  events.on('respawn', () => $('dguest').classList.add('hidden'));
}
