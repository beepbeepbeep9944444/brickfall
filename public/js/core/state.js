// Shared mutable runtime state. Modules import these objects and change their fields
// (ES module bindings can't be reassigned from outside, so state lives on objects).

/** Global game state. `state` is 'menu' or 'playing'; `time` advances 0.05s per game tick. */
export const game = {
  state: 'menu',
  time: 0,
  mode: 'arena',
  /** Hotbar item ids for the current mode's kit (set when a mode loads). */
  hotbar: ['sword', 'rod', 'bow', 'flask', 'blocks', 'arrows'],
  /** Camera: 0 = first person, 1 = third person (behind), 2 = third person (front). Toggled with F5. */
  view: 0,
};

/** Live input state, written by core/input.js and read by the player controller each tick. */
export const input = {
  keys: {},
  lmb: false,
  rmb: false,
  clicks: 0, // left clicks not yet processed by a tick
  rmbEdge: false, // right button pressed since the last tick
  locked: false, // pointer lock active
  sprintToggled: false,
  dtSprint: false, // sprinting started by double-tapping W
  chatOpen: false, // typing in chat (the pointer is released, but the game isn't paused)
  touchSprint: false, // touch joystick pushed to the edge
};
