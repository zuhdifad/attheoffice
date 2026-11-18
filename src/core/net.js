// The live floor. Every clocked-in person is one client of this room, the way
// a BBM or YM contact list was one server's roster: you only ever drive your
// own character, and everyone else arrives over the wire the moment they clock
// in — position, facing, action, seat and chat, ten times a second.
//
// Transport: BroadcastChannel carries the live traffic between every tab and
// window of this browser on the same origin, and localStorage keeps a small
// registry per person so a reload, a late joiner or a channel-less browser
// still finds the whole floor. Each client writes only its own key; heartbeats
// expire, so a closed tab leaves the room without a trace.
//
// The module is transport only — it knows nothing about tiles or chairs. The
// sim feeds it poses, the chat dock feeds it lines, and it emits join / leave /
// pose / chat / emote for the world to act on.

const ROOM = 'dmkchef-l22';
const PREFIX = `${ROOM}:`;
const STALE_MS = 6000;    // a heartbeat older than this is a gone person
const PRUNE_MS = 30000;   // registry keys older than this are swept
const WRITE_MS = 400;     // registry write throttle; the channel is unthrottled

const newId = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.random().toString(36).slice(2)}`);

let id;
try {
  id = sessionStorage.getItem(`${ROOM}-id`) || newId();
  sessionStorage.setItem(`${ROOM}-id`, id);
} catch {
  id = newId();
}

const peers = new Map();
const listeners = { join: [], leave: [], pose: [], chat: [], emote: [] };

let self = null;
let joined = false;
let lastWrite = 0;
let heartbeat = null;

const channel = ('BroadcastChannel' in window) ? new BroadcastChannel(ROOM) : null;

function emit(evt, payload) {
  for (const cb of listeners[evt] || []) {
    try { cb(payload); } catch (err) { console.error(`net ${evt} handler`, err); }
  }
}

function post(msg) {
  if (channel) channel.postMessage(msg);
}

function writeRegistry(force) {
  if (!self) return;
  const t = Date.now();
  if (!force && t - lastWrite < WRITE_MS) return;
  lastWrite = t;
  self.at = t;
  try { localStorage.setItem(PREFIX + id, JSON.stringify(self)); } catch {}
}

function upsert(rec) {
  if (!rec || rec.id === id) return;
  const known = peers.has(rec.id);
  peers.set(rec.id, rec);
  if (!known) emit('join', rec);
  if (rec.pose) emit('pose', rec);
}

function drop(pid, why) {
  const rec = peers.get(pid);
  if (!rec) return;
  peers.delete(pid);
  emit('leave', { ...rec, why });
}

// The registry is the slow path: it catches people who were already clocked in
// before this tab opened, and it expires the ones whose heartbeat stopped.
function scan() {
  const t = Date.now();
  let keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
  } catch { return; }
  const seen = new Set();
  for (const k of keys) {
    let rec = null;
    try { rec = JSON.parse(localStorage.getItem(k)); } catch {}
    if (!rec || rec.id === id) continue;
    if (t - (rec.at || 0) > PRUNE_MS) {
      try { localStorage.removeItem(k); } catch {}
      continue;
    }
    if (t - (rec.at || 0) > STALE_MS) continue;
    seen.add(rec.id);
    // The channel is fresher than the registry: never overwrite a live pose
    // with a half-second-old heartbeat copy of the same person.
    const live = peers.get(rec.id);
    if (!live || (rec.at || 0) > (live.at || 0)) upsert(rec);
  }
  for (const pid of [...peers.keys()]) {
    const rec = peers.get(pid);
    if (t - (rec.at || 0) > STALE_MS) drop(pid, 'timeout');
  }
}

if (channel) {
  channel.onmessage = (ev) => {
    const m = ev.data;
    if (!m || m.id === id) return;
    if (m.t === 'hello') {
      upsert(m.rec);
      if (joined && self) post({ t: 'here', id, rec: self });
    } else if (m.t === 'here' || m.t === 'pose') {
      upsert(m.rec);
    } else if (m.t === 'chat') {
      emit('chat', m);
    } else if (m.t === 'emote') {
      emit('emote', m);
    } else if (m.t === 'bye') {
      drop(m.id, 'clocked-out');
    }
  };
}

window.addEventListener('storage', (ev) => {
  if (ev.key && ev.key.startsWith(PREFIX)) scan();
});

// The slow scan runs for as long as the page is open, even after clock-out:
// the room keeps breathing behind the receipt, and the floor stays live.
window.setInterval(scan, 1500);

export const net = {
  id,

  on(evt, cb) {
    (listeners[evt] || (listeners[evt] = [])).push(cb);
    // The roster is sticky: the registry scan can find people before the world
    // has wired its handlers (assets still loading), and a join is only emitted
    // once. A late join listener is replayed everyone already on the floor, so
    // a late tab never misses the people who clocked in before it opened.
    if (evt === 'join') {
      for (const rec of peers.values()) {
        try { cb(rec); } catch (err) { console.error('net join handler', err); }
      }
    }
  },

  // Clocking in: announce yourself, answer the roll call, start the heartbeat.
  join(profile) {
    self = { id, ...profile, at: Date.now(), pose: null };
    joined = true;
    writeRegistry(true);
    post({ t: 'hello', id, rec: self });
    scan();
    if (!heartbeat) {
      heartbeat = window.setInterval(() => {
        if (!joined) return;
        writeRegistry(true);
        post({ t: 'here', id, rec: self });
      }, 1000);
    }
  },

  // Clocking out: the character leaves every other floor immediately.
  leave() {
    if (!joined) return;
    joined = false;
    post({ t: 'bye', id });
    try { localStorage.removeItem(PREFIX + id); } catch {}
    self = null;
  },

  get joined() { return joined; },
  get profile() { return self; },

  // One pose, straight off the sim. The channel carries it now; the registry
  // takes a throttled copy so a reload finds people where they actually stand.
  pose(p) {
    if (!joined || !self) return;
    self.pose = p;
    self.at = Date.now();
    post({ t: 'pose', id, rec: self });
    writeRegistry(false);
  },

  chat(text) {
    if (!self) return null;
    const m = { t: 'chat', id, name: self.name, tint: self.tint, text, at: Date.now() };
    post(m);
    emit('chat', m); // the sender's own dock and bubble read the same line
    return m;
  },

  emote(kind, to = null) {
    if (!self) return;
    post({ t: 'emote', id, name: self.name, kind, to });
  },

  peers() { return peers; },

  // Seat availability for the enlist map: every clocked-in person's claim.
  takenSeats() {
    const out = new Map();
    for (const rec of peers.values()) {
      const num = rec.pose?.seatNum ?? rec.seatNum;
      if (num) out.set(num, { id: rec.id, name: rec.name, tint: rec.tint });
    }
    return out;
  }
};

// A closed tab is a clock-out: the registry key goes and the room is told.
window.addEventListener('pagehide', () => net.leave());