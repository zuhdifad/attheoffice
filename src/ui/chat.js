// The floor chat, in the register of an old BBM/YM window: a log of who said
// what and when, a field to say it back, and two emotes — a wave and a nudge —
// that land on the other person's character, not just in the log. The dock is
// DOM on the picture's own chrome; the lines themselves also become bubbles
// over the speakers' heads (main.js wires that), so the room reads as people
// talking even with the dock shut.
import { net } from '../core/net.js?v=26';
import { state } from '../core/state.js?v=26';
import { sfx } from '../core/audio.js?v=26';
import { setInputEnabled } from '../core/input.js?v=26';
import { now } from './wallclock.js?v=26';

const MAX_ROWS = 80;
const TWO = (n) => String(n).padStart(2, '0');
// The dock wears the floor's own clock, not the device's raw one: a pinned
// demo hour and the parchment HUD must agree on what time it is.
const hhmm = () => {
  const d = now();
  return `${TWO(d.getHours())}:${TWO(d.getMinutes())}`;
};

let dock = null;
let log = null;
let input = null;
let badge = null;
let btn = null;
let onlineEl = null;
let opened = false;
let unread = 0;
let onWave = () => {};
let onNudge = () => {};

// The game's own input gate: while the dock is open the keys belong to the
// field, but the sim and the wire keep running — you stay live while typing.
function syncInput() {
  setInputEnabled(
    !opened && state.running && state.mode === 'world' &&
    state.phase === 'play' && !state.paused && !state.askingClockOut && !state.clockedOut
  );
}

function scrollDown() {
  if (log) log.scrollTop = log.scrollHeight;
}

function trim() {
  while (log && log.children.length > MAX_ROWS) log.removeChild(log.firstChild);
}

function emptyNote() {
  if (!log || log.children.length) return;
  const p = document.createElement('p');
  p.className = 'chat-empty';
  p.textContent = 'The floor is quiet. Say hello — everyone clocked in sees it.';
  log.append(p);
}

export function bind(opts = {}) {
  onWave = opts.onWave || onWave;
  onNudge = opts.onNudge || onNudge;
  dock = document.getElementById('chatDock');
  log = document.getElementById('chatLog');
  input = document.getElementById('chatInput');
  badge = document.getElementById('chatBadge');
  btn = document.getElementById('chatBtn');
  onlineEl = document.getElementById('chatOnline');

  btn.addEventListener('click', () => { toggle(); btn.blur(); });
  document.getElementById('chatClose').addEventListener('click', close);
  document.getElementById('waveBtn').addEventListener('click', () => { sfx.ui(); onWave(); });
  document.getElementById('nudgeBtn').addEventListener('click', () => { sfx.ui(); onNudge(); });

  document.getElementById('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim().replace(/\s+/g, ' ');
    if (!text) return;
    // net.chat echoes to our own handler too, so the sender's dock and bubble
    // read the same line everyone else's do.
    net.chat(text);
    input.value = '';
    input.focus();
  });

  // Esc closes the dock before it can reach the pause; the field keeps every
  // other key, so typing a 'v' never zooms the room behind you.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });

  emptyNote();
}

export function isOpen() { return opened; }

export function open() {
  if (!dock || opened) return;
  opened = true;
  dock.hidden = false;
  btn.classList.add('is-on');
  unread = 0;
  badge.hidden = true;
  syncInput();
  scrollDown();
  requestAnimationFrame(() => input && input.focus());
}

export function close() {
  if (!dock || !opened) return;
  opened = false;
  dock.hidden = true;
  btn.classList.remove('is-on');
  if (input) input.blur();
  syncInput();
}

export function toggle() { opened ? close() : open(); }

// One line off the wire (or our own echo). Own lines wear the amber the badge
// buttons wear; everyone else's name carries their own character tint.
export function push(m, own = false) {
  if (!log) return;
  const note = log.querySelector('.chat-empty');
  if (note) note.remove();

  const row = document.createElement('div');
  row.className = `chat-row${own ? ' is-own' : ''}`;
  const time = document.createElement('span');
  time.className = 'chat-time';
  time.textContent = hhmm();
  const name = document.createElement('span');
  name.className = 'chat-name';
  name.style.color = own ? '#ffd873' : (m.tint || '#7fd4dd');
  name.textContent = `${m.name}:`;
  const text = document.createElement('span');
  text.className = 'chat-text';
  text.textContent = m.text;
  row.append(time, name, text);
  log.append(row);
  trim();
  scrollDown();

  if (!opened && !own) {
    unread++;
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.hidden = false;
    sfx.talk();
  }
}

// Join/leave and the floor's own notices: the roster changes the way a contact
// list did, with a quiet line rather than a modal. A notice that arrives while
// the dock is shut counts as unread — a colleague appearing is worth a look —
// except your own clock-in line, which is the floor talking to you alone.
export function system(text, leave = false, own = false) {
  if (!log) return;
  const note = log.querySelector('.chat-empty');
  if (note) note.remove();
  const p = document.createElement('p');
  p.className = `chat-sys${leave ? ' is-leave' : ''}`;
  p.textContent = text;
  log.append(p);
  trim();
  scrollDown();
  if (!opened && !own) {
    unread++;
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.hidden = false;
  }
}

export function setOnline(n) {
  if (onlineEl) onlineEl.innerHTML = `<i></i>${n} online`;
}

// The pill lives only while there is a floor to talk to: it appears on
// clock-in and leaves with you on clock-out.
export function setVisible(on) {
  if (btn) btn.hidden = !on;
  if (!on) close();
}