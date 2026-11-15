import { CHAR_W, CHAR_H, SHEET_COLS, DIR_ROW, DIFFICULTY } from '../core/config.js';
import { state } from '../core/state.js';
import { CHARACTERS } from '../art/palette.js';
import { sheetFor } from '../art/characters.js';
import { sfx } from '../core/audio.js';

// The picker is a personnel file. The hero is the full-length cut-out taken
// from each colleague's own model sheet, standing in a studio tinted with their
// colour; beside it the record — role, extension, where they usually sit — and
// underneath the whole floor as thirteen clickable faces. The small canvas is
// the honest part: it runs the real 6x4 walk sheet, so what you pick is exactly
// what walks the office.
const CW = 112;
const CH = 112;
const SCALE = 2;
const FACINGS = ['down', 'left', 'right', 'up'];
const FACING_LABEL = {
  down: 'Facing you',
  left: 'Facing left',
  right: 'Facing right',
  up: 'Facing away'
};

let page = 1;
let confirmCb = () => {};
let difficultyCb = () => {};
let raf = 0;
let frameTick = 0;
let ctx = null;
let faces = [];
let shownFacing = '';

const popup = () => document.getElementById('characterSelectPopup');
const panel = () => document.querySelector('#characterSelectPopup .picker');
const isOpen = () => popup().style.display === 'flex';
const el = (id) => document.getElementById(id);

function buildRail() {
  const strip = el('charRail');
  strip.textContent = '';
  faces = CHARACTERS.map((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'char-face';
    b.style.setProperty('--tint', c.tint);
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', 'false');
    b.setAttribute('aria-label', `${c.name}, ${c.role}`);
    b.title = `${c.name} — ${c.role}`;

    const img = document.createElement('img');
    img.src = c.bust;
    img.alt = '';
    img.width = 42;
    img.height = 42;
    img.draggable = false;

    const cap = document.createElement('span');
    // One word per tile: the full name is on the file itself and in the title.
    cap.textContent = c.name.split(' ')[0];

    b.append(img, cap);
    b.addEventListener('click', () => {
      if (page === i + 1) return;
      page = i + 1;
      sfx.ui();
      render();
    });
    strip.append(b);
    return b;
  });
}

// Centre the chosen face without touching the page scroll, which is what
// scrollIntoView would do inside a popup that itself scrolls.
function revealFace() {
  const rail = el('charRail');
  const face = faces[page - 1];
  if (!rail || !face) return;
  const a = face.getBoundingClientRect();
  const b = rail.getBoundingClientRect();
  if (!b.width) return;
  const delta = (a.left + a.width / 2) - (b.left + b.width / 2);
  if (Math.abs(delta) < 2) return;
  rail.scrollBy({ left: delta, behavior: 'smooth' });
}

function render() {
  const who = CHARACTERS[page - 1];
  if (!who) return;

  const portrait = el('charPortrait');
  portrait.src = who.card;
  portrait.alt = `${who.name}, full length`;

  el('charBadge').textContent = who.badge;
  el('charDept').textContent = who.dept;
  el('charName').textContent = who.name;
  el('charRole').textContent = who.role;
  el('charNote').textContent = who.note;
  el('charExt').textContent = who.ext;
  el('charSince').textContent = who.since;
  el('charDesk').textContent = who.desk;

  el('currentPage').textContent = page;
  el('totalPages').textContent = CHARACTERS.length;
  el('prevBtn').disabled = page === 1;
  el('nextBtn').disabled = page === CHARACTERS.length;
  // The tint lives on the panel, not the backdrop: .picker declares its own
  // --tint, so a value inherited from the popup would never reach it.
  panel().style.setProperty('--tint', who.tint);

  faces.forEach((f, i) => {
    const on = i === page - 1;
    f.classList.toggle('is-on', on);
    f.setAttribute('aria-selected', String(on));
  });
  revealFace();

  // Reset the cycle so every colleague is introduced on their contact pose
  // facing the camera, rather than mid-stride with their back turned.
  frameTick = 0;
  shownFacing = '';

  const card = el('charCard');
  card.classList.remove('swap');
  // Force the animation to restart on every change of worker.
  void card.offsetWidth;
  card.classList.add('swap');
}

// One loop, started when the popup opens and cancelled when it closes, so
// paging through the roster never stacks animations.
function tick() {
  if (!isOpen()) { raf = 0; return; }
  frameTick++;
  const who = CHARACTERS[page - 1];
  const sheet = sheetFor(who.id);
  const g = ctx;

  g.clearRect(0, 0, CW, CH);

  // Tinted pool of light behind the worker.
  const glow = g.createRadialGradient(CW / 2, CH / 2 + 6, 4, CW / 2, CH / 2 + 6, 52);
  glow.addColorStop(0, hexA(who.tint, 0.32));
  glow.addColorStop(1, hexA(who.tint, 0));
  g.fillStyle = glow;
  g.fillRect(0, 0, CW, CH);

  // A slab of the office floor, so the sprite is previewed on what it stands on.
  g.fillStyle = 'rgba(205,201,194,0.10)';
  g.beginPath();
  g.ellipse(CW / 2, CH - 12, 32, 9, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = hexA(who.tint, 0.45);
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(CW / 2, CH - 12, 22, 6, 0, 0, Math.PI * 2);
  g.stroke();

  const facing = FACINGS[Math.floor(frameTick / 110) % FACINGS.length];
  if (facing !== shownFacing) {
    shownFacing = facing;
    el('charFacing').textContent = FACING_LABEL[facing];
  }

  if (sheet) {
    const row = DIR_ROW[facing];
    const col = Math.floor(frameTick / 9) % SHEET_COLS;
    const bob = col === 1 || col === 4 ? -SCALE : 0;
    const dx = Math.round(CW / 2 - (CHAR_W * SCALE) / 2);
    const dy = Math.round(CH - 12 - CHAR_H * SCALE + 8) + bob;

    g.fillStyle = 'rgba(10,13,20,0.34)';
    g.beginPath();
    g.ellipse(CW / 2, CH - 10, 15, 5, 0, 0, Math.PI * 2);
    g.fill();

    g.drawImage(sheet, col * CHAR_W, row * CHAR_H, CHAR_W, CHAR_H, dx, dy, CHAR_W * SCALE, CHAR_H * SCALE);
  }

  raf = requestAnimationFrame(tick);
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function start() {
  if (raf) return;
  frameTick = 0;
  raf = requestAnimationFrame(tick);
}

function stop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

function step(d) {
  const next = page + d;
  if (next < 1 || next > CHARACTERS.length) return;
  page = next;
  if (d > 0) sfx.ui(); else sfx.back();
  render();
}

export function close() {
  popup().style.display = 'none';
  stop();
}

export function open() {
  page = Math.max(1, CHARACTERS.findIndex((c) => c.id === document.body.dataset.worker) + 1);
  // The badge is filled in by now, so the picker can greet the player by name and
  // level instead of talking about the floor in the abstract.
  const sub = el('pickerSub');
  if (sub) {
    sub.textContent = state.playerName
      ? `${state.playerName} · ${state.floor}. Now pick the colleague you clock in as.`
      : 'Everyone on floor 12 is clocked in. Choose who you are today.';
  }
  popup().style.display = 'flex';
  render();
  start();
}

export function bind({ onConfirm, onDifficulty, difficulty }) {
  confirmCb = onConfirm;
  difficultyCb = onDifficulty;

  ctx = el('charCanvas').getContext('2d');
  ctx.imageSmoothingEnabled = false;
  buildRail();

  const shift = el('pickDifficulty');
  shift.textContent = '';
  for (const [key, d] of Object.entries(DIFFICULTY)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.key = key;
    b.textContent = d.label;
    b.title = `${d.daySeconds}s day`;
    b.addEventListener('click', () => {
      difficultyCb(key);
      syncDifficulty(key);
      sfx.ui();
    });
    shift.append(b);
  }
  syncDifficulty(difficulty);

  el('prevBtn').addEventListener('click', () => step(-1));
  el('nextBtn').addEventListener('click', () => step(1));
  el('confirmCharBtn').addEventListener('click', () => {
    const who = CHARACTERS[page - 1];
    document.body.dataset.worker = who.id;
    sfx.clockIn();
    close();
    confirmCb(who);
  });

  // Swipe the file left or right on a phone. Vertical drags are left alone so
  // the popup still scrolls normally.
  const card = el('charCard');
  let sx = 0;
  let sy = 0;
  let tracking = false;
  card.addEventListener('pointerdown', (e) => {
    tracking = true;
    sx = e.clientX;
    sy = e.clientY;
  });
  card.addEventListener('pointerup', (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.abs(dx) > 46 && Math.abs(dx) > Math.abs(dy) * 1.6) step(dx < 0 ? 1 : -1);
  });
  card.addEventListener('pointercancel', () => { tracking = false; });

  window.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'Home') { page = 1; sfx.back(); render(); }
    else if (e.key === 'End') { page = CHARACTERS.length; sfx.ui(); render(); }
    else if (e.key === 'Enter') el('confirmCharBtn').click();
    else if (e.key === 'Escape') { sfx.back(); close(); }
  });

  window.addEventListener('click', (e) => {
    if (e.target === popup()) { sfx.back(); close(); }
  });
}

export function syncDifficulty(key) {
  for (const b of el('pickDifficulty').children) {
    b.classList.toggle('is-on', b.dataset.key === key);
  }
  const d = DIFFICULTY[key];
  el('pickShiftNote').textContent =
    `${d.label} shift · ${Math.round(d.daySeconds / 60 * 10) / 10} min real time · 09:00 to 17:00`;
}