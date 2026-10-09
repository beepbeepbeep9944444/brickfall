// Passwords (scrypt) and sessions (random token; only its SHA-256 is stored). The token travels in an
// HttpOnly cookie on our own site, or as a bearer token for builds hosted elsewhere (e.g. CrazyGames).
import crypto from 'node:crypto';
import { config } from './config.js';
import { q } from './db.js';
import { parseCookies, isHttps } from './http.js';

const COOKIE = 'bf_session';
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, KEY_LEN, SCRYPT, (err, key) => {
      if (err) reject(err); else resolve(`scrypt$${salt.toString('hex')}$${key.toString('hex')}`);
    });
  });
}

export function verifyPassword(password, stored) {
  const [scheme, saltHex, keyHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return Promise.resolve(false);
  return new Promise((resolve) => {
    crypto.scrypt(String(password), Buffer.from(saltHex, 'hex'), KEY_LEN, SCRYPT, (err, key) => {
      const expected = Buffer.from(keyHex, 'hex');
      resolve(!err && key.length === expected.length && crypto.timingSafeEqual(key, expected));
    });
  });
}

/** Used when the username doesn't exist, so failed logins take the same time either way. */
export const DUMMY_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (pw.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`;
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Basic shape check. We can't send mail, so addresses are not verified. */
export function validateEmail(email) {
  if (typeof email !== 'string' || email.length > 254 || !EMAIL_RE.test(email)) return "That doesn't look like an email address.";
  return null;
}

function cookie(req, token, maxAgeSeconds) {
  const secure = config.secureCookies || isHttps(req) ? '; Secure' : '';
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

/** Accounts made through another platform have no password; this never matches a login. */
export const NO_PASSWORD = '!';

/** Create a session. Returns { cookie (Set-Cookie value), token (for bearer-token clients) }. */
export function createSession(req, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  q.addSession.run(sha256(token), userId, Date.now() + config.sessionDays * 864e5);
  return { cookie: cookie(req, token, config.sessionDays * 86400), token };
}

export function clearSessionCookie(req) {
  return cookie(req, '', 0);
}

function tokenOf(req) {
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  const t = bearer ? bearer[1] : parseCookies(req)[COOKIE];
  return t && t.length <= 100 ? t : null;
}

/** The signed-in user ({ id, name }) or null. */
export function currentUser(req) {
  const t = tokenOf(req);
  return t ? q.sessionUser.get(sha256(t), Date.now()) || null : null;
}

/** The user for a raw session token (the game connection sends it when cookies aren't available). */
export function userForToken(token) {
  return typeof token === 'string' && token.length <= 100 ? q.sessionUser.get(sha256(token), Date.now()) || null : null;
}

export function endSession(req) {
  const t = tokenOf(req);
  if (t) q.deleteSession.run(sha256(t));
}

export function endAllSessions(userId) {
  q.deleteUserSessions.run(userId);
}
