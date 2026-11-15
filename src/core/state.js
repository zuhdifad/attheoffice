// One mutable snapshot of a running game. Imports nothing, which is what keeps
// the module graph acyclic.
//
// mode is the router: 'title' until a worker is confirmed, then 'world'.
// phase is the workday: 'brief' -> 'play' -> 'done'.
export const state = {
  mode: 'title',
  phase: 'brief',
  running: false,
  paused: false,
  tick: 0,

  chosen: null,
  // Asked on the title card before the picker: the player's own name, and the
  // level they say they work on. A day restart keeps both.
  playerName: '',
  floor: '',
  player: null,
  npcs: [],
  occupied: new Set(),
  keepClear: new Set(),
  place: null,
  map: null,
  walkable: () => false,

  cam: { x: 0, y: 0, shake: 0 },
  zoom: 1,
  zoomManual: false,

  // The day.
  tasks: [],
  active: 0,
  work: 0,
  sync: null,
  score: 0,
  combo: 0,
  bestCombo: 0,
  perfect: 0,
  elapsed: 0,
  dayFrames: 0,
  finishFrames: 0,
  result: null,

  // Options, all live from the control rail.
  difficulty: 'normal',
  speed: 1,
  hints: true,
  grid: false,
  muted: false,

  toasts: [],
  bubbles: []
};

// A day restarts in place: the room and the crowd are rebuilt, but the chosen
// worker and the options the player set survive.
export function resetDay(keep) {
  state.phase = 'brief';
  state.paused = false;
  state.tick = 0;
  state.tasks = [];
  state.active = 0;
  state.work = 0;
  state.sync = null;
  state.score = 0;
  state.combo = 0;
  state.bestCombo = 0;
  state.perfect = 0;
  state.elapsed = 0;
  state.dayFrames = 0;
  state.finishFrames = 0;
  state.result = null;
  state.toasts.length = 0;
  state.bubbles.length = 0;
  state.cam.shake = 0;
  if (keep) Object.assign(state, keep);
}