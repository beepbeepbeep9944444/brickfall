// Camera placement, interpolated between ticks: first person (bob, hurt tilt, sprint/bow FOV),
// F5 third-person views showing the player's own skin and cape, and a slow orbit on menus.
import * as THREE from '../vendor/three.js';
import { game } from '../core/state.js';
import { settings } from '../core/settings.js';
import { events } from '../core/events.js';
import { itemAt } from './icons.js';
import { camera, scene } from './scene.js';
import { vmCam, ROD_TIP_CAMERA_SPACE } from './viewmodel.js';
import { player } from '../game/entities.js';
import { horizontalSpeed } from '../game/physics.js';
import { makeCharacter, disposeCharacter, animateCape, showHeld } from '../game/characters.js';
import { CX, CZ, raycastVoxel } from '../world/world.js';

const EYE_HEIGHT = 1.62;
const THIRD_PERSON_DISTANCE = 4;
const SPRINT_FOV = 1.15;
let orbit = 0;
let model = null, walkPhase = 0, swing = 0;
const eye = new THREE.Vector3(), back = new THREE.Vector3(), lerped = new THREE.Vector3();

// ---------------------------------------------------------------- player model (third person)
function rebuildModel() {
  if (model) { scene.remove(model.group); disposeCharacter(model); }
  model = makeCharacter(player.cosmetics);
  model.group.visible = false;
  scene.add(model.group);
}
events.on('gameStart', rebuildModel);
events.on('playerCosmetics', () => { if (model) rebuildModel(); });
events.on('swing', () => { swing = 1; });

function animateModel(dt, hs) {
  const m = model;
  m.group.position.copy(lerped);
  m.group.rotation.y = player.yaw;
  showHeld(m, itemAt(player.slot));
  walkPhase += hs * dt * 2.4;
  const sw = Math.sin(walkPhase) * Math.min(1, hs / 4) * 0.9;
  m.legL.rotation.x = sw;
  m.legR.rotation.x = -sw;
  swing = Math.max(0, swing - dt * 5);
  const s = Math.sin(swing * Math.PI);
  if (player.bowT > 0) { m.armR.rotation.set(-Math.PI / 2 + player.pitch, -0.1, 0); m.armL.rotation.set(-Math.PI / 2 + player.pitch, 0.5, 0); }
  else if (player.blocking) { m.armR.rotation.set(-0.9, -0.5, 0.3); m.armL.rotation.set(-sw * 0.8, 0, 0); }
  else { m.armR.rotation.set(sw * 0.6 - s * 1.7 - 0.15, 0, s * 0.4); m.armL.rotation.set(-sw * 0.8, 0, 0); }
  m.head.rotation.x = player.pitch * 0.8;
  animateCape(m, hs, player.vel.y, dt, walkPhase);
  const red = player.hurtT > 0 ? 0x881111 : 0;
  for (const mt of m.mats) mt.emissive.setHex(red);
}

/** World-space position of a fighter's rod tip (anchors the fishing line). */
export function rodTip(owner, out) {
  if (owner === player && game.view === 0) return camera.localToWorld(out.copy(ROD_TIP_CAMERA_SPACE));
  const m = owner === player ? model : owner.model;
  if (!m) return out.copy(owner.pos);
  return m.armR.localToWorld(out.set(0, -0.35, -0.95));
}

// ---------------------------------------------------------------- per frame
export function updateCamera(dt, alpha) {
  if (game.state !== 'playing') {
    if (model) model.group.visible = false;
    orbit += dt * 0.08;
    camera.position.set(CX + Math.cos(orbit) * 30, 24, CZ + Math.sin(orbit) * 30);
    camera.lookAt(CX, 8, CZ);
    camera.rotation.z = 0;
    if (camera.fov !== settings.fov) { camera.fov = settings.fov; camera.updateProjectionMatrix(); }
    return;
  }
  const P = player, hs = horizontalSpeed(P);
  lerped.lerpVectors(P.prevPos, P.pos, alpha);
  P.bobAmt += ((P.onGround ? Math.min(1, hs / 4.3) : 0) - P.bobAmt) * Math.min(1, dt * 10);
  P.bob += hs * dt * 1.9;
  P.hurtAnim = Math.max(0, P.hurtAnim - dt * 2);

  const a = settings.bobbing && game.view === 0 ? P.bobAmt : 0;
  const bx = Math.sin(P.bob) * 0.03 * a, by = Math.abs(Math.cos(P.bob)) * 0.05 * a;
  eye.set(lerped.x + Math.cos(P.yaw) * bx, lerped.y + EYE_HEIGHT + by - 0.03 * a, lerped.z - Math.sin(P.yaw) * bx);
  const h = P.hurtAnim, roll = -Math.sin(h * h * h * h * Math.PI) * 0.24 * P.hurtSide + Math.sin(P.bob) * 0.006 * a;

  if (game.view === 0) {
    camera.position.copy(eye);
    camera.rotation.set(P.pitch, P.yaw, roll);
  } else {
    // pull the camera back (or around to the front), stopping short of walls
    const cp = Math.cos(P.pitch), sign = game.view === 1 ? 1 : -1;
    back.set(Math.sin(P.yaw) * cp * sign, -Math.sin(P.pitch) * sign, Math.cos(P.yaw) * cp * sign);
    const hit = raycastVoxel(eye, back, THIRD_PERSON_DISTANCE);
    const dist = hit ? Math.max(0.3, hit.t - 0.25) : THIRD_PERSON_DISTANCE;
    camera.position.copy(eye).addScaledVector(back, dist);
    if (game.view === 1) camera.rotation.set(P.pitch, P.yaw, 0);
    else camera.lookAt(eye);
  }
  vmCam.rotation.z = roll;

  if (model) {
    model.group.visible = game.view !== 0 && P.alive;
    if (model.group.visible) animateModel(dt, hs);
  }
  const targetFov = settings.fov * (P.sprinting ? SPRINT_FOV : 1) * (1 - P.charge * P.charge * 0.15);
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
  camera.updateProjectionMatrix();
}

export const isFirstPerson = () => game.view === 0;
