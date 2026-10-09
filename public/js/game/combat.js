// Damage, knockback, healing and kills, following the classic 1.8.9 rules:
//  - no attack cooldown; after a hit the victim resists damage for 20 ticks. During the first
//    10 a stronger hit deals only the difference (and no knockback); after that hits land normally
//  - knockback: victim velocity is halved, then pushed 0.4 away from the attacker and 0.4 up (capped)
//  - sprint hits add 0.5 along the attacker's facing (+0.1 up); the attacker slows to 60% and stops sprinting
//  - crits while falling deal 1.5x; sword blocking turns damage into (1 + dmg) / 2 before armor
//  - armor: damage * (25 - points) / 25; absorption hearts soak damage first
//  - fall damage: ceil(fallDistance - 3), ignores armor
// Damage, armor, hurt resistance, knockback and regen come from the active mode (game/rules.js).
import * as THREE from '../vendor/three.js';
import { game } from '../core/state.js';
import { events } from '../core/events.js';
import { sfx } from '../core/audio.js';
import { inSafeZone } from './physics.js';
import { burst } from './effects.js';
import { drawTag } from './characters.js';
import { player } from './entities.js';
import { rankById, killXp, levelFromXp } from '../shared/cosmetics.js';
import { rules } from './rules.js';
import { net } from '../net/net.js';

export const REACH = 3;
export const CRIT_MULTIPLIER = 1.5;
const SPRINT_KNOCKBACK = 0.5, SPRINT_KNOCKBACK_UP = 0.1;
const NATURAL_REGEN_INTERVAL = 4; // 1 HP every 80 ticks with full hunger
const REGEN_II_INTERVAL = 1.25; // Regeneration II: 1 HP every 25 ticks
const PLAYER_RESPAWN = 3.5, BOT_RESPAWN = 3;
const ASSIST_WINDOW = 8; // seconds a recent attacker still gets credit (e.g. knocked off a ledge)
const ENVIRONMENT = new Set(['fall', 'void', 'pearl']);

const _p = new THREE.Vector3();

export function knockback(v, fromX, fromZ) {
  const [KB, KB_UP] = rules().knockback;
  let dx = fromX - v.pos.x, dz = fromZ - v.pos.z;
  while (dx * dx + dz * dz < 1e-4) { dx = (Math.random() - Math.random()) * 0.01; dz = (Math.random() - Math.random()) * 0.01; }
  const d = Math.hypot(dx, dz);
  v.vel.x = v.vel.x / 2 - (dx / d) * KB;
  v.vel.y = Math.min(KB_UP, v.vel.y / 2 + KB_UP);
  v.vel.z = v.vel.z / 2 - (dz / d) * KB;
  v.onGround = false;
}

function refreshTag(f) { if (f.tag) drawTag(f); }

/** Sprint-hit extras: push along the attacker's facing; online the server tells us the yaw. */
export function sprintKnockback(v, yaw) {
  v.vel.x -= Math.sin(yaw) * SPRINT_KNOCKBACK;
  v.vel.z -= Math.cos(yaw) * SPRINT_KNOCKBACK;
  v.vel.y += SPRINT_KNOCKBACK_UP;
}

export function heal(f, amount) {
  if (net.online && (f === player || f.remote)) return; // the server owns everyone's health online
  if (!f.alive || f.hp >= f.maxHp) return;
  f.hp = Math.min(f.maxHp, f.hp + amount);
  refreshTag(f);
}

/**
 * Apply raw damage. kind: 'melee' | 'arrow' | 'rod' | 'fall' | 'void'.
 * `knockFrom` overrides the point knockback pushes away from (defaults to the attacker).
 * Returns true if the hit registered (it may still deal 0 damage, e.g. a fishing rod).
 */
export function damage(victim, raw, attacker, kind, { sprint = false, knockFrom = null, crit = false } = {}) {
  if (!victim.alive) return false;
  if (!ENVIRONMENT.has(kind)) {
    if (inSafeZone(victim) || (attacker && inSafeZone(attacker)) || victim.protectT > 0) return false;
    if (attacker) attacker.protectT = 0; // attacking ends your own spawn protection
  }
  if (net.online) return claim(victim, raw, attacker, kind, { sprint, crit });

  const R = rules(), HURT_RESISTANCE = R.hurtResistance;
  let amount = raw, fresh = true;
  if (victim.iframe > HURT_RESISTANCE / 2) {
    if (amount <= victim.lastDmg) return false;
    const full = amount;
    amount -= victim.lastDmg;
    victim.lastDmg = full;
    fresh = false;
  } else {
    victim.lastDmg = amount;
    victim.iframe = HURT_RESISTANCE;
    victim.hurtT = 0.5;
  }

  let dmg = amount;
  if (!ENVIRONMENT.has(kind)) {
    if (victim.blocking && dmg > 0) dmg = (1 + dmg) * 0.5;
    dmg = (dmg * (25 - R.armor)) / 25;
  }
  if (victim.absorb > 0) { const soak = Math.min(victim.absorb, dmg); victim.absorb -= soak; dmg -= soak; }
  victim.hp -= dmg;

  if (attacker) { victim.lastAttacker = attacker; victim.lastHitT = game.time; }
  if (attacker && !ENVIRONMENT.has(kind)) {
    if (fresh) knockback(victim, (knockFrom || attacker.pos).x, (knockFrom || attacker.pos).z);
    if (sprint) {
      victim.vel.x -= Math.sin(attacker.yaw) * SPRINT_KNOCKBACK;
      victim.vel.z -= Math.cos(attacker.yaw) * SPRINT_KNOCKBACK;
      victim.vel.y += SPRINT_KNOCKBACK_UP;
      attacker.vel.x *= 0.6;
      attacker.vel.z *= 0.6;
      attacker.sprinting = false;
      attacker.sprintBroken = true;
    }
  }

  if (fresh) {
    if (victim === player) {
      sfx('hurt');
      player.hurtAnim = 1;
      const dx = victim.pos.x - (attacker ? attacker.pos.x : victim.pos.x), dz = victim.pos.z - (attacker ? attacker.pos.z : victim.pos.z);
      player.hurtSide = Math.sign(dx * Math.cos(player.yaw) - dz * Math.sin(player.yaw)) || 1;
    }
    if (dmg > 0) burst(_p.set(victim.pos.x, victim.pos.y + 1.2, victim.pos.z), 0xc4304a, 6, 2.5);
  }
  refreshTag(victim);
  events.emit('hurt', { victim, attacker, amount: dmg, kind });
  if (victim.hp <= 0) { victim.hp = 0; kill(victim, attacker, kind); }
  return true;
}

/** Per-tick health upkeep: resistance timers, regeneration and fall damage. */
export function tickVitals(f, dt) {
  const R = rules();
  f.iframe -= dt;
  f.hurtT -= dt;
  f.speedT -= dt;
  f.protectT -= dt;
  f.foodRegenT += dt;
  if (f.foodRegenT >= NATURAL_REGEN_INTERVAL) { f.foodRegenT = 0; if (R.naturalRegen) heal(f, 1); }
  if (f.regenT > 0) {
    f.regenT -= dt;
    f.regenAcc = (f.regenAcc || 0) + dt;
    if (f.regenAcc >= REGEN_II_INTERVAL) { f.regenAcc -= REGEN_II_INTERVAL; heal(f, 1); }
  }
  if (R.fallDamage && f.landedFrom > 3 && !f.fallFromSafe) damage(f, Math.ceil(f.landedFrom - 3), null, 'fall');
}

/**
 * Online: we don't apply damage ourselves, we tell the server what happened and it answers with
 * 'hurt' / 'kill' messages (net/multiplayer.js). Returns false: nothing is confirmed yet.
 */
function claim(victim, raw, attacker, kind, { sprint, crit }) {
  if (victim === player) {
    if (kind === 'fall') net.send({ t: 'env', k: 'fall', a: raw });
    else if (kind === 'pearl') net.send({ t: 'pearl', p: [player.pos.x, player.pos.y, player.pos.z] });
    return false;
  }
  if (!victim.remote || attacker !== player) return false;
  net.send({ t: 'hit', id: victim.netId, k: kind, c: crit ? 1 : 0, s: sprint ? 1 : 0, d: Math.round(raw * 100) / 100 });
  // the sprint-hit slowdown, if this hit can land (the target isn't still resisting damage)
  if (sprint && game.time - (victim.netHurtAt ?? -9) > rules().hurtResistance / 2) {
    player.vel.x *= 0.6;
    player.vel.z *= 0.6;
    player.sprinting = false;
    player.sprintBroken = true;
  }
  return false;
}

export function kill(victim, attacker, kind) {
  if (net.online) { // the server decides deaths; falling out of the world is reported to it
    if (victim === player && player.alive) net.send({ t: 'void' });
    return;
  }
  victim.alive = false;
  victim.deaths++;
  const endedStreak = victim.streak;
  const bounty = endedStreak >= 5 ? endedStreak * 3 : 0;
  victim.streak = 0;
  victim.absorb = 0;
  victim.regenT = 0;
  victim.speedT = 0;

  let killer = attacker && attacker !== victim ? attacker : null;
  if (!killer && victim.lastAttacker && game.time - victim.lastHitT < ASSIST_WINDOW) killer = victim.lastAttacker;

  let reward = 0, xp = 0, levelUp = 0;
  if (killer) {
    killer.kills++;
    killer.streak++;
    killer.best = Math.max(killer.best, killer.streak);
    // coins (boosted by rank) and XP (more on a streak)
    reward = Math.round((10 + Math.min(killer.streak, 10) * 2 + bounty) * (1 + rankById(killer.rank).coinBonus));
    killer.coins += reward;
    xp = killXp(killer.streak);
    const before = levelFromXp(killer.xp).level;
    killer.xp += xp;
    const after = levelFromXp(killer.xp).level;
    if (killer === player) { player.level = after; if (after > before) levelUp = after; }
    killer.lastAttacker = null;
    // kill rewards: resupply (per mode) and a little health
    const R = rules();
    if (killer === player) {
      for (const [k, [amount, cap]] of Object.entries(R.killRefill)) player.inv[k] = Math.min(cap, (player.inv[k] || 0) + amount);
    } else if (killer.inv) {
      const kit = R.bot;
      if (kit.pots) killer.inv.pots = Math.min(kit.pots, killer.inv.pots + 6);
      if (kit.flasks) killer.inv.flasks = Math.min(kit.flasks, killer.inv.flasks + 2);
    }
    heal(killer, R.killHeal);
  }

  burst(_p.set(victim.pos.x, victim.pos.y + 1, victim.pos.z), 0xffffff, 14, 4, 1.4);
  if (victim === player) {
    player.respawnT = PLAYER_RESPAWN;
  } else {
    victim.model.group.visible = false;
    victim.respawnT = BOT_RESPAWN;
  }
  events.emit('kill', { killer, victim, kind, reward, xp, endedStreak });
  if (levelUp) events.emit('levelUp', { level: levelUp });
}
