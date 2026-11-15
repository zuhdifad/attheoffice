import { FRAME_MS, DIFFICULTY } from './core/config.js';
import { state, resetDay } from './core/state.js';
import { g, fitZoom, applyZoom, setZoom, zoomBy, bindResize, present } from './core/display.js';
import { setInputEnabled, setPadDirection, setPadWork, tapSync } from './core/input.js';
import { setMuted, sfx, setAmbience } from './core/audio.js';
import { CHARACTERS } from './art/palette.js';
import { loadRoster } from './art/characters.js';
import { loadAtlas } from './art/tiles.js';
import { buildPlace } from './world/places/index.js';
import { createMap } from './world/map.js';
import { buildNpcs } from './entities/npc.js';
import { createPlayer } from './entities/player.js';
import { centerCamera } from './world/camera.js';
import { resetFx } from './world/fx.js';
import { startDay, resetWarnings } from './game/day.js';
import * as rail from './ui/rail.js';
import * as clockin from './screens/clockin.js';
import * as select from './screens/select.js';
import * as world from './screens/world.js';

// The router. Only one screen is canvas-drawn; the start screen, the clock-in
// receipt and the picker are DOM and keep their own markup.
const SCREENS = { world };

let mounted = false;

function render() {
  if (!state.running) return;
  SCREENS[state.mode].draw(g, state);
  present();
}

// ---- boot -------------------------------------------------------------------

function buildDay(who) {
  const place = buildPlace('office');
  const crowd = buildNpcs(place, CHARACTERS, who);

  state.place = place;
  state.map = createMap(place.grid);
  state.occupied = crowd.occupied;
  state.keepClear = crowd.keepClear;
  state.npcs = crowd.list;
  state.chosen = who;
  state.player = createPlayer(place.spawn.x, place.spawn.y, who);

  // Standing people block the tile they occupy, so the map the player walks on
  // is the tile map plus whoever is in the way. Seats are already solid.
  state.walkable = (x, y) => state.map.walkable(x, y) && !state.occupied.has(`${x},${y}`);

  resetFx();
  resetWarnings();
  world.reset();
  startDay(state);
  centerCamera(state);
}

function boot(who) {
  resetDay();
  buildDay(who);

  document.getElementById('gameArea').style.display = 'grid';
  document.body.classList.add('in-game');

  // The level on the header is the one the player picked on the way in, so the
  // room they walk into matches the badge they filled out.
  const sub = document.querySelector('.game-sub');
  if (sub && state.floor) sub.textContent = `A workday · ${state.floor}`;

  state.mode = 'world';
  state.running = true;
  state.zoomManual = false;
  state.zoom = fitZoom();
  applyZoom(state);

  if (!mounted) {
    rail.mount(state, handlers);
    mounted = true;
  } else {
    rail.rebuild(state);
  }
  rail.refresh(state);

  setAmbience(0.10);
  setInputEnabled(true);
  last = performance.now();
  acc = 0;
  if (!looping) {
    looping = true;
    requestAnimationFrame(frame);
  }
}

function restart() {
  sfx.ui();
  boot(state.chosen);
}

function changeWorker() {
  sfx.back();
  state.running = false;
  looping = false;
  setInputEnabled(false);
  document.getElementById('gameArea').style.display = 'none';
  document.body.classList.remove('in-game');
  setAmbience(0.04);
  select.open();
}

// ---- options ----------------------------------------------------------------

const handlers = {
  difficulty(key) {
    if (!DIFFICULTY[key]) return;
    state.difficulty = key;
    select.syncDifficulty(key);
    sfx.ui();
    // Changing pressure mid-shift restarts the shift, which is the only honest
    // way to apply a different day length.
    restart();
  },
  speed(v) {
    state.speed = v;
    sfx.ui();
  },
  zoom(v) {
    setZoom(state, v);
    rail.refresh(state);
  },
  zoomStep(d) {
    zoomBy(state, d);
    sfx.ui();
    rail.refresh(state);
  },
  hints(on) {
    state.hints = on;
    sfx.ui();
  },
  grid(on) {
    state.grid = on;
    sfx.ui();
  },
  pause() {
    state.paused = !state.paused;
    setAmbience(state.paused ? 0.03 : 0.10);
    sfx.ui();
    rail.refresh(state);
  },
  restart,
  swap: changeWorker
};

// ---- loop -------------------------------------------------------------------
let last = 0;
let acc = 0;
let looping = false;
let railClock = 0;

function frame(now) {
  if (!state.running) { looping = false; return; }
  // Speed scales the whole simulation, animations included, so 1.5x really is
  // a faster day rather than a faster clock over a normal one.
  acc += (now - last) * state.speed;
  last = now;
  if (acc > 400) acc = 400;

  let guard = 0;
  while (acc >= FRAME_MS && guard < 6) {
    SCREENS[state.mode].update(state);
    acc -= FRAME_MS;
    guard++;
  }

  render();

  // The rail is DOM; ten updates a second is plenty and keeps layout off the
  // frame budget.
  if (++railClock % 6 === 0) rail.refresh(state);

  requestAnimationFrame(frame);
}

// ---- chrome -----------------------------------------------------------------

function bindChrome() {
  // The title screen carries nothing but the name and the start prompt, so the
  // only chrome to wire here is the sound control and the shortcuts that work
  // before the shift begins.
  const mute = document.getElementById('muteBtn');
  const sync = () => {
    mute.classList.toggle('is-muted', state.muted);
    mute.setAttribute('aria-pressed', String(state.muted));
    mute.querySelector('.mute-label').textContent = state.muted ? 'Sound off' : 'Sound on';
    mute.querySelector('.mute-icon').textContent = state.muted ? '🔇' : '🔊';
  };
  mute.addEventListener('click', () => {
    state.muted = setMuted(!state.muted);
    sync();
    if (!state.muted) sfx.ui();
  });
  sync();

  window.addEventListener('keydown', (e) => {
    if (!state.running) return;
    const k = e.key.toLowerCase();
    if (k === '+' || k === '=') { zoomBy(state, 1); rail.refresh(state); }
    else if (k === '-' || k === '_') { zoomBy(state, -1); rail.refresh(state); }
    else if (k === 'p') handlers.pause();
    else if (k === 'r' && state.phase === 'done') restart();
    else if (k === 'c' && state.phase === 'done') changeWorker();
    else if (k === 'm') mute.click();
  });

  // Touch pad. Pointer events cover mouse, pen and finger with one path.
  for (const btn of document.querySelectorAll('#touchPad [data-dir]')) {
    const dir = btn.dataset.dir;
    const on = (e) => { e.preventDefault(); setPadDirection(dir); btn.classList.add('is-down'); };
    const off = () => { setPadDirection(null); btn.classList.remove('is-down'); };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointerleave', off);
    btn.addEventListener('pointercancel', off);
  }
  const work = document.getElementById('touchWork');
  work.addEventListener('pointerdown', (e) => { e.preventDefault(); setPadWork(true); work.classList.add('is-down'); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
    work.addEventListener(ev, () => { setPadWork(false); work.classList.remove('is-down'); });
  }
  const syncBtn = document.getElementById('touchSync');
  syncBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); tapSync(); });
}

// ---- entry ------------------------------------------------------------------

async function main() {
  const status = document.getElementById('loadStatus');
  try {
    await Promise.all([loadAtlas(), loadRoster()]);
    status.textContent = '';
    document.body.classList.add('ready');
  } catch (err) {
    status.textContent = 'Art failed to load. Serve this folder over http:// and reload.';
    status.classList.add('is-error');
    console.error(err);
    return;
  }

  bindResize(state);
  bindChrome();

  clockin.bind({
    onStartToWork: ({ name, floor }) => {
      state.playerName = name;
      state.floor = floor;
      select.open();
    }
  });
  select.bind({
    onConfirm: (who) => boot(who),
    onDifficulty: (key) => { state.difficulty = key; },
    difficulty: state.difficulty
  });
}

main();