// HTTP helpers: JSON responses and bodies, cookies, client IP, rate limiting and security headers.
import { config } from './config.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function sendJSON(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

const BODY_LIMIT = 16 * 1024;

export function readJSON(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return reject(new HttpError(415, 'Expected a JSON body.'));
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > BODY_LIMIT) { reject(new HttpError(413, 'Request body too large.')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        resolve(parsed);
      } catch {
        reject(new HttpError(400, 'Malformed JSON.'));
      }
    });
    req.on('error', reject);
  });
}

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore bad cookie */ }
    }
  }
  return out;
}

export function clientIp(req) {
  if (config.trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || 'unknown';
}

export function isHttps(req) {
  return config.trustProxy ? req.headers['x-forwarded-proto'] === 'https' : !!req.socket.encrypted;
}

// ---------------------------------------------------------------- rate limiting
const buckets = new Map();
const MAX_BUCKETS = 50000;

/** Returns true when this IP has used up `limit` requests for `name` in the current window. */
export function rateLimited(req, name, limit, windowMs) {
  const key = `${name}|${clientIp(req)}`, now = Date.now(), max = Math.ceil(limit * config.rateLimitScale);
  let b = buckets.get(key);
  if (!b || now > b.reset) {
    if (buckets.size >= MAX_BUCKETS) pruneBuckets(now);
    b = { count: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  return ++b.count > max;
}

export function pruneBuckets(now = Date.now()) {
  for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
  if (buckets.size >= MAX_BUCKETS) buckets.clear(); // under attack: start fresh rather than grow forever
}

// ---------------------------------------------------------------- security
const CSP = [
  "default-src 'self'",
  // the CrazyGames SDK is only loaded when the game runs with ?platform=crazygames
  "script-src 'self' https://cdn.jsdelivr.net https://sdk.crazygames.com",
  "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self' https://*.crazygames.com",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export function setSecurityHeaders(req, res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

/**
 * Defense in depth against cross-site requests: state-changing calls must come from our own pages
 * or an allowed partner origin (see CORS_ORIGINS). Session cookies are SameSite=Lax and never sent
 * cross-origin (no credentialed CORS), so partner sites can only act with an explicit bearer token.
 */
export function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin fetches from older browsers and non-browser clients
  try { return new URL(origin).host === req.headers.host || isCorsOrigin(origin); } catch { return false; }
}

/** True when `origin` matches an entry in CORS_ORIGINS ("https://*.site.com" matches subdomains). */
export function isCorsOrigin(origin) {
  if (!origin) return false;
  return config.corsOrigins.some((allowed) => {
    if (allowed === origin) return true;
    const m = allowed.match(/^(https?):\/\/\*\.(.+)$/);
    if (!m) return false;
    try {
      const u = new URL(origin);
      return u.protocol === `${m[1]}:` && u.hostname.endsWith(`.${m[2]}`) && !u.port;
    } catch { return false; }
  });
}

/** CORS headers for allowed partner origins (no credentials: they authenticate with a bearer token). */
export function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!isCorsOrigin(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}
