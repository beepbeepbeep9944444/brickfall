// Ranks, levels, skins and capes. Shared by the browser and the server (no DOM / Three.js),
// so prices and unlock rules can't drift apart.

// ---------------------------------------------------------------- ranks
/** Purchasable ranks (bought with coins; upgrades cost the difference). */
export const RANKS = [
  { id: 'NONE', name: 'Default', tier: 0, tag: null, price: 0, coinBonus: 0 },
  { id: 'ACE', name: 'Ace', tier: 1, tag: 'ACE', price: 2500, coinBonus: 0.1 },
  { id: 'HERO', name: 'Hero', tier: 2, tag: 'HERO', price: 7500, coinBonus: 0.25 },
  { id: 'TITAN', name: 'Titan', tier: 3, tag: 'TITAN', price: 15000, coinBonus: 0.5 },
];

/** Staff ranks are granted by the server owner (npm run rank -- <name> <RANK>). */
export const STAFF_RANKS = [
  { id: 'MOD', name: 'Moderator', tier: 10, tag: 'MOD', staff: true, coinBonus: 0.5 },
  { id: 'ADMIN', name: 'Admin', tier: 11, tag: 'ADMIN', staff: true, coinBonus: 0.5 },
  { id: 'OWNER', name: 'Owner', tier: 12, tag: 'OWNER', staff: true, coinBonus: 0.5 },
];

/** Hex colors per rank (CSS mirrors these as .rank-<ID>). */
export const RANK_COLORS = {
  NONE: '#b4b8cc', ACE: '#5bd97a', HERO: '#4cc9f0', TITAN: '#ffb627', MOD: '#2fd6c2', ADMIN: '#ff6b6b', OWNER: '#ff3d3d',
};

const ALL_RANKS = [...RANKS, ...STAFF_RANKS];
export const rankById = (id) => ALL_RANKS.find((r) => r.id === id) || RANKS[0];
export const isStaffRank = (id) => STAFF_RANKS.some((r) => r.id === id);
export const isPaidRank = (id) => RANKS.some((r) => r.id === id && r.tier > 0);

/** The rank shown next to a name: staff overrides the purchased rank. */
export function displayRank(staffRank, paidRank) {
  if (staffRank && isStaffRank(staffRank)) return rankById(staffRank);
  return isPaidRank(paidRank) ? rankById(paidRank) : RANKS[0];
}

/** Coins needed to go from `currentId` to `targetId` (0 if not an upgrade). */
export function upgradePrice(currentId, targetId) {
  const cur = rankById(currentId), tgt = rankById(targetId);
  if (!isPaidRank(tgt.id) || tgt.tier <= cur.tier) return 0;
  return tgt.price - (isPaidRank(cur.id) ? cur.price : 0);
}

// ---------------------------------------------------------------- levels
/** XP needed to go from `level` to `level + 1`. */
export const xpToNext = (level) => 100 + 20 * (level - 1);

export function levelFromXp(xp) {
  let level = 1, rest = Math.max(0, Math.floor(xp || 0));
  while (rest >= xpToNext(level) && level < 999) { rest -= xpToNext(level); level++; }
  return { level, into: rest, need: xpToNext(level) };
}

/** XP for a kill: more on a streak. */
export const killXp = (streak) => 20 + 2 * Math.min(streak, 10);

/** Level color tiers (CSS: .lvl-<n>). */
export const LEVEL_TIERS = [0, 10, 20, 30, 40, 50, 75, 100];
export const LEVEL_COLORS = ['#a3a7c0', '#4cc9f0', '#5bd97a', '#ffd84a', '#ff9f1c', '#ff4d6d', '#b07cff', '#ffffff'];
export function levelTier(level) {
  let t = 0;
  LEVEL_TIERS.forEach((min, i) => { if (level >= min) t = i; });
  return t;
}

// ---------------------------------------------------------------- skins
// A skin is a fixed look. Fields feed the character builder (game/characters.js).
export const HAIR_STYLES = ['short', 'long', 'spiky', 'mohawk', 'cap', 'bald', 'hood', 'helmet', 'headband', 'crown'];
export const OUTFITS = ['tee', 'hoodie', 'stripes', 'jacket', 'armor', 'suit', 'spacesuit'];

/** Face pixel palette. Index 0 = skin color, 8 = hair color. */
export const FACE_PALETTE = [null, '#ffffff', '#1b1d2a', '#6b4426', '#e8324f', '#3f7be0', '#3ccf7a', '#ff9fc0', null, '#ffd36b'];
export const FACE_SIZE = 8;
const rows = (...r) => r.join('');
const FACES = {
  classic: rows('00000000', '00000000', '00000000', '01200210', '01200210', '00000000', '00033000', '00000000'),
  happy: rows('00000000', '00000000', '00000000', '00200200', '00200200', '03000030', '00333300', '00000000'),
  cool: rows('00000000', '00000000', '00000000', '22222222', '02200220', '00000000', '00033000', '00000000'),
  stern: rows('00000000', '00000000', '02200220', '01200210', '00000000', '00000000', '00333300', '00000000'),
  beard: rows('00000000', '00000000', '00000000', '01200210', '01200210', '80000008', '88333388', '88888888'),
  mask: rows('22222222', '22222222', '22222222', '22122122', '22222222', '22222222', '22222222', '22222222'),
  visor: rows('11111111', '15555551', '15555151', '15551551', '15555551', '11111111', '11111111', '11111111'),
  patch: rows('00000000', '00000000', '22222222', '22200210', '22200210', '00000000', '00033000', '00000000'),
  robot: rows('00000000', '00000000', '00000000', '05500550', '05500550', '00000000', '01111110', '00000000'),
  freckles: rows('00000000', '00000000', '00000000', '01200210', '01200210', '03000030', '00033000', '00000000'),
};

const skin = (o) => ({ skin: '#f1c9a5', hair: '#5a3a1e', shirt: '#ff9f1c', pants: '#2f3550', shoes: '#2b2b33', accent: '#ffb627', hairStyle: 'short', outfit: 'tee', face: FACES.classic, ...o });

/** price 0 = free starter; `rank` = free with that rank; otherwise buy with coins. */
export const SKINS = [
  { id: 'rowan', name: 'Rowan', price: 0, skin: skin({ shirt: '#ff9f1c', pants: '#2f3550' }) },
  { id: 'ivy', name: 'Ivy', price: 0, skin: skin({ skin: '#e2b08a', hair: '#2a1a10', hairStyle: 'long', shirt: '#7b5cd6', pants: '#2b2d42', shoes: '#f4f1ea', face: FACES.freckles }) },
  { id: 'ranger', name: 'Ranger', price: 750, skin: skin({ skin: '#d9a27a', hair: '#3c6b2f', hairStyle: 'hood', shirt: '#3c8a42', pants: '#4b3a2a', shoes: '#6b4426', outfit: 'hoodie', accent: '#2f6b33', face: FACES.stern }) },
  { id: 'shadow', name: 'Shadow', price: 1000, skin: skin({ skin: '#d9a27a', hair: '#141420', hairStyle: 'headband', accent: '#c21f2f', shirt: '#1b1d2a', pants: '#14151f', shoes: '#0d0d14', outfit: 'jacket', face: FACES.mask }) },
  { id: 'captain', name: 'Captain', price: 1250, skin: skin({ skin: '#c98e62', hair: '#2a1a10', hairStyle: 'headband', accent: '#c21f2f', shirt: '#f4f1ea', pants: '#2b2d42', shoes: '#3a2414', outfit: 'stripes', face: FACES.patch }) },
  { id: 'frost', name: 'Frost', price: 1500, skin: skin({ skin: '#e8f2ff', hair: '#9ad8ff', hairStyle: 'spiky', shirt: '#4cc9f0', pants: '#1e4f7a', shoes: '#f4f1ea', outfit: 'hoodie', face: FACES.cool }) },
  { id: 'knight', name: 'Knight', price: 2000, skin: skin({ hair: '#9aa0ad', hairStyle: 'helmet', shirt: '#9aa0ad', pants: '#5b6170', shoes: '#3a3f4f', outfit: 'armor', accent: '#ffb627', face: FACES.stern }) },
  { id: 'astronaut', name: 'Astronaut', price: 2500, skin: skin({ skin: '#f4f4f6', hair: '#f4f4f6', hairStyle: 'helmet', shirt: '#f4f4f6', pants: '#e2e4ea', shoes: '#9aa0ad', outfit: 'spacesuit', accent: '#ff6b2d', face: FACES.visor }) },
  { id: 'magma', name: 'Magma', price: 3000, skin: skin({ skin: '#3a1a14', hair: '#ff6b2d', hairStyle: 'mohawk', shirt: '#7a1410', pants: '#2a0d0a', shoes: '#ff9f1c', outfit: 'armor', accent: '#ff9f1c', face: FACES.stern }) },
  { id: 'agent', name: 'Agent', price: 3500, skin: skin({ skin: '#b07a52', hair: '#111111', hairStyle: 'short', shirt: '#1b1d2a', pants: '#1b1d2a', shoes: '#0d0d14', outfit: 'suit', accent: '#c21f2f', face: FACES.cool }) },
  { id: 'circuit', name: 'Circuit', price: 4000, skin: skin({ skin: '#9aa0ad', hair: '#5b6170', hairStyle: 'bald', shirt: '#4cc9f0', pants: '#3a3f4f', shoes: '#22252f', outfit: 'armor', accent: '#22e3c4', face: FACES.robot }) },
  { id: 'skypilot', name: 'Sky Pilot', rank: 'ACE', skin: skin({ hair: '#6b4426', hairStyle: 'cap', shirt: '#3ccf7a', pants: '#2f3550', shoes: '#f4f1ea', outfit: 'jacket', face: FACES.happy }) },
  { id: 'guardian', name: 'Guardian', rank: 'HERO', skin: skin({ skin: '#d9a27a', hair: '#4cc9f0', hairStyle: 'helmet', shirt: '#1e88d6', pants: '#0b3d7a', shoes: '#f4f1ea', outfit: 'armor', accent: '#9ad8ff', face: FACES.stern }) },
  { id: 'titanking', name: 'Titan King', rank: 'TITAN', skin: skin({ skin: '#e2b08a', hair: '#f4f1ea', hairStyle: 'crown', shirt: '#7a1410', pants: '#2a0d0a', shoes: '#ffb627', outfit: 'armor', accent: '#ffb627', face: FACES.beard }) },
];

export const skinById = (id) => SKINS.find((s) => s.id === id) || SKINS[0];

// ---------------------------------------------------------------- capes
/** `how`: a short line on the Wardrobe card saying how to get the cape. */
export const CAPES = [
  { id: 'none', name: 'No cape', price: 0, how: 'Go without a cape.' },
  { id: 'ember', name: 'Ember', price: 1000, how: 'Buy it with coins from kills.' },
  { id: 'ocean', name: 'Ocean', price: 1000, how: 'Buy it with coins from kills.' },
  { id: 'checker', name: 'Checkmate', price: 1500, how: 'Buy it with coins from kills.' },
  { id: 'midnight', name: 'Midnight', price: 2000, how: 'Buy it with coins from kills.' },
  { id: 'starry', name: 'Starry Night', price: 3000, how: 'Buy it with coins from kills.' },
  { id: 'rose', name: 'Royal Rose', price: 5000, how: 'The priciest cape in the shop.' },
  { id: 'bolt', name: 'Lightning', unlock: { type: 'streak', n: 10 }, how: 'Get a 10 kill streak in any mode.' },
  { id: 'ace', name: 'Ace', rank: 'ACE', how: 'Comes with the ACE rank (or higher).' },
  { id: 'hero', name: 'Hero', rank: 'HERO', how: 'Comes with the HERO rank (or higher).' },
  { id: 'titan', name: 'Titan', rank: 'TITAN', how: 'Comes with the TITAN rank.' },
  { id: 'founder', name: 'Founder', unlock: { type: 'founder' }, how: 'For accounts made before 2027.' },
  { id: 'staff', name: 'Staff', unlock: { type: 'staff' }, how: 'Only for Brickfall staff.' },
];

/** Accounts created before this date get the Founder cape. */
export const FOUNDER_UNTIL = Date.UTC(2027, 0, 1);

export const DEFAULT_COSMETICS = Object.freeze({ skin: 'rowan', cape: 'none' });

// ---------------------------------------------------------------- availability
/**
 * ctx: { owned: { skin: [ids], cape: [ids] }, staffRank, paidRank, bestStreak, created }
 * Returns 'free' | 'owned' | 'rank' (included with a rank you have) | 'unlocked' | 'buy' | 'locked'.
 */
export function itemStatus(kind, item, ctx) {
  const staff = isStaffRank(ctx.staffRank);
  const tier = displayRank(ctx.staffRank, ctx.paidRank).tier;
  if (item.rank) return staff || tier >= rankById(item.rank).tier ? 'rank' : 'locked';
  if (item.unlock) {
    if (staff) return 'unlocked';
    const u = item.unlock;
    const ok = (u.type === 'streak' && (ctx.bestStreak || 0) >= u.n) || (u.type === 'founder' && !!ctx.created && ctx.created < FOUNDER_UNTIL);
    return ok ? 'unlocked' : 'locked';
  }
  if (!item.price) return 'free';
  if (staff || (ctx.owned?.[kind] || []).includes(item.id)) return 'owned';
  return 'buy';
}

export const canEquip = (kind, item, ctx) => ['free', 'owned', 'rank', 'unlocked'].includes(itemStatus(kind, item, ctx));
export const isPurchasable = (item) => !!item.price && !item.rank && !item.unlock;

export function requirementText(item) {
  if (item.rank) return `${rankById(item.rank).name} rank`;
  if (item.unlock?.type === 'streak') return `Get a ${item.unlock.n} kill streak`;
  if (item.unlock?.type === 'founder') return 'Early players only';
  if (item.unlock?.type === 'staff') return 'Staff only';
  return '';
}

/** Validate untrusted equip choices. Unknown or unavailable items fall back to defaults. */
export function sanitizeCosmetics(input, ctx) {
  const src = input && typeof input === 'object' ? input : {};
  const s = SKINS.find((x) => x.id === src.skin);
  const c = CAPES.find((x) => x.id === src.cape);
  return {
    skin: s && canEquip('skin', s, ctx) ? s.id : DEFAULT_COSMETICS.skin,
    cape: c && canEquip('cape', c, ctx) ? c.id : DEFAULT_COSMETICS.cape,
  };
}
