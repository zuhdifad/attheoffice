import { TILE } from '../core/config.js?v=26';
import { canvas } from '../core/draw.js?v=26';
import { blitCell, atlasPages } from '../art/tiles.js?v=26';
import { PAL } from '../art/palette.js?v=26';
import { paintShadow, primeShadows, SHELL } from '../art/shadows.js?v=26';
import { primeGlazing } from '../art/props.js?v=26';
import { primeLights } from './lighting.js?v=26';

// The static ground — slab, baked joint, zone inlay and the ambient occlusion
// at the foot of every solid footprint — is laid once into 8x8-tile chunk
// canvases per LOD and blitted 1:1 thereafter. A frame pays one drawImage per
// visible chunk instead of one per tile plus a second pass for the inlay, and
// the AO gradients are created at bake time, never inside a frame.
//
// The cache hangs off the map object itself: a rebuild is a new map, so it is
// born with an empty cache and the old one is collected. invalidateGround is
// the explicit door for an in-place edit of the grid.
const CHUNK = 8;
const caches = new WeakMap();

// AO is a cool sink, not a grey one: the same blue-black the people shadows
// use, so a desk foot and a walker read under one light.
const AO = '16,20,30';
const AO_DEPTH = 9;   // world px the occlusion reaches into the open floor
const AO_ALPHA = 0.17;

function lodCache(map, tilePx) {
  let byLod = caches.get(map);
  if (!byLod) { byLod = new Map(); caches.set(map, byLod); }
  let lod = byLod.get(tilePx);
  if (!lod) {
    lod = { cols: Math.ceil(map.w / CHUNK), rows: Math.ceil(map.h / CHUNK), chunks: new Map() };
    byLod.set(tilePx, lod);
  }
  return lod;
}

// One chunk, baked at the plate's own device size so the frame blits it 1:1.
// Everything inside is authored in world units under a single ppu scale, the
// same contract the live world pass runs on.
function bakeChunk(map, page, cx, cy) {
  const ppu = page.tilePx / TILE;
  const S = CHUNK * TILE;
  const { c, ctx } = canvas(S * ppu, S * ppu);
  ctx.save();
  ctx.scale(ppu, ppu);
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;

  for (let ly = 0; ly < CHUNK; ly++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const x = x0 + lx, y = y0 + ly;
      if (x >= map.w || y >= map.h) continue;
      blitCell(ctx, page, map.floorAt(x, y), lx * TILE, ly * TILE);
    }
  }

  // The zone inlay: the brass line where two zones meet, interior edges only.
  for (let ly = 0; ly < CHUNK; ly++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const x = x0 + lx, y = y0 + ly;
      if (x >= map.w || y >= map.h) continue;
      const a = map.accentAt(x, y);
      if (!a || !PAL[a]) continue;
      const dx = lx * TILE, dy = ly * TILE;
      ctx.fillStyle = PAL[a];
      const edge = (nx, ny) => nx >= 0 && ny >= 0 && nx < map.w && ny < map.h && map.accentAt(nx, ny) !== a;
      if (edge(x, y - 1)) ctx.fillRect(dx, dy, TILE, 2);
      if (edge(x, y + 1)) ctx.fillRect(dx, dy + TILE - 2, TILE, 2);
      if (edge(x - 1, y)) ctx.fillRect(dx, dy, 2, TILE);
      if (edge(x + 1, y)) ctx.fillRect(dx + TILE - 2, dy, 2, TILE);
    }
  }

  // Ambient occlusion: every open tile that touches a solid footprint carries
  // a soft sink along the shared edge, so furniture sits into the floor rather
  // than on top of it. Gradient stops are decided here, once per chunk bake.
  for (let ly = 0; ly < CHUNK; ly++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const x = x0 + lx, y = y0 + ly;
      if (x >= map.w || y >= map.h || map.solidAt(x, y)) continue;
      const dx = lx * TILE, dy = ly * TILE;
      const sink = (gx0, gy0, gx1, gy1, rx, ry, rw, rh) => {
        const grad = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
        grad.addColorStop(0, `rgba(${AO},${AO_ALPHA})`);
        grad.addColorStop(1, `rgba(${AO},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(rx, ry, rw, rh);
      };
      if (map.solidAt(x, y - 1)) sink(dx, dy, dx, dy + AO_DEPTH, dx, dy, TILE, AO_DEPTH);
      if (map.solidAt(x, y + 1)) sink(dx, dy + TILE, dx, dy + TILE - AO_DEPTH, dx, dy + TILE - AO_DEPTH, TILE, AO_DEPTH);
      if (map.solidAt(x - 1, y)) sink(dx, dy, dx + AO_DEPTH, dy, dx, dy, AO_DEPTH, TILE);
      if (map.solidAt(x + 1, y)) sink(dx + TILE, dy, dx + TILE - AO_DEPTH, dy, dx + TILE - AO_DEPTH, dy, AO_DEPTH, TILE);
    }
  }

  // The shell's own shadow — the contact strip under every wall module and the
  // long cast a tall wall throws into the room — is static, so it bakes in here
  // with the ground instead of riding a sprite per module per frame.
  for (const p of map.props) {
    if (!SHELL.has(p.def.name)) continue;
    const px = (p.x - x0) * TILE;
    const py = (p.y - y0) * TILE;
    if (px > S || py > S || px + p.def.w * TILE + 2 * TILE < 0 || py + p.def.h * TILE + 2 * TILE < 0) continue;
    paintShadow(ctx, p.def, px, py);
  }

  ctx.restore();
  return c;
}

function chunkFor(map, page, cx, cy) {
  const lod = lodCache(map, page.tilePx);
  const key = cy * lod.cols + cx;
  let c = lod.chunks.get(key);
  if (!c) { c = bakeChunk(map, page, cx, cy); lod.chunks.set(key, c); }
  return c;
}

// The whole ground pass: one 1:1 blit per visible chunk, trimmed to the part of
// the chunk the camera actually shows — a chunk canvas is larger than the view
// at the close stop, and blitting its hidden margin would overdraw the whole
// buffer several times over. Source and dest are both on whole device pixels:
// chunk origins are whole tiles, the camera arrives snapped to the device grid,
// so no edge lands on a half pixel and no smoothing toggle is needed in-frame.
export function drawGround(g, map, page, rcam, viewW, viewH) {
  const ppu = page.tilePx / TILE;
  const S = CHUNK * TILE;
  const cx0 = Math.max(0, Math.floor(rcam.x / S));
  const cy0 = Math.max(0, Math.floor(rcam.y / S));
  const cx1 = Math.min(Math.ceil(map.w / CHUNK) - 1, Math.floor((rcam.x + viewW) / S));
  const cy1 = Math.min(Math.ceil(map.h / CHUNK) - 1, Math.floor((rcam.y + viewH) / S));
  const right = Math.min(rcam.x + viewW, map.w * TILE);
  const bottom = Math.min(rcam.y + viewH, map.h * TILE);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = chunkFor(map, page, cx, cy);
      const vx = Math.max(rcam.x, cx * S);
      const vy = Math.max(rcam.y, cy * S);
      const vw = Math.min(right, (cx + 1) * S) - vx;
      const vh = Math.min(bottom, (cy + 1) * S) - vy;
      if (vw <= 0 || vh <= 0) continue;
      const sx = Math.round((vx - cx * S) * ppu);
      const sy = Math.round((vy - cy * S) * ppu);
      const sw = Math.round(vw * ppu);
      const sh = Math.round(vh * ppu);
      const dx = Math.round((vx - rcam.x) * ppu) / ppu;
      const dy = Math.round((vy - rcam.y) * ppu) / ppu;
      g.drawImage(c, sx, sy, sw, sh, dx, dy, sw / ppu, sh / ppu);
    }
  }
}

// Drop every cached chunk of a map: the door for an in-place grid edit. A
// rebuilt map never needs it — the cache is keyed on the map object itself.
export function invalidateGround(map) {
  caches.delete(map);
}

// Bake every chunk of both LODs, every prop shadow and every light sprite up
// front, while the boot is still awaiting art. The first frame — and the first
// frame after a zoom swap — then finds everything warm, so neither pays a bake.
export function primeWorld(map) {
  for (const page of atlasPages()) {
    const lod = lodCache(map, page.tilePx);
    for (let cy = 0; cy < lod.rows; cy++) {
      for (let cx = 0; cx < lod.cols; cx++) chunkFor(map, page, cx, cy);
    }
    primeShadows(page.tilePx);
    primeLights(page.tilePx);
    primeGlazing(page.tilePx);
  }
}