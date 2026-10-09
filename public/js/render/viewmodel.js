// First-person held item + arm, rendered in a separate pass so it never clips into walls.
import * as THREE from '../vendor/three.js';
import { DEG, angDiff, clamp } from '../core/util.js';
import { game } from '../core/state.js';
import { settings } from '../core/settings.js';
import { events } from '../core/events.js';
import { itemAt } from './icons.js';
import { ITEM_GEO } from './geometry.js';
import { itemMat } from './materials.js';
import { atlasTex, tileUV, T } from './textures.js';
import { onResize } from './scene.js';
import { player } from '../game/entities.js';

export const vmScene = new THREE.Scene();
export const vmCam = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 10);
vmCam.rotation.order = 'YXZ';
onResize(() => { vmCam.aspect = innerWidth / innerHeight; vmCam.updateProjectionMatrix(); });

vmScene.add(new THREE.AmbientLight(0xffffff, 0.62));
const light = new THREE.DirectionalLight(0xffffff, 0.55);
light.position.set(-0.3, 1, 0.5);
vmScene.add(light);

// root: walk bob + look sway; pivot (= the hand): swing / block / draw / drink poses
const root = new THREE.Group(), pivot = new THREE.Group();
vmScene.add(root);
root.add(pivot);

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const AX = V3(1, 0, 0), AY = V3(0, 1, 0), AZ = V3(0, 0, 1);

/** Rotation mapping a local axis + face normal onto a target axis + normal. */
function basisQuat(a1, n1, a2, n2) {
  const frame = (a, n) => {
    const A = a.clone().normalize(), N = n.clone().addScaledVector(A, -n.dot(A)).normalize();
    return new THREE.Matrix4().makeBasis(A, N, new THREE.Vector3().crossVectors(A, N));
  };
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().multiplyMatrices(frame(a2, n2), frame(a1, n1).transpose()));
}

/** A held item whose grip point sits in the hand, oriented by (axis, face normal). */
function heldItem(geo, scale, grip, axisW, normW, axisL = V3(1, 1, 0)) {
  const disp = new THREE.Group(), inner = new THREE.Group(), mesh = new THREE.Mesh(geo, itemMat);
  mesh.position.set(-grip[0], -grip[1], 0);
  inner.add(mesh);
  inner.scale.setScalar(scale);
  disp.add(inner);
  disp.quaternion.copy(basisQuat(axisL, V3(0, 0, 1), axisW, normW));
  return disp;
}

function heldBlock() {
  const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3), uv = geo.attributes.uv, [u0, v0, u1, v1] = tileUV(T.planks);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  const g = new THREE.Group(), m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: atlasTex }));
  m.position.set(0, 0.1, -0.06);
  m.rotation.set(0.15, 0.8, 0);
  g.add(m);
  return g;
}

const items = {
  sword: heldItem(ITEM_GEO.sword, 0.4, [-0.344, -0.344], V3(-0.3, 0.8, -0.5), V3(0.35, 0.3, 0.9)),
  bow: heldItem(ITEM_GEO.bow, 0.55, [-0.098, 0.098], V3(0.8, 1, -0.2), V3(0.25, -0.1, 1)),
  arrows: heldItem(ITEM_GEO.arrow, 0.34, [-0.344, -0.344], V3(-0.3, 0.8, -0.5), V3(0.35, 0.3, 0.9)),
  rod: heldItem(ITEM_GEO.rod, 0.46, [-0.344, -0.344], V3(-0.25, 0.85, -0.6), V3(0.35, 0.3, 0.9)),
  flask: heldItem(ITEM_GEO.flask, 0.38, [0.03, -0.16], V3(0.1, 1, 0.15), V3(0.3, 0, 0.95), V3(0, 1, 0)),
  splash: heldItem(ITEM_GEO.splash, 0.36, [0, -0.2], V3(0.1, 1, 0.15), V3(0.3, 0, 0.95), V3(0, 1, 0)),
  speed: heldItem(ITEM_GEO.speed, 0.36, [0, -0.2], V3(0.1, 1, 0.15), V3(0.3, 0, 0.95), V3(0, 1, 0)),
  pearl: heldItem(ITEM_GEO.pearl, 0.2, [0, -0.1], V3(0, 1, 0), V3(0.3, 0, 0.95), V3(0, 1, 0)),
  blocks: heldBlock(),
};
items.bow.position.z = -0.05;
const nock = heldItem(ITEM_GEO.arrow, 0.3, [0, 0], V3(0, 0, -1), V3(0, 1, 0));
const SWORD_REST = items.sword.quaternion.clone();
const SWORD_BLOCK = basisQuat(V3(1, 1, 0), V3(0, 0, 1), V3(-1, 0.35, -0.25), V3(0.1, 0.3, 1));

const handMat = new THREE.MeshLambertMaterial({ color: 0xf1c9a5 }), sleeveMat = new THREE.MeshLambertMaterial({ color: 0xff9f1c });
const arm = (() => {
  const g = new THREE.Group();
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.22), handMat);
  hand.position.z = 0.07;
  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.168, 0.168, 0.55), sleeveMat);
  sleeve.position.z = 0.44;
  g.add(hand, sleeve);
  g.scale.set(0.8, 0.8, 1);
  g.quaternion.setFromUnitVectors(AZ, V3(0.35, -0.72, 0.6).normalize());
  return g;
})();
// the arm follows the hand but only takes part of the swing rotation, so it never sweeps across the view
const armHolder = new THREE.Group();
armHolder.add(arm);
root.add(armHolder);
pivot.add(nock);
for (const k in items) { items[k].visible = false; pivot.add(items[k]); }

const BASE = {
  sword: [0.36, -0.4, -0.78], rod: [0.36, -0.4, -0.78], bow: [0.36, -0.3, -0.85], arrows: [0.36, -0.4, -0.78], flask: [0.36, -0.36, -0.78],
  blocks: [0.4, -0.42, -0.8], splash: [0.36, -0.36, -0.78], speed: [0.36, -0.36, -0.78], pearl: [0.36, -0.38, -0.78], fists: [0.42, -0.36, -0.74],
};
const SWING_TIME = 0.3;
const st = { swingP: 0, swinging: false, equip: 1, block: 0, bow: 0, drink: 0, lagYaw: 0, lagPitch: 0 };

events.on('swing', () => { if (!st.swinging || st.swingP >= 0.5) { st.swingP = 0; st.swinging = true; } });
events.on('slot', () => { st.equip = 0; });
events.on('respawn', () => { st.equip = 0; st.lagYaw = player.yaw; st.lagPitch = player.pitch; });

/** First-person arm uses the player's skin tone and shirt color. */
function applyArmSkin() {
  handMat.color.set(player.cosmetics.skin.skin);
  sleeveMat.color.set(player.cosmetics.skin.shirt);
}
events.on('gameStart', applyArmSkin);
events.on('playerCosmetics', applyArmSkin);

/** Where the rod tip is, in camera space (used to anchor the first-person fishing line). */
export const ROD_TIP_CAMERA_SPACE = new THREE.Vector3(0.3, -0.02, -0.75);

const R45 = new THREE.Quaternion().setFromAxisAngle(AY, Math.PI / 4), R45i = R45.clone().invert();
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion(), qT = new THREE.Quaternion(), qI = new THREE.Quaternion();

export function updateViewmodel(dt) {
  const P = player, id = itemAt(P.slot);
  for (const k in items) items[k].visible = k === id;
  if (st.swinging) { st.swingP += dt / SWING_TIME; if (st.swingP >= 1) { st.swingP = 0; st.swinging = false; } }
  st.equip = Math.min(1, st.equip + dt * 5);
  const k = Math.min(1, dt * 16);
  st.block += ((P.blocking ? 1 : 0) - st.block) * k;
  st.bow += ((P.bowT > 0 ? 1 : 0) - st.bow) * k;
  st.drink += ((P.drink > 0 ? 1 : 0) - st.drink) * k;

  // swing curve (fast start, eased return), applied around the hand in the item's 45° frame
  const p = st.swingP, sq = Math.sqrt(p), f1 = Math.sin(p * p * Math.PI), f2 = Math.sin(sq * Math.PI), base = BASE[id], eq = 1 - st.equip;
  let x = base[0] - 0.3 * f2;
  let y = base[1] + 0.12 * Math.sin(sq * Math.PI * 2) + 0.05 * f2 - eq * eq * 0.6;
  let z = base[2] - 0.15 * Math.sin(p * Math.PI);
  qT.setFromAxisAngle(AY, -20 * DEG * f1).multiply(qa.setFromAxisAngle(AZ, -20 * DEG * f2)).multiply(qb.setFromAxisAngle(AX, -50 * DEG * f2));
  qT.premultiply(R45).multiply(R45i);

  // sword block: blade turned flat across the screen
  items.sword.quaternion.copy(SWORD_REST).slerp(SWORD_BLOCK, st.block);
  x -= 0.14 * st.block;
  y += 0.1 * st.block;

  // bow draw: pull in toward center, back with charge, tremble at full draw
  if (st.bow > 0.001) {
    const b = st.bow;
    x -= 0.14 * b; y += 0.04 * b; z += (0.03 + P.charge * 0.09) * b;
    if (P.charge >= 1) { x += Math.sin(game.time * 70) * 0.004; y += Math.cos(game.time * 63) * 0.004; }
    qT.multiply(qc.setFromAxisAngle(AZ, -0.2 * b));
  }
  // drinking: lift to the mouth and bob
  if (st.drink > 0.001) {
    const d = st.drink;
    x += (0.1 - x) * d;
    y += (-0.3 - y) * d + Math.abs(Math.cos(game.time * Math.PI * 2.6)) * 0.035 * d;
    z += (-0.5 - z) * d;
    qT.multiply(qc.setFromAxisAngle(AX, -0.6 * d)).multiply(qa.setFromAxisAngle(AZ, 0.4 * d));
  }
  if (id === 'rod' && P.hook) { y += 0.04; qT.multiply(qc.setFromAxisAngle(AX, 0.25)); }
  pivot.position.set(x, y, z);
  pivot.quaternion.copy(qT);
  armHolder.position.set(x, y, z);
  armHolder.quaternion.copy(qI).slerp(qT, id === 'fists' ? 0.7 : 0.3); // an empty hand swings with the punch
  nock.visible = id === 'bow' && P.bowT > 0 && P.inv.arrows > 0;
  nock.position.set(0.05, -0.02, -0.02 + P.charge * 0.06);

  // walk bob + look sway (the hand lags behind camera turns)
  const a = settings.bobbing ? P.bobAmt : 0;
  root.position.set(Math.sin(P.bob) * 0.03 * a, -Math.abs(Math.cos(P.bob)) * 0.04 * a, 0);
  st.lagYaw += angDiff(P.yaw, st.lagYaw) * Math.min(1, dt * 12);
  st.lagPitch += (P.pitch - st.lagPitch) * Math.min(1, dt * 12);
  root.rotation.set(
    clamp(-(P.pitch - st.lagPitch) * 0.15, -0.15, 0.15),
    clamp(-angDiff(P.yaw, st.lagYaw) * 0.15, -0.15, 0.15),
    Math.sin(P.bob) * 0.02 * a,
  );
}
