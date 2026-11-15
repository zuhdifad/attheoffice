import { TILE, VIEW_W, VIEW_H, SCREEN_W, SCREEN_H } from '../core/config.js?v=8';
import { vignette } from '../art/backdrop.js?v=8';

// Post pass: daylight out of the north glazing, the warm lift the phone booth
// throws, then a vignette that pulls the eye to the middle of the room.
//
// The office is lit by the sky, not by tungsten, so a beam is a blue-white lift
// and a shadow is a blue-black sink. The booth is the one warm source, which is
// what makes it read as the loudest object on the floor.

const BEAM = '150,200,226';
const WARM = '242,177,52';

function visible(state, ids) {
  const { map, cam } = state;
  const x0 = Math.floor(cam.x / TILE);
  const y0 = Math.floor(cam.y / TILE);
  const out = [];
  for (let y = y0 - 2; y <= y0 + VIEW_H + 1; y++) {
    for (let x = x0 - 1; x <= x0 + VIEW_W; x++) {
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
      const id = map.get(x, y);
      if (!ids.has(id)) continue;
      out.push({ id, dx: x * TILE - cam.x, dy: y * TILE - cam.y });
    }
  }
  return out;
}

const SOURCES = new Set(['W']);

export function drawLight(g, state) {
  const src = visible(state, SOURCES);
  if (!src.length) return;

  g.save();
  g.globalCompositeOperation = 'lighter';

  for (const { id, dx, dy } of src) {
    if (id === 'j') {
      // The booth glows from inside its canopy.
      const cx = dx + TILE / 2;
      const cy = dy + TILE;
      const pool = g.createRadialGradient(cx, cy, 2, cx, cy, 46);
      pool.addColorStop(0, `rgba(${WARM},0.17)`);
      pool.addColorStop(1, `rgba(${WARM},0)`);
      g.fillStyle = pool;
      g.fillRect(cx - 46, cy - 46, 92, 92);
      continue;
    }

    const top = dy + 22;
    const foot = dy + 132;
    const shaft = g.createLinearGradient(0, top, 0, foot);
    shaft.addColorStop(0, `rgba(${BEAM},0.11)`);
    shaft.addColorStop(0.32, `rgba(${BEAM},0.05)`);
    shaft.addColorStop(1, `rgba(${BEAM},0)`);
    g.fillStyle = shaft;
    g.beginPath();
    g.moveTo(dx + 2, top);
    g.lineTo(dx + TILE - 2, top);
    g.lineTo(dx + TILE + 16, foot);
    g.lineTo(dx - 16, foot);
    g.closePath();
    g.fill();

    const cx = dx + TILE / 2;
    const cy = dy + 104;
    const pool = g.createRadialGradient(cx, cy, 2, cx, cy, 52);
    pool.addColorStop(0, `rgba(${BEAM},0.07)`);
    pool.addColorStop(1, `rgba(${BEAM},0)`);
    g.fillStyle = pool;
    g.fillRect(cx - 52, cy - 52, 104, 104);
  }

  g.restore();
}

// The day darkens as it goes: a cool morning wash, then full daylight held
// until late afternoon so the floor stays as bright as the reference, and
// only the last hours of the shift sliding amber. Cheap — one flat fill over
// the whole 480x288 buffer.
export function drawTimeOfDay(g, t) {
  if (t <= 0.02) return;
  const warm = Math.max(0, (t - 0.72) / 0.28);
  const cool = Math.max(0, 1 - t * 2.2);
  g.save();
  if (cool > 0) {
    g.fillStyle = `rgba(120,164,206,${(cool * 0.06).toFixed(3)})`;
    g.fillRect(0, 0, SCREEN_W, SCREEN_H);
  }
  if (warm > 0) {
    g.fillStyle = `rgba(226,140,60,${(warm * 0.13).toFixed(3)})`;
    g.fillRect(0, 0, SCREEN_W, SCREEN_H);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = `rgba(150,150,170,${(warm * 0.12).toFixed(3)})`;
    g.fillRect(0, 0, SCREEN_W, SCREEN_H);
  }
  g.restore();
}

export function drawGrade(g, alpha = 1) {
  // Daylight, not tungsten: the floor stays bright, warm and saturated like the
  // reference. One very light warm multiply seats the props without grey-ing
  // the beige, and the vignette is kept gentle so the room reads open.
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = 'rgba(255,238,208,1)';
  g.globalAlpha = 0.14;
  g.fillRect(0, 0, SCREEN_W, SCREEN_H);
  g.restore();
  vignette(g, alpha * 0.55);
}