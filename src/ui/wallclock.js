// The page's own clock: the device's real time, ticking in the header while you
// walk the floor. Nothing here is simulated — the date, the seconds and the
// 18:00 question all come from the same Date the player's computer keeps.
//
// ?time=HH:MM pins the clock to a chosen hour (it still ticks forward from
// there), which is how the evening question gets tested without waiting for
// the evening.

const TWO = (n) => String(n).padStart(2, '0');
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const realStart = Date.now();
let fakeStart = null;

const pin = new URLSearchParams(window.location.search).get('time');
if (pin && /^\d{1,2}:\d{2}(:\d{2})?$/.test(pin)) {
  const [h, m, s = '0'] = pin.split(':');
  const d = new Date();
  d.setHours(Number(h), Number(m), Number(s), 0);
  fakeStart = d.getTime();
}

export function now() {
  return new Date(fakeStart === null ? Date.now() : fakeStart + (Date.now() - realStart));
}

export const fmtTime = (d) => `${TWO(d.getHours())}:${TWO(d.getMinutes())}:${TWO(d.getSeconds())}`;
export const fmtHM = (d) => `${TWO(d.getHours())}:${TWO(d.getMinutes())}`;
export const fmtDate = (d) => `${TWO(d.getDate())}/${TWO(d.getMonth() + 1)}/${d.getFullYear()}`;
export const weekday = (d) => WEEKDAYS[d.getDay()];
export const isAfterHours = () => now().getHours() >= 18;

let els = null;
let armed = false;
let fired = false;
let out = false;
let afterCb = () => {};

// One interval for the whole page. The header is DOM, so four updates a second
// is plenty and keeps layout off the render loop's budget.
export function bind({ onAfterHours }) {
  afterCb = onAfterHours;
  els = {
    time: document.getElementById('wallTime'),
    date: document.getElementById('wallDate'),
    state: document.getElementById('clockState'),
    label: document.getElementById('clockStateLabel')
  };

  const tick = () => {
    const d = now();
    els.time.textContent = fmtTime(d);
    els.date.textContent = fmtDate(d);
    // The question fires once per clock-in, a beat after the hour turns so the
    // room is already on screen when it asks.
    if (armed && !fired && !out && d.getHours() >= 18) {
      fired = true;
      window.setTimeout(afterCb, 900);
    }
  };
  tick();
  window.setInterval(tick, 250);
}

export function markClockedIn() {
  out = false;
  armed = true;
  fired = false;
  setState('clocked-in', false);
}

export function markClockedOut() {
  out = true;
  armed = false;
  setState('clocked-out', true);
}

function setState(label, isOut) {
  if (!els) return;
  els.state.classList.toggle('is-out', isOut);
  els.label.textContent = label;
}