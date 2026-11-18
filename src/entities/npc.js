import { TILE, STEP_FRAMES } from '../core/config.js?v=26';
import { mulberry32 } from '../core/rng.js?v=26';
import { actorFor } from '../art/rig.js?v=26';
import { setMood } from '../art/expressions.js?v=26';
import { startAction, tickAction } from './actions.js?v=26';

// The only NPC on the floor: the security guard at the door. Everyone else you
// see is a real person who clocked in — they arrive over the live presence
// layer (core/net.js) and are drawn as remote actors, not as a simulated crowd.
//
// The guard keeps one post beside the entrance mat, faces whoever comes close,
// waves each arrival through, and mutters the small talk of a man who has
// watched this doorway for years. He never leaves his tile: the post is part of
// the room's collision from the first frame.

const POST = { x: 4, y: 25 };

// The guard borrows a suit from the roster — Philip's grey one, or Max's
// charcoal if the player clocked in as Philip — so the art is always baked.
const GUARD_IDS = ['philip', 'max'];

const CHATTER = [
  'Badge on, mind the mat.',
  'Level 22. Quiet floor today.',
  'Clock-out is at six, not half past.',
  'Lost a charger? Check the lounge.',
  'The kettle is on the right.',
  'Visitors sign at the desk.',
  'Stretch your legs, the aisle is clear.',
  'I have watched this door since 2016.',
  'Coffee is fine. The printer is not.',
  'No running. This is an office, not a gym.'
];

const MOODS = ['neutral', 'bored', 'curious', 'happy', 'tired'];

export function buildNpcs(place, map, characters, chosen) {
  const id = GUARD_IDS.find((g) => g !== chosen.id) || GUARD_IDS[0];
  const who = characters.find((c) => c.id === id);
  const rand = mulberry32(20261118);
  const guard = {
    id: who.id,
    name: `Pak ${who.name}`,
    tint: who.tint,
    role: 'Security',
    guard: true,
    dialogueKey: 'security',
    x: POST.x, y: POST.y,
    tx: POST.x, ty: POST.y,
    px: POST.x * TILE, py: POST.y * TILE,
    dir: 'left', // faces the door leaf, the way a post is kept
    frame: 0,
    moving: false,
    step: 0,
    stepLen: STEP_FRAMES,
    seated: false,
    off: Math.floor(rand() * 240),
    wait: 0,
    say: 0,
    line: '',
    rand,
    action: 'idle',
    act: 0,
    seat: null,
    leaving: null,
    greeted: false,
    waveCd: 0,
    chatterAt: 420 + Math.floor(rand() * 300)
  };
  startAction(guard, 'idle');
  return {
    list: [guard],
    occupied: new Set([`${POST.x},${POST.y}`]),
    keepClear: new Set()
  };
}

const dist = (a, b) => Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty);

function faceTowardGuard(g, p) {
  const dx = p.tx - g.tx;
  const dy = p.ty - g.ty;
  g.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}

export function updateNpcs(state) {
  const p = state.player;
  for (const g of state.npcs) {
    if (!g.guard) continue;
    if (g.say > 0) g.say--;
    if (g.waveCd > 0) g.waveCd--;
    tickAction(g);

    const near = dist(g, p);

    // Each clock-in is waved through once: the guard turns, lifts a hand, and
    // says the floor's one greeting. The badge name makes it personal.
    if (!g.greeted && near <= 3 && state.phase === 'play') {
      g.greeted = true;
      g.waveCd = 600;
      faceTowardGuard(g, p);
      startAction(g, 'wave');
      g.say = 210;
      g.line = `Morning, ${state.playerName || 'friend'}! Off to your seat.`;
      setMood(actorFor(g), 'happy', 210);
      continue;
    }

    // Whoever stands close gets looked at — the room's one NPC is attentive,
    // not a statue. Once they walk on, the post faces the door again.
    if (near <= 2 && g.action === 'idle') {
      faceTowardGuard(g, p);
    } else if (near > 3 && g.action === 'idle' && g.dir !== 'left') {
      g.dir = 'left';
    }

    // The doorway watch: a wave back when someone waves first, handled by the
    // emote layer, plus the slow small talk of a long shift.
    if (state.tick >= g.chatterAt && g.say <= 0 && g.action === 'idle') {
      g.chatterAt = state.tick + 600 + Math.floor(g.rand() * 500);
      g.say = 190;
      g.line = CHATTER[Math.floor(g.rand() * CHATTER.length)];
      setMood(actorFor(g), MOODS[Math.floor(g.rand() * MOODS.length)], 190);
    }
  }
}