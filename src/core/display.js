import { SCREEN_W, SCREEN_H } from './config.js?v=9';

export const screen = document.getElementById('gameCanvas');
export const sctx = screen.getContext('2d');

// Everything is drawn into a true 480x288 buffer, then blitted up by a whole
// number. Scaling the canvas itself instead would give half-pixels.
export const buf = document.createElement('canvas');
buf.width = SCREEN_W;
buf.height = SCREEN_H;
export const g = buf.getContext('2d');
g.imageSmoothingEnabled = false;

// The backing store stays fixed; only the CSS size changes.
screen.width = SCREEN_W;
screen.height = SCREEN_H;
sctx.imageSmoothingEnabled = false;

// The room is pinned at 2x: there is no zoom control and every visit opens on
// the same framed picture. A small screen scales the whole buffer down by one
// common factor, so the room is letterboxed rather than cropped.
export function applyZoom(state) {
  const stage = document.getElementById('stage');
  let w = SCREEN_W * state.zoom;
  let h = SCREEN_H * state.zoom;
  if (stage) {
    const availW = Math.max(120, stage.clientWidth - 24);
    const availH = Math.max(80, stage.clientHeight - 24);
    const k = Math.min(1, availW / w, availH / h);
    w *= k;
    h *= k;
  }
  screen.style.width = `${Math.round(w)}px`;
  screen.style.height = `${Math.round(h)}px`;
}

export function bindResize(state) {
  const refit = () => {
    if (!state.running) return;
    applyZoom(state);
  };
  window.addEventListener('resize', refit);
  window.addEventListener('orientationchange', refit);
  return refit;
}

export function present() {
  sctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
  sctx.drawImage(buf, 0, 0);
}
