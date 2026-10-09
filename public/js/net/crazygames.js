// CrazyGames SDK (v3) integration, active only in the CrazyGames build (or with ?platform=crazygames):
//  - loading / gameplay start-stop / happytime events
//  - the platform's audio mute and chat settings
//  - account integration: CrazyGames users are signed in automatically (see net/account.js)
// Every call is wrapped so a missing or failing SDK never breaks the game.
import { events } from '../core/events.js';
import { game } from '../core/state.js';
import { setPlatformMute } from '../core/audio.js';
import { ON_CRAZYGAMES } from '../core/platform.js';

const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

/** active: SDK loaded and running on CrazyGames. accounts: the site supports user accounts. */
export const cg = { active: false, accounts: false, muteAudio: false, disableChat: false };
let sdk = null;
let playing = false;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

const call = (fn) => {
  if (!cg.active) return undefined;
  try { return fn(); } catch (err) { console.warn('CrazyGames SDK call failed', err); return undefined; }
};

function applySettings(s) {
  if (!s) return;
  cg.muteAudio = !!s.muteAudio;
  cg.disableChat = !!s.disableChat;
  setPlatformMute(cg.muteAudio);
  events.emit('platformSettings', { muteAudio: cg.muteAudio, disableChat: cg.disableChat });
}

/** Tell CrazyGames whether the player is actively playing (not in menus or paused). */
export function setGameplay(on) {
  if (on === playing) return;
  playing = on;
  call(() => (on ? sdk.game.gameplayStart() : sdk.game.gameplayStop()));
}

export const loadingStart = () => call(() => sdk.game.loadingStart());
export const loadingStop = () => call(() => sdk.game.loadingStop());

/** A signed token for the signed-in CrazyGames user, or null (not signed in / unavailable). */
export async function userToken() {
  if (!cg.active || !cg.accounts) return null;
  try {
    if (!(await sdk.user.getUser())) return null;
    return await sdk.user.getUserToken();
  } catch {
    return null;
  }
}

/** Show CrazyGames' own sign-in / sign-up dialog. Resolves to true if the player signed in. */
export async function showAuthPrompt() {
  if (!cg.active || !cg.accounts) return false;
  try { return !!(await sdk.user.showAuthPrompt()); } catch { return false; }
}

/** Load and start the SDK. Resolves to true when running on CrazyGames. */
export async function initCrazyGames() {
  if (!ON_CRAZYGAMES) return false;
  try {
    await loadScript(SDK_URL);
    sdk = window.CrazyGames?.SDK;
    await sdk.init();
    cg.active = sdk.environment !== 'disabled';
  } catch (err) {
    console.warn('CrazyGames SDK unavailable', err);
    cg.active = false;
  }
  if (!cg.active) return false;
  cg.accounts = !!call(() => sdk.user.isUserAccountAvailable);
  applySettings(call(() => sdk.game.settings));
  call(() => sdk.game.addSettingsChangeListener(applySettings));
  call(() => sdk.user.addAuthListener((user) => events.emit('crazygamesAuth', { user })));

  // gameplay events: playing = in a match and not paused
  events.on('lockChange', ({ locked }) => setGameplay(locked && game.state === 'playing'));
  events.on('gameEnd', () => setGameplay(false));
  events.on('levelUp', () => call(() => sdk.game.happytime()));
  return true;
}
