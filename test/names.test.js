import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateUsername } from '../server/names.js';

test('accepts ordinary names', () => {
  for (const n of ['Brawler447', 'SpicyLynx', 'class_act', 'Bass_Player', 'xX_Pro_Xx', 'Sneaky_Otter']) {
    assert.equal(validateUsername(n), null, n);
  }
});

test('rejects bad formats', () => {
  for (const n of ['ab', 'way_too_long_username', 'has space', 'émile', '', null]) {
    assert.notEqual(validateUsername(n), null, String(n));
  }
});

test('rejects reserved and offensive names, including look-alikes', () => {
  for (const n of ['admin', 'Moderator', 'Brickfall', 'sh1t_head', 'FUUUCK', 'b1tch', 'ass']) {
    assert.notEqual(validateUsername(n), null, n);
  }
});
