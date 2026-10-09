// Voxel world storage, map generation (one map per game mode) and ray queries.
// Runs in the browser and on the server (which keeps one world per room and switches between
// them with useWorld), so it must not touch the DOM or Three.js.
import { mulberry32, vnoise } from '../core/util.js';
import { B } from '../shared/blocks.js';

export const W = 64, H = 32, D = 64;
export const CX = W / 2, CZ = D / 2;
/** Standing height on top of the spawn tower. */
export const SPAWN_TOP = 14;

/** Block data of the active world. */
export let world = new Uint8Array(W * H * D);
export const wi = (x, y, z) => (y * D + z) * W + x;

/**
 * The loaded map. `tower`: the map has the safe spawn tower. `voidFloor`: nothing below the map
 * (falling out kills). `killY`: falling below this height kills. `ring` / `pit`: playable radius.
 */
export let map = { id: '', tower: true, voidFloor: false, killY: -5, ring: 0, ringY: 0, pit: 0 };

/** A separate world (the server keeps one per room). Generate into it after useWorld(). */
export const newWorld = () => ({ data: new Uint8Array(W * H * D), map: { id: '', tower: true, voidFloor: false, killY: -5, ring: 0, ringY: 0, pit: 0 } });

/** Make `w` the world every query in this module reads and writes. */
export function useWorld(w) {
  world = w.data;
  map = w.map;
}

/** Block at a cell; outside the map counts as air (below the floor counts as solid). */
export function getB(x, y, z) {
  if (y < 0) return map.voidFloor ? 0 : 1;
  if (x < 0 || z < 0 || x >= W || z >= D || y >= H) return 0;
  return world[wi(x, y, z)];
}

/** Collision query; the map edges act as walls (except on void maps). */
export function solid(x, y, z) {
  if (y < 0) return !map.voidFloor;
  if (y >= H) return false;
  if (x < 0 || z < 0 || x >= W || z >= D) return !map.voidFloor;
  return world[wi(x, y, z)] !== 0;
}

export function setB(x, y, z, b) {
  if (x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= D) return;
  world[wi(x, y, z)] = b;
}

/** First free y above the ground at (x, z). */
export function topY(x, z) {
  for (let y = H - 1; y >= 0; y--) if (world[wi(x, y, z)]) return y + 1;
  return 0;
}

const dist = (x, z) => Math.hypot(x + 0.5 - CX, z + 0.5 - CZ);
const forEachColumn = (fn) => { for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) fn(x, z, dist(x, z)); };

// ---------------------------------------------------------------- shared pieces
function spawnTower(top, wall, rim) {
  forEachColumn((x, z, d) => {
    if (d <= 6.3) for (let y = 1; y <= 6; y++) setB(x, y, z, B.STONE);
    if (d <= 5.2) {
      for (let y = 1; y < SPAWN_TOP; y++) {
        let b = wall;
        if (y === SPAWN_TOP - 1) b = d > 4.2 ? rim : top;
        else if (y === SPAWN_TOP - 4) b = B.STONE;
        setB(x, y, z, b);
      }
    }
  });
}

function borderWall(height, wall, cap) {
  forEachColumn((x, z) => {
    if (x === 0 || z === 0 || x === W - 1 || z === D - 1) for (let y = 1; y < height; y++) setB(x, y, z, y === height - 1 ? cap : wall);
  });
}

function tree(x, z, r, { trunk = [4, 5], wide = 2 } = {}) {
  const g = topY(x, z), under = getB(x, g - 1, z);
  if (under !== B.GRASS && under !== B.SAND) return;
  const th = trunk[0] + Math.floor(r() * (trunk[1] - trunk[0] + 1));
  for (let y = 0; y < th; y++) setB(x, g + y, z, B.LOG);
  for (let dy = -2; dy <= 1; dy++) {
    const rr = dy < 0 ? wide : 1;
    for (let dx = -rr; dx <= rr; dx++) {
      for (let dz = -rr; dz <= rr; dz++) {
        if (Math.abs(dx) === rr && Math.abs(dz) === rr && r() < 0.6) continue;
        const yy = g + th + dy;
        if (!getB(x + dx, yy, z + dz)) setB(x + dx, yy, z + dz, B.LEAVES);
      }
    }
  }
  setB(x, g + th + 1, z, B.LEAVES);
}

// ---------------------------------------------------------------- maps
/** Arena FFA: rolling grass with hills at the edges, cover walls, trees and sniper pillars. */
function arenaMap(r, R, RI) {
  forEachColumn((x, z, d) => {
    let h = 4 + Math.floor(vnoise(x * 0.13, z * 0.13) * 1.8);
    if (d > 21) h += Math.floor((d - 21) * 0.5 + vnoise(x * 0.21 + 9, z * 0.21) * 2.2);
    h = Math.min(h, 13);
    const sandy = d < 20 && d > 8 && vnoise(x * 0.09 + 40, z * 0.09 + 40) > 0.68;
    setB(x, 0, z, B.BEDROCK);
    for (let y = 1; y <= h; y++) setB(x, y, z, y === h ? (sandy ? B.SAND : B.GRASS) : y >= h - 2 ? (sandy ? B.SAND : B.DIRT) : B.STONE);
  });
  borderWall(18, B.BRICK, B.GOLD);
  spawnTower(B.PLANKS, B.BRICK, B.GOLD);

  // corner sniper pillars
  for (const [sx, sz] of [[-15, -15], [15, -15], [-15, 15], [15, 15]]) {
    const px = CX + sx, pz = CZ + sz, g = topY(px, pz);
    for (let y = g; y < g + 7; y++) for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) setB(px + a, y, pz + b, B.STONE);
    for (let a = -1; a < 3; a++) for (let b = -1; b < 3; b++) setB(px + a, g + 7, pz + b, B.PLANKS);
  }
  // cover walls
  for (let n = 0; n < 14; n++) {
    const a = R(0, Math.PI * 2), d = R(9, 21), x = Math.floor(CX + Math.cos(a) * d), z = Math.floor(CZ + Math.sin(a) * d);
    const len = RI(3, 5), horiz = r() < 0.5, mat = r() < 0.5 ? B.PLANKS : B.BRICK;
    for (let i = 0; i < len; i++) {
      const bx = horiz ? x + i : x, bz = horiz ? z : z + i, g = topY(bx, bz);
      for (let y = 0; y < 2; y++) setB(bx, g + y, bz, mat);
    }
  }
  for (let n = 0; n < 14; n++) {
    const a = R(0, Math.PI * 2), d = R(10, 24);
    tree(Math.floor(CX + Math.cos(a) * d), Math.floor(CZ + Math.sin(a) * d), r);
  }
}

/** Pot PvP: a flat desert courtyard with a ring of columns, low ruined walls and palms. */
function ruinsMap(r, R, RI) {
  forEachColumn((x, z, d) => {
    let h = 4 + (d > 24 ? Math.floor((d - 24) * 0.6 + vnoise(x * 0.2, z * 0.2) * 2) : 0);
    h = Math.min(h, 12);
    setB(x, 0, z, B.BEDROCK);
    const tile = d < 22 && ((x >> 2) + (z >> 2)) % 2 === 0 && vnoise(x * 0.3 + 7, z * 0.3) > 0.35;
    for (let y = 1; y <= h; y++) setB(x, y, z, y === h ? (tile && h === 4 ? B.STONE : B.SAND) : y >= h - 2 ? B.SAND : B.STONE);
  });
  borderWall(16, B.SAND, B.GOLD);
  spawnTower(B.SAND, B.SAND, B.GOLD);

  // a ring of columns, some broken
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.13, x = Math.floor(CX + Math.cos(a) * 15), z = Math.floor(CZ + Math.sin(a) * 15);
    const g = topY(x, z), hgt = r() < 0.35 ? RI(1, 3) : 6;
    for (let y = 0; y < hgt; y++) setB(x, g + y, z, y === hgt - 1 && hgt === 6 ? B.GOLD : B.STONE);
    if (hgt === 6) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) setB(x + dx, g + 5, z + dz, B.SAND);
  }
  // ruined wall segments
  for (let n = 0; n < 12; n++) {
    const a = R(0, Math.PI * 2), d = R(8, 22), x = Math.floor(CX + Math.cos(a) * d), z = Math.floor(CZ + Math.sin(a) * d);
    const len = RI(3, 6), horiz = r() < 0.5;
    for (let i = 0; i < len; i++) {
      const bx = horiz ? x + i : x, bz = horiz ? z : z + i, g = topY(bx, bz), hgt = RI(1, 3);
      for (let y = 0; y < hgt; y++) setB(bx, g + y, bz, r() < 0.25 ? B.STONE : B.SAND);
    }
  }
  // palms
  for (let n = 0; n < 9; n++) {
    const a = R(0, Math.PI * 2), d = R(18, 26);
    tree(Math.floor(CX + Math.cos(a) * d), Math.floor(CZ + Math.sin(a) * d), r, { trunk: [5, 6], wide: 2 });
  }
}

const RING_RADIUS = 9.5, RING_Y = 12;

/** Sumo: a round floating platform over the void, with a few distant islands for scenery. */
function ringMap(r) {
  forEachColumn((x, z, d) => {
    if (d > RING_RADIUS) return;
    const rim = d > RING_RADIUS - 1, inner = d < 2.5;
    setB(x, RING_Y - 3, z, B.STONE);
    setB(x, RING_Y - 2, z, d < RING_RADIUS - 1.5 ? B.STONE : B.BRICK);
    setB(x, RING_Y - 1, z, rim ? B.GOLD : inner ? B.RED : Math.floor(d) % 3 === 0 ? B.PLANKS : B.STONE);
    if (d < RING_RADIUS - 3) setB(x, RING_Y - 4, z, B.STONE);
    if (d < 1.6) for (let y = RING_Y - 8; y < RING_Y - 4; y++) setB(x, y, z, B.STONE);
  });
  // floating islands far away
  for (const [ix, iz, iy, rad] of [[8, 10, 8, 4], [54, 14, 15, 3.5], [12, 52, 18, 3], [52, 50, 6, 4.5]]) {
    for (let x = ix - 6; x <= ix + 6; x++) {
      for (let z = iz - 6; z <= iz + 6; z++) {
        const d = Math.hypot(x - ix, z - iz);
        if (d > rad) continue;
        const depth = Math.floor((rad - d) * 1.2) + 1;
        for (let y = iy - depth; y <= iy; y++) setB(x, y, z, y === iy ? B.GRASS : y > iy - 2 ? B.DIRT : B.STONE);
      }
    }
    tree(ix, iz, r, { trunk: [3, 4], wide: 2 });
  }
}

const PIT_HALF = 16, PIT_FLOOR = 4;

/** Combo: a sunken square pit with brick walls and a checkered floor. */
function pitMap() {
  forEachColumn((x, z) => {
    const m = Math.max(Math.abs(x + 0.5 - CX), Math.abs(z + 0.5 - CZ));
    setB(x, 0, z, B.BEDROCK);
    if (m <= PIT_HALF) {
      for (let y = 1; y < PIT_FLOOR; y++) setB(x, y, z, B.STONE);
      const check = ((Math.floor(x / 4) + Math.floor(z / 4)) & 1) === 0;
      setB(x, PIT_FLOOR, z, m > PIT_HALF - 1.5 ? B.GOLD : check ? B.PLANKS : B.STONE);
    } else {
      const h = Math.min(PIT_FLOOR + 8 + Math.floor(vnoise(x * 0.2, z * 0.2) * 3), 14);
      for (let y = 1; y <= h; y++) setB(x, y, z, y === h ? B.GRASS : y > h - 3 ? B.DIRT : B.STONE);
      if (m <= PIT_HALF + 1) for (let y = PIT_FLOOR + 1; y <= PIT_FLOOR + 8; y++) setB(x, y, z, y === PIT_FLOOR + 8 ? B.GOLD : B.BRICK);
    }
  });
  // low corner pillars to fight around
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const px = Math.floor(CX + sx * 9), pz = Math.floor(CZ + sz * 9);
    for (let y = PIT_FLOOR + 1; y <= PIT_FLOOR + 4; y++) for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) setB(px + a, y, pz + b, y === PIT_FLOOR + 4 ? B.GOLD : B.BRICK);
  }
}

const MAPS = {
  arena: { gen: arenaMap, tower: true, voidFloor: false, killY: -5 },
  ruins: { gen: ruinsMap, tower: true, voidFloor: false, killY: -5 },
  ring: { gen: ringMap, tower: false, voidFloor: true, killY: RING_Y - 7, ring: RING_RADIUS, ringY: RING_Y },
  pit: { gen: pitMap, tower: false, voidFloor: false, killY: -5, pit: PIT_HALF },
};

/** Build a map. Deterministic, so every player sees the same layout. */
export function generateWorld(id = 'arena', seed = 1337) {
  const def = MAPS[id] || MAPS.arena;
  world.fill(0);
  Object.assign(map, { id, tower: def.tower, voidFloor: def.voidFloor, killY: def.killY, ring: def.ring || 0, ringY: def.ringY || 0, pit: def.pit || 0 });
  const r = mulberry32(seed), R = (a, b) => a + r() * (b - a), RI = (a, b) => Math.floor(R(a, b + 1));
  def.gen(r, R, RI);
}

/** A random open standing spot for (re)spawning, away from the spawn tower. */
export function spawnPoint(rand = Math.random) {
  for (let tries = 0; tries < 300; tries++) {
    let x, z;
    if (map.ring) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * (map.ring - 2.5);
      x = Math.floor(CX + Math.cos(a) * d); z = Math.floor(CZ + Math.sin(a) * d);
    } else if (map.pit) {
      x = Math.floor(CX - map.pit + 2 + rand() * (map.pit * 2 - 4)); z = Math.floor(CZ - map.pit + 2 + rand() * (map.pit * 2 - 4));
    } else {
      x = 3 + Math.floor(rand() * (W - 7)); z = 3 + Math.floor(rand() * (D - 7));
      const d = dist(x, z);
      if (d < 9 || d > 25) continue;
    }
    const y = topY(x, z);
    if (y > 0 && y < H - 3 && !solid(x, y, z) && !solid(x, y + 1, z)) return { x: x + 0.5, y, z: z + 0.5 };
  }
  return map.ring ? { x: CX + 0.5, y: map.ringY, z: CZ + 0.5 } : { x: CX + 12, y: 8, z: CZ };
}

/** Grid traversal (Amanatides & Woo). Returns the first solid cell hit and its face normal. */
export function raycastVoxel(o, d, max) {
  let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
  const sx = Math.sign(d.x), sy = Math.sign(d.y), sz = Math.sign(d.z);
  const tdx = sx ? Math.abs(1 / d.x) : Infinity, tdy = sy ? Math.abs(1 / d.y) : Infinity, tdz = sz ? Math.abs(1 / d.z) : Infinity;
  let tmx = sx > 0 ? (x + 1 - o.x) * tdx : sx < 0 ? (o.x - x) * tdx : Infinity;
  let tmy = sy > 0 ? (y + 1 - o.y) * tdy : sy < 0 ? (o.y - y) * tdy : Infinity;
  let tmz = sz > 0 ? (z + 1 - o.z) * tdz : sz < 0 ? (o.z - z) * tdz : Infinity;
  let t = 0, nx = 0, ny = 0, nz = 0;
  while (t <= max) {
    if (y >= 0 && y < H && x >= 0 && z >= 0 && x < W && z < D && world[wi(x, y, z)]) return { x, y, z, nx, ny, nz, t };
    if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
    else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
    else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
  }
  return null;
}

/** Slab test: distance along the ray to an axis-aligned box, or Infinity. */
export function rayAABB(o, d, mn, mx) {
  let tmin = 0, tmax = Infinity;
  for (const a of ['x', 'y', 'z']) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < mn[a] || o[a] > mx[a]) return Infinity;
    } else {
      let t1 = (mn[a] - o[a]) / d[a], t2 = (mx[a] - o[a]) / d[a];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

export function lineOfSight(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  return !raycastVoxel(a, { x: dx / len, y: dy / len, z: dz / len }, len);
}
