import { TILE, VIEW_W, VIEW_H } from '../core/config.js';
import { blitCell, isObject, atlasImage } from '../art/tiles.js';
import { PAL } from '../art/palette.js';
import { activeTask, dayClock, dayProgress, tasksLeft } from '../game/day.js';

const MAP_SCALE = 6;

let els = null;
let base = null;
let mapCtx = null;
let rows = [];
let lastPhase = '';

// The rail is the permanently visible control region: what to do, where you
// are, and every option that changes how the day runs. Nothing here is hidden
// behind a menu.
export function mount(state, handlers) {
  els = {
    list: document.getElementById('taskList'),
    map: document.getElementById('miniMap'),
    clock: document.getElementById('railClock'),
    dayBar: document.getElementById('railDayBar'),
    score: document.getElementById('railScore'),
    combo: document.getElementById('railCombo'),
    left: document.getElementById('railLeft'),
    difficulty: document.getElementById('optDifficulty'),
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

  els.difficulty.value = state.difficulty;
  els.speed.value = String(state.speed);
  els.hints.checked = state.hints;
  els.grid.checked = state.grid;

  els.difficulty.addEventListener('change', () => handlers.difficulty(els.difficulty.value));
  els.speed.addEventListener('change', () => handlers.speed(Number(els.speed.value)));
  els.zoom.addEventListener('input', () => handlers.zoom(Number(els.zoom.value)));
  els.zoomOut.addEventListener('click', () => handlers.zoomStep(-1));
  els.zoomIn.addEventListener('click', () => handlers.zoomStep(1));
  els.hints.addEventListener('change', () => handlers.hints(els.hints.checked));
  els.grid.addEventListener('change', () => handlers.grid(els.grid.checked));
  els.pause.addEventListener('click', () => handlers.pause());
  els.restart.addEventListener('click', () => handlers.restart());
  els.swap.addEventListener('click', () => handlers.swap());

  buildRows(state);
}

// The floor plan is the tileset itself, shrunk once. Redrawing 1064 atlas
// blits every frame would be wasteful for a picture that never changes.
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
  // Ground first, then everything that stands, so a chair sits on its carpet
  // rather than being overwritten by the next row's floor.
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

function buildRows(state) {
  els.list.textContent = '';
  rows = state.tasks.map((t) => {
    const li = document.createElement('li');
    li.className = 'task';
    const mark = document.createElement('span');
    mark.className = 'task-mark';
    const body = document.createElement('span');
    body.className = 'task-body';
    const name = document.createElement('span');
    name.className = 'task-name';
    name.textContent = t.label;
    const hint = document.createElement('span');
    hint.className = 'task-hint';
    hint.textContent = t.hint;
    body.append(name, hint);
    const pts = document.createElement('span');
    pts.className = 'task-pts';
    pts.textContent = t.points;
    li.append(mark, body, pts);
    els.list.append(li);
    return { li, mark, pts };
  });
}

export function refresh(state) {
  if (!els) return;
  if (!rows.length || rows.length !== state.tasks.length) buildRows(state);

  const active = activeTask(state);
  state.tasks.forEach((t, i) => {
    const r = rows[i];
    if (!r) return;
    const isActive = active && t.id === active.id && state.phase === 'play';
    r.li.classList.toggle('is-done', t.done);
    r.li.classList.toggle('is-active', Boolean(isActive));
    r.mark.textContent = t.done ? '✓' : isActive ? '▸' : String(i + 1);
    r.pts.textContent = t.done ? `+${t.points}` : t.points;
    if (isActive && state.work > 0) {
      r.li.style.setProperty('--fill', `${Math.round((state.work / t.need) * 100)}%`);
    } else {
      r.li.style.setProperty('--fill', t.done ? '100%' : '0%');
    }
  });

  els.clock.textContent = dayClock(state);
  els.dayBar.style.width = `${(dayProgress(state) * 100).toFixed(1)}%`;
  els.dayBar.classList.toggle('is-late', dayProgress(state) > 0.8);
  els.score.textContent = String(state.score);
  els.combo.textContent = state.combo > 1 ? `×${state.combo}` : '—';
  els.left.textContent = `${state.tasks.length - tasksLeft(state)}/${state.tasks.length}`;
  els.zoom.value = String(state.zoom);
  els.zoomVal.textContent = `${state.zoom}×`;
  els.pause.textContent = state.paused ? 'Resume' : 'Pause';
  els.pause.classList.toggle('is-on', state.paused);
  els.hints.checked = state.hints;
  els.grid.checked = state.grid;
  els.difficulty.value = state.difficulty;
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

  // Stations, then the camera window, then you.
  const active = activeTask(state);
  const pulse = (Math.sin(state.tick * 0.09) + 1) / 2;
  for (const t of state.tasks) {
    const x = t.x * MAP_SCALE + MAP_SCALE / 2;
    const y = t.y * MAP_SCALE + MAP_SCALE / 2;
    const isActive = active && t.id === active.id;
    g.fillStyle = t.done ? PAL.ok : isActive ? PAL.amber : 'rgba(200,215,225,0.45)';
    const s = isActive ? 3 + pulse * 2 : 3;
    g.fillRect(x - s / 2, y - s / 2, s, s);
    if (isActive) {
      g.strokeStyle = `rgba(242,177,52,${0.25 + pulse * 0.4})`;
      g.lineWidth = 1;
      g.strokeRect(x - 5.5, y - 5.5, 11, 11);
    }
  }

  g.strokeStyle = 'rgba(220,235,245,0.30)';
  g.lineWidth = 1;
  g.strokeRect(
    (state.cam.x / TILE) * MAP_SCALE + 0.5,
    (state.cam.y / TILE) * MAP_SCALE + 0.5,
    VIEW_W * MAP_SCALE,
    VIEW_H * MAP_SCALE
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
  buildRows(state);
  lastPhase = '';
  refresh(state);
}