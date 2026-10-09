// CrazyGames account integration. The game gets a signed user token from the CrazyGames SDK
// (SDK.user.getUserToken()) and sends it here; we verify the RS256 signature with CrazyGames'
// public key and link the CrazyGames user to a Brickfall account, creating one on first visit.
import crypto from 'node:crypto';
import { config } from './config.js';
import { log } from './log.js';
import { q } from './db.js';
import { HttpError } from './http.js';
import { NO_PASSWORD } from './auth.js';
import { validateUsername } from './names.js';

const KEY_TTL = 3600e3;
let cachedKey = null, cachedAt = 0;

async function publicKey() {
  if (config.crazyGames.publicKey) return config.crazyGames.publicKey;
  if (cachedKey && Date.now() - cachedAt < KEY_TTL) return cachedKey;
  try {
    const r = await fetch(config.crazyGames.publicKeyUrl, { signal: AbortSignal.timeout(5000) });
    const { publicKey: pem } = await r.json();
    if (typeof pem !== 'string' || !pem.includes('PUBLIC KEY')) throw new Error('no key in response');
    cachedKey = pem;
    cachedAt = Date.now();
    return pem;
  } catch (err) {
    log.error('could not fetch the CrazyGames public key', { error: String(err) });
    if (cachedKey) return cachedKey; // keep working with the old key during an outage
    throw new HttpError(503, "Couldn't reach CrazyGames. Try again in a moment.");
  }
}

const b64json = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/** Verify a CrazyGames user token. Returns { userId, username }. */
export async function verifyToken(token) {
  const bad = () => new HttpError(401, 'Your CrazyGames sign-in could not be verified.');
  if (typeof token !== 'string' || token.length > 4096) throw bad();
  const parts = token.split('.');
  if (parts.length !== 3) throw bad();
  let header, payload;
  try { header = b64json(parts[0]); payload = b64json(parts[1]); } catch { throw bad(); }
  if (header.alg !== 'RS256') throw bad();
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), await publicKey(), Buffer.from(parts[2], 'base64url'));
  if (!ok) throw bad();
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) throw new HttpError(401, 'Your CrazyGames sign-in expired. Please try again.');
  if (typeof payload.userId !== 'string' && typeof payload.userId !== 'number') throw bad();
  return { userId: String(payload.userId), username: typeof payload.username === 'string' ? payload.username : '' };
}

/** A free Brickfall username based on the CrazyGames one. */
function pickName(wanted) {
  let base = String(wanted).replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
  if (base.length < 3 || validateUsername(base)) base = 'Player';
  if (!q.userByName.get(base)) return base;
  for (let i = 0; i < 50; i++) {
    const n = `${base.slice(0, 11)}${crypto.randomInt(10000, 99999)}`;
    if (!q.userByName.get(n)) return n;
  }
  return `Player${crypto.randomInt(1e6, 1e7)}`;
}

/** The Brickfall account linked to this CrazyGames user (created if needed). */
export function accountFor({ userId, username }) {
  const existing = q.userByCrazyGamesId.get(userId);
  if (existing) return existing;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const id = Number(q.addPlatformUser.run(pickName(username), NO_PASSWORD, Date.now(), userId).lastInsertRowid);
      return q.userById.get(id);
    } catch {
      const raced = q.userByCrazyGamesId.get(userId); // two tabs signing in at once
      if (raced) return raced;
    }
  }
  throw new HttpError(500, "Couldn't create your account. Please try again.");
}
