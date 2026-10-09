// Global chat: players receive messages over Server-Sent Events and send them with a POST.
// Anyone can read; only signed-in players can talk (and bots never do). Messages are filtered
// (names.js), rate limited per account, and staff can mute players.
import { q } from './db.js';
import { HttpError, clientIp, sendJSON } from './http.js';
import { censorChat } from './names.js';
import { displayRank, levelFromXp, isStaffRank, rankById } from '../public/js/shared/cosmetics.js';
import { isMode } from '../public/js/shared/modes.js';

export const MAX_LENGTH = 100;
const HISTORY = 40;
// a whole school often shares one IP address, so the per-IP cap is generous
const MAX_CLIENTS = 2000, MAX_CLIENTS_PER_IP = 80;
const HEARTBEAT_MS = 25000;
// per account: at most BURST messages per BURST_WINDOW, and MIN_GAP between messages
const MIN_GAP = 1200, BURST = 5, BURST_WINDOW = 15000;
const MOD_TIER = 10; // MOD and above can mute

const history = [];
const clients = new Set();
const recent = new Map(); // user id -> { times: [], last: '' }
let nextId = 1;

function write(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(msg) {
  history.push(msg);
  if (history.length > HISTORY) history.shift();
  for (const c of clients) write(c.res, 'message', msg);
}

/** GET /api/chat/stream — recent history, then live messages. */
export function openStream(req, res) {
  const ip = clientIp(req);
  let fromIp = 0;
  for (const c of clients) if (c.ip === ip) fromIp++;
  if (clients.size >= MAX_CLIENTS || fromIp >= MAX_CLIENTS_PER_IP) throw new HttpError(429, 'Too many chat connections.');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // don't let proxies buffer the stream
  });
  res.write('retry: 5000\n\n');
  write(res, 'history', history);
  const client = { res, ip, beat: setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS) };
  clients.add(client);
  req.on('close', () => { clearInterval(client.beat); clients.delete(client); });
}

/** End every open stream (server shutdown). */
export function closeChat() {
  for (const c of clients) { clearInterval(c.beat); c.res.end(); }
  clients.clear();
}

/** Forget history and rate-limit state (tests). */
export function resetChat() {
  history.length = 0;
  recent.clear();
}

const tierOf = (user) => rankById(displayRank(user.staff_rank, user.paid_rank).id).tier;

/** Staff commands: /mute <name> [minutes], /unmute <name>. Returns a reply for the sender. */
function command(user, text) {
  const [cmd, name, minutesArg] = text.slice(1).split(/\s+/);
  const c = cmd.toLowerCase();
  if (c !== 'mute' && c !== 'unmute') return { system: 'Unknown command.' };
  if (!isStaffRank(user.staff_rank) || tierOf(user) < MOD_TIER) return { system: 'Only staff can do that.' };
  const target = name ? q.userByName.get(name) : null;
  if (!target) return { system: `No player named "${name || ''}".` };
  if (c === 'unmute') {
    q.setChatMute.run(null, target.id);
    return { system: `${target.name} can chat again.` };
  }
  if (tierOf(target) >= tierOf(user)) return { system: "You can't mute that player." };
  const minutes = Math.max(1, Math.min(60 * 24 * 30, Math.floor(Number(minutesArg) || 60)));
  q.setChatMute.run(Date.now() + minutes * 60e3, target.id);
  return { system: `${target.name} is muted for ${minutes} minute${minutes === 1 ? '' : 's'}.` };
}

/** POST /api/chat/send — { text, mode }. */
export function send(res, user, body) {
  const raw = typeof body.text === 'string' ? body.text.trim() : '';
  if (!raw) throw new HttpError(400, 'Type a message first.');
  if (raw.length > MAX_LENGTH) throw new HttpError(400, `Messages can be at most ${MAX_LENGTH} characters.`);
  if (raw.startsWith('/')) return sendJSON(res, 200, command(user, raw));

  if (user.chat_muted_until && user.chat_muted_until > Date.now()) {
    const mins = Math.ceil((user.chat_muted_until - Date.now()) / 60e3);
    throw new HttpError(403, `You're muted for ${mins} more minute${mins === 1 ? '' : 's'}.`);
  }
  const now = Date.now(), r = recent.get(user.id) || { times: [], last: '' };
  r.times = r.times.filter((t) => now - t < BURST_WINDOW);
  if (r.times.length && now - r.times.at(-1) < MIN_GAP) throw new HttpError(429, 'Slow down a little.');
  if (r.times.length >= BURST) throw new HttpError(429, 'You are sending messages too fast.');
  const text = censorChat(raw);
  if (!text.replace(/[*\s]/g, '')) throw new HttpError(400, "That message can't be sent.");
  if (text.toLowerCase() === r.last) throw new HttpError(429, "Don't repeat the same message.");
  r.times.push(now);
  r.last = text.toLowerCase();
  recent.set(user.id, r);
  if (recent.size > 5000) recent.clear();

  const msg = {
    id: nextId++,
    name: user.name,
    rankId: displayRank(user.staff_rank, user.paid_rank).id,
    level: levelFromXp(q.progress.get(user.id).xp).level,
    mode: isMode(body.mode) ? body.mode : null,
    text,
    t: now,
  };
  broadcast(msg);
  sendJSON(res, 200, { message: msg });
}
