// Cube face tables (shared by terrain meshing) and pixel-icon extrusion for 3D held items.
import * as THREE from '../vendor/three.js';
import { icons } from './icons.js';

/**
 * The six faces of a unit cube. Each corner is [x, y, z, u, v].
 * `shade` is the baked directional light for that face.
 */
export const FACES = [
  { dir: [-1, 0, 0], shade: 0.8, corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [1, 0, 0], shade: 0.8, corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [0, -1, 0], shade: 0.5, corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 1, 0], shade: 1, corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, 0, -1], shade: 0.66, corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { dir: [0, 0, 1], shade: 0.66, corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
];

/** Turn a 16x16 icon into a thin voxel mesh (one box per opaque pixel, hidden faces culled). */
export function extrude(icon, depth = 1 / 16) {
  const d = icon.getContext('2d').getImageData(0, 0, 16, 16).data;
  const op = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && d[(y * 16 + x) * 4 + 3] > 128;
  const pos = [], col = [], ind = [], s = 1 / 16;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (!op(x, y)) continue;
      const i = (y * 16 + x) * 4, r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      for (const F of FACES) {
        if (F.dir[0] && op(x + F.dir[0], y)) continue;
        if (F.dir[1] && op(x, y - F.dir[1])) continue;
        const n = pos.length / 3, sh = F.dir[2] ? 1 : F.dir[1] === 1 ? 0.9 : 0.7;
        for (const c of F.corners) {
          pos.push((x + c[0]) * s - 0.5, (15 - y + c[1]) * s - 0.5, (c[2] - 0.5) * depth);
          col.push(r * sh, g * sh, b * sh);
        }
        ind.push(n, n + 1, n + 2, n + 2, n + 1, n + 3);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(ind);
  return geo;
}

export const ITEM_GEO = {
  sword: extrude(icons.sword),
  bow: extrude(icons.bow),
  flask: extrude(icons.flask, 0.12),
  arrow: extrude(icons.arrows),
  rod: extrude(icons.rod),
  splash: extrude(icons.splash, 0.12),
  speed: extrude(icons.speed, 0.12),
  pearl: extrude(icons.pearl, 0.3),
};
