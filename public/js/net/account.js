// Signed-in account state: profile, wallet, owned items, cosmetics, and account actions.
import { store } from '../core/util.js';
import { events } from '../core/events.js';
import { game } from '../core/state.js';
import { DEFAULT_COSMETICS, sanitizeCosmetics, displayRank, levelFromXp } from '../shared/cosmetics.js';
import { api, setToken, ONLINE } from './api.js';
import { TOKEN_AUTH } from '../core/platform.js';
import { cg, userToken } from './crazygames.js';

const GUEST_COSMETICS_KEY = 'bf_cosmetics';
const EMPTY_PROGRESS = { kills: 0, bestStreak: 0, xp: 0 };

/**
 * user:      { name, staffRank, paidRank, created, email, platform, hasPassword } or null
 * stats:     the user's lifetime row for the current mode (position, kills, ...), or null
 * progress:  { kills, bestStreak, xp } across all modes
 * wallet:    { coins } spendable balance
 * owned:     { skin: [ids], cape: [ids] } purchased items
 * cosmetics: { skin, cape } equipped
 */
export const session = {
  user: null,
  stats: null,
  progress: { ...EMPTY_PROGRESS },
  wallet: { coins: 0 },
  owned: { skin: [], cape: [] },
  cosmetics: loadGuestCosmetics(),
  ready: false,
};

function guestContext() {
  return { owned: { skin: [], cape: [] }, staffRank: null, paidRank: null, bestStreak: 0, created: 0 };
}

function loadGuestCosmetics() {
  try { return sanitizeCosmetics(JSON.parse(store.get(GUEST_COSMETICS_KEY, 'null')), guestContext()); } catch { return { ...DEFAULT_COSMETICS }; }
}

/** Availability context for the shared catalog. */
export function unlockContext() {
  if (!session.user) return guestContext();
  return {
    owned: session.owned,
    staffRank: session.user.staffRank || null,
    paidRank: session.user.paidRank || null,
    bestStreak: session.progress.bestStreak,
    created: session.user.created || 0,
  };
}

export const currentRank = () => displayRank(session.user?.staffRank, session.user?.paidRank);
export const currentLevel = () => levelFromXp(session.progress.xp);

// Bumped whenever the signed-in identity changes, so a slow /api/me response that was
// requested before a login/logout can't overwrite the newer state.
let epoch = 0;

function apply(r) {
  session.user = r.user || null;
  session.stats = r.stats || null;
  session.progress = r.progress || { ...EMPTY_PROGRESS };
  session.wallet = r.wallet || { coins: 0 };
  session.owned = r.owned || { skin: [], cape: [] };
  session.cosmetics = session.user ? sanitizeCosmetics(r.cosmetics, unlockContext()) : loadGuestCosmetics();
  session.ready = true;
  events.emit('account', { user: session.user, stats: session.stats });
  events.emit('cosmetics', session.cosmetics);
}

function changeIdentity(user) {
  epoch++;
  apply({ user });
}

export async function refreshAccount() {
  if (!ONLINE) { apply({}); return; }
  const started = epoch;
  try {
    const r = await api(`/api/me?mode=${game.mode}`);
    if (started === epoch) apply(r);
  } catch {
    if (started === epoch) events.emit('account', { user: session.user, stats: session.stats });
  }
}

async function signedIn(r) {
  setToken(r.token);
  changeIdentity(r.user);
  await refreshAccount();
}

/** `name` may be the username or the account's email. */
export async function login(name, password) {
  await signedIn(await api('/api/login', { name, password, token: TOKEN_AUTH }));
}

/** `email` is optional (empty string for none). */
export async function register(name, password, email = '') {
  await signedIn(await api('/api/register', { name, password, email: email || null, token: TOKEN_AUTH }));
}

/**
 * CrazyGames account integration: if the player is signed in to CrazyGames, sign them in to the
 * linked Brickfall account (created on first visit). Returns true when signed in.
 */
export async function loginWithCrazyGames() {
  const token = await userToken();
  if (!token) return false;
  await signedIn(await api('/api/auth/crazygames', { token, wantToken: TOKEN_AUTH }));
  return true;
}

export async function logout() {
  try { await api('/api/logout', {}); } catch { /* signed out locally either way */ }
  setToken(null);
  changeIdentity(null);
}

export async function changePassword(currentPassword, newPassword) {
  const r = await api('/api/account/password', { currentPassword, newPassword });
  setToken(r.token); // every other session (including the old token) was signed out
}

/** Set, change or (with '') remove the account's email. */
export async function setEmail(password, email) {
  const r = await api('/api/account/email', { password, email });
  session.user = { ...session.user, email: r.email };
  events.emit('account', { user: session.user, stats: session.stats });
}

/** Accounts without a password (CrazyGames) confirm by typing their username instead. */
export async function deleteAccount(password, confirmName) {
  await api('/api/account/delete', { password, confirmName });
  setToken(null);
  changeIdentity(null);
}

// CrazyGames: follow the player signing in or out of CrazyGames while the game is open
events.on('crazygamesAuth', async ({ user }) => {
  if (!cg.active) return;
  if (user) { try { await loginWithCrazyGames(); } catch { /* stays a guest */ } }
  else if (session.user?.platform === 'crazygames') { setToken(null); changeIdentity(null); }
});

/** Buy a skin, cape or rank with coins. kind: 'skin' | 'cape' | 'rank'. */
export async function buy(kind, id) {
  const r = await api('/api/shop/buy', { kind, id });
  session.wallet = r.wallet;
  session.owned = r.owned;
  if (r.paidRank) session.user = { ...session.user, paidRank: r.paidRank };
  events.emit('account', { user: session.user, stats: session.stats });
  return r;
}

/** Equip: saved to the account when signed in, otherwise to this browser. */
export async function equip(cosmetics) {
  let clean = sanitizeCosmetics(cosmetics, unlockContext());
  if (session.user) clean = (await api('/api/cosmetics', { cosmetics: clean })).cosmetics;
  else store.set(GUEST_COSMETICS_KEY, JSON.stringify(clean));
  session.cosmetics = clean;
  events.emit('cosmetics', clean);
  return clean;
}
