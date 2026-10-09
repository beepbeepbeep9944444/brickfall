// In-game chat with other players (bots never chat). Messages arrive over Server-Sent Events and
// show in the HUD log; press T or Enter to talk. Only signed-in players can send. Players can be
// ignored locally (/ignore name), chat can be switched off in Options, and CrazyGames can disable it.
import { $, esc, store } from '../core/util.js';
import { game, input } from '../core/state.js';
import { settings } from '../core/settings.js';
import { events } from '../core/events.js';
import { requestLock, releaseLock } from '../core/input.js';
import { MODES } from '../shared/modes.js';
import { api, apiUrl, ONLINE } from '../net/api.js';
import { session } from '../net/account.js';
import { cg } from '../net/crazygames.js';
import { logMsg } from './hud.js';
import { rankedName } from './ranks.js';
import { screens } from './screens.js';

const IGNORE_KEY = 'bf_ignored';
const HISTORY_SHOWN = 8;
let source = null;
let ignored = new Set(JSON.parse(store.get(IGNORE_KEY, '[]') || '[]').map((n) => String(n).toLowerCase()));

export const chatAvailable = () => settings.chat && !cg.disableChat && ONLINE;

const saveIgnored = () => store.set(IGNORE_KEY, JSON.stringify([...ignored]));

function note(html) { logMsg(`<span class="chat-sys">${html}</span>`, 'chat-line'); }

function render(msg) {
  if (ignored.has(msg.name.toLowerCase())) return null;
  const mode = msg.mode && msg.mode !== game.mode ? `<span class="chat-mode">${esc(MODES[msg.mode]?.short || '')}</span>` : '';
  const line = logMsg(`${mode}${rankedName(msg.name, msg.rankId, { level: msg.level })}<span class="chat-colon">:</span> <span class="chat-text">${esc(msg.text)}</span>`, 'chat-line');
  return line;
}

/** Earlier messages go above everything else and stay hidden until chat is opened. */
function renderHistory(msgs) {
  const log = $('log');
  for (const m of msgs.slice().reverse()) {
    const line = render(m);
    if (!line) continue;
    line.classList.add('stale');
    log.prepend(line);
  }
}

function connect() {
  if (source || !chatAvailable()) return;
  source = new EventSource(apiUrl('/api/chat/stream'));
  let first = true;
  source.addEventListener('history', (e) => {
    if (!first) return; // reconnects resend history; we've shown it already
    first = false;
    renderHistory(JSON.parse(e.data).slice(-HISTORY_SHOWN));
  });
  source.addEventListener('message', (e) => render(JSON.parse(e.data)));
}

function disconnect() {
  source?.close();
  source = null;
}

// ---------------------------------------------------------------- open / close / send
export function openChat() {
  if (game.state !== 'playing' || input.chatOpen) return;
  if (!chatAvailable()) { note(settings.chat ? 'Chat is turned off here.' : 'Chat is off. Turn it on in Options.'); return; }
  input.chatOpen = true;
  releaseLock();
  $('hud').classList.add('chat-open');
  $('chatform').classList.remove('hidden');
  $('chathint').textContent = session.user ? 'Enter to send · Esc to close · /help' : 'Sign up to chat · Esc to close';
  $('chatinput').disabled = !session.user;
  $('chatinput').placeholder = session.user ? 'Say something nice…' : 'Only players with an account can chat';
  setTimeout(() => $('chatinput').focus(), 0);
  const log = $('log');
  log.scrollTop = log.scrollHeight;
}

/** `resume`: go straight back into the game (Enter); otherwise show the pause menu (Esc). */
export function closeChat(resume) {
  if (!input.chatOpen) return;
  input.chatOpen = false;
  $('chatinput').value = '';
  $('chatinput').blur();
  $('chatform').classList.add('hidden');
  $('hud').classList.remove('chat-open');
  if (resume) requestLock();
  else if (game.state === 'playing' && screens.depth === 0) screens.open('pause');
}

function localCommand(text) {
  const [cmd, name] = text.slice(1).split(/\s+/);
  switch (cmd.toLowerCase()) {
    case 'help':
      note('<b>/ignore name</b> hide someone · <b>/unignore name</b> · <b>/ignored</b> list');
      return true;
    case 'ignore':
      if (!name) { note('Usage: /ignore name'); return true; }
      ignored.add(name.toLowerCase());
      saveIgnored();
      note(`You won't see messages from <b>${esc(name)}</b>.`);
      return true;
    case 'unignore':
      ignored.delete(String(name).toLowerCase());
      saveIgnored();
      note(`Showing messages from <b>${esc(name || '')}</b> again.`);
      return true;
    case 'ignored':
      note(ignored.size ? `Ignored: ${[...ignored].map(esc).join(', ')}` : "You aren't ignoring anyone.");
      return true;
    default:
      return false; // staff commands go to the server
  }
}

async function send(text) {
  if (text.startsWith('/') && localCommand(text)) return;
  try {
    const r = await api('/api/chat/send', { text, mode: game.mode });
    if (r.system) note(esc(r.system));
  } catch (err) {
    note(esc(err.message));
  }
}

export function initChat() {
  $('chatform').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!input.chatOpen) return;
    const text = $('chatinput').value.trim();
    if (text && session.user) send(text);
    closeChat(true);
  });
  $('chatinput').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeChat(false); }
  });
  addEventListener('keydown', (e) => {
    if (game.state !== 'playing' || input.chatOpen || !input.locked || e.repeat) return;
    if (e.code === 'KeyT' || e.code === 'Enter' || e.code === 'Slash') {
      e.preventDefault();
      openChat();
      if (e.code === 'Slash') setTimeout(() => { $('chatinput').value = '/'; }, 0);
    }
  });
  events.on('gameStart', connect);
  events.on('gameEnd', () => { closeChat(false); disconnect(); });
  const refresh = () => { if (!chatAvailable()) { closeChat(false); disconnect(); } else if (game.state === 'playing') connect(); };
  events.on('settingsChanged', refresh);
  events.on('platformSettings', refresh);
}
