// Game modes. Shared by the browser (menu, HUD, leaderboard) and the server (validation and one
// leaderboard per mode). Gameplay rules and kits for each mode live in public/js/game/modes.js.

/** Every mode is a free-for-all. `icon` names a hotbar icon (render/icons.js). */
export const MODES = Object.freeze({
  arena: {
    name: 'Arena FFA',
    short: 'Arena',
    icon: 'sword',
    map: 'Brickfall Arena',
    description: 'Sword, rod, bow and blocks. Drop off the tower and fight.',
  },
  potpvp: {
    name: 'Pot PvP',
    short: 'Pot PvP',
    icon: 'splash',
    map: 'Sandstone Ruins',
    description: 'Diamond kit, healing splash potions, speed and pearls. No natural regen.',
  },
  sumo: {
    name: 'Sumo FFA',
    short: 'Sumo',
    icon: 'fists',
    map: 'Sky Ring',
    description: 'Fists only, no damage. Knock everyone off the floating ring.',
  },
  combo: {
    name: 'Combo FFA',
    short: 'Combo',
    icon: 'flask',
    map: 'Brick Pit',
    description: 'Almost no hit delay and heavy armor. Land long combos.',
  },
});

export const MODE_IDS = Object.keys(MODES);
export const DEFAULT_MODE = 'arena';
export const isMode = (id) => typeof id === 'string' && Object.hasOwn(MODES, id);
