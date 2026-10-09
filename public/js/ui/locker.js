// Wardrobe & shop: preview and equip skins and capes, buy them (and ranks) with coins.
import * as THREE from '../vendor/three.js';
import { $, esc } from '../core/util.js';
import { makeCharacter, disposeCharacter, faceForSkin, animateCape } from '../game/characters.js';
import { capeCanvas } from '../render/capes.js';
import {
  SKINS, CAPES, RANKS, itemStatus, requirementText, upgradePrice, rankById, isStaffRank,
} from '../shared/cosmetics.js';
import { session, unlockContext, currentRank, buy, equip } from '../net/account.js';
import { screens } from './screens.js';
import { notify } from './toasts.js';
import { openAuth } from './auth.js';

let tab = 'skin';
let previewing = null; // { skin, cape } shown on the model (may include items you don't own yet)
let confirming = null; // "kind:id" awaiting a second click to confirm a purchase
const fmt = (n) => n.toLocaleString('en-US');

// ---------------------------------------------------------------- 3D preview
const preview = { renderer: null, scene: null, camera: null, model: null, key: '', yaw: 0.5, running: false, last: 0, drag: null };

function initPreview() {
  if (preview.renderer) return;
  const canvas = $('lockerview');
  preview.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  preview.scene = new THREE.Scene();
  preview.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  preview.camera.position.set(0, 1.25, 5.2);
  preview.camera.lookAt(0, 0.95, 0);
  preview.scene.add(new THREE.HemisphereLight(0xffffff, 0x4a4f6a, 0.95));
  const key = new THREE.DirectionalLight(0xfff0dc, 0.6);
  key.position.set(2, 4, 3);
  preview.scene.add(key);
  canvas.addEventListener('pointerdown', (e) => { preview.drag = e.clientX; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (preview.drag == null) return;
    preview.yaw += (e.clientX - preview.drag) * 0.012;
    preview.drag = e.clientX;
  });
  canvas.addEventListener('pointerup', () => { preview.drag = null; });
}

function syncModel() {
  const key = `${previewing.skin}|${previewing.cape}`;
  if (preview.model && key === preview.key) return;
  if (preview.model) { preview.scene.remove(preview.model.group); disposeCharacter(preview.model); }
  preview.model = makeCharacter(previewing);
  preview.scene.add(preview.model.group);
  preview.key = key;
}

function loop(now) {
  if (!preview.running) return;
  const dt = Math.min(0.05, (now - preview.last) / 1000 || 0);
  preview.last = now;
  syncModel();
  if (preview.drag == null) preview.yaw += dt * 0.5;
  const m = preview.model, t = now / 1000;
  m.group.rotation.y = Math.PI + preview.yaw;
  m.armL.rotation.x = Math.sin(t * 2) * 0.15;
  m.armR.rotation.x = -Math.sin(t * 2) * 0.15 - 0.15;
  m.head.rotation.x = Math.sin(t * 0.8) * 0.08;
  animateCape(m, 1.5 + Math.sin(t) * 1.5, 0, dt, t * 4);
  const c = $('lockerview'), w = c.clientWidth, h = c.clientHeight;
  if (w && h) {
    preview.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    preview.renderer.setSize(w, h, false);
    preview.camera.aspect = w / h;
    preview.camera.updateProjectionMatrix();
  }
  preview.renderer.render(preview.scene, preview.camera);
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- actions
async function doBuy(kind, id, price) {
  if (!session.user) { openAuth('login'); return; }
  const key = `${kind}:${id}`;
  if (confirming !== key) { confirming = key; render(); return; }
  confirming = null;
  try {
    await buy(kind, id);
    notify(kind === 'rank' ? `You are now ${rankById(id).name}! Enjoy your perks.` : `Purchased for ${fmt(price)} coins.`, { type: 'success' });
    if (kind !== 'rank') await doEquip(kind, id, true);
  } catch (err) {
    notify(err.message, { type: 'error' });
  }
  render();
}

async function doEquip(kind, id, quiet = false) {
  try {
    await equip({ ...session.cosmetics, [kind]: id });
    previewing = { ...session.cosmetics };
    if (!quiet) notify('Equipped.', { type: 'success', ms: 1600 });
  } catch (err) {
    notify(err.message, { type: 'error' });
  }
  render();
}

// ---------------------------------------------------------------- cards
function actionButton(kind, item, status, equipped) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-sm';
  if (equipped) { b.textContent = 'Equipped'; b.classList.add('btn-ghost'); b.disabled = true; return b; }
  if (status === 'locked') { b.textContent = 'Locked'; b.classList.add('btn-ghost'); b.disabled = true; return b; }
  if (status === 'buy') {
    const short = item.price - session.wallet.coins;
    if (!session.user) { b.textContent = 'Log in to buy'; b.classList.add('btn-ghost'); }
    else if (confirming === `${kind}:${item.id}`) { b.textContent = `Confirm ${fmt(item.price)}`; b.classList.add('btn-primary'); }
    else if (short > 0) { b.textContent = `Need ${fmt(short)}`; b.classList.add('btn-ghost'); b.disabled = true; }
    else { b.textContent = `Buy · ${fmt(item.price)}`; b.classList.add('btn-primary'); }
    b.onclick = (e) => { e.stopPropagation(); doBuy(kind, item.id, item.price); };
    return b;
  }
  b.textContent = 'Equip';
  b.classList.add('btn-primary');
  b.onclick = (e) => { e.stopPropagation(); doEquip(kind, item.id); };
  return b;
}

function statusText(item, status) {
  switch (status) {
    case 'free': return 'Free';
    case 'owned': return 'Owned';
    case 'rank': return `${rankById(item.rank).name} perk`;
    case 'unlocked': return 'Unlocked';
    case 'buy': return `${fmt(item.price)} coins`;
    default: return item.how ? '🔒 Locked' : `🔒 ${esc(requirementText(item))}`; // the card's description explains how
  }
}

function itemCard(kind, item, art) {
  const status = itemStatus(kind, item, unlockContext());
  const equipped = session.cosmetics[kind] === item.id;
  const card = document.createElement('div');
  card.className = `item-card${equipped ? ' on' : ''}${previewing[kind] === item.id ? ' previewing' : ''}${status === 'locked' ? ' locked' : ''}`;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Preview ${item.name}`);
  card.innerHTML = `<div class="item-art"></div><div class="item-name">${esc(item.name)}</div><div class="item-req">${statusText(item, status)}</div>${item.how ? `<div class="item-how">${esc(item.how)}</div>` : ''}`;
  card.querySelector('.item-art').appendChild(art);
  card.appendChild(actionButton(kind, item, status, equipped));
  const tryOn = () => { previewing = { ...previewing, [kind]: item.id }; confirming = null; render(); };
  card.onclick = tryOn;
  card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tryOn(); } };
  return card;
}

function skinArt(id) {
  const c = faceForSkin(id), a = document.createElement('canvas');
  a.width = a.height = 8;
  a.className = 'face-art';
  a.getContext('2d').drawImage(c, 0, 0);
  return a;
}

function capeArt(id) {
  const src = capeCanvas(id);
  if (!src) { const s = document.createElement('span'); s.className = 'item-none'; s.textContent = '—'; return s; }
  const a = document.createElement('canvas');
  a.width = src.width; a.height = src.height;
  a.className = 'cape-art';
  a.getContext('2d').drawImage(src, 0, 0);
  return a;
}

function rankPerks(rank) {
  const perks = [`<span class="rtag rank-${rank.id}">[${rank.tag}]</span> tag and colored name`, `+${Math.round(rank.coinBonus * 100)}% coins per kill`];
  for (const s of SKINS) if (s.rank && rankById(s.rank).tier <= rank.tier) perks.push(`Skin: ${esc(s.name)}`);
  for (const c of CAPES) if (c.rank && rankById(c.rank).tier <= rank.tier) perks.push(`Cape: ${esc(c.name)}`);
  return perks;
}

function rankCard(rank) {
  const mine = currentRank(), staff = isStaffRank(session.user?.staffRank);
  const owned = staff || mine.tier >= rank.tier;
  const price = upgradePrice(session.user?.paidRank || 'NONE', rank.id);
  const card = document.createElement('div');
  card.className = `rank-card rank-${rank.id}${owned ? ' owned' : ''}`;
  card.innerHTML = `<div class="rank-card-name rname rank-${rank.id}">${esc(rank.name)}</div>
    <div class="rank-card-price">${owned ? 'Owned' : `${fmt(price)} coins${price < rank.price ? ` <s>${fmt(rank.price)}</s>` : ''}`}</div>
    <ul class="rank-perks">${rankPerks(rank).map((p) => `<li>${p}</li>`).join('')}</ul>`;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-sm';
  if (owned) { b.textContent = staff ? 'Staff' : mine.id === rank.id ? 'Current rank' : 'Included'; b.classList.add('btn-ghost'); b.disabled = true; }
  else if (!session.user) { b.textContent = 'Log in to buy'; b.classList.add('btn-ghost'); b.onclick = () => openAuth('login'); }
  else if (confirming === `rank:${rank.id}`) { b.textContent = `Confirm ${fmt(price)}`; b.classList.add('btn-primary'); b.onclick = () => doBuy('rank', rank.id, price); }
  else if (price > session.wallet.coins) { b.textContent = `Need ${fmt(price - session.wallet.coins)}`; b.classList.add('btn-ghost'); b.disabled = true; }
  else { b.textContent = mine.tier > 0 ? 'Upgrade' : 'Buy'; b.classList.add('btn-primary'); b.onclick = () => doBuy('rank', rank.id, price); }
  card.appendChild(b);
  return card;
}

// ---------------------------------------------------------------- render
function render() {
  document.querySelectorAll('#lockertabs button').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  $('lockercoins').textContent = session.user ? fmt(session.wallet.coins) : '—';
  const body = $('lockerbody'), scroll = body.scrollTop;
  body.innerHTML = '';
  const grid = document.createElement('div');
  if (tab === 'skin') { grid.className = 'item-grid'; for (const s of SKINS) grid.appendChild(itemCard('skin', s, skinArt(s.id))); }
  else if (tab === 'cape') { grid.className = 'item-grid'; for (const c of CAPES) grid.appendChild(itemCard('cape', c, capeArt(c.id))); }
  else { grid.className = 'rank-grid'; for (const r of RANKS.slice(1)) grid.appendChild(rankCard(r)); }
  body.appendChild(grid);
  if (tab === 'rank') {
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = 'Ranks are permanent. Upgrading only costs the difference. Earn coins by getting kills.';
    body.appendChild(note);
  }
  body.scrollTop = scroll;
  const p = previewing, equippedNow = p.skin === session.cosmetics.skin && p.cape === session.cosmetics.cape;
  $('lockerhint').textContent = equippedNow ? 'Drag to rotate' : 'Previewing — equip or buy to keep it';
}

export function initLocker() {
  screens.register('locker', {
    onOpen({ returning }) {
      if (!returning) { previewing = { ...session.cosmetics }; confirming = null; }
      initPreview();
      preview.running = true;
      preview.last = performance.now();
      requestAnimationFrame(loop);
      render();
    },
    onClose() { preview.running = false; },
  });
  document.querySelectorAll('#lockertabs button').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; confirming = null; render(); }; });
}
