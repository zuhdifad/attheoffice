import { CHARACTERS } from '../art/palette.js?v=24';
import { sfx } from '../core/audio.js?v=24';

// The picker shows one colleague at a time, full length, in a studio tinted
// with their own colour. The arrows — or ← → — walk the floor, and the one
// button clocks you in as whoever is on the stand.

let page = 1;
let confirmCb = () => {};

const popup = () => document.getElementById('characterSelectPopup');
const panel = () => document.querySelector('#characterSelectPopup .picker');
const stage = () => document.querySelector('#characterSelectPopup .showcase');
const isOpen = () => popup().style.display === 'flex';
const el = (id) => document.getElementById(id);

function render() {
  const who = CHARACTERS[page - 1];
  if (!who) return;

  const card = el('charCardImg');
  card.src = who.card;
  card.alt = who.name;

  el('prevBtn').disabled = page === 1;
  el('nextBtn').disabled = page === CHARACTERS.length;

  // The tint lives on the panel, not the backdrop: .picker declares its own
  // --tint, so a value inherited from the popup would never reach it.
  panel().style.setProperty('--tint', who.tint);

  // Restart the entrance so every colleague slides in fresh.
  const box = stage();
  box.classList.remove('swap');
  void box.offsetWidth;
  box.classList.add('swap');
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
}

export function open() {
  page = Math.max(1, CHARACTERS.findIndex((c) => c.id === document.body.dataset.worker) + 1);
  popup().style.display = 'flex';
  render();
}

export function bind({ onConfirm }) {
  confirmCb = onConfirm;

  el('prevBtn').addEventListener('click', () => step(-1));
  el('nextBtn').addEventListener('click', () => step(1));

  el('confirmCharBtn').addEventListener('click', () => {
    const who = CHARACTERS[page - 1];
    document.body.dataset.worker = who.id;
    sfx.clockIn();
    close();
    confirmCb(who);
  });

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
