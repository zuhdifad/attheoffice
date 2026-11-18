// ---- Layered actor rig: the atlas contract -----------------------------------
//
// An actor is body + head + hair + face (brows | eyes | mouth) + overlay. Each
// layer is its own sheet with the pivot baked into every cell: the art sits in
// the cell so that all layers drawn at one origin composite into the posed
// doll. The head is never part of the body sheet.
//
// Files, per character id:
//
//   assets/chars/<id>/body@4.png   near LOD, 4 device px per world unit
//   assets/chars/<id>/body@2.png   far LOD, 2 px per unit (optional; @4 stands in)
//   assets/chars/<id>/head@4.png   skin + rim, same grid as body (optional)
//   assets/chars/<id>/hair@4.png   hair mass, same grid as body (optional)
//   assets/chars/<id>/face@4.png   brows/eyes/mouth, expression blocks (optional)
//   assets/chars/<id>/overlay@4.png  held props / worn extras, same grid (optional)
//   assets/chars/<id>/meta.json    the manifest below
//
// meta.json:
//   {
//     cell: [w, h],                  // @4 cell size in px, e.g. [128, 192]
//     dirs: ['down', 'side', 'up'],  // the only three authored directions
//     anims: {
//       name: { row, frames, fps, loop, dirStride }
//       // row: sheet row of the anim. frames: count. fps/loop: free-running
//       // playback (the sim drives in-game frames). dirStride: columns per
//       // direction block, >= frames. Cell address:
//       //   col = dirIndex * dirStride + frame,  row = anim.row
//     },
//     pivots: { head: [x, y], foot: [x, y] },  // in @4 cell px
//     mirror: true,                  // left is mirrored from side at draw time
//     expressions: ['neutral', ...], // optional; face sheet vertical blocks
//     layerCells: { head: [w, h], hair: [w, h], face: [w, h] }  // optional
//   }
//
// The face sheet repeats the body's anim grid once per expression, stacked
// vertically: face row = exprIndex * animRows + anim.row, so a talking mouth
// stays in sync with the head. animRows = max(anims.row) + 1.
//
// head/hair/face cells may be top crops of the body cell (layerCells): the art
// keeps its coordinates, the cell just ends below the neck instead of at the
// feet, which halves what those layers decode to. Alignment is by pivot: a
// layer is drawn so its baked head pivot lands on the body's head pivot, so a
// top crop with unchanged pivot coordinates draws at the shared origin.
//
// body@2 cells are exactly half the @4 cell; head/hair/face/overlay are @4 only
// and downscale 2:1 with smoothing off in the far view.
//
// Fallback ladder, all behind one drawActor call:
//   1. meta.json present and body@4 loaded -> layered draw (this module)
//   2. baked monolithic rig sheet present  -> drawRigChar (characters.js)
//   3. neither                             -> the legacy 6x4 sheetFor(id) path
// Absent meta.json is not an error; it is the signal to keep the old art.
//
// Runtime API: playAnim(actor, name), setExpression(actor, name, intensity),
// updateActor(actor, dt), drawActor(g, actor, ppu). Positions ride on the actor
// (dx/dy, device-snapped world units) because the view owns camera snapping.
//
// Expressions ride on the same actor: art/expressions.js owns the mood (current,
// target, eased t, hold, blink, gaze) and paints the shared face — three 64x64
// layers at the head pivot plus a 24x24 overlay — over whichever body path
// draws. Poses are transforms on the doll, never a new sheet.

import { CHAR_W, CHAR_H, VIEWS, RIG } from '../core/config.js?v=26';
import { drawChar, drawRigChar, rigFor } from './characters.js?v=26';
import { ACTIONS, actionFrame } from '../entities/actions.js?v=26';
import {
  POSES, createMood, updateMood, setMood, faceBlend, drawFace
} from './expressions.js?v=26';

const RIGS = new Map();   // id -> { meta, animRows, body, head, hair, face, overlay } | null
const LOADS = new Map();  // id -> Promise<boolean>, so boot and QA share one fetch

const load = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  // Decode before the sheet is handed to the view: a lazy first drawImage
  // would raster the whole layer inside a live frame and stall it.
  img.onload = () => (img.decode ? img.decode() : Promise.resolve()).then(() => resolve(img), () => resolve(img));
  img.onerror = () => reject(new Error(`rig layer failed to load: ${src}`));
  img.src = src;
});
const optional = (src) => load(src).catch(() => null);

export function loadActorRig(id) {
  if (LOADS.has(id)) return LOADS.get(id);
  const p = (async () => {
    let meta = null;
    try {
      const res = await fetch(`assets/chars/${id}/meta.json`);
      if (res.ok) meta = await res.json();
    } catch (err) {
      meta = null;
    }
    // A malformed manifest is the same as an absent one: fall back, never break.
    if (!meta || !Array.isArray(meta.cell) || !Array.isArray(meta.dirs) || !meta.anims) {
      RIGS.set(id, null);
      return false;
    }
    const base = `assets/chars/${id}`;
    try {
      const [b4, b2, head, hair, face, overlay] = await Promise.all([
        load(`${base}/body@4.png`),
        optional(`${base}/body@2.png`),
        optional(`${base}/head@4.png`),
        optional(`${base}/hair@4.png`),
        optional(`${base}/face@4.png`),
        optional(`${base}/overlay@4.png`)
      ]);
      const animRows = Object.values(meta.anims).reduce((m, a) => Math.max(m, a.row + 1), 0);
      RIGS.set(id, {
        meta, animRows,
        body: { 4: b4, 2: b2 || b4 },
        head, hair, face, overlay
      });
      return true;
    } catch (err) {
      RIGS.set(id, null);
      return false;
    }
  })();
  LOADS.set(id, p);
  return p;
}

export function actorRigFor(id) {
  return RIGS.get(id) || null;
}

// Any rig that will draw in this view — layered, or the baked monolithic sheet
// for the stop on screen. The view uses this to pick floor positioning: rig art
// meets the chair at floor level, the legacy sheet needs the seat biases. The
// check is per-view because residency evicts near sheets outside the close
// view; positioning must agree with what drawActor will actually pick.
export function hasRig(id, view) {
  return !!RIGS.get(id) || !!rigFor(id, view || 'near');
}

// ---- actor state --------------------------------------------------------------

export function createActor(id) {
  return {
    id,
    dir: 'down',
    anim: 'idle',
    frame: 0,
    t: 0,            // free-running playback clock, in frames
    tick: 0,         // sim ticks consumed, kept in lockstep with state.tick
    expression: { name: 'neutral', intensity: 1 },
    mood: createMood(),  // the expression system's per-actor state
    entity: null,    // linked player/npc when the sim drives the actor
    lod: null,       // optional LOD override ('4'/'2'); else derived from ppu
    dx: 0, dy: 0     // device-snapped world position, set by the view each frame
  };
}

// One actor per entity, cached on the entity itself so the roster, the view and
// the update loop all reach the same state without a side table. A remote
// person carries a session id for the sim but a character id for the art, so
// the doll is looked up by artId when one is set.
export function actorFor(entity) {
  if (!entity.actor) {
    entity.actor = createActor(entity.artId || entity.id);
    entity.actor.entity = entity;
  }
  return entity.actor;
}

export function playAnim(actor, name) {
  const rig = RIGS.get(actor.id);
  const known = rig ? rig.meta.anims[name] : RIG.actions[name];
  if (!known) return false;
  if (actor.anim !== name) {
    actor.anim = name;
    actor.frame = 0;
    actor.t = 0;
  }
  return true;
}

export function setExpression(actor, name, intensity = 1) {
  actor.expression = { name, intensity: Math.max(0, Math.min(1, intensity)) };
  // The mood is the live state: intensity scales how long the face holds, and
  // a zero intensity is the release back to the resting face.
  setMood(actor, intensity > 0 ? name : 'neutral', Math.round(240 * intensity));
}

// The head pivot in world units: the layered manifest bakes it in @4 cell px,
// the monolithic rig shares the normalized doll's pivot, and the legacy 6x4
// sheet carries its head a little lower in the box.
function headPivot(actor, rig, view) {
  if (rig && rig.meta.pivots && rig.meta.pivots.head) {
    return { x: rig.meta.pivots.head[0] / 4, y: rig.meta.pivots.head[1] / 4 };
  }
  if (rigFor(actor.id, view)) return { x: 16, y: 11.5 };
  return { x: 16, y: 15 };
}

// Advance one fixed step. A linked entity is sim-driven: the anim and frame
// come off the same tick maths the legacy view used, so gameplay timing is
// unchanged. A free actor (contact sheet, cutscenes) plays its anim by fps.
export function updateActor(actor, dt) {
  actor.tick += dt * 60;
  updateMood(actor, dt);
  const e = actor.entity;
  if (!e) {
    // Free-running playback: the layered anim carries its own fps/loop; the
    // baked monolithic actions and the legacy sheet ride a default cadence,
    // which is all the contact sheet needs of them.
    const rig = RIGS.get(actor.id);
    const a = rig && rig.meta.anims[actor.anim];
    const frames = a ? a.frames : (RIG.actions[actor.anim] || RIG.actions.idle)[1];
    const fps = a ? a.fps : 10;
    const loop = a ? a.loop : true;
    actor.t += dt * fps;
    const f = Math.floor(actor.t);
    actor.frame = loop ? f % frames : Math.min(f, frames - 1);
    applyPose(actor);
    return;
  }

  actor.dir = e.dir;
  const rig = RIGS.get(actor.id);
  // Either LOD counts here: anim selection is view-independent, and residency
  // guarantees the sheet for the stop on screen is resident before it draws.
  if (!rig && !rigFor(actor.id, 'near') && !rigFor(actor.id, 'far')) {
    // Legacy sheet: the entity's own frame, exactly as the old view drew it.
    actor.frame = e.frame || 0;
    return;
  }
  const frames = (name) => (rig ? rig.meta.anims[name].frames : RIG.actions[name][1]);
  const tick = Math.floor(actor.tick);
  // The action state machine owns the pose. An entity staged without an
  // explicit action falls back to the seated/moving read, so a chair track is
  // never lost and a sitter is never drawn standing.
  const action = e.action || (e.seated ? 'type' : e.moving ? 'walk' : 'idle');
  const a = ACTIONS[action] || ACTIONS.idle;
  let anim, frame;
  if (e.say > 0 && a.loop && action !== 'walk') {
    // Chatter overrides a resting loop, never a transition in flight.
    anim = 'talk';
    frame = Math.floor((tick + (e.off || 0)) / 8) % frames(anim);
  } else if (action === 'walk') {
    anim = 'walk';
    frame = e.frame;
  } else if (e.action) {
    anim = a.anim;
    frame = actionFrame(e);
  } else {
    // Legacy breath: the seated type nudge and the idle breath ride the sim
    // clock, decorrelated per colleague by their offset.
    anim = a.anim;
    frame = Math.floor((tick + (e.off || 0)) / (action === 'type' ? 8 : 10)) % frames(anim);
  }
  playAnim(actor, anim);
  actor.frame = frame;
  applyPose(actor);
}

// A pose overrides the body animation by holding a frame of an anim the rig
// already owns — hands-up borrows wave, hand-to-face borrows sip. A seated doll
// keeps its chair track: standing anims on a chair read as a glitch, so there
// the pose is only the transform drawActor applies.
function applyPose(actor) {
  const b = faceBlend(actor.mood);
  const pose = POSES[b.dom.pose] || POSES.neutral;
  if (!pose.anim) return;
  if (actor.entity && actor.entity.seated) return;
  // A transition in flight owns its track: a mood may not borrow a different
  // anim mid sit-down, mid sip or mid stand-up.
  if (actor.entity && actor.entity.action) {
    const a = ACTIONS[actor.entity.action];
    if (a && !a.loop) return;
  }
  const rig = RIGS.get(actor.id);
  const known = rig ? rig.meta.anims[pose.anim] : RIG.actions[pose.anim];
  if (!known) return;
  const frames = rig ? known.frames : known[1];
  playAnim(actor, pose.anim);
  actor.frame = Math.min(pose.frame, frames - 1);
}

// ---- drawing ------------------------------------------------------------------

// The one call site for every actor, new or old. Returns false only when no art
// exists at all, so callers can treat a miss as "nothing drawn", never a crash.
// The pose rides here as a transform around the foot pivot — the same doll,
// leaned or slumped, never a new sheet — and the shared face goes on last, in
// the same space, so it leans and slumps with the body it belongs to.
export function drawActor(g, actor, ppu) {
  const rig = RIGS.get(actor.id);
  const view = actor.lod === '2' ? 'far'
    : actor.lod === '4' ? 'near'
    : (ppu <= VIEWS.far.ppu ? 'far' : 'near');
  const b = faceBlend(actor.mood);
  const pf = POSES[b.from.pose] || POSES.neutral;
  const pt = POSES[b.to.pose] || POSES.neutral;
  const mix = (a, c) => a + (c - a) * b.k;
  const sign = actor.dir === 'left' ? -1 : actor.dir === 'right' ? 1 : actor.dir === 'up' ? -0.5 : 0.5;
  const rot = mix(pf.rot, pt.rot) * sign;
  const dx = mix(pf.dx, pt.dx);
  const dy = mix(pf.dy, pt.dy);
  const sy = mix(pf.sy, pt.sy);

  g.save();
  g.translate(actor.dx, actor.dy);
  if (rot || dx || dy || sy !== 1) {
    g.translate(CHAR_W / 2, CHAR_H);
    g.rotate(rot);
    g.scale(1, sy);
    g.translate(-CHAR_W / 2, -CHAR_H);
    g.translate(dx, dy);
  }
  let drew = false;
  let flip = false;
  if (rig) {
    const r = drawLayered(g, actor, rig, view);
    drew = r.drew;
    flip = r.flip;
  } else if (rigFor(actor.id, view)) {
    // The baked sheets author all four rows, face included: nothing is
    // mirrored here, so the face goes on unflipped.
    drew = drawRigChar(g, actor.id, actor.dir, actor.anim, actor.frame, 0, 0, view);
  } else {
    drew = drawChar(g, actor.id, actor.dir, actor.frame, 0, 0);
  }
  // A layered rig with its own head layer carries a clean skull, so the
  // features need no backing; every baked doll gets the skin mask instead.
  if (drew) drawFace(g, actor, headPivot(actor, rig, view), { patch: !(rig && rig.head), flip });
  g.restore();
  return drew;
}

function drawLayered(g, actor, rig, view) {
  const meta = rig.meta;
  const [cw, ch] = meta.cell;
  // Only three directions are authored; left is the side block flipped around
  // the cell centre at draw time. CHAR_W is even, so the flip keeps the sprite
  // on the device pixel grid the view snapped it to.
  const authored = actor.dir === 'left' ? 'side' : actor.dir;
  const di = Math.max(0, meta.dirs.indexOf(authored));
  const flip = actor.dir === 'left' && meta.mirror !== false;
  const a = meta.anims[actor.anim] || meta.anims.idle;
  const frame = Math.max(0, Math.min(a.frames - 1, actor.frame));
  const sx = (di * a.dirStride + frame) * cw;
  const sy = a.row * ch;
  const k = CHAR_W / cw;   // @4 cell px -> world units

  g.save();
  if (flip) {
    g.translate(CHAR_W, 0);
    g.scale(-1, 1);
  }
  // The body carries the foot pivot and sets the world box; every other layer
  // is placed so its baked head pivot lands on the body's head pivot. Layers
  // whose cell is a top crop of the body cell keep the pivot coordinates, so
  // the offset is zero and one origin composites the doll. The box stays the
  // legacy 32x48 and the y-sort / lift maths never changes.
  const blit = (img, x, y, w, h, ox, oy) => {
    if (img) g.drawImage(img, x, y, w, h, ox, oy, w * k, h * k);
  };
  if (view === 'far') {
    // body@2 is half-cell art: sample the @2 cell at half coordinates, but the
    // dest stays the full 32x48 world box (cw*k x ch*k) so it blits 1:1 at ppu 2
    // and the doll keeps its size. When no @2 was baked, @4 stands in: sample
    // the full @4 cell and let the same dest downscale it 2:1, smoothing off.
    const img = rig.body[2];
    if (img) {
      const half = img !== rig.body[4];
      g.drawImage(img, half ? sx / 2 : sx, half ? sy / 2 : sy,
        half ? cw / 2 : cw, half ? ch / 2 : ch, 0, 0, cw * k, ch * k);
    }
  } else {
    blit(rig.body[4], sx, sy, cw, ch, 0, 0);
  }
  const headLayer = (name, img, row) => {
    if (!img) return;
    const [lw, lh] = (meta.layerCells && meta.layerCells[name]) || [cw, ch];
    // Pivot alignment: the body's head pivot lands at hp * k in world units,
    // and a top-crop layer bakes the same pivot at the same cell coordinates,
    // so its offset from the shared origin is hp * k - hp * k = 0.
    blit(img, sx, row * lh, lw, lh, 0, 0);
  };
  headLayer('head', rig.head, a.row);
  headLayer('hair', rig.hair, a.row);
  // The authored face block is the resting face: it fades out exactly as fast
  // as the shared expression fades in, so the two never double up.
  const presence = faceBlend(actor.mood).presence;
  if (rig.face && presence < 0.98) {
    const names = meta.expressions || ['neutral'];
    const ei = Math.max(0, names.indexOf('neutral'));
    g.globalAlpha = 1 - presence;
    headLayer('face', rig.face, ei * rig.animRows + a.row);
    g.globalAlpha = 1;
  }
  blit(rig.overlay, sx, sy, cw, ch, 0, 0);
  g.restore();
  return { drew: true, flip };
}