import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RANKS, SKINS, CAPES, displayRank, upgradePrice, levelFromXp, killXp, xpToNext, itemStatus, canEquip, sanitizeCosmetics, FOUNDER_UNTIL,
} from '../public/js/shared/cosmetics.js';

const ctx = (o = {}) => ({ owned: { skin: [], cape: [] }, staffRank: null, paidRank: null, bestStreak: 0, created: 0, ...o });
const skin = (id) => SKINS.find((s) => s.id === id);
const cape = (id) => CAPES.find((c) => c.id === id);

test('three purchasable ranks; staff overrides; upgrades cost the difference', () => {
  assert.deepEqual(RANKS.filter((r) => r.tier > 0).map((r) => r.id), ['ACE', 'HERO', 'TITAN']);
  assert.equal(displayRank(null, 'HERO').id, 'HERO');
  assert.equal(displayRank('ADMIN', 'HERO').id, 'ADMIN');
  assert.equal(displayRank('HACKER', 'WIZARD').id, 'NONE', 'unknown ranks are ignored');
  assert.equal(upgradePrice('NONE', 'HERO'), 7500);
  assert.equal(upgradePrice('ACE', 'TITAN'), 15000 - 2500);
  assert.equal(upgradePrice('TITAN', 'ACE'), 0, 'no downgrades');
});

test('levels advance with XP from kills', () => {
  assert.equal(levelFromXp(0).level, 1);
  assert.equal(levelFromXp(xpToNext(1) - 1).level, 1);
  assert.equal(levelFromXp(xpToNext(1)).level, 2);
  assert.equal(levelFromXp(xpToNext(1) + xpToNext(2)).level, 3);
  assert.equal(killXp(1), 22);
  assert.equal(killXp(50), 40, 'streak bonus is capped');
});

test('two free starter skins; the rest are bought, rank-locked or special', () => {
  assert.deepEqual(SKINS.filter((s) => !s.price && !s.rank).map((s) => s.id), ['rowan', 'ivy']);
  assert.equal(itemStatus('skin', skin('rowan'), ctx()), 'free');
  assert.equal(itemStatus('skin', skin('knight'), ctx()), 'buy');
  assert.equal(itemStatus('skin', skin('knight'), ctx({ owned: { skin: ['knight'], cape: [] } })), 'owned');
  assert.equal(itemStatus('skin', skin('guardian'), ctx({ paidRank: 'ACE' })), 'locked');
  assert.equal(itemStatus('skin', skin('guardian'), ctx({ paidRank: 'TITAN' })), 'rank', 'higher ranks include lower perks');
  assert.equal(itemStatus('cape', cape('bolt'), ctx({ bestStreak: 10 })), 'unlocked');
  assert.equal(itemStatus('cape', cape('founder'), ctx({ created: FOUNDER_UNTIL - 1 })), 'unlocked');
  assert.equal(itemStatus('cape', cape('staff'), ctx({ paidRank: 'TITAN' })), 'locked');
  assert.equal(canEquip('cape', cape('staff'), ctx({ staffRank: 'MOD' })), true);
});

test('sanitizeCosmetics never trusts input', () => {
  assert.deepEqual(sanitizeCosmetics({ skin: 'knight', cape: 'titan' }, ctx()), { skin: 'rowan', cape: 'none' });
  assert.deepEqual(sanitizeCosmetics({ skin: 'ivy', cape: 'nope' }, ctx()), { skin: 'ivy', cape: 'none' });
  assert.deepEqual(sanitizeCosmetics({ skin: { skin: '#fff' } }, ctx()), { skin: 'rowan', cape: 'none' }, 'old custom-skin saves fall back');
  assert.deepEqual(sanitizeCosmetics(null, ctx()), { skin: 'rowan', cape: 'none' });
});
