// Remote actors: the other people on the floor. A remote is a puppet, not a
// second simulation — its tile, facing, action and seat come off the wire ten
// times a second, and between messages it eases toward the last pose so a walk
// reads as a walk, never as a teleport. Everything the room does to a local
// actor (y-sort, shadows, name tags, bubbles, door machines, seat claims) it
// does to a remote unchanged, because a remote is shaped exactly like one.
import { TILE } from '../core/config.js?v=26';
import { startAction, tickAction } from './actions.js?v=26';
import { actorFor } from '../art/rig.js?v=26';
import { setMood } from '../art/expressions.js?v=26';
import { seatByNum } from '../world/seats.js?v=26';

const hash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

export function createRemote(rec) {
  const p = rec.pose || {};
  const tx = p.tx ?? 3, ty = p.ty ?? 26;
  const px = p.px ?? tx * TILE, py = p.py ?? ty * TILE;
  return {
    id: rec.id,            // the session: unique per clocked-in person
    artId: rec.charId,     // the doll: which baked rig draws them
    name: rec.name,
    tint: rec.tint,
    role: rec.role || '',
    remote: true,
    x: tx, y: ty, tx, ty,
    px, py,
    net: { px, py },
    to: p.moving ? { x: p.mx ?? tx, y: p.my ?? ty } : null,
    dir: p.dir || 'down',
    frame: p.frame || 0,
    moving: false,
    step: 0,
    stepLen: 12,
    seated: !!p.seated,
    seat: null,
    seatNum: rec.seatNum ?? null,
    off: hash(rec.id) % 240,
    say: 0,
    line: '',
    action: p.action || 'idle',
    act: p.act || 0,
    emoteHold: 0,
    occ: new Set()
  };
}

// One pose off the wire. The tile is authoritative immediately (collision and
// adjacency read it); the pixels ease in updateRemotes.
export function applyPose(state, r, rec) {
  const p = rec.pose || {};
  r.net.px = p.px ?? r.tx * TILE;
  r.net.py = p.py ?? r.ty * TILE;
  if (p.tx != null) { r.tx = p.tx; r.x = p.tx; }
  if (p.ty != null) { r.ty = p.ty; r.y = p.ty; }
  r.to = p.moving ? { x: p.mx ?? r.tx, y: p.my ?? r.ty } : null;
  r.dir = p.dir || r.dir;
  r.frame = p.frame || 0;
  r.seated = !!p.seated;
  // An emote in flight owns the pose for its own beat; the wire takes back over
  // once the wave has landed, so a greeting never freezes a walker.
  if (r.emoteHold <= 0) {
    r.action = p.action || 'idle';
    r.act = p.act || 0;
  }
  syncSeat(state, r, p.seatNum ?? rec.seatNum);
}

function syncSeat(state, r, num) {
  if (r.seated && num) {
    const s = seatByNum(state.map, num);
    if (s && state.map.claimSeat(s, r.id)) r.seat = s;
  } else if (r.seat) {
    state.map.releaseSeat(r.seat, r.id);
    r.seat = null;
  }
}

// A chat line becomes a bubble over the speaker's head, exactly the way the
// guard's small talk does — the floor reads as people talking, not as a log.
export function remoteSay(r, text) {
  r.say = 260;
  r.line = text.length > 44 ? `${text.slice(0, 43)}…` : text;
  setMood(actorFor(r), 'happy', 260);
}

export function remoteEmote(state, r, kind) {
  if (kind === 'wave') {
    r.emoteHold = 26;
    startAction(r, 'wave');
    const p = state.player;
    if (Math.abs(r.tx - p.tx) + Math.abs(r.ty - p.ty) <= 3) {
      const dx = p.tx - r.tx, dy = p.ty - r.ty;
      r.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    }
    setMood(actorFor(r), 'happy', 200);
  } else if (kind === 'nudge') {
    r.say = 160;
    r.line = '*nudge*';
    setMood(actorFor(r), 'curious', 160);
  }
}

export function removeRemote(state, r) {
  if (r.seat) state.map.releaseSeat(r.seat, r.id);
  for (const k of r.occ) state.occupied.delete(k);
  r.occ.clear();
  state.remotes.delete(r.id);
}

const EASE = 0.38;

export function updateRemotes(state) {
  const p = state.player;
  for (const r of state.remotes.values()) {
    if (r.say > 0) r.say--;

    // The wire owns the action clock; between poses it keeps ticking so anims
    // never stall, and each message corrects it back onto the sender's beat.
    if (r.emoteHold > 0) {
      r.emoteHold--;
      tickAction(r);
    } else {
      r.act++;
    }

    r.px += (r.net.px - r.px) * EASE;
    r.py += (r.net.py - r.py) * EASE;
    if (Math.abs(r.net.px - r.px) < 0.4) r.px = r.net.px;
    if (Math.abs(r.net.py - r.py) < 0.4) r.py = r.net.py;
    r.moving = Math.abs(r.net.px - r.px) + Math.abs(r.net.py - r.py) > 1.5;

    // Look at whoever is beside you: two people standing together face each
    // other, each on their own client, the way a room actually works.
    if (!r.seated && !r.moving && r.action === 'idle' && r.emoteHold <= 0) {
      const dx = p.tx - r.tx, dy = p.ty - r.ty;
      if (Math.abs(dx) + Math.abs(dy) <= 2) {
        r.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      }
    }

    // A standing person blocks their tile (and the one they are stepping into)
    // on every client, so nobody walks through a colleague who is really there.
    const want = new Set();
    if (!r.seated) {
      want.add(`${r.tx},${r.ty}`);
      if (r.moving && r.to) want.add(`${r.to.x},${r.to.y}`);
    }
    for (const k of r.occ) if (!want.has(k)) state.occupied.delete(k);
    for (const k of want) state.occupied.add(k);
    r.occ = want;
  }
}