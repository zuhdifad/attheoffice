// ?rig=1 — the actor contact sheet. Every animation and every direction of
// every colleague, laid out on the same 1280x720 buffer the game draws into,
// through the same drawActor call the floor uses. Layered rigs show their
// meta.json grid; baked monolithic rigs show the 47-column sheet's actions;
// everyone else shows the legacy 6x4 sheetFor(id) fallback, labelled as such.
//
// Keys: Left/Right page the cast, Up/Down pick the live anim, Z swaps LOD.
// The live strip at the bottom runs the runtime API for real: playAnim,
// updateActor, setExpression, and the draw-time left mirror.

import { BUFFER_W, BUFFER_H, CHAR_W, CHAR_H, SHEET_COLS, RIG, FRAME_MS } from '../core/config.js?v=26';
import { CHARACTERS, PAL } from '../art/palette.js?v=26';
import { loadRigNear, loadRigFar, evictRigNear, rigFor, sheetFor } from '../art/characters.js?v=26';
import { loadActorRig, actorRigFor, createActor, playAnim, setExpression, updateActor, drawActor } from '../art/rig.js?v=26';
import { updateMood } from '../art/expressions.js?v=26';
import { state } from '../core/state.js?v=26';
import { applyZoom } from '../core/display.js?v=26';
import { text, px } from '../core/draw.js?v=26';

const DIRS4 = ['down', 'side', 'up', 'left'];
const LIVE_DIRS = ['down', 'side', 'up', 'left'];

let actors = [];
let page = 0;
let lod = '4';
let animIdx = 0;
let scratch = null;   // one reused actor for the static grid cells

const animNames = () => {
  const rig = actorRigFor(CHARACTERS[page].id);
  if (rig) return Object.keys(rig.meta.anims);
  if (rigFor(CHARACTERS[page].id, 'near') || rigFor(CHARACTERS[page].id, 'far')) {
    return Object.keys(RIG.actions);
  }
  return ['walk'];
};

const kindOf = (id) => {
  if (actorRigFor(id)) return 'LAYERED';
  if (rigFor(id, 'near') || rigFor(id, 'far')) return 'BAKED';
  return 'LEGACY';
};

async function loadPage(next) {
  const prev = CHARACTERS[page] && CHARACTERS[page].id;
  page = (next + CHARACTERS.length) % CHARACTERS.length;
  const id = CHARACTERS[page].id;
  animIdx = 0;
  // Near sheets are the expensive ones: keep only the page on screen, the way
  // world/residency.js keeps only the close view's neighbours.
  await Promise.all([loadRigNear(id), loadRigFar(id), loadActorRig(id)]);
  if (prev && prev !== id) evictRigNear(prev);
}

export async function open() {
  // Far sheets for the whole cast so the kind badges tell the truth; layered
  // atlases are resident by design. Near sheets stay per-page.
  await Promise.all(CHARACTERS.flatMap((c) => [loadActorRig(c.id), loadRigFar(c.id)]));
  actors = CHARACTERS.map((c) => createActor(c.id));
  scratch = createActor('');
  await loadPage(0);

  state.mode = 'rig';
  state.running = true;
  state.view = 'near';
  document.getElementById('gameArea').style.display = 'block';
  document.body.classList.add('in-game');
  applyZoom(state);

  window.addEventListener('keydown', (e) => {
    if (state.mode !== 'rig') return;
    const k = e.key;
    if (k === 'ArrowLeft') { e.preventDefault(); loadPage(page - 1); }
    else if (k === 'ArrowRight') { e.preventDefault(); loadPage(page + 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); animIdx = (animIdx + animNames().length - 1) % animNames().length; }
    else if (k === 'ArrowDown') { e.preventDefault(); animIdx = (animIdx + 1) % animNames().length; }
    else if (k.toLowerCase() === 'z') { lod = lod === '4' ? '2' : '4'; }
  });

  // QA handle: the page, the LOD and the live anim, beside the shared buffer.
  if (window.__office) {
    window.__office.rig = {
      get page() { return page; },
      get lod() { return lod; },
      get anim() { return animNames()[animIdx]; },
      kindOf,
      actors
    };
  }
}

export function update(st) {
  st.tick++;
  const live = actors[page];
  if (!live) return;
  const names = animNames();
  playAnim(live, names[animIdx % names.length]);
  // Cycle every direction, left included, so the mirror is on screen too.
  live.dir = LIVE_DIRS[Math.floor(st.tick / 75) % LIVE_DIRS.length];
  updateActor(live, FRAME_MS / 1000);
}

export function draw(g, st) {
  g.fillStyle = PAL.ink;
  g.fillRect(0, 0, BUFFER_W, BUFFER_H);
  const who = CHARACTERS[page];
  const kind = kindOf(who.id);

  // Header.
  text(g, `ACTOR RIG — ${who.name}`, 24, 26, PAL.text, 'left', 16);
  const badge = kind === 'LAYERED' ? PAL.ok : kind === 'BAKED' ? PAL.info : PAL.warn;
  text(g, `${kind} · LOD @${lod}`, BUFFER_W - 24, 22, badge, 'right', 10);
  text(g, `${page + 1} / ${CHARACTERS.length} · ${who.id}`, BUFFER_W - 24, 38, PAL.textDim, 'right', 8);
  px(g, 24, 44, BUFFER_W - 48, 1, PAL.surfaceHi);

  if (kind === 'LAYERED') drawLayeredGrid(g, st, who);
  else if (kind === 'BAKED') drawBakedGrid(g, st, who);
  else drawLegacySheet(g, st, who);

  drawLiveStrip(g, st, who, kind);

  text(g, '←/→ colleague    ↑/↓ anim    Z lod', 24, BUFFER_H - 12, PAL.textFaint, 'left', 8);
  const counts = { LAYERED: 0, BAKED: 0, LEGACY: 0 };
  for (const c of CHARACTERS) counts[kindOf(c.id)]++;
  text(g, `layered ${counts.LAYERED} · baked ${counts.BAKED} · legacy ${counts.LEGACY}`,
    BUFFER_W - 24, BUFFER_H - 12, PAL.textFaint, 'right', 8);
}

// ---- grids -------------------------------------------------------------------
// Cells are drawn through drawActor itself — the contact sheet exercises the
// production path, not a re-implementation of it. The scratch actor carries the
// LOD override and a device-space position; ppu is chosen so the 32x48 world
// box lands at exactly the display cell size.

const GRID = { x: 120, y: 64, w: BUFFER_W - 144, h: 488 };

function gridScale(rows, dirs, maxFrames, cw, ch) {
  return Math.min(GRID.h / (rows * ch), GRID.w / (dirs * maxFrames * cw));
}

function drawLayeredGrid(g, st, who) {
  const rig = actorRigFor(who.id);
  const meta = rig.meta;
  const names = Object.keys(meta.anims);
  const [cw, ch] = meta.cell;
  const maxFrames = Math.max(...names.map((n) => meta.anims[n].frames));
  const s = gridScale(names.length, 3, maxFrames, cw, ch);
  const cellW = cw * s, cellH = ch * s;
  const live = actors[page];

  for (let di = 0; di < 3; di++) {
    text(g, meta.dirs[di], GRID.x + di * maxFrames * cellW + 4, GRID.y - 6, PAL.textDim, 'left', 8);
  }
  names.forEach((name, row) => {
    const a = meta.anims[name];
    const y = GRID.y + row * cellH;
    text(g, name, GRID.x - 12, y + cellH / 2 + 3, row === animIdx ? PAL.amber : PAL.textDim, 'right', 9);
    text(g, `${a.frames}f`, GRID.x - 12, y + cellH / 2 + 14, PAL.textFaint, 'right', 7);
    for (let di = 0; di < 3; di++) {
      for (let f = 0; f < a.frames; f++) {
        const x = GRID.x + (di * maxFrames + f) * cellW;
        px(g, x, y, cellW - 1, cellH - 1, row % 2 ? PAL.surface : PAL.night);
        scratch.id = who.id;
        scratch.dir = meta.dirs[di];
        scratch.anim = name;
        scratch.frame = f;
        scratch.lod = lod;
        scratch.dx = x;
        scratch.dy = y;
        drawActor(g, scratch, 4 * s);
        // The live playhead: where updateActor currently sits in this anim.
        if (name === live.anim && f === live.frame && meta.dirs[di] === (live.dir === 'left' ? 'side' : live.dir)) {
          g.strokeStyle = PAL.amber;
          g.lineWidth = 1;
          g.strokeRect(x + 0.5, y + 0.5, cellW - 2, cellH - 2);
        }
      }
    }
  });
}

function drawBakedGrid(g, st, who) {
  const view = lod === '2' ? 'far' : 'near';
  const [cw, ch] = RIG[view].cell;
  const names = Object.keys(RIG.actions);
  const maxFrames = Math.max(...names.map((n) => RIG.actions[n][1]));
  const dirs = ['down', 'left', 'right', 'up'];
  const s = gridScale(names.length, 4, maxFrames, cw, ch);
  const cellW = cw * s, cellH = ch * s;
  const live = actors[page];

  for (let di = 0; di < 4; di++) {
    text(g, dirs[di], GRID.x + di * maxFrames * cellW + 4, GRID.y - 6, PAL.textDim, 'left', 8);
  }
  names.forEach((name, row) => {
    const [col0, count] = RIG.actions[name];
    const y = GRID.y + row * cellH;
    text(g, name, GRID.x - 12, y + cellH / 2 + 3, row === animIdx ? PAL.amber : PAL.textDim, 'right', 9);
    for (let di = 0; di < 4; di++) {
      for (let f = 0; f < count; f++) {
        const x = GRID.x + (di * maxFrames + f) * cellW;
        px(g, x, y, cellW - 1, cellH - 1, row % 2 ? PAL.surface : PAL.night);
        scratch.id = who.id;
        scratch.dir = dirs[di];
        scratch.anim = name;
        scratch.frame = f;
        scratch.lod = lod;
        scratch.dx = x;
        scratch.dy = y;
        drawActor(g, scratch, 4 * s);
        if (name === live.anim && f === live.frame && dirs[di] === live.dir) {
          g.strokeStyle = PAL.amber;
          g.lineWidth = 1;
          g.strokeRect(x + 0.5, y + 0.5, cellW - 2, cellH - 2);
        }
      }
    }
  });
}

function drawLegacySheet(g, st, who) {
  const sheet = sheetFor(who.id);
  text(g, 'no meta.json — sheetFor(id) fallback, unchanged', GRID.x, GRID.y + 4, PAL.warn, 'left', 9);
  if (!sheet) return;
  // The whole 6x4 sheet at 2x, rows labelled with the legacy direction map.
  const s = 2;
  const x0 = GRID.x, y0 = GRID.y + 24;
  const rows = ['down', 'left', 'right', 'up'];
  for (let r = 0; r < 4; r++) {
    text(g, rows[r], x0 - 12, y0 + r * CHAR_H * s + CHAR_H * s / 2, PAL.textDim, 'right', 9);
    for (let c = 0; c < SHEET_COLS; c++) {
      px(g, x0 + c * CHAR_W * s, y0 + r * CHAR_H * s, CHAR_W * s - 1, CHAR_H * s - 1, r % 2 ? PAL.surface : PAL.night);
      g.drawImage(sheet, c * CHAR_W, r * CHAR_H, CHAR_W, CHAR_H,
        x0 + c * CHAR_W * s, y0 + r * CHAR_H * s, CHAR_W * s, CHAR_H * s);
    }
  }
  // And the production fallback itself: one drawActor row, walking frames.
  const y1 = y0 + 4 * CHAR_H * s + 24;
  text(g, 'drawActor fallback path', x0, y1 - 6, PAL.textDim, 'left', 8);
  const frame = Math.floor(st.tick / 10) % SHEET_COLS;
  rows.forEach((d, i) => {
    scratch.id = who.id;
    scratch.dir = d;
    scratch.anim = 'walk';
    scratch.frame = frame;
    scratch.lod = null;
    scratch.dx = x0 + i * (CHAR_W * 2 + 16);
    scratch.dy = y1;
    drawActor(g, scratch, 2);
  });
}

// ---- live strip ----------------------------------------------------------------
// The runtime API, running: one actor advanced by updateActor each step, drawn
// in all four directions (left mirrored at draw time), plus the expression
// intensity ramp when a face layer exists.

function drawLiveStrip(g, st, who, kind) {
  const y = 576;
  px(g, 24, y - 16, BUFFER_W - 48, 1, PAL.surfaceHi);
  text(g, 'LIVE — playAnim · updateActor · setExpression · mirror', 24, y - 4, PAL.textDim, 'left', 8);
  const live = actors[page];
  const cellW = CHAR_W * 2, cellH = CHAR_H * 2;   // ppu 2 -> 64x96

  LIVE_DIRS.forEach((d, i) => {
    const x = 24 + i * (cellW + 24);
    px(g, x, y + 8, cellW, cellH, PAL.night);
    live.dir = d;
    live.lod = kind === 'LEGACY' ? null : lod;
    live.dx = x;
    live.dy = y + 8;
    drawActor(g, live, 2);
    text(g, d === 'left' ? 'left (mirrored)' : d, x + cellW / 2, y + cellH + 20, PAL.textFaint, 'center', 7);
    // Pivot crosshairs on the first cell: the contract made visible.
    if (i === 0 && kind === 'LAYERED') {
      const meta = actorRigFor(who.id).meta;
      const k = CHAR_W / meta.cell[0];
      for (const [name, p] of Object.entries(meta.pivots || {})) {
        const cx = x + p[0] * k * 2, cy = y + 8 + p[1] * k * 2;
        px(g, cx - 3, cy, 7, 1, PAL.amber);
        px(g, cx, cy - 3, 1, 7, PAL.amber);
        text(g, name, cx + 6, cy + 3, PAL.amber, 'left', 6);
      }
    }
  });

  const rig = actorRigFor(who.id);
  if (rig && rig.face) {
    const x0 = 24 + 4 * (cellW + 24) + 24;
    text(g, 'expression intensity', x0, y + 4, PAL.textDim, 'left', 8);
    [1, 0.5, 0].forEach((intensity, i) => {
      const x = x0 + i * (cellW + 16);
      px(g, x, y + 8, cellW, cellH, PAL.night);
      const saveExp = live.expression, saveMood = live.mood;
      setExpression(live, 'happy', intensity);
      // Intensity is hold time: settle past the half hold so 1.0 still holds
      // the face, 0.5 is caught mid-release and 0.0 is back at rest.
      for (let s = 0; s < 130; s++) updateMood(live, FRAME_MS / 1000);
      live.dir = 'down';
      live.dx = x;
      live.dy = y + 8;
      drawActor(g, live, 2);
      live.expression = saveExp;
      live.mood = saveMood;
      text(g, intensity.toFixed(1), x + cellW / 2, y + cellH + 20, PAL.textFaint, 'center', 7);
    });
  }

  const infoX = BUFFER_W - 260;
  text(g, `anim  ${live.anim}`, infoX, y + 20, PAL.text, 'left', 9);
  text(g, `frame ${live.frame}`, infoX, y + 36, PAL.textDim, 'left', 9);
  text(g, `dir   ${live.dir}`, infoX, y + 52, PAL.textDim, 'left', 9);
  text(g, kind === 'LAYERED' ? 'body + head + hair + face' : kind === 'BAKED' ? 'monolithic rig sheet' : 'legacy 6x4 sheet',
    infoX, y + 76, PAL.textFaint, 'left', 8);
}