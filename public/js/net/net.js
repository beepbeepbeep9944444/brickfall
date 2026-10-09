// Online-play switch shared by gameplay code. When `online` is true the server decides health,
// damage and kills, so gameplay code sends claims through `send` instead of applying them itself.
// (Kept tiny and dependency-free so combat/projectile code can import it without import cycles.)
export const net = {
  online: false,
  /** Send a message to the game server (set by net/multiplayer.js while connected). */
  send: () => {},
};
