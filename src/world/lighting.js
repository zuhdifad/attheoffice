import { TILE, BUFFER_W, BUFFER_H } from '../core/config.js?v=26';
import { canvas } from '../core/draw.js?v=26';
import { vignette } from '../art/backdrop.js?v=26';

// Post pass: daylight out of the north glazing, pooled light under the lamps,
// then a vignette that pulls the eye to the middle of the room.
//
// The office is lit by the sky, not by tungsten, so a beam is a blue-white lift
// and a shadow is a blue-black sink. The sources come from the props themselves
// — a glazed wall tile is a `light` prop, a lamp carries a `lamp` tone — so the
// pass never guesses at the grid: move a window and the light moves with it.
//
// Every gradient here is baked once per LOD into a sprite and blitted 1:1 with
// `lighter`: additive light lifts the teal carpet and warms the beige without
// greying either, and a frame never creates a gradient object at all.
const BEAM = '150,200,226';

// The beam's whole box in world px, relative to the source's foot point: the
// shaft from 78 above to 132 below, the pool reaching 156 below and 36 out to
// either side. Whole world pixels, so the dest lands on whole device pixels at
// both stops without any rounding inside the frame.
const BEAM_BOX = { x: -36, y: -78, w: 104, h: 234 };
const beamCache = new Map();

function beamSprite(tilePx) {
  let c = beamCache.get(tilePx);
  if (c) return c;
  const ppu = tilePx / TILE;
  ({ c } = canvas(BEAM_BOX.w * ppu, BEAM_BOX.h * ppu));
  const x = c.getContext('2d');
  x.scale(ppu, ppu);
  x.translate(-BEAM_BOX.x, -BEAM_BOX.y);

  const shaft = x.createLinearGradient(0, -78, 0, 132);
  shaft.addColorStop(0, `rgba(${BEAM},0.11)`);
  shaft.addColorStop(0.32, `rgba(${BEAM},0.05)`);
  shaft.addColorStop(1, `rgba(${BEAM},0)`);
  x.fillStyle = shaft;
  x.beginPath();
  x.moveTo(2, -78);
  x.lineTo(TILE - 2, -78);
  x.lineTo(TILE + 16, 132);
  x.lineTo(-16, 132);
  x.closePath();
  x.fill();

  const pool = x.createRadialGradient(TILE / 2, 104, 2, TILE / 2, 104, 52);
  pool.addColorStop(0, `rgba(${BEAM},0.07)`);
  pool.addColorStop(1, `rgba(${BEAM},0)`);
  x.fillStyle = pool;
  x.fillRect(TILE / 2 - 52, 104 - 52, 104, 104);

  beamCache.set(tilePx, c);
  return c;
}

// A lamp's pool: one soft additive ellipse on the floor around its foot. Warm
// lamps lean amber-white, the ceiling panel leans cool white — both stay clear
// of grey so the teal weave and the beige slab keep their own colour under it.
const LAMP_BOX = { x: -26, y: 10, w: 84, h: 40 };
const lampCache = new Map();

function lampSprite(warm, tilePx) {
  const key = (warm ? 'w' : 'c') + tilePx;
  let c = lampCache.get(key);
  if (c) return c;
  const ppu = tilePx / TILE;
  ({ c } = canvas(LAMP_BOX.w * ppu, LAMP_BOX.h * ppu));
  const x = c.getContext('2d');
  x.scale(ppu, ppu);
  x.translate(-LAMP_BOX.x, -LAMP_BOX.y);
  x.translate(16, 30);
  x.scale(42, 20);
  const tone = warm ? '255,216,150' : '214,232,255';
  const a = warm ? 0.20 : 0.15;
  const grad = x.createRadialGradient(0, 0, 0, 0, 0, 1);
  grad.addColorStop(0, `rgba(${tone},${a})`);
  grad.addColorStop(0.55, `rgba(${tone},${(a * 0.45).toFixed(3)})`);
  grad.addColorStop(1, `rgba(${tone},0)`);
  x.fillStyle = grad;
  x.fillRect(-1, -1, 2, 2);
  lampCache.set(key, c);
  return c;
}

export function primeLights(tilePx) {
  beamSprite(tilePx);
  lampSprite(true, tilePx);
  lampSprite(false, tilePx);
}

export function drawLight(g, state) {
  const { map, cam, cols, rows } = state;
  if (!map.lights.length && !map.lamps.length) return;
  const x0 = Math.floor(cam.x / TILE);
  const y0 = Math.floor(cam.y / TILE);
  const ppu = g.getTransform().a;
  const tilePx = TILE * ppu;

  g.save();
  g.globalCompositeOperation = 'lighter';

  for (const s of map.lights) {
    if (s.x < x0 - 2 || s.x > x0 + cols + 2) continue;
    if (s.y < y0 - 6 || s.y > y0 + rows + 2) continue;
    // A source is anchored on the foot of the tile it lights from, so the beam
    // starts at the top of the wall's glazing and lands on the floor below it.
    const dx = s.x * TILE - cam.x;
    const dy = s.foot - cam.y;
    g.drawImage(beamSprite(tilePx), dx + BEAM_BOX.x, dy + BEAM_BOX.y, BEAM_BOX.w, BEAM_BOX.h);
  }

  for (const s of map.lamps) {
    if (s.x < x0 - 2 || s.x > x0 + cols + 2) continue;
    if (s.y < y0 - 2 || s.y > y0 + rows + 2) continue;
    const dx = s.x * TILE - cam.x;
    const dy = s.y * TILE - cam.y;
    g.drawImage(lampSprite(s.warm, tilePx), dx + LAMP_BOX.x, dy + LAMP_BOX.y, LAMP_BOX.w, LAMP_BOX.h);
  }

  g.restore();
}

// The day darkens as it goes: a cool morning wash, then full daylight held
// until late afternoon so the floor stays as bright as the reference, and
// only the last hours of the shift sliding amber. Cheap — one flat fill over
// the whole buffer.
export function drawTimeOfDay(g, t) {
  if (t <= 0.02) return;
  const warm = Math.max(0, (t - 0.72) / 0.28);
  const cool = Math.max(0, 1 - t * 2.2);
  g.save();
  if (cool > 0) {
    g.fillStyle = `rgba(120,164,206,${(cool * 0.06).toFixed(3)})`;
    g.fillRect(0, 0, BUFFER_W, BUFFER_H);
  }
  if (warm > 0) {
    g.fillStyle = `rgba(226,140,60,${(warm * 0.13).toFixed(3)})`;
    g.fillRect(0, 0, BUFFER_W, BUFFER_H);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = `rgba(150,150,170,${(warm * 0.12).toFixed(3)})`;
    g.fillRect(0, 0, BUFFER_W, BUFFER_H);
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
  g.fillRect(0, 0, BUFFER_W, BUFFER_H);
  g.restore();
  vignette(g, alpha * 0.55);
}