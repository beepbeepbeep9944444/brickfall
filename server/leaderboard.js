// Leaderboard queries (per mode, ranked by kills; daily / weekly / lifetime) and match-report limits.
import { db } from './db.js';
import { SKINS, displayRank, levelFromXp } from '../public/js/shared/cosmetics.js';
import { MODES } from '../public/js/shared/modes.js';

/** Game modes, each with its own leaderboard (defined in public/js/shared/modes.js). */
export { MODES };

export const PERIODS = ['day', 'week', 'all'];

/** ISO-8601 week key, e.g. "2026-W41" (weeks start on Monday, UTC). */
export function isoWeek(t = Date.now()) {
  const d = new Date(t);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** UTC day key, e.g. "2026-10-09". */
export const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

/** Every stats bucket a report is added to. */
export const periodKeys = (t = Date.now()) => ['all', isoWeek(t), dayKey(t)];

const keyFor = (period) => (period === 'day' ? dayKey() : period === 'week' ? isoWeek() : 'all');

// lifetime totals across every mode (levels come from total XP)
const TOTAL_XP = "(SELECT COALESCE(SUM(t.xp), 0) FROM stats t WHERE t.user_id = s.user_id AND t.period = 'all')";

/** The equipped skin id for avatars (old or invalid saves show the default skin). */
function skinOf(cosmeticsJson) {
  let id = null;
  try { id = JSON.parse(cosmeticsJson || 'null')?.skin; } catch { id = null; }
  return typeof id === 'string' && SKINS.some((s) => s.id === id) ? id : 'rowan';
}

const format = (x) => ({
  name: x.name,
  rankId: displayRank(x.staff_rank, x.paid_rank).id,
  level: levelFromXp(x.total_xp).level,
  skin: skinOf(x.cosmetics),
  kills: x.kills,
  deaths: x.deaths,
  kd: Number((x.kills / Math.max(1, x.deaths)).toFixed(2)),
});

/** Top rows plus the given user's own position (if they have kills in that period). */
export function leaderboard({ mode, period = 'all', limit = 50, user = null }) {
  const key = keyFor(period);
  const rows = limit > 0
    ? db.prepare(`SELECT u.name, u.staff_rank, u.paid_rank, u.cosmetics, ${TOTAL_XP} AS total_xp, s.kills, s.deaths
        FROM stats s JOIN users u ON u.id = s.user_id
        WHERE s.mode = ? AND s.period = ? AND s.kills > 0
        ORDER BY s.kills DESC, s.deaths ASC, s.updated ASC LIMIT ?`).all(mode, key, limit)
    : [];

  let me = null;
  if (user) {
    const mine = db.prepare(`SELECT ${TOTAL_XP} AS total_xp, s.kills, s.deaths
      FROM stats s WHERE s.user_id = ? AND s.mode = ? AND s.period = ?`).get(user.id, mode, key);
    if (mine && mine.kills > 0) {
      const { r } = db.prepare('SELECT COUNT(*) + 1 AS r FROM stats s WHERE s.mode = ? AND s.period = ? AND s.kills > ?').get(mode, key, mine.kills);
      me = { rank: r, ...format({ ...mine, name: user.name, staff_rank: user.staff_rank, paid_rank: user.paid_rank, cosmetics: user.cosmetics }) };
    }
  }
  return { mode, period, key, rows: rows.map((x, i) => ({ rank: i + 1, ...format(x) })), me };
}

/** A user's lifetime row for a mode (shown on their account card even with 0 kills). */
export function lifetimeStats(user, mode) {
  const row = db.prepare("SELECT kills, deaths, best_streak, coins, seconds, xp FROM stats WHERE user_id = ? AND mode = ? AND period = 'all'").get(user.id, mode);
  if (!row) return null;
  const { r } = db.prepare("SELECT COUNT(*) + 1 AS r FROM stats WHERE mode = ? AND period = 'all' AND kills > ?").get(mode, row.kills);
  return { rank: r, kills: row.kills, deaths: row.deaths, kd: Number((row.kills / Math.max(1, row.deaths)).toFixed(2)), bestStreak: row.best_streak, coins: row.coins, seconds: row.seconds, xp: row.xp };
}

/**
 * Stats are reported by the player's browser, so each report is clamped to what is physically
 * possible in the real time that passed since the previous report.
 */
export function clampReport(body, match, now = Date.now()) {
  const int = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
  const elapsed = Math.max(0, (now - match.last) / 1000);
  const kills = int(body.kills, Math.floor(elapsed / 2) + 2);
  return {
    seconds: int(body.seconds, Math.ceil(elapsed) + 5),
    kills,
    deaths: int(body.deaths, Math.floor(elapsed / 3) + 1),
    coins: int(body.coins, kills * 120),
    xp: int(body.xp, kills * 60),
    bestStreak: int(body.bestStreak, match.kills + kills),
  };
}
