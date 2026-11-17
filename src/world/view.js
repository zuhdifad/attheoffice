import { TILE, CHAR_H, BUFFER_W, BUFFER_H, VIEWS } from '../core/config.js?v=24';
import { atlasFor } from '../art/tiles.js?v=24';
import { blitPropLayer } from '../art/props.js?v=24';
import { shadowFor } from '../art/shadows.js?v=24';
import { PAL } from '../art/palette.js?v=24';
import { actorFor, drawActor } from '../art/rig.js?v=24';
import { text, px } from '../core/draw.js?v=24';
import { drawGround } from './ground.js?v=24';
import { drawLight, drawGrade, drawTimeOfDay } from './lighting.js?v=24';
import { drawFx } from './fx.js?v=24';
import { now } from '../ui/wallclock.js?v=24';

const LIFT = CHAR_H - TILE;
// A sitter is drawn at floor level in a seated anim — the chair track carries
// the pose, so there is no standing-sprite lift to fake it. The covering is the
// furniture's own z: the tabletop at +6 and the chair back at +10 (art/props.js)
// both sort over a sitter whose foot is on the tile line, hiding a lap and a
// lower back while the torso stays above the desk.

// Positions snap in device space, never in world units: four device pixels to
// the unit means a world-integer sprite would move in steps of four and read as
// a twitch while the camera slides.
const snap = (v, ppu) => Math.round(v * ppu) / ppu;

// Ground first, then one y-sorted pass holding every character and every prop
// layer, so you walk behind a desk and in front of the one below it without any
// layer bookkeeping. A prop is not one entry but as many as it has layers, each
// sorted on its own foot + bias: the far half of a desk can sit behind the
// person at it while its tabletop sits in front. This is the web stand-in for
// Unity's sorting layers, and the wall caps are the one exception — they run
// after every character so nobody can stand through a wall that is behind them.
export function drawWorld(g, state) {
  const { map, npcs, player, cam } = state;
  const { ppu } = VIEWS[state.view] || VIEWS.near;
  // One plate per zoom: 128 px per tile for the close view, 64 for the far one,
  // so whichever is on screen blits 1:1 and never resamples.
  const page = atlasFor(ppu);
  const one = 1 / ppu;
  const at = (v) => snap(v, ppu);

  // Camera shake rides on top of the smoothed camera and decays in world.js.
  const s = cam.shake;
  const rcam = s > 0.05
    ? { x: at(cam.x + (Math.random() - 0.5) * s), y: at(cam.y + (Math.random() - 0.5) * s) }
    : { x: at(cam.x), y: at(cam.y) };

  // The void behind the room is filled in device space, before the world scale
  // goes on, so it covers the whole pixel budget and not just the cull box.
  g.fillStyle = PAL.ink;
  g.fillRect(0, 0, BUFFER_W, BUFFER_H);
  if (!page) return;

  // The whole world pass is scaled once, by ppu, so every constant below stays
  // in world units. Lighting that belongs to the room rides inside the same
  // transform; the full-screen grade and time wash are applied afterwards, in
  // device space.
  g.save();
  g.scale(ppu, ppu);

  // The cull box is the buffer measured in world units — how much floor ppu
  // leaves on screen — not a fixed tile count.
  const viewW = BUFFER_W / ppu;
  const viewH = BUFFER_H / ppu;
  const cols = Math.ceil(viewW / TILE) + 1;
  const rows = Math.ceil(viewH / TILE) + 1;
  const x0 = Math.floor(rcam.x / TILE);
  const y0 = Math.floor(rcam.y / TILE);

  // Ground first: the slab, its baked joint, the zone inlay and the AO at every
  // solid foot arrive as one 1:1 blit per 8x8-tile chunk, cached per LOD on the
  // map itself. A desk sits on the same stone as the aisle beside it, and the
  // frame pays a handful of draws for the whole floor instead of one per tile.
  drawGround(g, map, page, rcam, viewW, viewH);

  const sorted = [];
  const caps = [];

  // One entry per layer, not per prop: the draw list has no idea what a desk is,
  // it only knows a plane of art and the z it belongs at.
  for (const p of map.props) {
    const b = p.def.box;
    // Cull on the box the layers actually paint, not on the footprint: a wall
    // paints two and a half tiles above the tile it stands on.
    if ((p.x + b.right) * TILE < rcam.x || (p.x + b.left) * TILE > rcam.x + viewW) continue;
    if ((p.y + b.bottom) * TILE < rcam.y || (p.y + b.top) * TILE > rcam.y + viewH) continue;
    const ox = at(p.x * TILE - rcam.x);
    const oy = at(p.y * TILE - rcam.y);
    // The prop's baked shadow: one sprite holding the contact pool and the
    // directional cast, sorted just under the prop's own lowest layer so the
    // furniture stands on it. Its box is device-aligned at bake time, so the
    // blit needs no rounding here.
    const sh = shadowFor(p.def, page.tilePx);
    if (sh) {
      let minBias = 0;
      for (const l of p.def.layers) if (!l.cap && l.bias < minBias) minBias = l.bias;
      sorted.push({
        z: p.foot + minBias - 0.5,
        draw: () => g.drawImage(sh.img, ox + sh.x, oy + sh.y, sh.w, sh.h)
      });
    }
    // What a paint layer reads: the sim tick, the prop's own machine state,
    // and the camera — the window's outside view leans against it.
    const m = { tick: state.tick, anim: p.anim || {}, p, cam: rcam, ppu };
    for (const l of p.def.layers) {
      // A cap only exists on the wall module at the back of a run. The map marks
      // the ones buried under a wall in front of them, and those are not drawn at
      // all: a cap pushed into the ordinary pass would stripe the run instead of
      // topping it, and it is written to run after every character.
      if (l.cap && !p.capped) continue;
      const entry = {
        z: p.foot + l.bias,
        draw: () => {
          if (!l.paint) return blitPropLayer(g, page, l, ox, oy);
          g.save();
          g.translate(ox, oy);
          // Paint layers author in tiles, the pass runs in world units: one
          // scale here is the whole contract between the two.
          g.scale(TILE, TILE);
          l.paint(g, m);
          g.restore();
        }
      };
      (l.cap ? caps : sorted).push(entry);
    }
  }

  // Contact shadows go down before anything stands on them.
  const people = [];
  for (const n of npcs) {
    if (n.px / TILE < x0 - 2 || n.px / TILE > x0 + cols + 2) continue;
    if (n.py / TILE < y0 - 2 || n.py / TILE > y0 + rows + 2) continue;
    people.push(n);
  }
  for (const n of people) shadow(g, at(n.px - rcam.x), at(n.py - rcam.y), n.seated ? 11 : 13);
  shadow(g, at(player.px - rcam.x), at(player.py - rcam.y), player.seated ? 11 : 14, PAL.shadow);

  // One call site for every colleague: drawActor picks the layered rig, the
  // baked monolithic rig or the legacy 6x4 sheet internally. Anim and frame
  // come off updateActor, which reads the action state machine — a sitter is
  // always on a chair track, never a shifted standing sprite.
  for (const n of people) {
    const actor = actorFor(n);
    sorted.push({
      z: n.py + TILE,
      draw: () => {
        actor.dx = at(n.px - rcam.x);
        actor.dy = at(n.py - rcam.y - LIFT);
        drawActor(g, actor, ppu);
      }
    });
  }

  // The rig's walk cycle already carries the contact dip, so no synthetic bob is
  // added on top; the idle breath and frame selection live in updateActor.
  sorted.push({
    z: player.py + TILE + 1,
    draw: () => {
      const dx = at(player.px - rcam.x);
      const dy = at(player.py - rcam.y - LIFT);
      heroRing(g, state, dx, dy + LIFT, one);
      const actor = actorFor(player);
      actor.dx = dx;
      actor.dy = dy;
      drawActor(g, actor, ppu);
    }
  });

  sorted.sort((a, b) => a.z - b.z);
  for (const o of sorted) o.draw();

  // The wall tops. Every character is down by now, so a head standing behind a
  // wall is under the cap instead of through it.
  if (caps.length) {
    caps.sort((a, b) => a.z - b.z);
    for (const o of caps) o.draw();
  }

  drawFx(g, rcam, ppu);
  drawLight(g, { map, cam: rcam, cols, rows });

  // Anything that talks to the player sits above the light pass but still in
  // world space, so it tracks the sprite it belongs to.
  for (const n of people) if (n.say > 0) bubble(g, n, rcam, viewW, ppu);
  drawNameTags(g, state, rcam, people, ppu);

  g.restore();

  // The room's light follows the device's own day: cool before mid-morning,
  // amber once the evening comes on.
  const d = now();
  const dayT = Math.max(0, Math.min(1, (d.getHours() + d.getMinutes() / 60 - 7) / 12));
  drawTimeOfDay(g, dayT);
  drawGrade(g);
}

function shadow(g, dx, dy, w, color = 'rgba(12,14,20,0.26)') {
  g.save();
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(dx + TILE / 2, dy + TILE - 3, w / 2, w / 4.6, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

// A quiet ring under the player, in their own accent, so you never lose
// yourself in a crowd of seven identical silhouettes.
function heroRing(g, state, dx, dy, one) {
  const pulse = 0.42 + Math.sin(state.tick * 0.07) * 0.12;
  g.save();
  g.globalAlpha = pulse;
  g.strokeStyle = state.chosen.tint;
  g.lineWidth = one;
  g.beginPath();
  g.ellipse(dx + TILE / 2, dy + TILE - 3, 9, 4, 0, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

function bubble(g, n, cam, viewW, ppu) {
  const dx = snap(n.px - cam.x, ppu) + TILE / 2;
  const dy = snap(n.py - cam.y, ppu) - LIFT - 4;
  g.font = '7px ui-monospace, Menlo, monospace';
  const w = Math.min(150, Math.ceil(g.measureText(n.line).width) + 10);
  const x = Math.max(2, Math.min(viewW - w - 2, dx - w / 2));
  const y = Math.max(14, dy - 14);
  const fade = Math.min(1, n.say / 30);

  g.save();
  g.globalAlpha = fade * 0.94;
  px(g, x, y, w, 13, 'rgba(243,241,236,0.94)');
  px(g, x, y + 12, w, 1, 'rgba(20,23,31,0.30)');
  g.fillStyle = 'rgba(243,241,236,0.94)';
  g.beginPath();
  g.moveTo(dx - 3, y + 13);
  g.lineTo(dx + 3, y + 13);
  g.lineTo(dx, y + 17);
  g.closePath();
  g.fill();
  text(g, n.line, x + w / 2, y + 9, PAL.ink, 'center', 7);
  g.restore();
}

// Names only appear near the player, so the room stays readable instead of
// wearing seven floating labels at once.
function drawNameTags(g, state, cam, people, ppu) {
  const p = state.player;
  for (const n of people) {
    if (n.say > 0) continue;
    const d = Math.abs(n.tx - p.tx) + Math.abs(n.ty - p.ty);
    if (d > 2) continue;
    const dx = snap(n.px - cam.x, ppu) + TILE / 2;
    const dy = snap(n.py - cam.y, ppu) - LIFT - 2;
    g.save();
    g.globalAlpha = Math.max(0, 1 - (d - 1) * 0.4);
    text(g, n.name, dx, dy, n.tint, 'center', 7, 'rgba(8,10,15,0.85)');
    g.restore();
  }
}
