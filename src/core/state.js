// One mutable snapshot of a running game. Imports nothing, which is what keeps
// the module graph acyclic.
//
// mode is the router: 'title' until a worker is confirmed, then 'world'.
// phase is the visit: 'brief' -> 'play' -> 'done' (clocked out).
// There is no mission layer: the floor is just a room you walk around, and the
// only clock that matters is the device's own, kept by ui/wallclock.js.
export const state = {
  mode: 'title',
  phase: 'brief',
  running: false,
  paused: false,
  tick: 0,

  chosen: null,
  // Asked on the title card before the picker: the player's own name, the level
  // they say they work on, the seat and role they claim, and the teammate they
  // bring in by email. A restart keeps all of it.
  playerName: '',
  floor: '',
  seat: '',
  role: '',
  partner: '',
  player: null,
  npcs: [],
  occupied: new Set(),
  keepClear: new Set(),
  place: null,
  map: null,
  walkable: () => false,

  cam: { x: 0, y: 0, shake: 0 },
  // Pinned at 2x: the room always opens on the same framed picture.
  zoom: 2,

  // The visit, in real device time. clockedInAt is stamped when the worker is
  // confirmed; askingClockOut freezes the player while the 18:00 question is
  // up; talks remembers which colleagues you have actually spoken to.
  clockedInAt: null,
  clockedOut: false,
  askingClockOut: false,
  talks: new Set(),
  result: null,

  // What is left of the options: walk pace and sound. Everything else the
  // floor needs is drawn inside the picture.
  speed: 1,
  muted: false,

  // An open Harvest Moon-style conversation, or null. While it is up the player
  // and the crowd freeze but the wall clock keeps running.
  dialogue: null
};

// A restart happens in place: the room and the crowd are rebuilt, but the
// chosen worker and the options the player set survive.
export function resetDay(keep) {
  state.phase = 'brief';
  state.paused = false;
  state.tick = 0;
  state.clockedInAt = null;
  state.clockedOut = false;
  state.askingClockOut = false;
  state.talks = new Set();
  state.result = null;
  state.dialogue = null;
  state.cam.shake = 0;
  if (keep) Object.assign(state, keep);
}