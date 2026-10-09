// HTTP client for the Brickfall server. On our own site the session is an HttpOnly cookie; builds
// hosted elsewhere (CrazyGames) talk to the server cross-origin and send a bearer token instead.
import { store } from '../core/util.js';
import { API_BASE, TOKEN_AUTH } from '../core/platform.js';

/** False when the page was opened straight from disk (no server to talk to). */
export const ONLINE = !!API_BASE || location.protocol === 'http:' || location.protocol === 'https:';

const TIMEOUT_MS = 10000;
const TOKEN_KEY = 'bf_token';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Full URL for an API path. */
export const apiUrl = (path) => API_BASE + path;

/** Remember (or forget, with null) the bearer token from a login response. Cookie mode ignores it. */
export function setToken(token) {
  if (!TOKEN_AUTH) return;
  try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
}

function authHeaders() {
  const t = TOKEN_AUTH ? store.get(TOKEN_KEY, null) : null;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** GET when `body` is omitted, otherwise POST JSON. Throws ApiError with a user-readable message. */
export async function api(path, body) {
  if (!ONLINE) throw new ApiError('Offline — the game server is not running.', 0);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(apiUrl(path), {
      method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...authHeaders() },
      body: body ? JSON.stringify(body) : undefined,
      credentials: TOKEN_AUTH ? 'omit' : 'same-origin',
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0);
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Something went wrong (${res.status}).`, res.status);
  return data;
}

/** Fire-and-forget POST that survives the page closing. */
export function beacon(path, body) {
  if (!ONLINE) return false;
  if (TOKEN_AUTH) { // sendBeacon can't carry the Authorization header
    fetch(apiUrl(path), { method: 'POST', keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) }).catch(() => {});
    return true;
  }
  if (!navigator.sendBeacon) return false;
  return navigator.sendBeacon(apiUrl(path), new Blob([JSON.stringify(body)], { type: 'application/json' }));
}
