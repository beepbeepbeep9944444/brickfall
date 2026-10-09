// Username rules, a basic offensive-name filter, and the chat filter built on the same word lists.
// The filter normalises look-alike characters ("4" -> "a", repeated letters, underscores) and then
// checks three lists. It is intentionally simple: it stops the obvious cases, not a determined troll.

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

/** Names nobody may register (impersonation risk). */
const RESERVED = new Set([
  'admin', 'administrator', 'moderator', 'mod', 'staff', 'owner', 'support', 'system', 'server',
  'brickfall', 'official', 'root', 'null', 'undefined', 'guest', 'anonymous', 'everyone',
]);

/** Blocked anywhere in the name. */
const ANYWHERE = [
  'fuck', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut', 'rapist',
  'nazi', 'hitler', 'porn', 'penis', 'vagina', 'pussy', 'asshole', 'dildo', 'kike', 'wetback',
  'tranny', 'molest', 'pedophile', 'kkk', 'heil',
];

/** Blocked at the start or end of the name (too many innocent words contain them in the middle). */
const EDGES = ['dick', 'dyke', 'jizz', 'twat', 'wank', 'cock'];

/** Blocked only as the whole name (they appear inside common words). */
const WHOLE = ['ass', 'hoe', 'tit', 'tits', 'cum', 'sex', 'spic', 'coon', 'chink', 'fag', 'rape', 'nig'];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g' };

function normalise(name) {
  return name
    .toLowerCase()
    .replace(/[0-9]/g, (d) => LEET[d] ?? '')
    .replace(/_/g, '')
    .replace(/(.)\1+/g, '$1');
}

/** Returns an error message, or null if the name is acceptable. */
export function validateUsername(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) return 'Username must be 3–16 letters, numbers or _.';
  const lower = name.toLowerCase().replace(/_/g, '');
  if (RESERVED.has(lower)) return 'That username is reserved.';
  const n = normalise(name);
  const raw = name.toLowerCase().replace(/[0-9_]/g, '');
  const offensive =
    ANYWHERE.some((w) => n.includes(w) || raw.includes(w)) ||
    EDGES.some((w) => n.startsWith(w) || n.endsWith(w)) ||
    WHOLE.some((w) => n === w || raw === w);
  return offensive ? 'Please choose a different username.' : null;
}

// ---------------------------------------------------------------- chat
const LINK_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|gg|io|xyz|ru|tk|me|co|uk|us|tv|app|dev|link|ly|to|info|biz|club|site|online|shop)\b\S*/gi;
const EMAIL_RE = /\S+@\S+\.\S+/g;
const PHONE_RE = /(?:\+?\d[\s\-.()]*){7,}/g; // 7+ digits: phone numbers and similar personal info
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;

function offensiveWord(token) {
  const word = token.replace(/[^A-Za-z0-9_]/g, '');
  if (!word) return false;
  const n = normalise(word), raw = word.toLowerCase().replace(/[0-9_]/g, '');
  return ANYWHERE.some((w) => n.includes(w) || raw.includes(w)) ||
    EDGES.some((w) => n.startsWith(w) || n.endsWith(w)) ||
    WHOLE.some((w) => n === w || raw === w || n === `${w}s` || raw === `${w}s`);
}

/** Clean a chat message: strips control characters, links, emails and phone numbers, stars out bad words. */
export function censorChat(text) {
  const clean = String(text).replace(CONTROL_RE, '').replace(/\s+/g, ' ').trim();
  return clean
    .replace(EMAIL_RE, '***')
    .replace(LINK_RE, '***')
    .replace(PHONE_RE, '***')
    .split(/(\s+)/)
    .map((tok) => (offensiveWord(tok) ? '*'.repeat(Math.min(Math.max(tok.length, 3), 8)) : tok))
    .join('');
}
