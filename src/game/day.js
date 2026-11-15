import { FPS, DIFFICULTY, DAY_START, DAY_END } from '../core/config.js';
import { isSolid } from '../art/tiles.js';
import { PAL } from '../art/palette.js';
import { sfx } from '../core/audio.js';
import { confetti, sparkle, shake } from '../world/fx.js';

const SYNC_HITS = 3;
const HIT_VALUE = 30;
const COMBO_STEP = 6;
const COMBO_CAP = 5;
// A perfect day lands near 2000: roughly 1100 of objectives, 700 of timing and
// 250 for walking out early. The ranks below are cut against that.
const PAR = 2000;

export function difficultyOf(state) {
  return DIFFICULTY[state.difficulty] || DIFFICULTY.normal;
}

export function startDay(state) {
  const d = difficultyOf(state);
  state.dayFrames = Math.round(d.daySeconds * FPS);
  state.elapsed = 0;
  state.tasks = state.place.stations.map((s, i) => ({
    ...s,
    index: i,
    done: false,
    need: Math.round(d.workFrames * (0.7 + s.points / 400)),
    hits: 0,
    face: faceOf(state.place, s.x, s.y)
  }));
  state.active = 0;
  state.phase = 'play';
  toast(state, 'Shift started', `${state.tasks.length} objectives before 17:00`, PAL.tealLit);
}

// Which way the worker looks while using a station: at the prop, not at the wall.
function faceOf(place, x, y) {
  const at = (i, j) => (i < 0 || j < 0 || i >= place.w || j >= place.h ? '#' : place.grid[j][i]);
  for (const [dir, dx, dy] of [['up', 0, -1], ['left', -1, 0], ['right', 1, 0], ['down', 0, 1]]) {
    if (isSolid(at(x + dx, y + dy))) return { dir, x: x + dx, y: y + dy };
  }
  return { dir: 'up', x, y: y - 1 };
}

export function activeTask(state) {
  return state.tasks[state.active] || null;
}

export function tasksLeft(state) {
  return state.tasks.filter((t) => !t.done).length;
}

// Standing on the marker or right beside it counts, so a chair or a plant next
// to the prop never makes an objective unreachable.
export function atStation(state, task) {
  if (!task) return false;
  const p = state.player;
  return Math.abs(p.tx - task.x) <= 1 && Math.abs(p.ty - task.y) <= 1;
}

export function dayClock(state) {
  const t = state.dayFrames ? Math.min(1, state.elapsed / state.dayFrames) : 0;
  const mins = DAY_START + t * (DAY_END - DAY_START);
  const h = Math.floor(mins / 60);
  const m = Math.floor(mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function dayProgress(state) {
  return state.dayFrames ? Math.min(1, state.elapsed / state.dayFrames) : 0;
}

export function toast(state, text, sub = '', color = PAL.text) {
  state.toasts.push({ text, sub, color, life: 168, max: 168 });
  if (state.toasts.length > 3) state.toasts.shift();
}

let warned = false;
export function resetWarnings() {
  warned = false;
}

// ---- the loop ---------------------------------------------------------------

export function updateDay(state, input) {
  if (state.phase !== 'play') return;

  state.elapsed++;
  const p = state.player;
  const task = activeTask(state);
  const near = atStation(state, task);

  // Work only happens where the objective is, and only while E is held.
  const working = near && input.work && !p.moving;
  p.working = working;

  if (working) {
    p.dir = task.face.dir;
    state.work++;
    if (state.tick % 7 === 0) sfx.key();

    if (!state.sync) {
      state.sync = { pos: 0, dir: 1, band: 0.3 + Math.random() * 0.4, width: 0.17, cool: 0 };
    }
    const s = state.sync;
    s.pos += s.dir * 0.017;
    if (s.pos >= 1) { s.pos = 1; s.dir = -1; }
    if (s.pos <= 0) { s.pos = 0; s.dir = 1; }
    if (s.cool > 0) s.cool--;

    if (input.syncTap && s.cool === 0 && task.hits < SYNC_HITS) {
      s.cool = 18;
      const inBand = Math.abs(s.pos - s.band) <= s.width / 2;
      if (inBand) {
        task.hits++;
        state.combo++;
        state.perfect++;
        state.bestCombo = Math.max(state.bestCombo, state.combo);
        const gain = HIT_VALUE + Math.min(state.combo, COMBO_CAP) * COMBO_STEP;
        state.score += gain;
        sparkle(p.tx, p.ty, PAL.amber);
        shake(state.cam, 1.6);
        sfx.sync();
        toast(state, `In sync +${gain}`, state.combo > 1 ? `Streak ×${state.combo}` : 'Precision bonus', PAL.amber);
        // A hit moves the target, so three in a row takes actual timing.
        s.band = 0.2 + Math.random() * 0.6;
      } else {
        state.combo = 0;
        sfx.miss();
      }
    }

    if (state.work >= task.need) completeTask(state, task);
  } else {
    state.sync = null;
    if (!near) state.combo = 0;
  }

  if (!warned && dayProgress(state) > 0.8 && tasksLeft(state) > 0) {
    warned = true;
    sfx.warn();
    toast(state, '16:00 — last hour', `${tasksLeft(state)} still open`, PAL.danger);
  }

  if (state.elapsed >= state.dayFrames) endDay(state, false);
}

function completeTask(state, task) {
  const left = 1 - dayProgress(state);
  const speed = Math.round(task.points * (0.55 + 0.45 * left));
  state.score += speed;
  task.done = true;
  state.work = 0;
  state.sync = null;
  state.player.working = false;

  confetti(task.x, task.y);
  shake(state.cam, 4);
  sfx.task();

  const next = state.tasks.findIndex((t) => !t.done);
  if (next < 0) {
    endDay(state, true);
    return;
  }
  state.active = next;
  const label = task.id === 'out' ? 'Clocked out' : task.label;
  toast(state, `${label} +${speed}`, `Next: ${state.tasks[next].label}`, PAL.ok);
}

export function endDay(state, cleared) {
  if (state.phase === 'done') return;
  state.phase = 'done';
  state.player.working = false;
  state.sync = null;
  state.finishFrames = state.elapsed;

  const d = difficultyOf(state);
  const done = state.tasks.filter((t) => t.done).length;
  const remaining = Math.max(0, 1 - state.elapsed / state.dayFrames);
  const early = cleared ? Math.round(remaining * 260 * d.bonus) : 0;
  state.score += early;

  const pct = state.score / PAR;
  const rank = !cleared
    ? { title: 'Overtime', note: 'The day beat you to the door.' }
    : pct >= 1 ? { title: 'Office Legend', note: 'Nobody even saw you move.' }
      : pct >= 0.82 ? { title: 'Director', note: 'Clean day, clean desk.' }
        : pct >= 0.64 ? { title: 'Team Lead', note: 'Everything shipped, mostly on time.' }
          : pct >= 0.46 ? { title: 'Specialist', note: 'Solid shift. Room to tighten up.' }
            : { title: 'Associate', note: 'You got through it. Barely.' };

  state.result = {
    cleared,
    done,
    total: state.tasks.length,
    score: state.score,
    early,
    perfect: state.perfect,
    bestCombo: state.bestCombo,
    steps: state.player.steps,
    clock: dayClock(state),
    seconds: Math.round(state.elapsed / FPS),
    difficulty: d.label,
    ...rank
  };

  if (cleared) {
    sfx.win();
    confetti(state.player.tx, state.player.ty);
    shake(state.cam, 6);
  } else {
    sfx.overtime();
  }
}