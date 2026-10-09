// Tiny publish/subscribe bus. Game logic emits events; UI, audio and rendering react to them,
// so gameplay modules never need to import the interface.
//
// Events used:
//   hurt        { victim, attacker, amount, dir }
//   kill        { killer, victim, kind, reward, endedStreak }
//   swing       {}                       player started a swing
//   slot        { index }                player changed hotbar slot
//   respawn     {}                       player respawned
//   gameStart / gameEnd
//   account     { user, stats }          signed-in state changed
//   lockChange  { locked }               pointer lock gained / lost

const handlers = new Map();

export const events = {
  on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(fn);
    return () => handlers.get(type).delete(fn);
  },
  emit(type, payload = {}) {
    const set = handlers.get(type);
    if (set) for (const fn of set) fn(payload);
  },
};
