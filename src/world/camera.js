import { TILE, SCREEN_W, VIEW_PX_H } from '../core/config.js?v=9';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Where the camera wants to be: centred on the player, then pinned inside the
// map so no void shows at the edges. The vertical slice is the foreshortened
// world height, not the buffer height, because the world pass is scaled in Y.
function target(state) {
  const p = state.player;
  return {
    x: clamp(p.px + TILE / 2 - SCREEN_W / 2, 0, state.map.w * TILE - SCREEN_W),
    y: clamp(p.py + TILE / 2 - VIEW_PX_H / 2, 0, state.map.h * TILE - VIEW_PX_H)
  };
}

export function centerCamera(state) {
  const t = target(state);
  state.cam.x = t.x;
  state.cam.y = t.y;
}

export function updateCamera(state) {
  const t = target(state);
  const cam = state.cam;
  cam.x += (t.x - cam.x) * 0.22;
  cam.y += (t.y - cam.y) * 0.22;
  if (Math.abs(t.x - cam.x) < 0.6) cam.x = t.x;
  if (Math.abs(t.y - cam.y) < 0.6) cam.y = t.y;
  // Integer camera or the tiles shimmer as it drifts across pixel boundaries.
  cam.x = Math.round(cam.x);
  cam.y = Math.round(cam.y);
}
