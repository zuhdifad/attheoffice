import { RIG } from '../core/config.js?v=26';

// ---- The actor action state machine ------------------------------------------
// Every character — player and colleague alike — is always in exactly one
// action. An action names a track the rig already owns, whether it loops, how
// many sim ticks each anim frame holds, and what it settles into when it is a
// one-shot. Nothing here is new art: sit-down borrows the `sit` track, stand-up
// is that same track played in reverse, drink borrows `sip`, laptop is `type`.
//
//   idle / walk            the two resting locomotion states
//   sit-down -> sit        the 5-frame sit track, anticipation then settle
//   sit / type / laptop    the seated loops (chair track, never a standing pose)
//   drink                  the sip track, then back to idle
//   stand-up -> idle       the sit track reversed, then off the chair
//   door                   a short reach (wave) while working a door leaf
//
// `hold` is sim ticks per anim frame, so a 5-frame transition reads as a
// deliberate ~20-tick move with a beat of anticipation and a beat of settle,
// not a flicker. `seated` marks the actions performed on a chair; the renderer
// and the seat-ownership logic both read it.
export const ACTIONS = {
  idle:    { anim: 'idle',    loop: true,  hold: 10 },
  walk:    { anim: 'walk',    loop: true,  hold: 1 },
  sitdown: { anim: 'sit',     loop: false, hold: 4, next: 'sit',  seated: true },
  sit:     { anim: 'sitidle', loop: true,  hold: 10,               seated: true },
  type:    { anim: 'type',    loop: true,  hold: 8,                seated: true },
  drink:   { anim: 'sip',     loop: false, hold: 5, next: 'idle' },
  laptop:  { anim: 'type',    loop: true,  hold: 8,                seated: true },
  standup: { anim: 'sit',     loop: false, hold: 4, next: 'idle',  seated: true, reverse: true },
  door:    { anim: 'wave',    loop: false, hold: 5, next: 'idle' },
  wave:    { anim: 'wave',    loop: false, hold: 5, next: 'idle' }
};

// Frame counts come off the baked rig table, which the layered manifests match
// frame for frame, so both art paths agree on how long a transition is.
export const framesOf = (action) => {
  const a = ACTIONS[action] || ACTIONS.idle;
  return (RIG.actions[a.anim] || RIG.actions.idle)[1];
};

export const isSeated = (action) => !!(ACTIONS[action] && ACTIONS[action].seated);

export function startAction(e, name) {
  if (!ACTIONS[name]) name = 'idle';
  e.action = name;
  e.act = 0;
}

// Advance one sim tick. Returns the action settled into when a one-shot
// completes — the caller applies the side effects that go with it (claim or
// release a seat, step off a chair) — and null while the action is still running.
export function tickAction(e) {
  const a = ACTIONS[e.action];
  if (!a) { startAction(e, 'idle'); return null; }
  e.act = (e.act || 0) + 1;
  if (!a.loop && e.act >= framesOf(e.action) * a.hold) {
    const next = a.next || 'idle';
    startAction(e, next);
    return next;
  }
  return null;
}

// The display frame for the current action, read by the renderer. A reversed
// track (stand-up) counts down from the last frame so the doll rises through the
// same poses it sat down through.
export function actionFrame(e) {
  const a = ACTIONS[e.action] || ACTIONS.idle;
  const f = framesOf(e.action);
  const t = Math.floor((e.act || 0) / a.hold);
  let frame = a.loop ? t % f : Math.min(t, f - 1);
  if (a.reverse) frame = f - 1 - frame;
  return frame;
}