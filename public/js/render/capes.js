// Procedural cape artwork (10x16 pixel canvases) for every cape in the catalog.
import { mulberry32 } from '../core/util.js';

export const CAPE_W = 10, CAPE_H = 16;
const cache = new Map();

const lerpHex = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round((((pa >> s) & 255) * (1 - t)) + (((pb >> s) & 255) * t));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
};

const PAINTERS = {
  ember(px) {
    for (let y = 0; y < CAPE_H; y++) for (let x = 0; x < CAPE_W; x++) px(x, y, lerpHex('#7a1410', '#ff8a00', y / (CAPE_H - 1)));
    const r = mulberry32(4);
    for (let i = 0; i < 14; i++) px(Math.floor(r() * CAPE_W), 8 + Math.floor(r() * 8), r() < 0.5 ? '#ffd36b' : '#ffb627');
  },
  ocean(px) {
    for (let y = 0; y < CAPE_H; y++) for (let x = 0; x < CAPE_W; x++) {
      const wave = (y + Math.round(Math.sin(x * 0.9) * 1.2)) % 4 === 0;
      px(x, y, wave ? '#9ad8ff' : lerpHex('#0b3d7a', '#1e88d6', y / (CAPE_H - 1)));
    }
  },
  midnight(px) {
    for (let y = 0; y < CAPE_H; y++) for (let x = 0; x < CAPE_W; x++) px(x, y, lerpHex('#05060d', '#1a1f3d', y / (CAPE_H - 1)));
    [[5, 3], [6, 3], [4, 4], [4, 5], [5, 6], [6, 6]].forEach(([x, y]) => px(x, y, '#f4f1ea'));
    [[1, 9], [8, 11], [2, 13], [7, 2]].forEach(([x, y]) => px(x, y, '#c9d6f4'));
  },
  checker(px) {
    for (let y = 0; y < CAPE_H; y++) for (let x = 0; x < CAPE_W; x++) px(x, y, ((x >> 1) + (y >> 1)) % 2 ? '#f4f1ea' : '#1b1d2a');
  },
  bolt(px) {
    for (let y = 0; y < CAPE_H; y++) for (let x = 0; x < CAPE_W; x++) px(x, y, lerpHex('#24104a', '#4b1e8a', y / (CAPE_H - 1)));
    [[6, 2], [5, 3], [5, 4], [4, 5], [4, 6], [3, 7], [4, 7], [5, 7], [6, 7], [5, 8], [5, 9], [4, 10], [4, 11], [3, 12], [3, 13]]
      .forEach(([x, y]) => px(x, y, '#ffd84a'));
  },
  hero(px) {
    for (let y = 0; y < CAPE_H; y++) for (let x = 0; x < CAPE_W; x++) px(x, y, '#1c2a52');
    for (const top of [4, 8, 12]) for (let i = 0; i < 5; i++) { px(i, top + Math.floor(i / 1.5), '#ffb627'); px(CAPE_W - 1 - i, top + Math.floor(i / 1.5), '#ffb627'); }
  },
  starry(px) {
    for (let y = 0; y < CAPE_H; y++) for (let x = 0; x < CAPE_W; x++) px(x, y, lerpHex('#140a3a', '#3a1f7a', y / (CAPE_H - 1)));
    const r = mulberry32(9);
    for (let i = 0; i < 16; i++) px(Math.floor(r() * CAPE_W), Math.floor(r() * CAPE_H), r() < 0.3 ? '#ffd36b' : '#e6e0ff');
  },
  titan(px) {
    for (let y = 0; y < CAPE_H; y++) for (let x = 0; x < CAPE_W; x++) px(x, y, lerpHex('#ffd36b', '#c27a00', y / (CAPE_H - 1)));
    const crown = ['.#..#..#.', '.##.#.##.', '.#######.', '.#######.'];
    crown.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') px(x + 0.5 | 0, y + 4, '#5a2f00'); }));
  },
  rose(px) {
    for (let y = 0; y < CAPE_H; y++) for (let x = 0; x < CAPE_W; x++) px(x, y, lerpHex('#ff5c8a', '#7a0b3a', y / (CAPE_H - 1)));
    for (let i = 0; i < 4; i++) { px(4, 4 + i, '#fff'); px(5, 4 + i, '#fff'); }
    [[3, 6], [6, 6], [2, 7], [7, 7]].forEach(([x, y]) => px(x, y, '#fff'));
    for (let x = 0; x < CAPE_W; x++) { px(x, 0, '#ffd36b'); px(x, CAPE_H - 1, '#ffd36b'); }
  },
  ace(px) {
    for (let y = 0; y < CAPE_H; y++) for (let x = 0; x < CAPE_W; x++) px(x, y, lerpHex('#2fae5a', '#0f4a26', y / (CAPE_H - 1)));
    const spade = ['....#....', '...###...', '..#####..', '.#######.', '.#######.', '..#.#.#..', '....#....', '...###...'];
    spade.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') px(x, y + 4, '#f4f1ea'); }));
    for (let x = 0; x < CAPE_W; x++) { px(x, 0, '#c8f5d6'); px(x, CAPE_H - 1, '#c8f5d6'); }
  },
  founder(px) {
    for (let y = 0; y < CAPE_H; y++) for (let x = 0; x < CAPE_W; x++) px(x, y, lerpHex('#0e3b44', '#0b1f2a', y / (CAPE_H - 1)));
    // small sword emblem
    for (let i = 0; i < 5; i++) px(3 + i, 9 - i, '#e6ecf8');
    [[2, 9], [3, 10], [4, 11], [1, 11]].forEach(([x, y]) => px(x, y, '#ffb627'));
    for (let x = 0; x < CAPE_W; x++) px(x, CAPE_H - 2, '#ffb627');
  },
  staff(px) {
    for (let y = 0; y < CAPE_H; y++) for (let x = 0; x < CAPE_W; x++) px(x, y, lerpHex('#c21f2f', '#6a0b15', y / (CAPE_H - 1)));
    const shield = ['.######.', '.######.', '.######.', '..####..', '...##...'];
    shield.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') px(x + 1, y + 4, '#f4f1ea'); }));
  },
};

/** 10x16 canvas for a cape id, or null for 'none'. */
export function capeCanvas(id) {
  if (!PAINTERS[id]) return null;
  if (cache.has(id)) return cache.get(id);
  const c = document.createElement('canvas');
  c.width = CAPE_W;
  c.height = CAPE_H;
  const g = c.getContext('2d');
  PAINTERS[id]((x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); });
  cache.set(id, c);
  return c;
}
