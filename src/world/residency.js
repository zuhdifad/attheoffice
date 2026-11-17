import { TILE, BUFFER_W, BUFFER_H, VIEWS } from '../core/config.js?v=24';
import { loadRigNear, loadRigFar, evictRigNear } from '../art/characters.js?v=24';

// A near sheet decodes to ~18.5MB, so only the player and whoever the close view
// can reach stay resident; far sheets cost a tenth of that and all thirteen live
// for the whole visit. The bands are measured on the near window regardless of
// the stop on screen, so zooming in never waits on a decode: the load band sits
// two tiles outside the window, the evict band six, and the four tiles between
// them are the hysteresis that keeps a walk from thrashing a sheet in and out.
const LOAD = 2 * TILE;
const EVICT = 6 * TILE;

function bands(state) {
  const { ppu } = VIEWS.near;
  const w = BUFFER_W / ppu;
  const h = BUFFER_H / ppu;
  const { x, y } = state.cam;
  return {
    load: { x0: x - LOAD, y0: y - LOAD, x1: x + w + LOAD, y1: y + h + LOAD },
    evict: { x0: x - EVICT, y0: y - EVICT, x1: x + w + EVICT, y1: y + h + EVICT }
  };
}

const inside = (n, b) => n.px >= b.x0 && n.px <= b.x1 && n.py >= b.y0 && n.py <= b.y1;

export function updateResidency(state) {
  const { load, evict } = bands(state);
  for (const n of state.npcs) {
    if (inside(n, load)) loadRigNear(n.id);
    else if (!inside(n, evict)) evictRigNear(n.id);
  }
}

// Boot pulls every far sheet plus only the near sheets the opening frame can
// show, so the first picture is rig-clean without decoding the whole cast.
export function primeResidency(state) {
  const { load } = bands(state);
  return Promise.all([
    ...state.npcs.map((n) => loadRigFar(n.id)),
    ...state.npcs.filter((n) => inside(n, load)).map((n) => loadRigNear(n.id))
  ]);
}