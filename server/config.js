// Server configuration, read once from environment variables (see .env.example).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const num = (v, fallback) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback);
const flag = (v) => v === '1' || v === 'true';

export const config = Object.freeze({
  version: JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version,
  port: num(env.PORT, 8123),
  host: env.HOST || '0.0.0.0',
  publicDir: path.join(root, 'public'),
  dataDir: path.resolve(env.DATA_DIR || path.join(root, 'data')),
  isProduction: env.NODE_ENV === 'production',
  // Only trust X-Forwarded-For / -Proto when running behind a reverse proxy you control.
  trustProxy: flag(env.TRUST_PROXY),
  // Force the Secure cookie flag (it is also set automatically for HTTPS requests behind a trusted proxy).
  secureCookies: flag(env.SECURE_COOKIES),
  logRequests: env.LOG_REQUESTS !== '0',
  // Multiplies every rate limit (tests raise it; 1 is the production default).
  rateLimitScale: num(env.RATE_LIMIT_SCALE, 1),
  sessionDays: num(env.SESSION_DAYS, 30),
  // Online rooms are topped up with bots until they hold this many fighters (0 = no bots).
  roomFighters: num(env.ROOM_FIGHTERS, 8),
  // Other sites allowed to call the API (e.g. the CrazyGames build). Comma-separated origins;
  // "https://*.example.com" matches any subdomain. Cross-origin clients use bearer tokens, never cookies.
  corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  crazyGames: {
    // PEM public key for verifying CrazyGames user tokens. Normally fetched from publicKeyUrl.
    // (literal "\n" sequences are turned into newlines, since most hosts store env values on one line)
    publicKey: env.CRAZYGAMES_PUBLIC_KEY ? env.CRAZYGAMES_PUBLIC_KEY.replace(/\\n/g, '\n') : null,
    publicKeyUrl: env.CRAZYGAMES_PUBLIC_KEY_URL || 'https://sdk.crazygames.com/publicKey.json',
  },
});
