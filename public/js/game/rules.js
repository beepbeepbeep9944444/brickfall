// Gameplay rules and kits for each mode (names and descriptions live in shared/modes.js).
// Combat code reads the active mode's numbers through rules(), so a new mode only needs an entry here,
// a map in world/world.js and an entry in shared/modes.js.
import { game } from '../core/state.js';

/**
 * kit:          hotbar item ids, in slot order (see ITEM_DEFS in render/icons.js)
 * inventory:    starting counts for consumables
 * killRefill:   what a kill gives back, as [amount, cap]
 * swordDamage / fistDamage / botDamage: melee damage before armor (bots hit softer than you)
 * armor:        armor points (damage x (25 - armor) / 25)
 * hurtResistance: seconds of hurt resistance after a hit (1.8.9: 20 ticks = 1 s)
 * knockback:    [horizontal, vertical] base knockback (1.8.9: 0.4, 0.4)
 * spawn:        'tower' (safe spawn tower) or 'random' (anywhere, with spawn protection)
 * bot:          what the bots carry in this mode
 */
export const RULES = Object.freeze({
  arena: {
    map: 'arena',
    kit: ['sword', 'rod', 'bow', 'flask', 'blocks', 'arrows'],
    inventory: { arrows: 24, blocks: 32, flasks: 2 },
    killRefill: { arrows: [6, 64], blocks: [8, 64], flasks: [1, 3] },
    killHeal: 4,
    swordDamage: 7, fistDamage: 1, botDamage: 4,
    armor: 12,
    hurtResistance: 1,
    knockback: [0.4, 0.4],
    naturalRegen: true,
    fallDamage: true,
    spawn: 'tower',
    bot: { weapon: 'sword', bow: true, rod: true, block: true },
  },
  potpvp: {
    map: 'ruins',
    kit: ['sword', 'pearl', 'speed', 'splash'],
    inventory: { pearls: 4, speed: 2, pots: 24 },
    killRefill: { pots: [8, 24], pearls: [1, 4], speed: [1, 2] },
    killHeal: 0,
    swordDamage: 9, fistDamage: 1, botDamage: 6,
    armor: 18, // diamond with protection
    hurtResistance: 1,
    knockback: [0.4, 0.4],
    naturalRegen: false, // health only comes back from potions
    fallDamage: true,
    spawn: 'tower',
    bot: { weapon: 'sword', block: true, pots: 8, speed: true },
  },
  sumo: {
    map: 'ring',
    kit: ['fists'],
    inventory: {},
    killRefill: {},
    killHeal: 0,
    swordDamage: 0, fistDamage: 0, botDamage: 0, // hits only knock back
    armor: 0,
    hurtResistance: 1,
    knockback: [0.4, 0.4],
    naturalRegen: true,
    fallDamage: false,
    spawn: 'random',
    protect: 2,
    bot: { weapon: 'none', sumo: true },
  },
  combo: {
    map: 'pit',
    kit: ['sword', 'flask'],
    inventory: { flasks: 8 },
    killRefill: { flasks: [3, 8] },
    killHeal: 8,
    swordDamage: 7, fistDamage: 1, botDamage: 4,
    armor: 20,
    hurtResistance: 0.25, // 5 ticks: hits land every 3 ticks
    knockback: [0.3, 0.33],
    naturalRegen: true,
    fallDamage: false,
    spawn: 'random',
    protect: 2,
    bot: { weapon: 'sword', block: false, flasks: 2 },
  },
});

/** Rules for the active mode. */
export const rules = () => RULES[game.mode] || RULES.arena;
