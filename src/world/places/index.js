import { office } from './office.js?v=26';

// Every room the game can load. Each entry is a zero-argument builder returning
// { name, w, h, grid, spawn }, so rooms never share mutable state.
export const PLACES = { office };

// Door links. Stepping on `at` in `from` swaps the loaded place and drops the
// player on `arrive`. Empty until there is a second room to walk into, so the
// '+' tiles are currently decorative but walkable.
export const DOORS = [];

export function buildPlace(id) {
  const build = PLACES[id];
  if (!build) throw new Error(`unknown place "${id}"`);
  return build();
}
