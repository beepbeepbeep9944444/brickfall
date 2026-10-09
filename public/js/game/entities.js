// Fighters: the local player and the bots, plus spawning.
import * as THREE from '../vendor/three.js';
import { pick, rand, randi } from '../core/util.js';
import { scene } from '../render/scene.js';
import { spawnPoint } from '../world/world.js';
import { RANKS, SKINS, CAPES, DEFAULT_COSMETICS } from '../shared/cosmetics.js';
import { makeCharacter, makeTag, drawTag, disposeCharacter } from './characters.js';
import { rules } from './rules.js';

const _eye = new THREE.Vector3();

export class Fighter {
  constructor(name) {
    this.name = name;
    this.rank = 'NONE';
    this.level = 1;
    this.xp = 0; // lifetime XP (player only)
    this.cosmetics = DEFAULT_COSMETICS;
    this.pos = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.vel = new THREE.Vector3(); // blocks per tick
    this.yaw = 0;
    this.prevYaw = 0;
    this.pitch = 0;
    this.w = 0.6;
    this.h = 1.8;
    this.maxHp = 20;
    this.hp = 20;
    this.absorb = 0; // bonus hearts from the golden flask
    this.regenT = 0; // Regeneration II time left (seconds)
    this.speedT = 0; // speed potion time left (seconds)
    this.speedLevel = 0;
    this.protectT = 0; // spawn protection (modes without a spawn tower)
    this.alive = false;
    this.onGround = false;
    this.hitWall = false;
    this.fallDistance = 0;
    this.fallFromSafe = false;
    this.landedFrom = 0;
    // stats
    this.kills = 0;
    this.deaths = 0;
    this.streak = 0;
    this.best = 0;
    this.coins = 0;
    // combat state
    this.iframe = 0; // hurt-resistance timer (seconds)
    this.hurtT = 0;
    this.lastDmg = 0;
    this.lastAttacker = null;
    this.lastHitT = -99;
    this.lastSwingT = -9;
    this.foodRegenT = 0;
    this.blocking = false;
    this.sprinting = false;
    this.sprintBroken = false;
    this.respawnT = 0;
  }

  /** Eye position (shared vector: copy it if you need to keep it). */
  get eye() { return _eye.set(this.pos.x, this.pos.y + 1.62, this.pos.z); }

  /** Call at the start of every tick so rendering can interpolate between ticks. */
  snapshot() {
    this.prevPos.copy(this.pos);
    this.prevYaw = this.yaw;
  }
}

// ---------------------------------------------------------------- bot looks
const RANK_WEIGHTS = { NONE: 55, ACE: 22, HERO: 15, TITAN: 8 };

function weightedRank() {
  let r = Math.random() * 100;
  for (const [id, w] of Object.entries(RANK_WEIGHTS)) { r -= w; if (r <= 0) return RANKS.find((x) => x.id === id); }
  return RANKS[0];
}

/** Bots wear anything a player of their rank could own. */
function botCosmetics(rank) {
  const allowed = (item) => !item.unlock && (!item.rank || RANKS.find((x) => x.id === item.rank).tier <= rank.tier);
  const skins = SKINS.filter(allowed), capes = CAPES.filter((c) => c.id !== 'none' && allowed(c));
  return {
    skin: pick(skins).id,
    cape: Math.random() < 0.25 + rank.tier * 0.2 ? pick(capes).id : 'none',
  };
}

export class Bot extends Fighter {
  constructor(name) {
    super(name);
    const rank = weightedRank();
    this.rank = rank.id;
    this.level = Math.max(1, Math.floor(Math.pow(Math.random(), 1.6) * 70));
    this.cosmetics = botCosmetics(rank);
    this.model = makeCharacter(this.cosmetics);
    this.tag = makeTag();
    this.model.group.add(this.tag.spr);
    scene.add(this.model.group);
    // AI state
    this.skill = rand(0.3, 0.6); // 0-1, scales aim, accuracy and how often they use tricks
    this.target = null;
    this.thinkT = 0;
    this.strafe = 0;
    this.wanderTo = null;
    this.bowCd = rand(2, 6);
    this.rodCd = rand(1, 4);
    this.attackCd = 0;
    this.stuckT = 0;
    this.wtapT = 0;
    this.blockT = 0;
    this.held = 'sword';
    this.heldT = 0; // how long to show a thrown/drunk item before going back to the weapon
    this.inv = { pots: 0, flasks: 0 };
    this.potCd = 0;
    this.drawing = 0;
    this.drawGoal = 1;
    this.hook = null;
    // animation
    this.walkPhase = 0;
    this.swing = 0;
    drawTag(this);
  }
}

/**
 * Another fighter in an online room (a real player or a server bot). The server sends its
 * position ~20 times a second; rendering interpolates between the last two updates.
 */
export class Remote extends Fighter {
  constructor(info) {
    super(info.name);
    this.remote = true;
    this.netId = info.id;
    this.isBot = !!info.bot;
    this.rank = info.rank || 'NONE';
    this.level = info.level || 1;
    this.cosmetics = info.cos || DEFAULT_COSMETICS;
    Object.assign(this, { kills: info.kills || 0, deaths: info.deaths || 0, streak: info.streak || 0, alive: !!info.alive });
    this.model = makeCharacter(this.cosmetics);
    this.tag = makeTag();
    this.model.group.add(this.tag.spr);
    this.model.group.visible = this.alive;
    scene.add(this.model.group);
    Object.assign(this, { held: 'sword', drawing: 0, walkPhase: 0, swing: 0, netAt: 0, netSwing: false, netHurtAt: -9, placed: false });
    drawTag(this);
  }

  dispose() {
    scene.remove(this.model.group);
    disposeCharacter(this.model);
  }
}

/** The local player (first person). Extra fields are used by the player controller. */
export const player = Object.assign(new Fighter('Player'), {
  slot: 0,
  inv: {}, // consumable counts for the current kit: arrows, blocks, flasks, pots, pearls, speed
  charge: 0,
  bowT: 0,
  drink: 0,
  useCd: 0,
  hook: null,
  bob: 0,
  bobAmt: 0,
  hurtAnim: 0,
  hurtSide: 1,
});

export const bots = [];
export const fighters = [player];

const ADJ = ['Swift', 'Rusty', 'Mighty', 'Sneaky', 'Lucky', 'Grumpy', 'Turbo', 'Cosmic', 'Brave', 'Sly', 'Jolly', 'Fuzzy', 'Salty', 'Spicy'];
const ANIMALS = ['Otter', 'Falcon', 'Badger', 'Llama', 'Panda', 'Gecko', 'Moose', 'Raven', 'Yak', 'Lynx', 'Koala', 'Wombat', 'Ferret', 'Newt'];

function botName() {
  let n;
  do n = pick(ADJ) + pick(ANIMALS) + randi(1, 99); while (bots.some((b) => b.name === n));
  return n;
}

export function createBots(count) {
  for (let i = 0; i < count; i++) {
    const b = new Bot(botName());
    bots.push(b);
    fighters.push(b);
    spawnBot(b);
  }
}

/** A random open spot on the current map (away from the spawn tower, if there is one). */
export function randomSpawn() {
  const p = spawnPoint();
  return new THREE.Vector3(p.x, p.y, p.z);
}

/** A spawn spot as far as possible from everyone else (out of a few random picks). */
export function spawnAwayFrom(self) {
  let best = null, bestD = -1;
  for (let i = 0; i < 10; i++) {
    const p = randomSpawn();
    let d = Infinity;
    for (const f of fighters) if (f !== self && f.alive) d = Math.min(d, f.pos.distanceTo(p));
    if (d > bestD) { bestD = d; best = p; }
  }
  return best;
}

export function spawnBot(b) {
  const R = rules(), kit = R.bot;
  b.pos.copy(spawnAwayFrom(b));
  b.prevPos.copy(b.pos);
  b.vel.set(0, 0, 0);
  Object.assign(b, {
    hp: b.maxHp, absorb: 0, regenT: 0, alive: true, target: null, fallDistance: 0, landedFrom: 0, iframe: 0, wanderTo: null,
    speedT: kit.speed ? 1e9 : 0, speedLevel: kit.speed ? 2 : 0, protectT: R.protect || 0,
    held: kit.weapon, heldT: 0, inv: { pots: kit.pots || 0, flasks: kit.flasks || 0 }, potCd: 0, drinkT: 0, retreatT: 0, drawing: 0,
  });
  b.yaw = b.prevYaw = rand(0, Math.PI * 2);
  b.model.group.visible = true;
  drawTag(b);
}
