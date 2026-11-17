import { BUFFER_W, BUFFER_H } from './config.js?v=24';

export const screen = document.getElementById('gameCanvas');
// The picture is always a full-buffer opaque blit, so the screen needs no
// alpha channel: the compositor uploads it without per-pixel blending.
export const sctx = screen.getContext('2d', { alpha: false });

// Everything is drawn into one true 1280x720 buffer and blitted 1:1, so a frame
// costs what the pixel budget says whatever size the window is. Scaling the
// canvas itself instead would put the world and the type on half-pixels.
export const buf = document.createElement('canvas');
buf.width = BUFFER_W;
buf.height = BUFFER_H;
export const g = buf.getContext('2d');
g.imageSmoothingEnabled = false;

// The picture is 1:1 with the buffer; the backing store is never resized.
screen.width = BUFFER_W;
screen.height = BUFFER_H;
sctx.imageSmoothingEnabled = false;

// Fitting the picture to the stage is now purely a CSS job: the room is
// letterboxed inside #stage rather than cropped, and the buffer behind it stays
// 1280x720 on a phone exactly as it does on a desktop.
export function applyZoom(state) {
  const stage = document.getElementById('stage');
  let w = BUFFER_W;
  let h = BUFFER_H;
  if (stage) {
    const availW = Math.max(120, stage.clientWidth - 24);
    const availH = Math.max(80, stage.clientHeight - 24);
    const k = Math.min(1, availW / w, availH / h);
    w *= k;
    h *= k;
  }
  screen.style.width = `${Math.round(w)}px`;
  screen.style.height = `${Math.round(h)}px`;
  // At or above 1:1 the device is stretching the picture anyway, so the pixel
  // edges stay hard; below it the browser's own filter beats dropping rows of
  // a 1280px buffer onto a phone.
  screen.style.imageRendering = w >= BUFFER_W ? 'pixelated' : 'auto';
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
  // Opaque full-frame blit: nothing survives under it, so no clear is needed.
  sctx.drawImage(buf, 0, 0);
}
