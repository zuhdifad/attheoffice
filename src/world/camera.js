import { TILE, FRAME_MS, BUFFER_W, BUFFER_H, VIEWS } from '../core/config.js?v=24';
import { WALL_RISE } from '../art/props.js?v=24';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// A re-frame takes 150 ms — nine simulated frames — and the art plate changes
// once, exactly halfway through it.
export const ZOOM_MS = 150;
const ZOOM_FRAMES = Math.max(2, Math.round(ZOOM_MS / FRAME_MS));

// The camera follows the player only once they have walked past this much slack,
// so a single tile step does not drag the whole room with it.
const DEAD_ZONE = TILE / 2;

const viewOf = (state) => VIEWS[state.view] || VIEWS.near;

// How much floor a stop frames, in world units: the buffer measured at that
// stop's pixels-per-unit. The camera never needs to know how big the buffer is
// in device pixels, only how many tiles fit in it.
function windowOf(state) {
  const { ppu } = viewOf(state);
  return { w: BUFFER_W / ppu, h: BUFFER_H / ppu, ppu };
}

// The middle of the player's tile: what every stop centres on.
const eye = (state) => ({
  x: state.player.px + TILE / 2,
  y: state.player.py + TILE / 2
});

// Where a stop wants the top-left of its window: centred on the player, then
// pinned inside the map so no void shows at the edges — except at the top, where
// a room is allowed the headroom its own wall takes: a wall stands 2.5 tiles on
// the tile it occupies and carries its cap above that, so the stop may go up by
// exactly the part of the wall that hangs over the first row. Any more and the
// band above the cap is bare void; any less and the wall a floor opens onto is
// born cut in half, and so is anything hung on it.
const headroom = () => WALL_RISE * TILE;

function framing(state, w, h) {
  const e = eye(state);
  return {
    x: clamp(e.x - w / 2, 0, Math.max(0, state.map.w * TILE - w)),
    y: clamp(e.y - h / 2, -headroom(), Math.max(0, state.map.h * TILE - h))
  };
}

// The camera snaps to whole device pixels, never to whole world units: at four
// pixels per unit a world-integer camera would move the room in steps of four
// and read as a stutter while you walk. It is also held inside the stop that is
// on screen on every frame, which is what makes the re-clamp at the plate swap
// free of void.
export function clampCamera(state) {
  const { w, h, ppu } = windowOf(state);
  const cam = state.cam;
  // The top stop is the one the room's own walls need: the overhang of the north
  // wall above the first row, no more, or the void above the cap would show.
  const minY = -headroom();
  const maxX = Math.max(0, state.map.w * TILE - w);
  const maxY = Math.max(minY, state.map.h * TILE - h);
  cam.x = Math.min(maxX, Math.round(clamp(cam.x, 0, maxX) * ppu) / ppu);
  cam.y = Math.min(maxY, Math.round(clamp(cam.y, minY, maxY) * ppu) / ppu);
}

// Put the camera on a stop's exact framing, with no easing and no pending
// re-frame. This is how a visit opens.
export function centerCamera(state) {
  state.zoom = null;
  const { w, h } = windowOf(state);
  const f = framing(state, w, h);
  state.cam.x = f.x;
  state.cam.y = f.y;
  clampCamera(state);
}

// Ask for a stop. The wheel, +/- and the corner button all come through here, so
// a request that is already in flight is ignored rather than restarting the ease
// and a stream of trackpad deltas cannot stack into a scale between the two.
export function setView(state, next) {
  const to = VIEWS[next] ? next : 'near';
  const want = state.zoom ? state.zoom.to : state.view;
  if (want === to) return false;
  state.zoom = { from: state.view, to, n: 0 };
  return true;
}

export function toggleView(state) {
  const want = state.zoom ? state.zoom.to : state.view;
  return setView(state, want === 'near' ? 'far' : 'near');
}

// The zoom is two stops, never a scale: the room is drawn at four or two device
// pixels per unit and the plate is swapped at the midpoint, so no sprite is ever
// resampled. What the 150 ms buys is a settled frame to pop from and a beat
// between one stop and the next.
function advanceZoom(state) {
  const z = state.zoom;
  if (!z) return;
  z.n++;
  if (z.n * 2 >= ZOOM_FRAMES && state.view !== z.to) swap(state, z.to);
  if (z.n >= ZOOM_FRAMES) state.zoom = null;
}

// Zoom about the player: their device-space offset is carried across the scale
// change, so the room swells around them instead of the picture jumping. The new
// stop is clamped and snapped before the next frame is drawn, so an edge never
// opens a gap — even if the player was standing in one.
function swap(state, to) {
  const cam = state.cam;
  const e = eye(state);
  const before = viewOf(state).ppu;
  const sx = (e.x - cam.x) * before;
  const sy = (e.y - cam.y) * before;
  state.view = to;
  const after = viewOf(state).ppu;
  cam.x = e.x - sx / after;
  cam.y = e.y - sy / after;
  clampCamera(state);
}

// The follow only pulls when the player has left the dead zone, and it pulls
// them back to its edge rather than to the middle, so walking one tile does not
// move the room a whole tile.
function follow(cam, want, dz) {
  if (want > cam + dz) return want - dz;
  if (want < cam - dz) return want + dz;
  return cam;
}

export function updateCamera(state) {
  advanceZoom(state);

  const { w, h } = windowOf(state);
  const want = framing(state, w, h);
  const cam = state.cam;
  // While a re-frame is in flight the camera settles on the stop's framing
  // instead of holding the dead zone, so the plate swaps around the player.
  const dz = state.zoom ? 0 : DEAD_ZONE;
  const tx = follow(cam.x, want.x, dz);
  const ty = follow(cam.y, want.y, dz);

  cam.x += (tx - cam.x) * 0.22;
  cam.y += (ty - cam.y) * 0.22;
  if (Math.abs(tx - cam.x) < 0.6) cam.x = tx;
  if (Math.abs(ty - cam.y) < 0.6) cam.y = ty;

  clampCamera(state);
}
