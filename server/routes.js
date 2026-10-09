// JSON API. Each handler receives (req, res, url) and throws HttpError for client errors.
import crypto from 'node:crypto';
import { config } from './config.js';
import { q, transaction } from './db.js';
import { HttpError, sendJSON, readJSON, rateLimited } from './http.js';
import {
  hashPassword, verifyPassword, validatePassword, validateEmail, DUMMY_HASH,
  createSession, clearSessionCookie, currentUser, endSession, endAllSessions,
} from './auth.js';
import { validateUsername } from './names.js';
import * as chat from './chat.js';
import * as crazygames from './crazygames.js';
import { onlineCounts, MAX_PLAYERS } from './game/rooms.js';
import { MODES, PERIODS, leaderboard, lifetimeStats, periodKeys, clampReport } from './leaderboard.js';
import {
  SKINS, CAPES, RANKS, sanitizeCosmetics, displayRank, levelFromXp, itemStatus, isPurchasable, upgradePrice, isStaffRank, rankById,
} from '../public/js/shared/cosmetics.js';

function ownedItems(userId) {
  const owned = { skin: [], cape: [] };
  for (const row of q.owned.all(userId)) if (owned[row.kind]) owned[row.kind].push(row.item_id);
  return owned;
}

/** Everything the shared cosmetics rules need to know about a user. */
function profile(user) {
  const p = q.progress.get(user.id);
  return {
    progress: { kills: p.kills, bestStreak: p.bestStreak, xp: p.xp },
    wallet: { coins: Math.max(0, p.coinsEarned - (user.coins_spent || 0)) },
    owned: ownedItems(user.id),
    ctx: { owned: ownedItems(user.id), staffRank: user.staff_rank, paidRank: user.paid_rank, bestStreak: p.bestStreak, created: user.created },
  };
}
const unlockContext = (user) => profile(user).ctx;

function storedCosmetics(user, ctx) {
  let raw = null;
  try { raw = JSON.parse(user.cosmetics || 'null'); } catch { raw = null; }
  return sanitizeCosmetics(raw, ctx);
}

const MINUTE = 60e3, HOUR = 60 * MINUTE;
const startedAt = Date.now();

function limit(req, name, max, windowMs, message = 'Too many requests. Please slow down.') {
  if (rateLimited(req, name, max, windowMs)) throw new HttpError(429, message);
}

function requireUser(req) {
  const user = currentUser(req);
  if (!user) throw new HttpError(401, 'You need to be signed in.');
  return user;
}

/**
 * Sign `user` in and respond. Clients hosted on another site (e.g. the CrazyGames build) ask for
 * `token: true` and keep the bearer token themselves; our own pages use the HttpOnly cookie.
 */
function signIn(req, res, status, user, wantToken) {
  const s = createSession(req, user.id);
  sendJSON(res, status, { user: { name: user.name }, ...(wantToken === true ? { token: s.token } : {}) }, { 'Set-Cookie': s.cookie });
}

const hasPassword = (row) => row.pass !== '!';

/** null for "no email", otherwise a lowercase address (throws if it's malformed). */
function emailParam(email) {
  if (email == null || email === '') return null;
  const mail = String(email).trim().toLowerCase();
  const error = validateEmail(mail);
  if (error) throw new HttpError(400, error);
  return mail;
}

function modeParam(value) {
  const mode = value || 'arena';
  if (!Object.hasOwn(MODES, mode)) throw new HttpError(400, 'Unknown game mode.');
  return mode;
}

const routes = {
  'GET /healthz': (req, res) => {
    sendJSON(res, 200, { ok: true, version: config.version, uptime: Math.round((Date.now() - startedAt) / 1000) });
  },

  'POST /api/register': async (req, res) => {
    limit(req, 'register', 30, HOUR, 'Too many sign-ups from this network. Try again later.'); // schools share one IP
    const { name, password, email, token } = await readJSON(req);
    const nameError = validateUsername(name);
    if (nameError) throw new HttpError(400, nameError);
    const pwError = validatePassword(password);
    if (pwError) throw new HttpError(400, pwError);
    const mail = emailParam(email);
    if (mail && q.userByEmail.get(mail)) throw new HttpError(409, 'That email is already used by another account.');
    if (q.userByName.get(name)) throw new HttpError(409, 'That username is taken.');
    const hash = await hashPassword(password);
    let id;
    try {
      id = Number(q.addUser.run(name, hash, Date.now(), mail).lastInsertRowid);
    } catch {
      throw new HttpError(409, 'That username or email is taken.'); // lost a race with another sign-up
    }
    signIn(req, res, 201, { id, name }, token);
  },

  'POST /api/login': async (req, res) => {
    limit(req, 'login', 10, 10 * MINUTE, 'Too many attempts. Wait a few minutes and try again.');
    const { name, password, token } = await readJSON(req);
    // log in with either the username or the account's email
    const login = typeof name === 'string' ? name.trim() : '';
    const user = login.includes('@') && login.length <= 254 ? q.userByEmail.get(login.toLowerCase())
      : login && login.length <= 16 ? q.userByName.get(login) : null;
    const ok = await verifyPassword(String(password ?? ''), user ? user.pass : DUMMY_HASH);
    if (!user || !ok) throw new HttpError(401, 'Wrong username, email or password.');
    signIn(req, res, 200, user, token);
  },

  'POST /api/auth/crazygames': async (req, res) => {
    limit(req, 'cg-login', 20, 10 * MINUTE, 'Too many attempts. Wait a few minutes and try again.');
    const { token, wantToken } = await readJSON(req);
    const user = crazygames.accountFor(await crazygames.verifyToken(token));
    signIn(req, res, 200, user, wantToken);
  },

  'POST /api/logout': async (req, res) => {
    endSession(req);
    sendJSON(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(req) });
  },

  'GET /api/me': (req, res, url) => {
    const user = currentUser(req);
    if (!user) return sendJSON(res, 200, { user: null, stats: null });
    const pr = profile(user);
    sendJSON(res, 200, {
      user: {
        name: user.name, staffRank: user.staff_rank || null, paidRank: user.paid_rank || null, created: user.created,
        rankId: displayRank(user.staff_rank, user.paid_rank).id, level: levelFromXp(pr.progress.xp).level,
        email: user.email || null, platform: user.cg_user_id ? 'crazygames' : null, hasPassword: !user.no_password,
      },
      stats: lifetimeStats(user, modeParam(url.searchParams.get('mode'))),
      progress: pr.progress,
      wallet: pr.wallet,
      owned: pr.owned,
      cosmetics: storedCosmetics(user, pr.ctx),
    });
  },

  'POST /api/shop/buy': async (req, res) => {
    const user = requireUser(req);
    limit(req, 'shop', 20, MINUTE);
    const { kind, id } = await readJSON(req);
    const result = transaction(() => {
      const pr = profile(user);
      let cost = 0;
      if (kind === 'rank') {
        if (isStaffRank(user.staff_rank)) throw new HttpError(400, 'Staff already have every perk.');
        const target = RANKS.find((r) => r.id === id && r.tier > 0);
        if (!target) throw new HttpError(400, 'Unknown rank.');
        cost = upgradePrice(user.paid_rank || 'NONE', target.id);
        if (!cost) throw new HttpError(400, `You already have ${rankById(user.paid_rank).name}.`);
        if (cost > pr.wallet.coins) throw new HttpError(400, `You need ${cost - pr.wallet.coins} more coins.`);
        q.spendCoins.run(cost, user.id);
        q.setPaidRank.run(target.id, user.id);
        user.paid_rank = target.id;
      } else if (kind === 'skin' || kind === 'cape') {
        const item = (kind === 'skin' ? SKINS : CAPES).find((x) => x.id === id);
        if (!item || !isPurchasable(item)) throw new HttpError(400, "That item isn't for sale.");
        if (itemStatus(kind, item, pr.ctx) !== 'buy') throw new HttpError(400, 'You already own that.');
        cost = item.price;
        if (cost > pr.wallet.coins) throw new HttpError(400, `You need ${cost - pr.wallet.coins} more coins.`);
        q.spendCoins.run(cost, user.id);
        q.addOwned.run(user.id, kind, item.id, Date.now());
      } else {
        throw new HttpError(400, 'Unknown item type.');
      }
      return { cost, ...profile({ ...user, coins_spent: (user.coins_spent || 0) + cost }) };
    });
    user.coins_spent = (user.coins_spent || 0) + result.cost;
    sendJSON(res, 200, { ok: true, spent: result.cost, wallet: result.wallet, owned: result.owned, paidRank: user.paid_rank || null });
  },

  'POST /api/cosmetics': async (req, res) => {
    const user = requireUser(req);
    limit(req, 'cosmetics', 30, MINUTE);
    const { cosmetics } = await readJSON(req);
    const clean = sanitizeCosmetics(cosmetics, unlockContext(user)); // locked items silently fall back
    q.setCosmetics.run(JSON.stringify(clean), user.id);
    sendJSON(res, 200, { cosmetics: clean });
  },

  'POST /api/account/password': async (req, res) => {
    const user = requireUser(req);
    limit(req, 'password', 5, 10 * MINUTE, 'Too many attempts. Wait a few minutes and try again.');
    const { currentPassword, newPassword } = await readJSON(req);
    const row = q.userById.get(user.id);
    if (!hasPassword(row)) throw new HttpError(400, 'This account signs in through CrazyGames, so it has no password.');
    if (!(await verifyPassword(String(currentPassword ?? ''), row.pass))) throw new HttpError(403, 'Your current password is incorrect.');
    const pwError = validatePassword(newPassword);
    if (pwError) throw new HttpError(400, pwError);
    const hash = await hashPassword(newPassword);
    transaction(() => {
      q.setPassword.run(hash, Date.now(), user.id);
      endAllSessions(user.id); // sign out every other device
    });
    const s = createSession(req, user.id);
    sendJSON(res, 200, { ok: true, token: s.token }, { 'Set-Cookie': s.cookie });
  },

  'POST /api/account/email': async (req, res) => {
    const user = requireUser(req);
    limit(req, 'email', 5, 10 * MINUTE, 'Too many attempts. Wait a few minutes and try again.');
    const { password, email } = await readJSON(req);
    const row = q.userById.get(user.id);
    if (hasPassword(row) && !(await verifyPassword(String(password ?? ''), row.pass))) throw new HttpError(403, 'Your password is incorrect.');
    const mail = emailParam(email);
    const other = mail ? q.userByEmail.get(mail) : null;
    if (other && other.id !== user.id) throw new HttpError(409, 'That email is already used by another account.');
    q.setEmail.run(mail, user.id);
    sendJSON(res, 200, { ok: true, email: mail });
  },

  'POST /api/account/delete': async (req, res) => {
    const user = requireUser(req);
    limit(req, 'delete', 5, 10 * MINUTE);
    const { password, confirmName } = await readJSON(req);
    const row = q.userById.get(user.id);
    if (hasPassword(row)) {
      if (!(await verifyPassword(String(password ?? ''), row.pass))) throw new HttpError(403, 'Your password is incorrect.');
    } else if (String(confirmName ?? '').toLowerCase() !== row.name.toLowerCase()) {
      throw new HttpError(403, 'Type your username to confirm.'); // platform accounts have no password
    }
    transaction(() => {
      q.deleteUserStats.run(user.id);
      q.deleteUserMatches.run(user.id);
      q.deleteUserOwned.run(user.id);
      endAllSessions(user.id);
      q.deleteUser.run(user.id);
    });
    sendJSON(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(req) });
  },

  'GET /api/chat/stream': (req, res) => {
    limit(req, 'chat-stream', 200, MINUTE); // per IP, and schools share one
    chat.openStream(req, res);
  },

  'POST /api/chat/send': async (req, res) => {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, 'Sign up or log in to chat.');
    limit(req, 'chat', 30, MINUTE, 'Slow down a little.');
    chat.send(res, user, await readJSON(req));
  },

  'GET /api/online': (req, res) => {
    sendJSON(res, 200, { players: onlineCounts(), roomSize: MAX_PLAYERS });
  },

  'GET /api/leaderboard': (req, res, url) => {
    limit(req, 'board', 60, MINUTE);
    const p = url.searchParams;
    const lim = Math.max(1, Math.min(100, Math.floor(Number(p.get('limit')) || 50)));
    const result = leaderboard({
      mode: modeParam(p.get('mode')),
      period: PERIODS.includes(p.get('period')) ? p.get('period') : 'all',
      limit: lim,
      user: currentUser(req),
    });
    sendJSON(res, 200, { ...result, modes: MODES });
  },

  'POST /api/match/start': async (req, res) => {
    const user = requireUser(req);
    limit(req, 'match', 20, MINUTE);
    const { mode } = await readJSON(req);
    const id = crypto.randomBytes(16).toString('hex'), now = Date.now();
    q.addMatch.run(id, user.id, modeParam(mode), now, now);
    sendJSON(res, 200, { matchId: id });
  },

  'POST /api/match/report': async (req, res) => {
    const user = requireUser(req);
    limit(req, 'report', 40, MINUTE);
    const body = await readJSON(req);
    const match = typeof body.matchId === 'string' && body.matchId.length === 32 ? q.match.get(body.matchId, user.id) : null;
    if (!match) throw new HttpError(404, 'Unknown match.');
    const now = Date.now(), a = clampReport(body, match, now);
    transaction(() => {
      q.touchMatch.run(now, a.kills, match.id);
      for (const period of periodKeys(now)) {
        q.addStats.run(user.id, match.mode, period, a.kills, a.deaths, a.bestStreak, a.coins, a.xp, a.seconds, now);
      }
    });
    sendJSON(res, 200, { ok: true, accepted: a });
  },
};

/** Returns the handler for a request, or null. */
export function findRoute(method, pathname) {
  const key = `${method === 'HEAD' ? 'GET' : method} ${pathname}`;
  return Object.hasOwn(routes, key) ? routes[key] : null;
}

/** True when the path exists with a different method (for 405 responses). */
export function pathExists(pathname) {
  return Object.keys(routes).some((k) => k.split(' ')[1] === pathname);
}
