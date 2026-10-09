// Procedural block texture atlas (original art: chunky, beveled 16x16 tiles) and block definitions.
import * as THREE from '../vendor/three.js';
import { clamp, hash, mulberry32, vnoise } from '../core/util.js';

export const TILE = 16;
export const AN = 4; // atlas is AN x AN tiles

export const atlasCanvas = document.createElement('canvas');
atlasCanvas.width = atlasCanvas.height = TILE * AN;
const actx = atlasCanvas.getContext('2d');

/** Tile indices inside the atlas. */
export const T = {
  grassTop: 0, grassSide: 1, dirt: 2, stone: 3, planks: 4, sand: 5, brick: 6, bedrock: 7,
  leaves: 8, logSide: 9, logTop: 10, red: 11, blue: 12, gold: 13,
};

const mul = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
const css = (c) => `rgb(${clamp(c[0] | 0, 0, 255)},${clamp(c[1] | 0, 0, 255)},${clamp(c[2] | 0, 0, 255)})`;

function drawTile(id, fn, bevel = true) {
  const ox = (id % AN) * TILE, oy = Math.floor(id / AN) * TILE, r = mulberry32(id * 977 + 13);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let c = fn(x, y, r);
      if (bevel) { if (x === 0 || y === 0) c = mul(c, 1.12); else if (x === 15 || y === 15) c = mul(c, 0.8); }
      actx.fillStyle = css(c);
      actx.fillRect(ox + x, oy + y, 1, 1);
    }
  }
}

const GRASS = [84, 170, 74], DIRT = [128, 92, 64];
const dirtPx = (n) => (n > 0.92 ? [94, 68, 48] : mul(DIRT, 0.85 + n * 0.25));

drawTile(T.grassTop, (x, y, r) => { const n = r(); return mul(GRASS, n > 0.94 ? 1.2 : 0.86 + n * 0.2); });
drawTile(T.dirt, (x, y, r) => dirtPx(r()));
drawTile(T.grassSide, (x, y, r) => {
  const drip = 3 + (hash(x, 7) > 0.5 ? 1 : 0) + (hash(x, 3) > 0.8 ? 1 : 0), n = r();
  return y < drip ? mul(GRASS, 0.86 + n * 0.2) : dirtPx(n);
}, false);
drawTile(T.stone, (x, y, r) => mul([122, 125, 136], 0.8 + vnoise(x * 0.4 + 3, y * 0.4) * 0.28 + r() * 0.08));
drawTile(T.planks, (x, y, r) => {
  const row = y >> 2;
  if ((y & 3) === 3 || x === (row * 5 + 3) % 16) return [112, 78, 46];
  return mul([180, 134, 86], 0.9 + r() * 0.1 + ((x + row * 3) % 7 === 0 ? -0.07 : 0));
});
drawTile(T.sand, (x, y, r) => mul([226, 206, 150], 0.92 + r() * 0.12));
drawTile(T.brick, (x, y, r) => {
  const row = y >> 2, off = row % 2 ? 4 : 0;
  if ((y & 3) === 3 || ((x + off) & 7) === 7) return mul([190, 184, 172], 0.95 + r() * 0.08);
  return mul([166, 72, 58], 0.88 + r() * 0.16);
}, false);
drawTile(T.bedrock, (x, y, r) => mul([58, 58, 68], 0.6 + r() * 0.6));
drawTile(T.leaves, (x, y, r) => { const n = r(); return mul([56, 138, 66], n < 0.18 ? 0.6 : 0.85 + r() * 0.25); });
drawTile(T.logSide, (x, y, r) => mul([112, 80, 50], (x % 4 === 0 ? 0.78 : 1) * (0.9 + r() * 0.12)));
drawTile(T.logTop, (x, y, r) => {
  const d = Math.hypot(x - 7.5, y - 7.5);
  if (d > 6.6) return mul([100, 70, 44], 0.9 + r() * 0.1);
  return mul([190, 148, 96], (Math.floor(d) % 2 ? 0.86 : 1) * (0.95 + r() * 0.06));
});
drawTile(T.red, (x, y, r) => mul([200, 58, 70], 0.9 + r() * 0.12 + ((x + y) % 4 === 0 ? 0.06 : 0)));
drawTile(T.blue, (x, y, r) => mul([60, 98, 206], 0.9 + r() * 0.12 + ((x + y) % 4 === 0 ? 0.06 : 0)));
drawTile(T.gold, (x, y, r) => mul([238, 184, 56], ((x + y) % 6 === 0 ? 1.2 : 0.92) + r() * 0.06));

export const atlasTex = new THREE.CanvasTexture(atlasCanvas);
atlasTex.magFilter = THREE.NearestFilter;
atlasTex.minFilter = THREE.NearestFilter;
atlasTex.generateMipmaps = false;

/** Block ids (defined in shared/blocks.js so the server can use them too). */
export { B } from '../shared/blocks.js';

/** Per block: [top, bottom, side] tile indices. */
export const BLOCK_TILES = [
  null,
  [T.grassTop, T.dirt, T.grassSide],
  [T.dirt, T.dirt, T.dirt],
  [T.stone, T.stone, T.stone],
  [T.planks, T.planks, T.planks],
  [T.sand, T.sand, T.sand],
  [T.brick, T.brick, T.brick],
  [T.bedrock, T.bedrock, T.bedrock],
  [T.leaves, T.leaves, T.leaves],
  [T.logTop, T.logTop, T.logSide],
  [T.red, T.red, T.red],
  [T.blue, T.blue, T.blue],
  [T.gold, T.gold, T.gold],
];

/** Average color per block, used for break particles. */
export const BLOCK_COLOR = [0, 0x55aa4a, 0x805c40, 0x7a7d88, 0xb48656, 0xe2ce96, 0xa6483a, 0x3a3a44, 0x388a42, 0x70503a, 0xc83a46, 0x3c62ce, 0xeeb838];

/** UV rectangle helper for a tile: returns [u0, v0, u1, v1]. */
export function tileUV(tile) {
  const tx = tile % AN, ty = Math.floor(tile / AN);
  return [tx / AN, 1 - (ty + 1) / AN, (tx + 1) / AN, 1 - ty / AN];
}
