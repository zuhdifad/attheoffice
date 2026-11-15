import { TILE, VIEW_W, VIEW_PX_H } from '../core/config.js?v=8';
import { blitCell, isObject, atlasImage } from '../art/tiles.js?v=8';
import { PAL } from '../art/palette.js?v=8';

const MAP_SCALE = 6;

let els = null;
let base = null;
let mapCtx = null;
let lastPhase = '';

// The rail is the permanently visible control region: where you are on the
// floor, and every option that changes how the walk runs. Nothing here is
// hidden behind a menu, and nothing here is a mission.
export function mount(state, handlers) {
  els = {
    map: document.getElementById('miniMap'),
    speed: document.getElementById('optSpeed'),
    zoom: document.getElementById('optZoom'),
    zoomOut: document.getElementById('zoomOut'),
    zoomIn: document.getElementById('zoomIn'),
    zoomVal: document.getElementById('zoomVal'),
    hints: document.getElementById('optHints'),
    grid: document.getElementById('optGrid'),
    pause: document.getElementById('optPause'),
    restart: document.getElementById('optRestart'),
    swap: document.getElementById('optSwap')
  };

  mapCtx = els.map.getContext('2d');
  buildBase(state);

  els.speed.value = String(state.speed);
  els.hints.checked = state.hints;
  els.grid.checked = state.grid;

  els.speed.addEventListener('change', () => handlers.speed(Number(els.speed.value)));
  els.zoom.addEventListener('input', () => handlers.zoom(Number(els.zoom.value)));
  els.zoomOut.addEventListener('click', () => handlers.zoomStep(-1));
  els.zoomIn.addEventListener('click', () => handlers.zoomStep(1));
  els.hints.addEventListener('change', () => handlers.hints(els.hints.checked));
  els.grid.addEventListener('change', () => handlers.grid(els.grid.checked));
  els.pause.addEventListener('click', () => handlers.pause());
  els.restart.addEventListener('click', () => handlers.restart());
  els.swap.addEventListener('click', () => handlers.swap());
}

// The floor plan is the tileset itself, shrunk once. Redrawing every atlas
// blit each frame would be wasteful for a picture that never changes.
function buildBase(state) {
  const { place } = state;
  const atlas = atlasImage();
  base = document.createElement('canvas');
  base.width = place.w * MAP_SCALE;
  base.height = place.h * MAP_SCALE;
  const b = base.getContext('2d');
  b.fillStyle = PAL.night;
  b.fillRect(0, 0, base.width, base.height);
  if (!atlas) return;

  b.imageSmoothingEnabled = true;
  // Ground first, then everything that stands, so a chair sits on its floor
  // rather than being overwritten by the next row's tiles.
  for (let y = 0; y < place.h; y++) {
    for (let x = 0; x < place.w; x++) {
      blitCell(b, atlas, state.map.floorAt(x, y), x * MAP_SCALE, y * MAP_SCALE, MAP_SCALE);
    }
  }
  for (let y = 0; y < place.h; y++) {
    for (let x = 0; x < place.w; x++) {
      const id = place.grid[y][x];
      if (!isObject(id)) continue;
      blitCell(b, atlas, id, x * MAP_SCALE, y * MAP_SCALE, MAP_SCALE);
    }
  }
  b.imageSmoothingEnabled = false;

  els.map.width = base.width;
  els.map.height = base.height;
}

export function refresh(state) {
  if (!els) return;
  els.zoom.value = String(state.zoom);
  els.zoomVal.textContent = `${state.zoom}×`;
  els.pause.textContent = state.paused ? 'Resume' : 'Pause';
  els.pause.classList.toggle('is-on', state.paused);
  els.hints.checked = state.hints;
  els.grid.checked = state.grid;
  els.speed.value = String(state.speed);

  if (lastPhase !== state.phase) {
    lastPhase = state.phase;
    document.getElementById('gameArea').dataset.phase = state.phase;
  }

  drawMap(state);
}

function drawMap(state) {
  if (!base || !mapCtx) return;
  const g = mapCtx;
  g.clearRect(0, 0, els.map.width, els.map.height);
  g.drawImage(base, 0, 0);
  g.fillStyle = 'rgba(10,13,20,0.34)';
  g.fillRect(0, 0, els.map.width, els.map.height);

  // The crowd, then the camera window, then you.
  for (const n of state.npcs) {
    g.fillStyle = n.tint;
    g.globalAlpha = n.seated ? 0.55 : 0.85;
    g.fillRect(n.tx * MAP_SCALE + 1.5, n.ty * MAP_SCALE + 1.5, 3, 3);
  }
  g.globalAlpha = 1;

  g.strokeStyle = 'rgba(220,235,245,0.30)';
  g.lineWidth = 1;
  g.strokeRect(
    (state.cam.x / TILE) * MAP_SCALE + 0.5,
    (state.cam.y / TILE) * MAP_SCALE + 0.5,
    VIEW_W * MAP_SCALE,
    (VIEW_PX_H / TILE) * MAP_SCALE
  );

  const px = (state.player.px / TILE) * MAP_SCALE + MAP_SCALE / 2;
  const py = (state.player.py / TILE) * MAP_SCALE + MAP_SCALE / 2;
  g.fillStyle = state.chosen.tint;
  g.beginPath();
  g.arc(px, py, 3.4, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(10,13,20,0.85)';
  g.lineWidth = 1;
  g.stroke();
}

export function rebuild(state) {
  buildBase(state);
  lastPhase = '';
  refresh(state);
}