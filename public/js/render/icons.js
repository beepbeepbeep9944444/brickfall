// 16x16 pixel-art icons. Used for the hotbar, kill feed and (extruded) as 3D held items.
import { game } from '../core/state.js';
import { atlasCanvas, AN, T } from './textures.js';

function makeIcon(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  const px = (x, y, col) => { if (x < 0 || y < 0 || x > 15 || y > 15) return; g.fillStyle = col; g.fillRect(x, y, 1, 1); };
  draw(px, g);
  // dark outline around every opaque pixel
  const d = g.getImageData(0, 0, 16, 16).data;
  const op = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && d[(y * 16 + x) * 4 + 3] > 128;
  g.fillStyle = '#1b1d2a';
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (!op(x, y) && (op(x + 1, y) || op(x - 1, y) || op(x, y + 1) || op(x, y - 1))) g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

/** Splash-style potion bottle in three shades (light, mid, dark). */
function potionIcon([light, mid, dark]) {
  return makeIcon((px) => {
    for (let y = 1; y <= 2; y++) for (let x = 6; x <= 9; x++) px(x, y, '#8a5a32');
    for (let y = 3; y <= 5; y++) for (let x = 7; x <= 8; x++) px(x, y, '#d9ecff');
    px(6, 5, '#d9ecff'); px(9, 5, '#d9ecff');
    for (let y = 6; y <= 14; y++) {
      const w = y < 8 ? 3 + (y - 6) * 2 : y > 12 ? 5 - (y - 13) : 6;
      for (let x = 8 - w; x < 8 + w; x++) px(x, y, y === 6 ? '#d9ecff' : x < 6 && y < 11 ? light : x > 10 || y > 12 ? dark : mid);
    }
    px(4, 9, '#ffffff'); px(4, 10, '#ffffff'); px(5, 8, '#ffffff');
  });
}

export const icons = {
  sword: makeIcon((px) => {
    for (let i = 0; i < 10; i++) { const x = 5 + i, y = 10 - i; px(x, y - 1, '#eef3ff'); px(x + 1, y, '#7f93c4'); px(x, y, '#b9c8ee'); }
    px(15, 0, '#eef3ff');
    for (let k = -2; k <= 2; k++) px(4 + k, 11 + k, k === 0 ? '#ffd36b' : '#e89a1c');
    px(3, 12, '#6b4426'); px(2, 13, '#55341c'); px(1, 14, '#e89a1c'); px(0, 15, '#ffd36b');
  }),
  bow: makeIcon((px) => {
    for (let i = 0; i <= 10; i++) px(3 + i, 13 - i, '#e6e6ee');
    for (let a = 0; a <= 60; a++) {
      const t = Math.PI + (a / 60) * (Math.PI / 2);
      px(Math.round(13 + 10.5 * Math.cos(t)), Math.round(13 + 10.5 * Math.sin(t)), '#8a5a32');
      px(Math.round(13 + 9.5 * Math.cos(t)), Math.round(13 + 9.5 * Math.sin(t)), '#c08850');
    }
    px(3, 13, '#55341c'); px(13, 3, '#55341c');
  }),
  blocks: makeIcon((px, g) => {
    g.drawImage(atlasCanvas, (T.planks % AN) * 16, Math.floor(T.planks / AN) * 16, 16, 16, 0, 0, 16, 16);
  }),
  flask: makeIcon((px) => {
    for (let y = 1; y <= 2; y++) for (let x = 7; x <= 8; x++) px(x, y, '#8a5a32');
    for (let y = 3; y <= 5; y++) for (let x = 7; x <= 8; x++) px(x, y, '#cfe6ff');
    for (let y = 5; y <= 15; y++) {
      for (let x = 2; x <= 13; x++) {
        const d = Math.hypot(x - 7.5, y - 10.2);
        if (d < 4.9) px(x, y, y >= 8 ? (d < 3.6 ? '#ff5c7a' : '#e0334f') : '#d9ecff');
      }
    }
    px(5, 9, '#ffffff'); px(5, 10, '#ffd2dc'); px(6, 8, '#ffffff');
  }),
  arrows: makeIcon((px) => {
    for (let i = 0; i <= 8; i++) px(3 + i, 12 - i, '#8a5a32');
    px(12, 3, '#c9ced8'); px(12, 2, '#e8ecf4'); px(13, 3, '#9aa0ad'); px(13, 2, '#c9ced8'); px(14, 1, '#e8ecf4');
    px(2, 13, '#f2f2f2'); px(1, 13, '#ff4d6d'); px(2, 14, '#ff4d6d'); px(1, 14, '#f2f2f2'); px(3, 13, '#f2f2f2'); px(2, 12, '#f2f2f2');
  }),
  rod: makeIcon((px) => {
    for (let i = 0; i <= 11; i++) px(2 + i, 13 - i, i < 3 ? '#55341c' : '#8a5a32');
    for (let y = 3; y <= 10; y++) px(14, y, '#d9dde8');
    px(13, 11, '#c9ced8'); px(14, 11, '#c9ced8'); px(13, 10, '#c9ced8');
    px(12, 12, '#ff4d6d'); px(13, 12, '#f4f1ea');
  }),
  splash: potionIcon(['#ff7aa8', '#e8336e', '#a81e4f']),
  speed: potionIcon(['#a8ecff', '#4cc9f0', '#2379a8']),
  pearl: makeIcon((px) => {
    for (let y = 3; y <= 13; y++) {
      for (let x = 3; x <= 13; x++) {
        const d = Math.hypot(x - 8, y - 8);
        if (d > 5.4) continue;
        px(x, y, d < 2.2 ? '#9ff5df' : d < 4 ? '#2fa58c' : '#155e55');
      }
    }
    px(6, 6, '#e9fff9'); px(7, 6, '#c8fff0'); px(6, 7, '#c8fff0');
  }),
  fists: makeIcon((px) => {
    const rows = ['..####....', '.######...', '########..', '#########.', '##########', '##########', '.#########', '..#######.', '...#####..'];
    rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '#') px(x + 3, y + 3, y < 2 ? '#f6d2b0' : x > 7 ? '#c99a74' : '#e8b88f'); }));
    for (const x of [5, 7, 9]) px(x, 5, '#b98a64');
    for (let y = 12; y <= 14; y++) for (let x = 5; x <= 10; x++) px(x, y, '#4cc9f0');
  }),
  heart: makeIcon((px) => {
    const rows = ['.##..##.', '########', '########', '.######.', '..####..', '...##...'];
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== '#') return;
      const col = y < 2 && (x === 1 || x === 2) ? '#ffb3c0' : '#ff4d6d';
      px(x * 2, y * 2 + 3, col); px(x * 2 + 1, y * 2 + 3, col); px(x * 2, y * 2 + 4, col); px(x * 2 + 1, y * 2 + 4, col);
    }));
  }),
};

/** Data URLs for <img> use (kill feed, favicons, etc.). */
export const iconURL = Object.fromEntries(Object.entries(icons).map(([k, c]) => [k, c.toDataURL()]));

/**
 * Every hotbar item. `count` names the inventory field shown on the slot (consumables).
 * Each mode's kit (game/rules.js) picks which of these are on the hotbar.
 */
export const ITEM_DEFS = {
  sword: { name: 'Steel Cleaver', icon: icons.sword },
  rod: { name: 'Fishing Rod', icon: icons.rod },
  bow: { name: 'Recurve Bow', icon: icons.bow, count: 'arrows' },
  flask: { name: 'Golden Flask', icon: icons.flask, count: 'flasks' },
  blocks: { name: 'Oak Blocks', icon: icons.blocks, count: 'blocks' },
  arrows: { name: 'Arrows', icon: icons.arrows, count: 'arrows' },
  splash: { name: 'Healing Splash II', icon: icons.splash, count: 'pots' },
  speed: { name: 'Swiftness Potion', icon: icons.speed, count: 'speed' },
  pearl: { name: 'Void Pearl', icon: icons.pearl, count: 'pearls' },
  fists: { name: 'Fists', icon: icons.fists },
};

/** Item id in a hotbar slot for the current kit. */
export const itemAt = (slot) => game.hotbar[slot] || game.hotbar[0];

/** Draw an icon into an existing canvas element (scaled with CSS pixelated rendering). */
export function paintIcon(canvas, name) {
  canvas.width = canvas.height = 16;
  canvas.getContext('2d').drawImage(icons[name], 0, 0);
}
