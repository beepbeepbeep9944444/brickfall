// The game connection: GET /ws upgrades to a WebSocket. The first message must be
// { t: 'hello', mode, name?, cos?, token? }; the player is then placed in a room.
// Signed-in players are identified by their session cookie (same site) or the token in hello
// (builds hosted elsewhere). One connection per account: joining again replaces the old one.
import { config } from '../config.js';
import { log } from '../log.js';
import { clientIp, isCorsOrigin } from '../http.js';
import { currentUser, userForToken } from '../auth.js';
import { validateUsername } from '../names.js';
import { acceptUpgrade, rejectUpgrade } from '../ws.js';
import { joinRoom, leaveRoom, handleMessage, findUserFighter, profileFor } from './rooms.js';

const HELLO_TIMEOUT = 10000;
const MAX_PER_IP = 60; // schools share one address
const perIp = new Map();
const sockets = new Set();

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host || isCorsOrigin(origin); } catch { return false; }
}

export function handleUpgrade(req, socket, head) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws') return rejectUpgrade(socket, 404, 'Not Found');
  if (!originAllowed(req)) return rejectUpgrade(socket, 403, 'Forbidden');
  const ip = clientIp(req);
  if ((perIp.get(ip) || 0) >= MAX_PER_IP) return rejectUpgrade(socket, 429, 'Too Many Requests');
  const conn = acceptUpgrade(req, socket);
  if (!conn) return undefined;
  if (head?.length) conn.onData(head);
  perIp.set(ip, (perIp.get(ip) || 0) + 1);
  sockets.add(conn);

  let session = null; // { room, fighter }
  const helloTimer = setTimeout(() => { if (!session) conn.close(4000, 'no hello'); }, HELLO_TIMEOUT);

  conn.on('message', (text) => {
    if (session) { handleMessage(session.room, session.fighter, text); return; }
    let hello;
    try { hello = JSON.parse(text); } catch { conn.close(4000, 'bad hello'); return; }
    if (hello?.t !== 'hello') { conn.close(4000, 'bad hello'); return; }
    clearTimeout(helloTimer);
    const user = currentUser(req) || userForToken(hello.token);
    if (user) {
      const old = findUserFighter(user.id);
      if (old) { old.fighter.conn.send({ t: 'kicked', reason: 'You started playing somewhere else.' }); old.fighter.conn.close(4001, 'replaced'); }
    }
    session = joinRoom(conn, hello.mode, profileFor(user, hello, validateUsername));
    if (config.logRequests) log.info('player joined', { room: session.room.id, mode: session.room.mode, name: session.fighter.name });
  });

  conn.on('close', () => {
    clearTimeout(helloTimer);
    sockets.delete(conn);
    const n = (perIp.get(ip) || 1) - 1;
    if (n > 0) perIp.set(ip, n); else perIp.delete(ip);
    if (session) leaveRoom(session.room, session.fighter);
  });
  return undefined;
}

/** Drop every game connection (shutdown). */
export function closeGameConnections() {
  for (const c of sockets) c.close(1001, 'server restarting');
}
