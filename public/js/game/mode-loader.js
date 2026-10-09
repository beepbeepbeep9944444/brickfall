// Switching game modes: loads the mode's map and kit, clears leftovers and resets the bots.
import { game } from '../core/state.js';
import { events } from '../core/events.js';
import { generateWorld, map } from '../world/world.js';
import { buildAllChunks } from '../world/mesher.js';
import { clearPlaced } from '../world/placed.js';
import { isMode, DEFAULT_MODE } from '../shared/modes.js';
import { clearProjectiles } from './projectiles.js';
import { bots, fighters, spawnBot } from './entities.js';
import { RULES } from './rules.js';

/** localStorage key for the last mode picked on the menu. */
export const MODE_KEY = 'bf_mode';

/** Make `id` the active mode (also used on the menu so the background shows the chosen map). */
export function loadMode(id) {
  if (!isMode(id)) id = DEFAULT_MODE;
  const R = RULES[id];
  game.mode = id;
  game.hotbar = R.kit;
  if (map.id !== R.map) {
    clearProjectiles();
    clearPlaced();
    generateWorld(R.map);
    buildAllChunks();
  }
  resetFighters();
  events.emit('modeChange', { mode: id });
}

/** Fresh match: everyone's scores go back to zero and the bots respawn with this mode's kit. */
export function resetFighters() {
  for (const f of fighters) Object.assign(f, { kills: 0, deaths: 0, streak: 0, best: 0, coins: 0, lastAttacker: null });
  for (const b of bots) spawnBot(b);
}
