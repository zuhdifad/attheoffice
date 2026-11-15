import { SCREEN_W, SCREEN_H, ZOOM_MIN, ZOOM_MAX } from './config.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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

// Measured against the stage, not the window: the control rail owns its own
// column and the room only gets what is left.
export function fitZoom() {
  const stage = document.getElementById('stage');
  const r = stage ? stage.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
  const availW = Math.max(SCREEN_W, r.width - 20);
  const availH = Math.max(SCREEN_H, r.height - 20);
  const raw = Math.min(availW / SCREEN_W, availH / SCREEN_H);
  return clamp(Math.floor(raw), ZOOM_MIN, ZOOM_MAX);
}

// Integer zoom whenever the room fits; below 1x the whole buffer is scaled by
// one common factor so the picture is never squashed on a narrow phone.
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

export function setZoom(state, value) {
  state.zoom = clamp(Math.round(value), ZOOM_MIN, ZOOM_MAX);
  state.zoomManual = true;
  applyZoom(state);
}

export function zoomBy(state, delta) {
  setZoom(state, state.zoom + delta);
}

export function bindResize(state) {
  const refit = () => {
    if (!state.running) return;
    if (!state.zoomManual) state.zoom = fitZoom();
    // Even on a manual zoom the fit is recomputed, so rotating a phone never
    // pushes the room out of its stage.
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