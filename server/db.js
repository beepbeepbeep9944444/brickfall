// SQLite storage (built-in node:sqlite) with versioned migrations and prepared queries.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(config.dataDir, 'brickfall.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');

// Each entry upgrades the schema by one version. Never edit a shipped migration — add a new one.
const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS users(
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL UNIQUE COLLATE NOCASE,
     pass TEXT NOT NULL,
     created INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS sessions(
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL,
     expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS stats(
     user_id INTEGER NOT NULL, mode TEXT NOT NULL, period TEXT NOT NULL,
     kills INTEGER NOT NULL DEFAULT 0, deaths INTEGER NOT NULL DEFAULT 0, best_streak INTEGER NOT NULL DEFAULT 0,
     coins INTEGER NOT NULL DEFAULT 0, seconds INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL,
     PRIMARY KEY(user_id, mode, period));
   CREATE INDEX IF NOT EXISTS stats_by_kills ON stats(mode, period, kills DESC);
   CREATE TABLE IF NOT EXISTS matches(
     id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, mode TEXT NOT NULL,
     started INTEGER NOT NULL, last INTEGER NOT NULL, kills INTEGER NOT NULL DEFAULT 0);`,
  `CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions(user_id);
   CREATE INDEX IF NOT EXISTS matches_by_user ON matches(user_id);
   ALTER TABLE users ADD COLUMN password_changed INTEGER;`,
  `ALTER TABLE users ADD COLUMN staff_rank TEXT;
   ALTER TABLE users ADD COLUMN cosmetics TEXT;`,
  // shop + levels: XP per stats bucket (past kills are converted at 20 XP each), wallet, purchases
  `ALTER TABLE stats ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;
   UPDATE stats SET xp = kills * 20;
   ALTER TABLE users ADD COLUMN coins_spent INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE users ADD COLUMN paid_rank TEXT;
   CREATE TABLE IF NOT EXISTS owned(
     user_id INTEGER NOT NULL, kind TEXT NOT NULL, item_id TEXT NOT NULL, purchased INTEGER NOT NULL,
     PRIMARY KEY(user_id, kind, item_id));`,
  // optional email (stored lowercase), CrazyGames account link, chat mutes
  `ALTER TABLE users ADD COLUMN email TEXT;
   CREATE UNIQUE INDEX IF NOT EXISTS users_by_email ON users(email) WHERE email IS NOT NULL;
   ALTER TABLE users ADD COLUMN cg_user_id TEXT;
   CREATE UNIQUE INDEX IF NOT EXISTS users_by_cg ON users(cg_user_id) WHERE cg_user_id IS NOT NULL;
   ALTER TABLE users ADD COLUMN chat_muted_until INTEGER;`,
];

function migrate() {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version=${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
migrate();

export const q = {
  userByName: db.prepare('SELECT * FROM users WHERE name = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  addUser: db.prepare('INSERT INTO users(name, pass, created, email) VALUES(?, ?, ?, ?)'),
  addPlatformUser: db.prepare('INSERT INTO users(name, pass, created, cg_user_id) VALUES(?, ?, ?, ?)'),
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userByCrazyGamesId: db.prepare('SELECT * FROM users WHERE cg_user_id = ?'),
  setEmail: db.prepare('UPDATE users SET email = ? WHERE id = ?'),
  setChatMute: db.prepare('UPDATE users SET chat_muted_until = ? WHERE id = ?'),
  setPassword: db.prepare('UPDATE users SET pass = ?, password_changed = ? WHERE id = ?'),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  setCosmetics: db.prepare('UPDATE users SET cosmetics = ? WHERE id = ?'),
  setStaffRank: db.prepare('UPDATE users SET staff_rank = ? WHERE id = ?'),
  setPaidRank: db.prepare('UPDATE users SET paid_rank = ? WHERE id = ?'),
  spendCoins: db.prepare('UPDATE users SET coins_spent = coins_spent + ? WHERE id = ?'),
  /** Lifetime totals across every mode: level (XP), unlocks (streak) and coins earned. */
  progress: db.prepare(`SELECT COALESCE(SUM(kills), 0) AS kills, COALESCE(MAX(best_streak), 0) AS bestStreak,
    COALESCE(SUM(xp), 0) AS xp, COALESCE(SUM(coins), 0) AS coinsEarned
    FROM stats WHERE user_id = ? AND period = 'all'`),
  owned: db.prepare('SELECT kind, item_id FROM owned WHERE user_id = ?'),
  addOwned: db.prepare('INSERT OR IGNORE INTO owned(user_id, kind, item_id, purchased) VALUES(?, ?, ?, ?)'),
  deleteUserOwned: db.prepare('DELETE FROM owned WHERE user_id = ?'),

  addSession: db.prepare('INSERT INTO sessions(token_hash, user_id, expires) VALUES(?, ?, ?)'),
  sessionUser: db.prepare(`SELECT u.id, u.name, u.staff_rank, u.paid_rank, u.coins_spent, u.created, u.cosmetics,
      u.email, u.cg_user_id, u.chat_muted_until, u.pass = '!' AS no_password
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?`),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires <= ?'),

  addMatch: db.prepare('INSERT INTO matches(id, user_id, mode, started, last) VALUES(?, ?, ?, ?, ?)'),
  match: db.prepare('SELECT * FROM matches WHERE id = ? AND user_id = ?'),
  touchMatch: db.prepare('UPDATE matches SET last = ?, kills = kills + ? WHERE id = ?'),
  deleteUserMatches: db.prepare('DELETE FROM matches WHERE user_id = ?'),
  purgeMatches: db.prepare('DELETE FROM matches WHERE last <= ?'),

  addStats: db.prepare(`INSERT INTO stats(user_id, mode, period, kills, deaths, best_streak, coins, xp, seconds, updated)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, mode, period) DO UPDATE SET
      kills = kills + excluded.kills, deaths = deaths + excluded.deaths,
      best_streak = MAX(best_streak, excluded.best_streak), coins = coins + excluded.coins,
      xp = xp + excluded.xp, seconds = seconds + excluded.seconds, updated = excluded.updated`),
  deleteUserStats: db.prepare('DELETE FROM stats WHERE user_id = ?'),
};

/** Run `fn` inside a transaction. */
export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function closeDb() {
  try { db.close(); } catch { /* already closed */ }
}
