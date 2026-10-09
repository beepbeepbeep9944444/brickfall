// Blocky character models built from a skin, capes, and floating name/health tags.
import * as THREE from '../vendor/three.js';
import { ITEM_GEO } from '../render/geometry.js';
import { itemMat } from '../render/materials.js';
import { capeCanvas } from '../render/capes.js';
import { FACE_PALETTE, FACE_SIZE, RANK_COLORS, LEVEL_COLORS, rankById, skinById, levelTier } from '../shared/cosmetics.js';

const pixelTexture = (canvas) => {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
};

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}
function mix(hex, other, t) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(other.slice(1), 16);
  const c = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

/** 8x8 face canvas for a skin look (also used for leaderboard avatars). */
export function faceCanvas(look) {
  const c = document.createElement('canvas');
  c.width = c.height = FACE_SIZE;
  const g = c.getContext('2d');
  for (let i = 0; i < FACE_SIZE * FACE_SIZE; i++) {
    const idx = Number(look.face[i]);
    g.fillStyle = idx === 0 ? look.skin : idx === 8 ? look.hair : FACE_PALETTE[idx];
    g.fillRect(i % FACE_SIZE, Math.floor(i / FACE_SIZE), 1, 1);
  }
  return c;
}

export const faceForSkin = (skinId) => faceCanvas(skinById(skinId).skin);

/** Front-of-torso pattern for each outfit (8x10 canvas). */
function torsoCanvas(look) {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 10;
  const g = c.getContext('2d'), px = (x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };
  const row = (y, col) => { for (let x = 0; x < 8; x++) px(x, y, col); };
  g.fillStyle = look.shirt;
  g.fillRect(0, 0, 8, 10);
  switch (look.outfit) {
    case 'hoodie':
      for (let x = 2; x < 6; x++) for (let y = 6; y < 9; y++) px(x, y, shade(look.shirt, 0.82));
      px(3, 1, '#f4f1ea'); px(4, 1, '#f4f1ea'); px(3, 2, '#f4f1ea'); px(4, 3, '#f4f1ea');
      break;
    case 'stripes':
      for (let y = 0; y < 10; y += 2) row(y, mix(look.shirt, look.accent === '#ffb627' ? '#ffffff' : look.accent, 0.6));
      break;
    case 'jacket':
      for (let y = 0; y < 10; y++) { px(3, y, '#ececf2'); px(4, y, '#ececf2'); }
      for (let y = 1; y < 10; y += 2) px(4, y, '#9aa0ad');
      px(2, 0, shade(look.shirt, 0.75)); px(5, 0, shade(look.shirt, 0.75));
      break;
    case 'armor':
      row(0, look.accent);
      row(3, shade(look.shirt, 0.75));
      row(6, shade(look.shirt, 0.75));
      for (let y = 1; y < 9; y++) { px(0, y, shade(look.shirt, 0.85)); px(7, y, shade(look.shirt, 0.85)); }
      px(3, 4, look.accent); px(4, 4, look.accent); px(3, 5, look.accent); px(4, 5, look.accent);
      row(8, look.accent);
      break;
    case 'suit':
      for (let y = 0; y < 7; y++) for (let x = 3 - Math.floor(y / 3); x <= 4 + Math.floor(y / 3); x++) px(x, y, y < 7 ? '#f4f1ea' : look.shirt);
      for (let y = 1; y < 7; y++) { px(3, y, look.accent); px(4, y, look.accent); }
      px(3, 0, '#f4f1ea'); px(4, 0, '#f4f1ea');
      break;
    case 'spacesuit':
      for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) px(x, y, shade(look.shirt, 0.82));
      px(2, 2, look.accent); px(5, 2, '#3ddc84'); px(3, 4, '#4cc9f0'); px(4, 4, '#4cc9f0');
      row(0, look.accent);
      break;
    default: // tee
      px(3, 0, look.skin); px(4, 0, look.skin); px(3, 1, look.skin); px(4, 1, look.skin);
  }
  if (look.outfit !== 'armor') row(9, shade(look.pants, 0.7)); // belt line
  return c;
}

/**
 * Build a character (facing -Z) from cosmetics { skin: skinId, cape: capeId }.
 * Returns the group plus limb pivots for animation and every material (for the hurt flash).
 */
export function makeCharacter(cosmetics) {
  const look = skinById(cosmetics?.skin).skin;
  const mats = [];
  const L = (opts) => { const m = new THREE.MeshLambertMaterial(typeof opts === 'string' ? { color: opts } : opts); mats.push(m); return m; };
  const mSkin = L(look.skin), mHair = L(look.hair), mShirt = L(look.shirt), mPants = L(look.pants), mShoes = L(look.shoes), mAccent = L(look.accent);
  const mFace = L({ map: pixelTexture(faceCanvas(look)) });
  const mTorso = L({ map: pixelTexture(torsoCanvas(look)) });
  const group = new THREE.Group();
  const box = (w, h, d, m, x = 0, y = 0, z = 0) => {
    const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    me.position.set(x, y, z);
    return me;
  };

  // head + hair / headwear
  const head = new THREE.Group();
  head.position.y = 1.44;
  const hairTop = ['short', 'long', 'spiky', 'headband', 'crown'].includes(look.hairStyle);
  head.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), [mSkin, mSkin, hairTop ? mHair : mSkin, mSkin, hairTop ? mHair : mSkin, mFace]).translateY(0.25));
  const shortHair = () => head.add(box(0.54, 0.12, 0.54, mHair, 0, 0.48), box(0.54, 0.3, 0.06, mHair, 0, 0.34, 0.25));
  switch (look.hairStyle) {
    case 'short': shortHair(); break;
    case 'long': head.add(box(0.54, 0.12, 0.54, mHair, 0, 0.48), box(0.56, 0.62, 0.08, mHair, 0, 0.2, 0.26), box(0.06, 0.4, 0.4, mHair, -0.27, 0.32, 0.04), box(0.06, 0.4, 0.4, mHair, 0.27, 0.32, 0.04)); break;
    case 'spiky':
      head.add(box(0.54, 0.1, 0.54, mHair, 0, 0.48));
      for (const [x, z] of [[-0.15, -0.12], [0.12, -0.1], [-0.1, 0.13], [0.15, 0.14], [0, 0]]) head.add(box(0.13, 0.14, 0.13, mHair, x, 0.58, z));
      break;
    case 'mohawk': head.add(box(0.14, 0.2, 0.56, mHair, 0, 0.56)); break;
    case 'cap': head.add(box(0.54, 0.16, 0.54, mShirt, 0, 0.5), box(0.54, 0.04, 0.22, mShirt, 0, 0.44, -0.36)); break;
    case 'hood': head.add(box(0.58, 0.08, 0.58, mAccent, 0, 0.53), box(0.58, 0.56, 0.06, mAccent, 0, 0.25, 0.28), box(0.06, 0.52, 0.52, mAccent, -0.28, 0.25, 0.02), box(0.06, 0.52, 0.52, mAccent, 0.28, 0.25, 0.02)); break;
    case 'helmet':
      head.add(box(0.56, 0.1, 0.56, mHair, 0, 0.53), box(0.56, 0.54, 0.06, mHair, 0, 0.26, 0.28), box(0.06, 0.54, 0.56, mHair, -0.28, 0.26, 0), box(0.06, 0.54, 0.56, mHair, 0.28, 0.26, 0), box(0.56, 0.08, 0.06, mHair, 0, 0.46, -0.28));
      if (look.outfit === 'armor') head.add(box(0.08, 0.12, 0.34, mAccent, 0, 0.63, 0.04));
      break;
    case 'headband': shortHair(); head.add(box(0.55, 0.08, 0.55, mAccent, 0, 0.38), box(0.06, 0.14, 0.04, mAccent, 0.12, 0.3, 0.29)); break;
    case 'crown':
      shortHair();
      head.add(box(0.56, 0.1, 0.04, mAccent, 0, 0.58, -0.26), box(0.56, 0.1, 0.04, mAccent, 0, 0.58, 0.26), box(0.04, 0.1, 0.56, mAccent, -0.26, 0.58, 0), box(0.04, 0.1, 0.56, mAccent, 0.26, 0.58, 0));
      for (const x of [-0.2, 0, 0.2]) head.add(box(0.07, 0.08, 0.04, mAccent, x, 0.67, -0.26));
      break;
    default: break; // bald
  }
  group.add(head);

  // torso: patterned front (-Z face), plain shirt elsewhere
  group.add(new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.7, 0.3), [mShirt, mShirt, mShirt, mShirt, mShirt, mTorso]).translateY(1.09));
  if (look.outfit === 'hoodie' && look.hairStyle !== 'hood') group.add(box(0.4, 0.18, 0.1, L(shade(look.shirt, 0.8)), 0, 1.36, 0.19));

  const limb = (x, y) => { const p = new THREE.Group(); p.position.set(x, y, 0); group.add(p); return p; };
  const armL = limb(-0.38, 1.4), armR = limb(0.38, 1.4);
  for (const arm of [armL, armR]) {
    arm.add(box(0.22, 0.7, 0.22, mShirt, 0, -0.31));
    if (look.outfit === 'armor') arm.add(box(0.26, 0.16, 0.26, mAccent, 0, -0.02));
    arm.add(box(0.23, 0.2, 0.23, mSkin, 0, -0.57));
  }
  const legL = limb(-0.13, 0.74), legR = limb(0.13, 0.74);
  for (const leg of [legL, legR]) {
    leg.add(box(0.25, 0.6, 0.25, mPants, 0, -0.26));
    leg.add(box(0.26, 0.16, 0.27, mShoes, 0, -0.64, -0.005));
  }

  // held items (one visible at a time)
  const held = (geo, scale, pos, rot) => {
    const m = new THREE.Mesh(geo, itemMat);
    m.scale.setScalar(scale); m.position.set(...pos); m.rotation.set(...rot); m.visible = false;
    armR.add(m);
    return m;
  };
  const sword = held(ITEM_GEO.sword, 0.75, [0, -0.62, -0.18], [0, Math.PI / 2, -Math.PI / 4 + 0.2]);
  const bow = held(ITEM_GEO.bow, 0.8, [0, -0.62, -0.06], [0, Math.PI / 2, Math.PI / 4]);
  const rod = held(ITEM_GEO.rod, 0.85, [0, -0.62, -0.2], [0, Math.PI / 2, -Math.PI / 4 + 0.2]);
  const small = [0, -0.66, -0.08], upright = [0, Math.PI / 2, 0];
  const items = {
    sword, bow, rod,
    splash: held(ITEM_GEO.splash, 0.4, small, upright),
    speed: held(ITEM_GEO.speed, 0.4, small, upright),
    flask: held(ITEM_GEO.flask, 0.4, small, upright),
    pearl: held(ITEM_GEO.pearl, 0.25, small, upright),
  };
  sword.visible = true;

  // cape: pivots at the shoulders, hangs behind (+Z)
  let capePivot = null;
  const art = capeCanvas(cosmetics?.cape);
  if (art) {
    const tex = pixelTexture(art);
    const back = L({ map: tex }), inner = L({ map: tex, color: 0xb0b0b0 }), edge = L('#1b1d2a');
    capePivot = new THREE.Group();
    capePivot.position.set(0, 1.43, 0.17);
    capePivot.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.04), [edge, edge, edge, edge, back, inner]).translateY(-0.4));
    group.add(capePivot);
  }

  return { group, head, armL, armR, legL, legR, sword, bow, rod, items, capePivot, mats, capeSwing: 0.1 };
}

/** Show the held item with this id (anything without a model, like fists or blocks, shows an empty hand). */
export function showHeld(model, id) {
  for (const k in model.items) model.items[k].visible = k === id;
}

/** Swing the cape behind a moving character. `speed` is horizontal blocks/second, `vy` blocks/tick. */
export function animateCape(model, speed, vy, dt, bob = 0) {
  if (!model.capePivot) return;
  const target = 0.08 + Math.min(1, speed / 6) * 0.75 + Math.max(0, -vy) * 0.6 + Math.sin(bob) * 0.04 * Math.min(1, speed / 4);
  model.capeSwing += (target - model.capeSwing) * Math.min(1, dt * 8);
  model.capePivot.rotation.x = -model.capeSwing;
}

export function disposeCharacter(model) {
  model.group.traverse((o) => { if (o.geometry && !Object.values(ITEM_GEO).includes(o.geometry)) o.geometry.dispose(); });
  for (const m of model.mats) { m.map?.dispose(); m.dispose(); }
}

// ---------------------------------------------------------------- name tags
export function makeTag() {
  const cv = document.createElement('canvas');
  cv.width = 360;
  cv.height = 72;
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  spr.scale.set(2.7, 0.54, 1);
  spr.position.y = 2.38;
  return { spr, cv, tex };
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Redraw a fighter's tag: "[level] [RANK] Name" plus a health bar. */
export function drawTag(f) {
  const { cv, tex } = f.tag, g = cv.getContext('2d'), W = cv.width;
  const rank = rankById(f.rank), color = RANK_COLORS[rank.id];
  const parts = [
    { text: `[${f.level || 1}]`, color: LEVEL_COLORS[levelTier(f.level || 1)] },
    ...(rank.tag ? [{ text: `[${rank.tag}]`, color }] : []),
    { text: f.name, color },
  ];
  g.clearRect(0, 0, W, 72);
  g.font = '700 25px Rubik, sans-serif';
  g.textBaseline = 'middle';
  const widths = parts.map((p) => g.measureText(p.text).width);
  const total = widths.reduce((a, b) => a + b, 0) + (parts.length - 1) * 8 + 26, x0 = Math.max(2, (W - total) / 2);
  g.fillStyle = 'rgba(12,14,26,.72)';
  roundRect(g, x0, 2, Math.min(W - 4, total), 40, 10);
  g.fill();
  let x = x0 + 13;
  parts.forEach((p, i) => { g.fillStyle = p.color; g.fillText(p.text, x, 23); x += widths[i] + 8; });
  // health (+ golden absorption)
  const bx = W / 2 - 70, frac = Math.max(0, f.hp) / f.maxHp;
  g.fillStyle = 'rgba(12,14,26,.72)';
  roundRect(g, bx - 3, 50, 146, 16, 6);
  g.fill();
  g.fillStyle = frac > 0.5 ? '#3ddc84' : frac > 0.25 ? '#ffb627' : '#ff4d6d';
  roundRect(g, bx, 53, Math.max(4, 140 * frac), 10, 4);
  g.fill();
  if (f.absorb > 0) {
    g.fillStyle = '#ffd36b';
    roundRect(g, bx, 53, Math.max(3, 140 * (f.absorb / f.maxHp)), 4, 2);
    g.fill();
  }
  tex.needsUpdate = true;
}
