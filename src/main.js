import { FRAME_MS } from './core/config.js?v=9';
import { state, resetDay } from './core/state.js?v=9';
import { g, screen, applyZoom, bindResize, present } from './core/display.js?v=9';
import { setInputEnabled, setPadDirection, setPadWork, tapConfirm, tapBack } from './core/input.js?v=9';
import { setMuted, sfx, setAmbience } from './core/audio.js?v=9';
import { CHARACTERS, PAL } from './art/palette.js?v=9';
import { loadRoster } from './art/characters.js?v=9';
import { loadAtlas } from './art/tiles.js?v=9';
import { buildPlace } from './world/places/index.js?v=9';
import { createMap } from './world/map.js?v=9';
import { buildNpcs } from './entities/npc.js?v=9';
import { createPlayer } from './entities/player.js?v=9';
import { centerCamera } from './world/camera.js?v=9';
import { resetFx, sparkle } from './world/fx.js?v=9';
import * as wall from './ui/wallclock.js?v=9';
import * as clockin from './screens/clockin.js?v=9';
import * as select from './screens/select.js?v=12';
import * as world from './screens/world.js?v=9';

// The router. Only one screen is canvas-drawn; the start screen, the badge
// questions and the picker are DOM and keep their own markup.
const SCREENS = { world };

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

  // The visit starts now, in the device's own time. There is no shift to
  // simulate: the header clock and the 18:00 question both read the same Date.
  state.clockedInAt = wall.now();
  state.phase = 'play';

  resetFx();
  world.reset();
  centerCamera(state);
}

function boot(who) {
  resetDay();
  buildDay(who);

  document.getElementById('gameArea').style.display = 'block';
  document.body.classList.add('in-game');

  state.mode = 'world';
  state.running = true;
  // The room is pinned at 2x on every visit; there is no zoom control left.
  state.zoom = 2;
  applyZoom(state);

  // A fresh clock-in re-arms the evening question and clears any old receipt.
  wall.markClockedIn();
  clockOutBtn.hidden = true;
  clockOutModal.hidden = true;

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

// ---- clocking out -------------------------------------------------------------

const clockOutBtn = document.getElementById('clockOutBtn');
const clockOutModal = document.getElementById('clockOutModal');
const clockOutTime = document.getElementById('clockOutTime');
const clockOutYes = document.getElementById('clockOutYes');
const clockOutNo = document.getElementById('clockOutNo');

// The question the floor asks after 18:00, once per clock-in. The player is
// rooted while it is up; the room keeps breathing behind the scrim.
function askClockOut() {
  if (!state.running || state.clockedOut || state.phase !== 'play') return;
  state.askingClockOut = true;
  clockOutTime.textContent = wall.fmtHM(wall.now());
  clockOutModal.hidden = false;
  sfx.arrive();
  requestAnimationFrame(() => clockOutYes.focus());
}

function dismissClockOut() {
  state.askingClockOut = false;
  clockOutModal.hidden = true;
  // Declining keeps the offer on the table: the header button stays lit for
  // the rest of the evening.
  clockOutBtn.hidden = false;
  sfx.back();
}

function clockOut() {
  if (state.clockedOut) return;
  state.clockedOut = true;
  state.askingClockOut = false;
  state.phase = 'done';
  state.result = {
    inAt: state.clockedInAt,
    outAt: wall.now(),
    steps: state.player.steps,
    talks: state.talks.size,
    total: state.npcs.length
  };
  clockOutModal.hidden = true;
  clockOutBtn.hidden = true;
  wall.markClockedOut();
  sfx.clockOut();
  sparkle(state.player.tx, state.player.ty, PAL.amber);
}

function bindClockOut() {
  clockOutYes.addEventListener('click', clockOut);
  clockOutNo.addEventListener('click', dismissClockOut);
  clockOutBtn.addEventListener('click', askClockOut);
  window.addEventListener('keydown', (e) => {
    if (clockOutModal.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); dismissClockOut(); }
    else if (e.key === 'Enter') { e.preventDefault(); clockOut(); }
  });
}

// ---- pause -------------------------------------------------------------------
// Esc is the pause: the room freezes, the ambience drops, and the details panel
// takes the picture. Input is dropped while it is up so no key stays held down
// behind the card.

function togglePause() {
  if (state.phase !== 'play') return;
  state.paused = !state.paused;
  setInputEnabled(!state.paused);
  setAmbience(state.paused ? 0.03 : 0.10);
  sfx.ui();
}

// ---- loop -------------------------------------------------------------------
let last = 0;
let acc = 0;
let looping = false;

function frame(now) {
  if (!state.running) { looping = false; return; }
  // Speed scales the whole simulation, animations included, so 1.5x really is
  // a faster walk rather than a faster clock over a normal one.
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
  requestAnimationFrame(frame);
}

// ---- chrome -----------------------------------------------------------------

function bindChrome() {
  // The title screen carries nothing but the name and the start prompt, so the
  // only chrome to wire here is the sound control and the shortcuts that work
  // before the visit begins.
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
    // Esc is the pause. The clock-out question owns Esc while it is up.
    if (k === 'escape') {
      if (!clockOutModal.hidden) return;
      togglePause();
    }
    else if (k === 'r' && state.phase === 'done') restart();
    else if (k === 'c' && state.phase === 'done') changeWorker();
    else if (k === 'm') mute.click();
  });

  // Touch pad. Pointer events cover mouse, pen and finger with one path. The A
  // pad talks and advances; the B pad backs out of a conversation.
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

  const back = document.getElementById('touchBack');
  back.addEventListener('pointerdown', (e) => { e.preventDefault(); tapBack(); back.classList.add('is-down'); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
    back.addEventListener(ev, () => back.classList.remove('is-down'));
  }

  // A click or tap on the room itself talks to a colleague beside you, or
  // advances an open conversation — the same as Z / Space / Enter, so a mouse
  // or a finger never needs the keyboard.
  screen.addEventListener('pointerdown', (e) => { e.preventDefault(); tapConfirm(); });
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
  bindClockOut();
  wall.bind({ onAfterHours: askClockOut });

  clockin.bind({
    onStartToWork: ({ name, floor, seat, role, partner }) => {
      state.playerName = name;
      state.floor = floor;
      state.seat = seat;
      state.role = role;
      state.partner = partner;
      select.open();
    }
  });
  select.bind({ onConfirm: (who) => boot(who) });

  // A read-only handle for QA: the live snapshot, so a test can assert where
  // the player and the crowd actually are without guessing from pixels.
  window.__office = { state, wall };
}

main();