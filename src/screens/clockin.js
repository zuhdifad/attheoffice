import { initAudio, sfx } from '../core/audio.js?v=26';
import { CHARACTERS } from '../art/palette.js?v=26';
import { net } from '../core/net.js?v=26';
import * as seatmap from './seatmap.js?v=26';

// The title card hands over to a short loading plate — FIGHTING — and then to
// the questions the floor asks before it issues a badge: a name, a level, a
// seat, a role, and the teammate coming in with you. The answers ride out
// through the callback, so this module keeps nothing but the run it is in the
// middle of.
const LOAD_MS = 1700;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function bind({ onStartToWork }) {
  const startBtn = document.getElementById('clockInBtn');
  const loader = document.getElementById('bootLoad');
  const popup = document.getElementById('popup');

  const stages = {
    who: document.getElementById('stageWho'),
    where: document.getElementById('stageWhere'),
    seat: document.getElementById('stageSeat'),
    role: document.getElementById('stageRole'),
    partner: document.getElementById('stagePartner')
  };

  const whoForm = document.getElementById('whoForm');
  const whoInput = document.getElementById('whoInput');
  const whoError = document.getElementById('whoError');
  const whereError = document.getElementById('whereError');
  const partnerForm = document.getElementById('partnerForm');
  const partnerInput = document.getElementById('partnerInput');
  const partnerError = document.getElementById('partnerError');
  const floors = Array.from(document.querySelectorAll('#floorPick [data-floor]'));

  let name = '';
  let floor = '';
  let seat = '';
  let seatNum = 0;
  let seatTile = null;
  let role = '';
  let current = 'who';
  let loading = false;

  const roleBtns = [];

  const focusFor = () => ({
    who: whoInput,
    where: floors.find((f) => !f.disabled),
    seat: null, // the plan focuses its own canvas
    role: roleBtns[0],
    partner: partnerInput
  }[current]);

  const showStage = (stage) => {
    current = stage;
    for (const [key, node] of Object.entries(stages)) {
      node.classList.toggle('is-on', key === stage);
    }
    // The seat plan is live only while it is the question on screen: its
    // availability refresh follows the stage, not the whole enlist run.
    seatmap.setActive(stage === 'seat');
    // Focus lands on whatever the stage is asking for, so a keyboard player
    // never has to hunt for it.
    requestAnimationFrame(() => focusFor()?.focus());
  };

  // Escape walks the questions backwards before it gives up the floor.
  const PREV = { where: 'who', seat: 'where', role: 'seat', partner: 'role' };

  // ---- pick a seat ---------------------------------------------------------
  // The question is asked on the floor's own plan: all 32 chairs, numbered,
  // with live availability — a colleague clocking in on another window takes
  // their chair on this map within the second.
  const seatPick = document.getElementById('seatPick');
  seatmap.open(seatPick, {
    onPick: (info) => {
      seat = info.label;
      seatNum = info.num;
      seatTile = { x: info.x, y: info.y };
      showStage('role');
    },
    getTaken: () => net.takenSeats()
  });
  seatmap.setActive(false);

  // ---- pick a role ---------------------------------------------------------
  // The roles are the ones already on the floor, so the badge never claims a
  // job that does not exist in this office.
  const rolePick = document.getElementById('rolePick');
  for (const title of [...new Set(CHARACTERS.map((c) => c.role))]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pick-btn';
    b.textContent = title;
    b.addEventListener('click', () => {
      role = title;
      sfx.ui();
      showStage('partner');
    });
    rolePick.append(b);
    roleBtns.push(b);
  }

  const close = () => { popup.style.display = 'none'; };

  // Opening the floor is deliberately a two-second beat: the guard stops a
  // second Enter from stacking a second loader on top of the first.
  const loadFloor = () => {
    if (loading) return;
    loading = true;
    initAudio();
    sfx.clockIn();
    loader.classList.add('is-on');
    loader.setAttribute('aria-hidden', 'false');
    window.setTimeout(() => {
      loader.classList.remove('is-on');
      loader.setAttribute('aria-hidden', 'true');
      loading = false;
      popup.style.display = 'flex';
      showStage('who');
    }, LOAD_MS);
  };

  startBtn.addEventListener('click', loadFloor);

  whoForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = whoInput.value.trim().replace(/\s+/g, ' ');
    if (!value) {
      whoInput.classList.add('is-bad');
      whoError.textContent = 'A badge needs a name.';
      whoInput.focus();
      sfx.back();
      return;
    }
    whoInput.classList.remove('is-bad');
    whoError.textContent = '';
    name = value;
    sfx.ui();
    showStage('where');
  });

  whoInput.addEventListener('input', () => {
    if (!whoInput.classList.contains('is-bad')) return;
    whoInput.classList.remove('is-bad');
    whoError.textContent = '';
  });

  // Only Level 22 is open. The other floors stay on the card, locked, so the
  // building reads as a building — but the badge is issued for the live floor.
  for (const btn of floors) {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      floor = btn.dataset.floor;
      whereError.textContent = '';
      sfx.ui();
      showStage('seat');
    });
  }

  partnerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = partnerInput.value.trim();
    if (!EMAIL_RE.test(value)) {
      partnerInput.classList.add('is-bad');
      partnerError.textContent = 'Needs a valid email address.';
      partnerInput.focus();
      sfx.back();
      return;
    }
    partnerInput.classList.remove('is-bad');
    partnerError.textContent = '';
    sfx.clockIn();
    close();
    onStartToWork({ name, floor, seat, seatNum, seatTile, role, partner: value });
  });

  partnerInput.addEventListener('input', () => {
    if (!partnerInput.classList.contains('is-bad')) return;
    partnerInput.classList.remove('is-bad');
    partnerError.textContent = '';
  });

  document.getElementById('whereBack').addEventListener('click', () => { sfx.back(); showStage('who'); });
  document.getElementById('seatBack').addEventListener('click', () => { sfx.back(); showStage('where'); });
  document.getElementById('roleBack').addEventListener('click', () => { sfx.back(); showStage('seat'); });
  document.getElementById('partnerBack').addEventListener('click', () => { sfx.back(); showStage('role'); });

  window.addEventListener('click', (e) => {
    if (e.target === popup) { sfx.back(); close(); }
  });

  // The title card is a boot screen: Enter opens the floor, but only while the
  // title is the active screen — not over these questions, not under the picker
  // and never mid-shift, where the same key belongs to the game. Without the
  // ready flag the prompt is still unlit, so Enter does nothing until art is in.
  const titleIdle = () =>
    document.body.classList.contains('ready') &&
    !document.body.classList.contains('in-game') &&
    document.getElementById('characterSelectPopup').style.display !== 'flex';

  window.addEventListener('keydown', (e) => {
    if (popup.style.display === 'flex') {
      if (e.key === 'Escape') {
        const back = PREV[current];
        sfx.back();
        if (back) showStage(back);
        else close();
      } else if (current === 'where' && /^[1-3]$/.test(e.key)) {
        const btn = floors[Number(e.key) - 1];
        if (!btn) return;
        e.preventDefault();
        if (btn.disabled) {
          whereError.textContent = `${btn.dataset.floor} opens soon — Level 22 is the live floor.`;
          sfx.back();
        } else {
          btn.click();
        }
      }
      return;
    }
    if (loading || e.key !== 'Enter' || !titleIdle()) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target && target.closest('button, a, select, input, textarea')) return;
    e.preventDefault();
    loadFloor();
  });
}
