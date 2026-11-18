import { TILE } from '../core/config.js?v=26';
import { propFor } from '../art/props.js?v=26';

// The tile a sitter boards from, per facing: behind the chair, so stepping
// onto the seat is one tile forward into the facing the prop owns.
const SEAT_BACK = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] };

// Size comes from the place, never from a module constant. That is what lets a
// kitchen be 18x12 while the office stays 30x28.
//
// A place is ground plus props. The ground grid names the slab under every tile
// — including under the furniture, so a desk never stands on a hole — and each
// prop is one instance with a footprint. Collision is derived from those
// footprints and nothing else, which is the rule the whole renderer hangs on:
// if the art is 3 tiles wide, the floor is solid 3 tiles wide, and one tile of
// art can no longer pretend to be six tiles of collision.
export function createMap(place) {
  const w = place.w;
  const h = place.h;
  const floor = place.grid.map((row) => row.slice());
  // The accent inlay: one colour per zone, laid as a transition strip wherever
  // two zones meet. Optional, so a place without zoning still builds.
  const accents = place.accents ? place.accents.map((row) => row.slice()) : null;
  const solid = Array.from({ length: h }, () => new Array(w).fill(false));
  const props = [];
  const seats = [];
  const lights = [];
  const lamps = [];
  const passages = [];
  const doors = [];

  for (const p of place.props || []) {
    const def = propFor(p.kind);
    if (!def) throw new Error(`unknown prop "${p.kind}"`);
    const at = {
      kind: p.kind, def, x: p.x, y: p.y, face: p.face || null, foot: (p.y + def.h) * TILE,
      // A machine prop carries its own state, ticked by world/machines.js and
      // read by its paint layers: the brew cycle, the paper feed, the booth door.
      anim: def.machine ? { state: 'idle', phase: 'idle', open: 0, paper: 0, fill: 0, t: 0 } : null
    };
    props.push(at);

    for (let j = 0; j < def.h; j++) {
      for (let i = 0; i < def.w; i++) {
        const x = p.x + i;
        const y = p.y + j;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if (def.solid) solid[y][x] = true;
        if (def.door) passages.push({ x, y });
      }
    }

    if (def.seat) {
      // A seat is owned, not just occupied floor: the prop reports who is in
      // it, the pivot a sitter snaps to, and the one walkable tile they board
      // from — behind the sitter, opposite the way the chair faces. The dir
      // is the facing the chair belongs to: a desk chair faces its desk.
      const dir = p.face || def.seat;
      const back = SEAT_BACK[dir] || SEAT_BACK.up;
      seats.push({
        x: p.x, y: p.y, dir, kind: p.kind, prop: at,
        occupiedBy: null,
        pivot: { x: (p.x + 0.5) * TILE, y: (p.y + 0.5) * TILE },
        approach: { x: p.x + back[0], y: p.y + back[1] }
      });
    }
    if (def.machine === 'door') doors.push(at);
    if (def.light) lights.push({ x: p.x, y: p.y, foot: at.foot });
    // A lamp is a pooled source, not a daylight shaft: its own list, so the
    // light pass can lay a warm or cool pool around the foot of the prop.
    if (def.lamp) lamps.push({ x: p.x, y: p.y, warm: def.lamp === 'warm' });
  }

  // Sorted by foot so a walk over the prop list is already painter's order for
  // the halves the y-sort cannot interleave; the view re-sorts its own entries.
  props.sort((a, b) => a.foot - b.foot);

  // Where every cap-bearing prop stands. A cap is the top slab of a wall, so only
  // the module at the back of a run may show it: a wall stacked in front of
  // another one is buried up to its own top edge, and drawing its cap too would
  // ladder the run with a dark stripe every tile instead of leaving one top ...
  // and each of those stripes runs in the pass that comes after every character.
  const roofed = new Set();
  for (const p of props) {
    if (!p.def.layers.some((l) => l.cap)) continue;
    for (let j = 0; j < p.def.h; j++) {
      for (let i = 0; i < p.def.w; i++) roofed.add((p.y + j) + ',' + (p.x + i));
    }
  }
  for (const p of props) {
    if (!p.def.layers.some((l) => l.cap)) continue;
    let buried = true;
    for (let i = 0; i < p.def.w && buried; i++) {
      for (let j = 0; j < p.def.h && buried; j++) {
        if (!roofed.has((p.y + j - 1) + ',' + (p.x + i))) buried = false;
      }
    }
    p.capped = !buried;
  }

  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  return {
    w,
    h,
    props,
    seats,
    lights,
    lamps,
    passages,
    doors,
    // Seat ownership: one claimant at a time, reported by the prop itself.
    // A claim is refused while someone else holds it; a release only clears
    // the claimant's own, so a stand-up can never evict a later sitter.
    seatAt(x, y) {
      return seats.find((s) => s.x === x && s.y === y) || null;
    },
    claimSeat(seat, id) {
      if (!seat || (seat.occupiedBy && seat.occupiedBy !== id)) return false;
      seat.occupiedBy = id;
      return true;
    },
    releaseSeat(seat, id) {
      if (seat && seat.occupiedBy === id) seat.occupiedBy = null;
    },
    solidAt(x, y) {
      return !inside(x, y) || solid[y][x];
    },
    floorAt(x, y) {
      if (!inside(x, y)) return '.';
      return floor[y][x];
    },
    accentAt(x, y) {
      if (!accents || !inside(x, y)) return null;
      return accents[y][x];
    },
    walkable(x, y) {
      return inside(x, y) && !solid[y][x];
    }
  };
}
