import { initAudio, sfx } from '../core/audio.js';

// The title card hands over to a short loading plate — FIGHTING — and then to the
// two questions the floor asks before it issues a badge: a name, and the level
// that name works on. The answers ride out through the callback, so this module
// keeps nothing but the run it is in the middle of.
const LOAD_MS = 1700;

export function bind({ onStartToWork }) {
  const startBtn = document.getElementById('clockInBtn');
  const loader = document.getElementById('bootLoad');
  const popup = document.getElementById('popup');
  const stepLabel = document.getElementById('enlistStep');
  const stageWho = document.getElementById('stageWho');
  const stageWhere = document.getElementById('stageWhere');
  const whoForm = document.getElementById('whoForm');
  const whoInput = document.getElementById('whoInput');
  const whoError = document.getElementById('whoError');
  const whereSub = document.getElementById('whereSub');
  const backBtn = document.getElementById('whereBack');
  const floors = Array.from(document.querySelectorAll('#floorPick [data-floor]'));

  let name = '';
  let loading = false;

  const showStage = (stage) => {
    const who = stage === 'who';
    stageWho.classList.toggle('is-on', who);
    stageWhere.classList.toggle('is-on', !who);
    stepLabel.textContent = who ? '01 / 02' : '02 / 02';
    // Focus lands on whatever the stage is asking for, so a keyboard player
    // never has to hunt for it.
    requestAnimationFrame(() => (who ? whoInput : floors[0]).focus());
  };

  const close = () => { popup.style.display = 'none'; };

  const askWhere = () => {
    whereSub.textContent = `Badge ready for ${name}. Pick the level your desk sits on.`;
    showStage('where');
  };

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
    askWhere();
  });

  whoInput.addEventListener('input', () => {
    if (!whoInput.classList.contains('is-bad')) return;
    whoInput.classList.remove('is-bad');
    whoError.textContent = '';
  });

  backBtn.addEventListener('click', () => { sfx.back(); showStage('who'); });

  for (const btn of floors) {
    btn.addEventListener('click', () => {
      sfx.clockIn();
      close();
      onStartToWork({ name, floor: btn.dataset.floor });
    });
  }

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
      const onWhere = stageWhere.classList.contains('is-on');
      if (e.key === 'Escape') {
        // Escape walks the questions backwards before it gives up the floor.
        sfx.back();
        if (onWhere) showStage('who');
        else close();
      } else if (onWhere && /^[1-3]$/.test(e.key)) {
        const btn = floors[Number(e.key) - 1];
        if (btn) { e.preventDefault(); btn.click(); }
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
