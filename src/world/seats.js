// The floor's seat registry: the one numbering every part of the game agrees
// on — the enlist map, the badge, the HUD chip and the walk to the chair. Seats
// come off the built map (a chair is a prop with a footprint and a facing),
// sorted top-to-bottom then left-to-right so the numbers read like the plan:
// 01..03 meeting north, 04..07 bank A, and so on down to 32 at the lounge.
import { buildPlace } from './places/index.js?v=26';
import { createMap } from './map.js?v=26';

let cached = null;

// The zone a seat belongs to, read off the chair itself: the same names the
// floor plan wears, so "Seat 07 · Bank A" means the same thing everywhere.
export function zoneOf(seat) {
  const k = seat.kind;
  if (k === 'stool') return 'Pantry';
  if (k === 'sofa' || k === 'armchair') return 'Lounge';
  if (k === 'chairFront' || k === 'chairFrontOlive') {
    return seat.y <= 6 ? 'Meeting' : 'Manager';
  }
  return seat.y <= 9 ? 'Bank A' : 'Bank B';
}

// Every seat on Level 22, numbered. Built once from the real place and the
// real map, so the picker's map is the floor's map — never a second drawing
// that can drift out of sync with the furniture.
export function allSeats() {
  if (cached) return cached;
  const map = createMap(buildPlace('office'));
  const seats = map.seats
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((seat, i) => {
      const num = i + 1;
      const zone = zoneOf(seat);
      return {
        num,
        seat,
        zone,
        label: `Seat ${String(num).padStart(2, '0')} · ${zone}`,
        short: String(num).padStart(2, '0')
      };
    });
  cached = { map, seats };
  return cached;
}

export function seatByNum(map, num) {
  const { seats } = allSeats();
  const hit = seats.find((s) => s.num === num);
  if (!hit) return null;
  // The live map is a different instance than the registry's own: find the
  // same chair by position so claims land on the map the sim actually walks.
  return map.seatAt(hit.seat.x, hit.seat.y);
}

export function infoFor(map, seat) {
  const { seats } = allSeats();
  return seats.find((s) => s.seat.x === seat.x && s.seat.y === seat.y) || null;
}