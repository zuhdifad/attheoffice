import { FRAME_MS } from './core/config.js?v=24';
import { state, resetDay } from './core/state.js?v=24';
import { g, screen, buf, applyZoom, bindResize, present } from './core/display.js?v=24';
import { setInputEnabled, setPadDirection, setPadWork, tapConfirm, tapBack } from './core/input.js?v=24';
import { setMuted, sfx, setAmbience } from './core/audio.js?v=24';
import { CHARACTERS, PAL } from './art/palette.js?v=24';
import { loadRoster, loadRig } from './art/characters.js?v=24';
import { loadActorRig } from './art/rig.js?v=24';
import { loadAtlas } from './art/tiles.js?v=24';
import { buildPlace } from './world/places/index.js?v=24';
import { createMap } from './world/map.js?v=24';
import { primeWorld } from './world/ground.js?v=24';
import { doorPassable } from './world/machines.js?v=24';
import { buildNpcs } from './entities/npc.js?v=24';
import { createPlayer } from './entities/player.js?v=24';
import { centerCamera, setView, toggleView as toggleCamera } from './world/camera.js?v=24';
import { primeResidency } from './world/residency.js?v=24';
import { resetFx, sparkle } from './world/fx.js?v=24';
import * as wall from './ui/wallclock.js?v=24';
import * as clockin from './screens/clockin.js?v=24';
import * as select from './screens/select.js?v=24';
import * as world from './screens/world.js?v=24';
import * as rigScreen from './screens/rig.js?v=24';
import * as facesScreen from './screens/faces.js?v=24';

// The router. Only one screen is canvas-drawn; the start screen, the badge
// questions and the picker are DOM and keep their own markup. ?rig=1 swaps the
// world for the actor contact sheet — same loop, same buffer, no game state.
// ?faces=1 swaps it for the expression contact sheet.
const SCREENS = { world, rig: rigScreen, faces: facesScreen };

function render() {
  if (!state.running) return;
  SCREENS[state.mode].draw(g, state);
  present();
}

// ---- boot -------------------------------------------------------------------

function buildDay(who) {
  const place = buildPlace('office');
  // The map is built from the place's props, so it has to exist before the
  // crowd: seats, doorways and collision all come off the footprints.
  const map = createMap(place);
  // Bake the ground chunks, prop shadows and light sprites of both LODs while
  // the boot is still loading, so the first frame — and the first frame after
  // a zoom swap — finds every cache warm and pays no bake.
  primeWorld(map);
  const crowd = buildNpcs(place, map, CHARACTERS, who);

  state.place = place;
  state.map = map;
  state.occupied = crowd.occupied;
  state.keepClear = crowd.keepClear;
  state.npcs = crowd.list;
  state.chosen = who;
  state.player = createPlayer(place.spawn.x, place.spawn.y, who);

  // Standing people block the tile they occupy, so the map the player walks on
  // is the tile map plus whoever is in the way. Seats are already solid. A
  // doorway adds its leaf: passable only while the door machine sits open, so
  // a closed door stops a step but never rewrites the floor's own geometry.
  state.walkable = (x, y) =>
    state.map.walkable(x, y) && !state.occupied.has(`${x},${y}`) && doorPassable(state.map, x, y);

  // The visit starts now, in the device's own time. There is no shift to
  // simulate: the header clock and the 18:00 question both read the same Date.
  state.clockedInAt = wall.now();
  state.phase = 'play';

  resetFx();
  world.reset();
  centerCamera(state);
}

async function boot(who) {
  resetDay();
  // Pull the baked rig for whoever clocked in, if one exists; unbaked characters
  // keep the legacy sheet. Awaited so the first frame never pops mid-stride.
  // The layered atlas, when meta.json exists, loads beside it and takes over.
  await Promise.all([loadRig(who.id), loadActorRig(who.id)]);
  // Every visit opens on the near view, refitted to whatever stage it lands in.
  // The room is built after that, so the camera centres for the stop this visit
  // will actually draw.
  state.view = 'near';
  buildDay(who);
  // Far sheets for the whole cast, near sheets only for whoever the opening
  // frame can show; the residency manager fetches the rest as you walk to them.
  // Layered atlases are small enough to stay resident, so the whole cast is
  // probed once; ids without meta.json fall back and never retry.
  await Promise.all([
    primeResidency(state),
    ...state.npcs.map((n) => loadActorRig(n.id))
  ]);

  document.getElementById('gameArea').style.display = 'block';
  document.body.classList.add('in-game');

  state.mode = 'world';
  state.running = true;
  applyZoom(state);
  syncZoom();

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

// ---- view ---------------------------------------------------------------------
// Two framings of one room: four device pixels per world unit, and two. The
// wheel, +/- and the corner button all ask for a stop rather than a scale, so a
// frame is always drawn 1:1 and only how much floor it covers ever changes.

const zoomBtn = document.getElementById('zoomBtn');

// The pill names the stop it will take you to, so one button covers both.
function syncZoom() {
  const want = state.zoom ? state.zoom.to : state.view;
  const label = want === 'near' ? 'Zoom out' : 'Zoom in';
  zoomBtn.querySelector('.zoom-label').textContent = label;
  zoomBtn.setAttribute('aria-label', label);
  zoomBtn.setAttribute('aria-pressed', String(want === 'far'));
}

function zoomTo(next) {
  if (!state.running || !setView(state, next)) return;
  sfx.ui();
  syncZoom();
}

function toggleView() {
  if (!state.running || state.mode !== 'world' || !toggleCamera(state)) return;
  sfx.ui();
  syncZoom();
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
    if (k === 'm') { mute.click(); return; }
    // The contact sheet owns its own keys; world shortcuts would zoom a room
    // that is not there.
    if (state.mode !== 'world') return;
    // Esc is the pause. The clock-out question owns Esc while it is up.
    if (k === 'escape') {
      if (!clockOutModal.hidden) return;
      togglePause();
    }
    else if (k === 'r' && state.phase === 'done') restart();
    else if (k === 'c' && state.phase === 'done') changeWorker();
    else if (k === 'v') toggleView();
    else if (k === '+' || k === '=') zoomTo('near');
    else if (k === '-' || k === '_') zoomTo('far');
  });

  // The wheel over the room is the zoom: up pulls in, down pushes back out. It
  // only asks for a stop, so a trackpad's stream of deltas cannot crawl between
  // the two and land the picture on a scale the art was never baked for.
  document.getElementById('stage').addEventListener('wheel', (e) => {
    if (!state.running || state.mode !== 'world' || !e.deltaY) return;
    e.preventDefault();
    zoomTo(e.deltaY < 0 ? 'near' : 'far');
  }, { passive: false });

  // One button, two stops. It gives the focus back afterwards so Space keeps
  // advancing conversations instead of clicking the pill again.
  zoomBtn.addEventListener('click', () => { toggleView(); zoomBtn.blur(); });

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

  // A read-only handle for QA: the live snapshot, the wall clock and the frame
  // buffer, so a test can assert where the player is and what was actually
  // painted without guessing from screenshots.
  window.__office = { state, wall, buffer: buf };

  // ?rig=1 is the actor contact sheet: every animation and direction of every
  // colleague, layered rigs and legacy fallbacks alike, on the same loop and
  // buffer the game uses. It skips the enlist DOM entirely.
  if (new URLSearchParams(location.search).get('rig') === '1') {
    await rigScreen.open();
    last = performance.now();
    acc = 0;
    if (!looping) {
      looping = true;
      requestAnimationFrame(frame);
    }
  }

  // ?faces=1 is the expression contact sheet: all fourteen faces on every skin
  // tone, through the same drawFace the floor uses, on the same loop/buffer.
  if (new URLSearchParams(location.search).get('faces') === '1') {
    await facesScreen.open();
    last = performance.now();
    acc = 0;
    if (!looping) {
      looping = true;
      requestAnimationFrame(frame);
    }
  }
}

main();