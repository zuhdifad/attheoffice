// Headless runtime QA: drives the real game in headless Chrome over CDP and
// asserts on live state, canvas pixels and layout — not on DOM guesses.
// Run: node tools/qa.mjs   (screenshots land in qa/)
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = new URL('..', import.meta.url).pathname;
const OUT = `${ROOT}qa/`;
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = [];
const ok = (name, pass, detail = '') => {
  report.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9222', '--window-size=1440,900',
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  `--user-data-dir=${ROOT}.qa-profile`, 'about:blank'
], { stdio: 'ignore' });

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome did not expose a debug target');
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        this.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      } else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
        this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
      }
    });
  }
  send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = ++this.id;
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async ev(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result.value;
  }
  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT + name + '.png', Buffer.from(data, 'base64'));
  }
}

const PIXEL_PROOF = `(() => {
  const c = document.getElementById('gameCanvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 40) seen.add((d[i] >> 4) + ',' + (d[i+1] >> 4) + ',' + (d[i+2] >> 4));
  return { distinctColors: seen.size, dataUrlLen: c.toDataURL().length };
})()`;

// The clock chip is authored in the 480x288 design space; if the UI pass is
// scaled, it has to land in the top-right corner of the 1280x720 buffer rather
// than at 480-space coordinates.
const HUD_PROOF = `(() => {
  const b = window.__office.buffer;
  const x = b.getContext('2d');
  const corner = x.getImageData(b.width - 60, 8, 40, 40).data;
  let parchment = 0;
  for (let i = 0; i < corner.length; i += 4) {
    if (corner[i] > 225 && corner[i+1] > 215 && corner[i+2] > 180) parchment++;
  }
  return { w: b.width, h: b.height, parchment };
})()`;

// What the renderer frames, straight from the module that defines it: the cull
// box is the buffer measured in world units at the current pixels-per-unit.
const SPAN_PROOF = `(async () => {
  const c = await import('/src/core/config.js?v=24');
  const span = (ppu) => [c.BUFFER_W / ppu / c.TILE, c.BUFFER_H / ppu / c.TILE];
  return { near: span(c.VIEWS.near.ppu), far: span(c.VIEWS.far.ppu), buf: [c.BUFFER_W, c.BUFFER_H] };
})()`;

// The live stop, not the config's promise: the canvas backing store, the view
// the sim is actually on, and the tile span that view's ppu leaves on screen.
// Read at both stops, so a zoom that changed the buffer or stranded the state
// between stops fails here rather than in a screenshot.
const VIEW_PROOF = `(async () => {
  const c = await import('/src/core/config.js?v=24');
  const s = window.__office.state;
  const cv = document.getElementById('gameCanvas');
  const ppu = c.VIEWS[s.view].ppu;
  return JSON.stringify({
    view: s.view, zoom: s.zoom, ppu,
    backing: [cv.width, cv.height],
    buffer: [window.__office.buffer.width, window.__office.buffer.height],
    tiles: [c.BUFFER_W / ppu / c.TILE, c.BUFFER_H / ppu / c.TILE]
  });
})()`;
const viewOk = (v, stop, tw, th) => v.view === stop && v.zoom === null &&
  v.backing[0] === 1280 && v.backing[1] === 720 &&
  v.buffer[0] === 1280 && v.buffer[1] === 720 &&
  Math.abs(v.tiles[0] - tw) < 1e-9 && Math.abs(v.tiles[1] - th) < 1e-9;

// The bake, read back out of the pages that were actually built: two LODs, one
// uniform factor, no cell fitted to its box, and a floor with no hole in it.
const ATLAS_PROOF = `(async () => {
  const t = await import('/src/art/tiles.js?v=24');
  const p = await import('/src/art/props.js?v=24');
  const c = await import('/src/core/config.js?v=24');
  const pages = t.atlasPages();
  const near = t.atlasFor(c.VIEWS.near.ppu);
  const far = t.atlasFor(c.VIEWS.far.ppu);
  const lod = pages.map((pg) => ({ tilePx: pg.tilePx, cellW: pg.cellW, cellH: pg.cellH, cells: pg.cells.filter(Boolean).length }));
  const missing = [];
  const heights = new Set();
  let tallest = 0;
  for (const id of Object.keys(t.GLYPHS)) {
    const gl = t.glyph(id);
    // Paint glyphs are baked ground, not plate cells: they have no cell index.
    if (gl.paint) continue;
    const i = gl.i;
    for (const pg of pages) if (!pg.cells[i]) missing.push(id + '@' + pg.tilePx);
    const b = near.cells[i];
    if (!b) continue;
    const h = b.h / near.tilePx;
    heights.add(h.toFixed(3));
    if (h > tallest) tallest = h;
  }
  // A laid tile is the whole square: the plate's margin is baked out, so no
  // alpha may survive anywhere inside a ground cell's footprint.
  const g = near.img.getContext('2d');
  const holes = [];
  for (const id of ['.', ',', ':', ';', 'z', 'u', 'v', 'O', 'X']) {
    const i = t.glyph(id).i;
    const b = near.cells[i];
    const ox = (i % c.ATLAS_COLS) * near.cellW;
    const oy = Math.floor(i / c.ATLAS_COLS) * near.cellH;
    const d = g.getImageData(ox + b.x, oy + b.y, b.w, b.h).data;
    let minA = 255;
    for (let k = 3; k < d.length; k += 4) if (d[k] < minA) minA = d[k];
    if (minA < 255) holes.push(id + ':' + minA);
  }
  const span = (name) => {
    const d = p.propFor(name);
    if (!d) return null;
    // A prop stands on the floor line of its own box (the bottom, h tiles down)
    // and paints upward from there, so its height is everything between the
    // topmost layer top and that line.
    const top = Math.min(...d.layers.map((l) => l.dst.y));
    const layer = (want) => {
      const l = d.layers.find((v) => v.name === want);
      return l ? l.bias : null;
    };
    return {
      tiles: +(d.h - top).toFixed(4),
      units: Math.round((d.h - top) * c.TILE),
      layers: d.layers.length,
      caps: d.layers.filter((l) => l.cap).length,
      top: layer('top'),
      back: layer('back'),
      seat: layer('seat'),
      // Every panel of a run butts its neighbour: a face inset inside its own
      // footprint would leave a hairline of void between two wall modules.
      flush: d.layers.filter((l) => !l.cap).every((l) => l.dst.x === 0 && Math.abs(l.dst.w - d.w) < 1e-9)
    };
  };
  const src = await (await fetch('/src/world/view.js?v=24')).text();
  // Every layer needs a finite paint box and a repeat of at least one: a layer
  // with an undefined axis paints nothing at all, and the view culls on the box.
  const bad = [];
  for (const [name, d] of Object.entries(p.PROPS)) {
    const b = d.box;
    if (![b.left, b.right, b.top, b.bottom].every(Number.isFinite)) bad.push(name + ' box');
    for (const l of d.layers) {
      if (!(l.repeat.x >= 1 && l.repeat.y >= 1)) bad.push(name + '.' + l.name);
      if (!Number.isFinite(l.dst.x) || !Number.isFinite(l.dst.y)) bad.push(name + '.' + l.name + ' dst');
    }
  }
  // Every layer has to actually paint something: a slice taken from the wrong
  // place in the page draws nothing, which no other assertion can see. Each one
  // is blitted into a scratch buffer by the real blit and counted.
  const cv = document.createElement('canvas');
  cv.width = 400;
  cv.height = 480;
  const cg = cv.getContext('2d');
  const empty = [];
  for (const [name, d] of Object.entries(p.PROPS)) {
    for (const l of d.layers) {
      cg.clearRect(0, 0, 400, 480);
      if (l.paint) {
        // A painted layer is exercised with a live machine state, at 64 px per
        // tile, so even a mug or a badge reader lays down countable pixels.
        cg.save();
        cg.translate(200, 300);
        cg.scale(64, 64);
        l.paint(cg, { tick: 40, anim: { state: 'occupied', phase: 'brewing', open: 0.5, paper: 0.6, fill: 0.5 }, p: {} });
        cg.restore();
      } else {
        p.blitPropLayer(cg, near, l, 200, 300);
      }
      const px = cg.getImageData(0, 0, 400, 480).data;
      let n = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 8) n++;
      if (n < 40) empty.push(name + '.' + l.name + ':' + n);
    }
  }
  return JSON.stringify({
    lod, near: near.tilePx, far: far.tilePx, missing, heights: [...heights].sort(), tallest, holes,
    locker: span('locker'), door: span('door'), chair: span('chair'),
    wall: span('wall'), wallH: p.WALL_H, desk: span('desk'), table: span('table'),
    catalog: bad, empty,
    grout: src.includes('drawGrout'), charTiles: c.CHAR_H / c.TILE
  });
})()`;

// Collision is derived from footprints and nothing else. This rebuilds the set
// of solid tiles from the place's prop list, independently of the map, and
// compares it with what the map actually reports: not one tile more, not one
// less. It also proves the aisles the layout is built around are still open and
// that the doorway is a doorway rather than a wall you can see through.
const FOOTPRINT_PROOF = `(async () => {
  const { buildPlace } = await import('/src/world/places/index.js?v=24');
  const { createMap } = await import('/src/world/map.js?v=24');
  const { propFor } = await import('/src/art/props.js?v=24');
  const place = buildPlace('office');
  const map = createMap(place);

  const want = new Set();
  for (const p of place.props) {
    const def = propFor(p.kind);
    if (!def.solid) continue;
    for (let j = 0; j < def.h; j++) {
      for (let i = 0; i < def.w; i++) want.add((p.y + j) + ',' + (p.x + i));
    }
  }
  const got = new Set();
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) if (!map.walkable(x, y)) got.add(y + ',' + x);
  }

  // The two-tile aisles the layout is built around, sampled down every run:
  // inside both banks, the spine, the cross aisles and the south connectors.
  const aisles = [[5, 2], [6, 3], [5, 6], [6, 7], [5, 12], [6, 13], [5, 16], [6, 17],
    [13, 4], [14, 9], [13, 14], [14, 19], [9, 23], [10, 24], [16, 23], [17, 24],
    [27, 4], [28, 12], [3, 21], [12, 21], [20, 21], [24, 22]];

  // One cap per wall run, at the back of it. A module with a wall behind it is
  // buried up to its own top edge, so its cap may not be drawn — that is the
  // difference between a wall with a top and a wall striped every tile.
  const capped = map.props.filter((p) => p.def.layers.some((l) => l.cap));
  const standing = new Set(capped.map((p) => p.y + ',' + p.x));
  const wrong = capped.filter((p) => p.capped !== !standing.has((p.y - 1) + ',' + p.x));

  return JSON.stringify({
    extra: [...got].filter((k) => !want.has(k)).slice(0, 8),
    missing: [...want].filter((k) => !got.has(k)).slice(0, 8),
    aisles: aisles.filter(([x, y]) => !map.walkable(x, y)),
    doors: map.passages.length,
    doorOpen: map.walkable(2, place.h - 1) && map.walkable(3, place.h - 1),
    caps: { modules: capped.length, shown: capped.filter((p) => p.capped).length, wrong: wrong.length },
    seatTiles: map.seats.filter((s) => !map.walkable(s.x, s.y)).length,
    desks: map.props.filter((p) => p.kind === 'desk').length,
    tables: map.props.filter((p) => p.kind === 'table').length,
    seats: map.seats.length,
    lights: map.lights.length,
    walls: map.props.filter((p) => p.kind === 'wall' || p.kind === 'window').length,
    sills: map.props.filter((p) => p.kind === 'sill').length,
    size: [map.w, map.h]
  });
})()`;

// The acceptance as graph geometry: one connected floor from the spawn, every
// zone reached through the aisles, every station a walkable reached tile beside
// its prop, and every doorway open on both sides with no prop standing in it.
const REACH_PROOF = `(async () => {
  const { buildPlace } = await import('/src/world/places/index.js?v=24');
  const { ZONES } = await import('/src/world/places/office.js?v=24');
  const { createMap } = await import('/src/world/map.js?v=24');
  const { propFor } = await import('/src/art/props.js?v=24');
  const place = buildPlace('office');
  const map = createMap(place);

  const seen = new Set();
  const queue = [[place.spawn.x, place.spawn.y]];
  seen.add(place.spawn.y + ',' + place.spawn.x);
  while (queue.length) {
    const [x, y] = queue.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = ny + ',' + nx;
      if (seen.has(k) || !map.walkable(nx, ny)) continue;
      seen.add(k);
      queue.push([nx, ny]);
    }
  }
  let walkable = 0;
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (map.walkable(x, y)) walkable++;

  // Every zone: all of its walkable floor reached, one accent, named material.
  const zones = ZONES.map((z) => {
    let open = 0, reached = 0;
    const accents = new Set(), floors = new Set();
    for (let y = z.y; y < z.y + z.h; y++) {
      for (let x = z.x; x < z.x + z.w; x++) {
        accents.add(map.accentAt(x, y));
        floors.add(map.floorAt(x, y));
        if (map.walkable(x, y)) { open++; if (seen.has(y + ',' + x)) reached++; }
      }
    }
    return { accent: z.accent, oneAccent: accents.size === 1 && accents.has(z.accent), floor: z.floor, oneFloor: floors.size === 1 && floors.has(z.floor), open, reached };
  });

  // A station stands beside its prop: walkable, reached, and orthogonally
  // adjacent to a tile some prop's footprint covers.
  const covered = new Set();
  for (const p of place.props) {
    const d = propFor(p.kind);
    for (let j = 0; j < d.h; j++) for (let i = 0; i < d.w; i++) covered.add((p.y + j) + ',' + (p.x + i));
  }
  const stations = place.stations.map((s) => ({
    id: s.id,
    ok: map.walkable(s.x, s.y) && seen.has(s.y + ',' + s.x) &&
      [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => covered.has((s.y + dy) + ',' + (s.x + dx)))
  }));

  // Doorways: the passage tile itself walkable, at least two open sides, and
  // no solid footprint anywhere on the passage.
  const doors = map.passages.map((t) => {
    const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => map.walkable(t.x + dx, t.y + dy)).length;
    return { at: [t.x, t.y], open: map.walkable(t.x, t.y), sides, blocked: covered.has(t.y + ',' + t.x) && map.props.some((p) => p.def.solid && p.x <= t.x && p.x + p.def.w > t.x && p.y <= t.y && p.y + p.def.h > t.y) };
  });

  return JSON.stringify({
    walkable, reached: seen.size,
    zonesBad: zones.filter((z) => !z.oneAccent || !z.oneFloor || z.reached !== z.open),
    stationsBad: stations.filter((s) => !s.ok),
    doorsBad: doors.filter((d) => !d.open || d.sides < 2 || d.blocked),
    doors: doors.length
  });
})()`;

// The machines, stepped synchronously through their whole cycles: the brew
// visits all three phases, the printer feeds a full sheet, and the booth runs
// vacant -> entering -> occupied -> leaving -> vacant around a parked player.
const MACHINE_PROOF = `(async () => {
  const m = await import('/src/world/machines.js?v=24');
  const s = window.__office.state;
  const coffee = s.map.props.find((p) => p.kind === 'coffeeMachine');
  const printer = s.map.props.find((p) => p.kind === 'printer');
  const booth = s.map.props.find((p) => p.kind === 'booth');
  const saved = { x: s.player.tx, y: s.player.ty };
  // The machines now read the whole crowd, so park every colleague off the
  // floor for the synchronous run: the booth cycle is the player's alone.
  const crowd = s.npcs.map((n) => [n.tx, n.ty]);
  s.npcs.forEach((n) => { n.tx = -999; n.ty = -999; });
  const phases = new Set(), states = new Set();
  let paperMax = 0;
  s.player.tx = booth.x; s.player.ty = booth.y;
  for (let i = 0; i < 1400; i++) {
    m.updateMachines(s);
    phases.add(coffee.anim.phase);
    states.add(booth.anim.state);
    paperMax = Math.max(paperMax, printer.anim.paper);
  }
  s.player.tx = saved.x; s.player.ty = saved.y;
  for (let i = 0; i < 200; i++) { m.updateMachines(s); states.add(booth.anim.state); }
  s.npcs.forEach((n, i) => { n.tx = crowd[i][0]; n.ty = crowd[i][1]; });
  return JSON.stringify({
    phases: [...phases], states: [...states], paperMax,
    shut: booth.anim.open, lamp: booth.anim.state
  });
})()`;

// The acceptance, as geometry and state rather than as a picture: a sitter is
// drawn at floor level in a chair track — the renderer carries no standing
// sprite lift at all — and the furniture's own z does the covering: the
// tabletop (+6) cuts below the shoulder line, the desk base reaches the floor,
// and the chair back (+10) lands on the sitter and sorts over the tabletop.
// The action machine owns the poses: every transition is 4-6 frames, sit-down
// settles into sit, stand-up is the sit track reversed, and a seat reports
// exactly one claimant.
const SEAT_PROOF = `(async () => {
  const p = await import('/src/art/props.js?v=24');
  const { TILE, CHAR_H } = await import('/src/core/config.js?v=24');
  const act = await import('/src/entities/actions.js?v=24');
  const rig = await import('/src/art/rig.js?v=24');
  const { buildPlace } = await import('/src/world/places/index.js?v=24');
  const { createMap } = await import('/src/world/map.js?v=24');
  const view = await (await fetch('/src/world/view.js?v=24')).text();
  const noLift = !/SEAT_LIFT|SEAT_FOOT/.test(view);
  const lift = CHAR_H - TILE;
  const layer = (prop, name) => p.propFor(prop).layers.find((l) => l.name === name);
  const top = layer('desk', 'top');
  const back = layer('chair', 'back');
  const base = layer('desk', 'base');
  // Screen rows measured from the top of the sitter's own tile: the doll sits
  // at floor level, so the 48 px box spans -16..32 with no extra shift.
  const spriteTop = -lift;
  const spriteBottom = spriteTop + CHAR_H;
  const shoulders = spriteTop + CHAR_H / 4;
  const deskTop = [-TILE + top.dst.y * TILE, -TILE + (top.dst.y + top.dst.h) * TILE];
  const deskBase = [-TILE + (base.dst.y + base.dst.h) * TILE];
  const chairBack = [back.dst.y * TILE, (back.dst.y + back.dst.h) * TILE];

  // The action table: the nine states, transition lengths, and the settles.
  const names = Object.keys(act.ACTIONS);
  const want = ['idle', 'walk', 'sitdown', 'sit', 'type', 'drink', 'laptop', 'standup', 'door'];
  const tableOk = want.every((n) => names.includes(n));
  const trans = ['sitdown', 'standup', 'door'].map((n) => act.framesOf(n));
  const transOk = trans.every((f) => f >= 4 && f <= 6);
  const settles = act.ACTIONS.sitdown.next === 'sit' && act.ACTIONS.standup.next === 'idle' &&
    act.ACTIONS.drink.next === 'idle' && act.ACTIONS.standup.reverse === true;
  const seatedFlags = ['sitdown', 'sit', 'type', 'laptop', 'standup'].every((n) => act.ACTIONS[n].seated);

  // A seated entity reads a chair track through the real updateActor, and a
  // transition in flight owns its track against mood poses.
  const probe = (action) => {
    const a = rig.createActor(window.__office.state.player.id);
    a.entity = { action, seated: act.isSeated(action), dir: 'up', off: 0, say: 0, act: 0, moving: false };
    for (let i = 0; i < 30; i++) rig.updateActor(a, 1 / 60);
    return a.anim;
  };
  const sitAnim = probe('sit');
  const typeAnim = probe('type');
  const sitdownAnim = probe('sitdown');

  // Seat ownership on a fresh map: one claimant, refused while held, released
  // only by its holder; the pivot is the tile centre and the approach is the
  // walkable tile behind the facing.
  const map = createMap(buildPlace('office'));
  const seat = map.seats[0];
  const first = map.claimSeat(seat, 'a');
  const refused = map.claimSeat(seat, 'b') === false && seat.occupiedBy === 'a';
  map.releaseSeat(seat, 'b');
  const held = seat.occupiedBy === 'a';
  map.releaseSeat(seat, 'a');
  const freed = seat.occupiedBy === null;
  const pivotOk = seat.pivot.x === (seat.x + 0.5) * TILE && seat.pivot.y === (seat.y + 0.5) * TILE;
  const approachOk = Math.abs(seat.approach.x - seat.x) + Math.abs(seat.approach.y - seat.y) === 1 &&
    map.walkable(seat.approach.x, seat.approach.y);

  return JSON.stringify({
    noLift, spriteTop, spriteBottom, shoulders, deskTop, deskBase, chairBack,
    tableOk, trans, transOk, settles, seatedFlags,
    sitAnim, typeAnim, sitdownAnim,
    first, refused, held, freed, pivotOk, approachOk
  });
})()`;

// The catalog is the contract — src/art/props.js carries the data props.json
// used to hold: a seat's pivot is its tile centre, and every layer sorts on
// the prop's foot plus its own bias. This proves the renderer consumes both.
// The live map's seats are checked against the catalog defs, then the real
// drawWorld runs on a scratch buffer framing a desk, its chair and a sitter,
// with every drawImage logged. Only the prop pass blits the atlas page itself
// (ground chunks, shadows, light pools and dolls carry their own canvases),
// so the page's blits are the layer order: they must match the foot+bias sort
// the catalog predicts, caps must run after everything, and the sitter must
// land over the desk's far half but under the tabletop and chair back.
const CATALOG_PROOF = `(async () => {
  const p = await import('/src/art/props.js?v=24');
  const c = await import('/src/core/config.js?v=24');
  const t = await import('/src/art/tiles.js?v=24');
  const rig = await import('/src/art/rig.js?v=24');
  const { drawWorld } = await import('/src/world/view.js?v=24');
  const s = window.__office.state;
  const TILE = c.TILE;
  const BACK = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] };

  // Every seat on the live map: pivot, facing, foot and approach straight off
  // the catalog def the map built it from.
  const seatBad = [];
  for (const seat of s.map.seats) {
    const def = p.propFor(seat.kind);
    if (!def || !def.seat) { seatBad.push(seat.kind + ':no-seat'); continue; }
    if (seat.pivot.x !== (seat.x + 0.5) * TILE || seat.pivot.y !== (seat.y + 0.5) * TILE) seatBad.push(seat.kind + '@' + seat.x + ',' + seat.y + ':pivot');
    if (seat.dir !== (seat.prop.face || def.seat)) seatBad.push(seat.kind + ':dir');
    if (seat.prop.foot !== (seat.y + def.h) * TILE) seatBad.push(seat.kind + ':foot');
    const back = BACK[seat.dir] || BACK.up;
    if (seat.approach.x !== seat.x + back[0] || seat.approach.y !== seat.y + back[1]) seatBad.push(seat.kind + ':approach');
  }
  // A settled sitter stands on the pivot: half a tile of doll either side.
  const sitterBad = [];
  for (const n of [...s.npcs, s.player]) {
    if (!n.seated || n.moving || !n.seat) continue;
    if (n.px !== n.seat.pivot.x - TILE / 2 || n.py !== n.seat.pivot.y - TILE / 2) sitterBad.push(n.id);
  }

  // A chair at a desk, framed with the desk's far half and the wall behind it.
  const atDesk = (v) => s.map.props.find((q) => q.kind === 'desk' &&
    v.x >= q.x && v.x < q.x + q.def.w && v.y - 1 >= q.y && v.y - 1 < q.y + q.def.h);
  const seat = s.map.seats.find((v) => (v.kind === 'chair' || v.kind === 'chairOlive') && v.dir === 'up' && atDesk(v));
  if (!seat) return JSON.stringify({ error: 'no chair at a desk' });
  const desk = atDesk(seat);
  const ppu = c.VIEWS.near.ppu;
  const page = t.atlasFor(ppu);
  const snap = (v) => Math.round(v * ppu) / ppu;
  const camX = Math.max(0, (seat.x - 4) * TILE), camY = Math.max(0, (seat.y - 3) * TILE);
  const rcam = { x: snap(camX), y: snap(camY) };
  const viewW = c.BUFFER_W / ppu, viewH = c.BUFFER_H / ppu;

  // The order the catalog predicts: one entry per plate slice, culled and
  // snapped exactly as the view does, sorted on foot + bias. Paint layers
  // never blit the page, so they are not part of this sequence.
  const entries = [], capEntries = [];
  for (const q of s.map.props) {
    const b = q.def.box;
    if ((q.x + b.right) * TILE < rcam.x || (q.x + b.left) * TILE > rcam.x + viewW) continue;
    if ((q.y + b.bottom) * TILE < rcam.y || (q.y + b.top) * TILE > rcam.y + viewH) continue;
    const ox = snap(q.x * TILE - rcam.x), oy = snap(q.y * TILE - rcam.y);
    for (const l of q.def.layers) {
      if (l.cap && !q.capped) continue;
      if (!l.src) continue;
      const col = Math.floor(l.src.x), row = Math.floor(l.src.y);
      const ci = row * c.ATLAS_COLS + col;
      const box = page.cells[ci], org = page.orig[ci];
      if (!box || !org) continue;
      const sx = Math.round(col * page.cellW + box.x + (l.src.x - col - org.x) * page.tilePx);
      const sy = Math.round(row * page.cellH + box.y + (l.src.y - row - org.y) * page.tilePx);
      const sw = Math.max(1, Math.round(l.src.w * page.tilePx));
      const sh = Math.max(1, Math.round(l.src.h * page.tilePx));
      const w = Math.max(1, Math.round(l.dst.w * TILE));
      const h = Math.max(1, Math.round(l.dst.h * TILE));
      for (let j = 0; j < l.repeat.y; j++) {
        for (let i = 0; i < l.repeat.x; i++) {
          // A flipped slice is blitted at the origin of its own mirror transform.
          const x = l.flip ? 0 : Math.round(ox + (l.dst.x + i * l.step.x) * TILE);
          const y = l.flip ? 0 : Math.round(oy + (l.dst.y + j * l.step.y) * TILE);
          (l.cap ? capEntries : entries).push({
            key: q.kind + '@' + q.x + ',' + q.y + '.' + l.name + '#' + i + ',' + j,
            z: q.foot + l.bias, r: [sx, sy, sw, sh, x, y, w, h]
          });
        }
      }
    }
  }
  entries.sort((a, b) => a.z - b.z);
  capEntries.sort((a, b) => a.z - b.z);

  // The real pass on a scratch buffer. The sitter is a scratch entity on the
  // seat pivot, so the live crowd is never touched; the player is parked far
  // off frame, where its own blits cannot collide with the anchors.
  const cv = document.createElement('canvas');
  cv.width = c.BUFFER_W; cv.height = c.BUFFER_H;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  const log = [];
  const orig = g.drawImage.bind(g);
  g.drawImage = (...a) => { log.push(a); return orig(...a); };
  // Dolls are placed by a translate to their snapped position and blit at the
  // local origin, so the translate is the marker of an actor's draw — logged
  // alongside the blits to place the sitter in the one order.
  const origT = g.translate.bind(g);
  g.translate = (...a) => { log.push(['T', a[0], a[1]]); return origT(...a); };
  const sid = (s.npcs.find((n) => rig.actorRigFor(n.id)) || s.npcs[0]).id;
  const sitter = {
    id: sid, px: seat.pivot.x - TILE / 2, py: seat.pivot.y - TILE / 2,
    seated: true, dir: seat.dir, tx: seat.x, ty: seat.y,
    name: '', tint: '#ffffff', say: 0, moving: false, actor: null
  };
  const scratch = {
    map: s.map, npcs: [sitter],
    player: { id: s.player.id, px: -9999, py: -9999, seated: false, tx: -999, ty: -999, actor: null },
    cam: { x: camX, y: camY, shake: 0 }, view: 'near', tick: 40, chosen: { tint: '#ffffff' }
  };
  drawWorld(g, scratch);

  const atlas = log.filter((a) => a[0] === page.img);
  // Caps run in their own pass after everything: the ordinary sequence is the
  // page's blits minus the cap slices, checked against the cap pass below.
  const capKeys = new Set(capEntries.map((e) => e.r.join(',')));
  const obs = atlas.filter((a) => !capKeys.has(a.slice(1).join(','))).map((a) => a.slice(1));
  const want = entries.map((e) => e.r);
  let firstBad = -1;
  for (let i = 0; i < Math.max(obs.length, want.length); i++) {
    const o = obs[i], wnt = want[i];
    if (!o || !wnt || o.length !== wnt.length || o.some((v, k) => v !== wnt[k])) { firstBad = i; break; }
  }
  let lastOrd = -1, firstCap = Infinity, capCount = 0;
  const capObs = [];
  atlas.forEach((a, i) => {
    const k = a.slice(1).join(',');
    if (capKeys.has(k)) { firstCap = Math.min(firstCap, i); capCount++; capObs.push(k); }
    else lastOrd = i;
  });
  const capsAfter = capCount === capEntries.length && (capCount === 0 || firstCap > lastOrd) &&
    capObs.join('|') === capEntries.map((e) => e.r.join(',')).join('|');

  // The covering chain, read off the one log: the desk's far half (-32) draws
  // before the sitter (foot), the chair seat (+2) and the tabletop (+6) after
  // them, and the chair back (+10) last of the five.
  const idxOf = (key) => {
    const e = entries.find((v) => v.key === key);
    return e ? log.findIndex((a) => a[0] === page.img && a.slice(1).join(',') === e.r.join(',')) : -1;
  };
  const di = seat.x - desk.x;
  const deskBack = idxOf(desk.kind + '@' + desk.x + ',' + desk.y + '.back#' + di + ',0');
  const deskTop = idxOf(desk.kind + '@' + desk.x + ',' + desk.y + '.top#' + di + ',0');
  const chairSeat = idxOf(seat.kind + '@' + seat.x + ',' + seat.y + '.seat#0,0');
  const chairBack = idxOf(seat.kind + '@' + seat.x + ',' + seat.y + '.back#0,0');
  const sa = sitter.actor;
  // The doll's draw opens with the translate to its snapped pivot position;
  // no paint layer lands on the same point (their origins sit on whole tiles).
  const sitterIdx = log.findIndex((a) => a[0] === 'T' && a[1] === sa.dx && a[2] === sa.dy);
  const chain = [deskBack, sitterIdx, chairSeat, deskTop, chairBack];
  const chainOk = chain.every((v) => v >= 0) && chain.every((v, i) => i === 0 || chain[i - 1] < v);
  // The view placed the doll from the pivot, snapped on the device grid.
  const pivotDrawn = sa.dx === snap(seat.pivot.x - TILE / 2 - rcam.x) &&
    sa.dy === snap(seat.pivot.y - TILE / 2 - (c.CHAR_H - TILE) - rcam.y);

  return JSON.stringify({
    seats: s.map.seats.length, seatBad: seatBad.slice(0, 8), sitterBad,
    blits: obs.length, want: want.length, firstBad,
    at: firstBad >= 0 ? { got: obs[firstBad], want: want[firstBad] } : null,
    capCount, capWant: capEntries.length, capsAfter,
    chain, chainOk, pivotDrawn, dx: sa.dx, dy: sa.dy
  });
})()`;

// The entrance leaf, stepped synchronously through its whole cycle around a
// parked player: closed and solid from afar, swung open on approach, held open
// while a body stands in the doorway, closing once the floor is clear, and
// reopened mid-close the moment someone asks again — never a trap.
const DOOR_PROOF = `(async () => {
  const m = await import('/src/world/machines.js?v=24');
  const s = window.__office.state;
  const door = s.map.doors.find((d) => d.y === s.map.h - 1);
  if (!door) return JSON.stringify({ error: 'no entrance leaf' });
  const crowd = s.npcs.map((n) => [n.tx, n.ty]);
  s.npcs.forEach((n) => { n.tx = -999; n.ty = -999; });
  const saved = [s.player.tx, s.player.ty];
  door.anim.state = 'closed'; door.anim.open = 0; door.anim.t = 0;
  const at = (x, y, ticks) => {
    s.player.tx = x; s.player.ty = y; s.player.moving = false;
    for (let i = 0; i < ticks; i++) m.updateMachines(s);
    return door.anim.state;
  };
  const closed = at(3, 24, 120);
  const solid = !m.doorPassable(s.map, door.x, door.y) && !s.walkable(door.x, door.y);
  const opened = at(3, 26, 60);
  const passable = m.doorPassable(s.map, door.x, door.y) && s.walkable(door.x + 1, door.y);
  const heldOpen = at(door.x, door.y, 200);
  const closing = at(3, 24, 55);
  const shutMid = door.anim.open < 1;
  const reopened = at(3, 26, 60);
  s.player.tx = saved[0]; s.player.ty = saved[1];
  s.npcs.forEach((n, i) => { n.tx = crowd[i][0]; n.ty = crowd[i][1]; });
  return JSON.stringify({ closed, solid, opened, passable, heldOpen, closing, shutMid, reopened });
})()`;

// One colleague's whole coffee run, stepped synchronously: walk to the pantry,
// drink, walk home, board the chair and type. Every tick is measured — a tile
// change of more than one or a pixel jump of more than a tile is a teleport,
// and the run fails. The crowd is frozen and the floor's reservations cleared
// so the run is the walker's alone; everything is restored afterwards.
const NPC_RUN_PROOF = `(async () => {
  const npc = await import('/src/entities/npc.js?v=24');
  const m = await import('/src/world/machines.js?v=24');
  const s = window.__office.state;
  const map = s.map;
  const n = s.npcs.find((v) => {
    const hs = map.seatAt(v.home.x, v.home.y);
    return hs && (!hs.occupiedBy || hs.occupiedBy === v.id);
  });
  if (!n) return JSON.stringify({ error: 'no npc with a free home chair' });
  const snap = { ...n };
  const claims = map.seats.map((t) => t.occupiedBy);
  const occ = [...s.occupied];
  const crowd = s.npcs.map((v) => [v.tx, v.ty, v.wait]);
  s.npcs.forEach((v) => { if (v !== n) { v.tx = -999; v.ty = -999; v.wait = 100000; } });
  s.occupied.clear();
  if (n.seat) map.releaseSeat(n.seat, n.id);
  n.schedule = [{ kind: 'coffee', dwell: 160 }, { kind: 'desk', dwell: 100000 }];
  n.stopIdx = 0; n.phase = 'travel'; n.dwell = 0; n.target = null; n.path = null;
  n.goalSeat = null; n.retry = 0; n.wait = 0; n.seated = false; n.seat = null;
  n.leaving = null; n.moving = false; n.step = 0; n.stepLen = 12;
  n.px = n.tx * 32; n.py = n.ty * 32; n.action = 'idle'; n.act = 0;
  const coffee = (s.place.stations || []).find((st) => st.id === 'coffee') || { x: 19, y: 25 };
  let drank = false, sat = false, typed = false, ticks = 0;
  let maxTile = 0, maxPx = 0, drinkDir = '';
  let ptx = n.tx, pty = n.ty, ppx = n.px, ppy = n.py;
  for (let i = 0; i < 6000 && !typed; i++) {
    m.updateMachines(s);
    npc.updateNpcs(s);
    ticks++;
    maxTile = Math.max(maxTile, Math.abs(n.tx - ptx) + Math.abs(n.ty - pty));
    maxPx = Math.max(maxPx, Math.abs(n.px - ppx), Math.abs(n.py - ppy));
    ptx = n.tx; pty = n.ty; ppx = n.px; ppy = n.py;
    if (n.tx === coffee.x && n.ty === coffee.y && n.action === 'drink') { drank = true; drinkDir = n.dir; }
    const hs = map.seatAt(n.home.x, n.home.y);
    if (n.seated && n.tx === n.home.x && n.ty === n.home.y && hs && hs.occupiedBy === n.id) sat = true;
    if (sat && !n.moving && n.action === 'type') typed = true;
  }
  const homeDir = n.dir;
  Object.assign(n, snap);
  map.seats.forEach((t, i) => { t.occupiedBy = claims[i]; });
  s.occupied.clear(); occ.forEach((k) => s.occupied.add(k));
  s.npcs.forEach((v, i) => { v.tx = crowd[i][0]; v.ty = crowd[i][1]; v.wait = crowd[i][2]; });
  return JSON.stringify({ drank, drinkDir, sat, typed, ticks, maxTile, maxPx, home: [n.home.x, n.home.y], homeDir });
})()`;

const key = (cdp, k, type = 'keydown') =>
  cdp.ev(`window.dispatchEvent(new KeyboardEvent('${type}', { key: ${JSON.stringify(k)}, bubbles: true }))`);

// The badge questions, in order: name, level, seat, role, teammate — then the
// picker, then the floor. Every step is a click, so the run matches a player's
// rather than calling into the modules behind it.
async function enlist(cdp, partner = 'mate@example.com') {
  await cdp.ev(`document.getElementById('clockInBtn').click()`);
  await sleep(2200);
  await cdp.ev(`document.getElementById('whoInput').value = 'Tester'; document.getElementById('whoForm').requestSubmit()`);
  await sleep(300);
  await cdp.ev(`document.querySelector('#floorPick [data-floor="Level 22"]').click()`);
  await sleep(400);
  await cdp.ev(`document.querySelector('#seatPick .pick-btn').click()`);
  await sleep(300);
  await cdp.ev(`document.querySelector('#rolePick .pick-btn').click()`);
  await sleep(300);
  await cdp.ev(`document.getElementById('partnerInput').value = ${JSON.stringify(partner)}; document.getElementById('partnerForm').requestSubmit()`);
  await sleep(700);
  await cdp.ev(`document.getElementById('confirmCharBtn').click()`);
  await sleep(1200);
  // Boot decodes the baked sheets and the layered atlases before the room
  // appears; wait for it to actually be on screen rather than guessing.
  for (let i = 0; i < 40; i++) {
    if (await cdp.ev(`getComputedStyle(document.getElementById('gameArea')).display !== 'none'`)) break;
    await sleep(300);
  }
}

async function main() {
  const page = await target();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  const cdp = new CDP(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  // ---- desktop, daytime -----------------------------------------------------
  // The clock is pinned to a working morning: the evening question fires off the
  // device's own clock, and a run at 23:00 would answer it before the walk did.
  await cdp.send('Page.navigate', { url: 'http://localhost:8000/?time=10:30' });
  await sleep(2500);
  await enlist(cdp);

  const head = await cdp.ev(`JSON.stringify({
    body: document.body.className,
    gameDisplay: getComputedStyle(document.getElementById('gameArea')).display,
    phase: window.__office.state.phase,
    view: window.__office.state.view,
    player: [window.__office.state.player.tx, window.__office.state.player.ty],
    npcs: window.__office.state.npcs.length,
    clockedIn: Number(window.__office.state.clockedInAt),
    clockNow: Number(window.__office.wall.now()),
    popups: ['popup', 'characterSelectPopup'].map((id) => getComputedStyle(document.getElementById(id)).display),
    playerName: window.__office.state.playerName,
    seat: window.__office.state.seat,
    canvas: [gameCanvas.width, gameCanvas.height],
    css: [gameCanvas.getBoundingClientRect().width, gameCanvas.getBoundingClientRect().height],
    stage: [document.getElementById('stage').clientWidth, document.getElementById('stage').clientHeight]
  })`);
  const h = JSON.parse(head);
  ok('boot into world', h.gameDisplay !== 'none' && h.phase === 'play', JSON.stringify({ display: h.gameDisplay, phase: h.phase, npcs: h.npcs }));
  ok('enlist popups dismissed with a badge', h.popups.every((d) => d === 'none') && h.playerName === 'Tester' && !!h.seat, JSON.stringify({ popups: h.popups, name: h.playerName, seat: h.seat }));
  ok('backing store is the pixel budget', h.canvas[0] === 1280 && h.canvas[1] === 720, JSON.stringify(h.canvas));
  const fit = Math.abs(h.css[0] / h.css[1] - 16 / 9) < 0.02 && h.css[0] <= h.stage[0] + 2 && h.css[1] <= h.stage[1] + 2;
  ok('css box fits the stage, 16:9', fit, JSON.stringify({ css: h.css, stage: h.stage }));
  ok('clocked in on the wall clock', Math.abs(h.clockNow - h.clockedIn) < 15000, `${new Date(h.clockedIn).toISOString()} vs ${new Date(h.clockNow).toISOString()}`);
  ok('opens on the near view', h.view === 'near', h.view);
  // The acceptance picture: the room as the visit opens on it, from the spawn.
  await cdp.shot('qa_spawn');
  const vn = JSON.parse(await cdp.ev(VIEW_PROOF));
  ok('near stop: 1280x720 backing, live near view, 10 x 5.625 tiles',
    viewOk(vn, 'near', 10, 5.625), JSON.stringify(vn));
  await cdp.shot('qa_golden_near');

  const hud = await cdp.ev(HUD_PROOF);
  ok('hud drawn into the buffer corner', hud.w === 1280 && hud.h === 720 && hud.parchment > 200, JSON.stringify(hud));

  const span = await cdp.ev(SPAN_PROOF);
  ok('near frames 10 x 5.6 tiles', Math.abs(span.near[0] - 10) < 0.01 && Math.abs(span.near[1] - 5.6) < 0.05, JSON.stringify(span.near));
  ok('far frames 20 x 11 tiles', Math.abs(span.far[0] - 20) < 0.01 && Math.abs(span.far[1] - 11.25) < 0.05, JSON.stringify(span.far));

  // ---- atlas ----------------------------------------------------------------
  const atlas = JSON.parse(await cdp.ev(ATLAS_PROOF));
  const lods = atlas.lod.map((l) => l.tilePx).join(',');
  ok('two LOD plates from one source, 8 cols, 4-tile cells',
    lods === '128,64' && atlas.lod.every((l) => l.cellW === l.tilePx && l.cellH === l.tilePx * 4 && l.cells > 55),
    JSON.stringify(atlas.lod));
  ok('atlasFor picks the plate the zoom blits 1:1', atlas.near === 128 && atlas.far === 64, `${atlas.near} / ${atlas.far}`);
  ok('every glyph resolves in both plates', atlas.missing.length === 0, atlas.missing.slice(0, 8).join(' '));
  ok('nothing is fitted to its cell box', atlas.tallest <= 1.001 && atlas.heights.length <= 3,
    `tallest ${atlas.tallest} tiles of a 4-tile cell, ${atlas.heights.length} distinct heights`);
  ok('ground squares are baked solid, joint included', atlas.holes.length === 0, atlas.holes.join(' '));
  const props = [atlas.locker, atlas.door, atlas.chair];
  ok('locker > door > chair, each its own height',
    props.every(Boolean) && props[0].tiles > props[1].tiles && props[1].tiles > props[2].tiles &&
    Math.abs(props[0].tiles - 1.875) < 0.01 && Math.abs(props[1].tiles - 0.9453) < 0.01 && Math.abs(props[2].tiles - 0.727) < 0.01 &&
    props[0].tiles > atlas.charTiles,
    props.map((s) => (s ? `${s.units}u/${s.layers}L` : 'missing')).join(' > '));
  ok('walls stand 2.5 tiles and carry a cap layer of their own',
    Math.abs(atlas.wallH - 2.5) < 1e-9 && atlas.wall.layers === 3 && atlas.wall.caps === 1 &&
    Math.abs(atlas.wall.tiles - 2.641) < 0.01 && atlas.wall.flush === true,
    JSON.stringify({ h: atlas.wallH, span: atlas.wall.tiles, layers: atlas.wall.layers, caps: atlas.wall.caps, flush: atlas.wall.flush }));
  // The three biases the sitter is designed against: foot (ty+1)*32-2, the
  // tabletop at +6 and the chair back at +10, with the far half of a desk one
  // whole tile behind its own near row (-32).
  ok('tabletop (+6) and chair back (+10) both clear a sitter at -2',
    atlas.desk.top === 6 && atlas.chair.back === 10 && atlas.chair.seat === 2 &&
    atlas.table.top === 6 && atlas.desk.back === -32 && atlas.table.back === -32,
    JSON.stringify({ desk: [atlas.desk.back, atlas.desk.top], chair: [atlas.chair.seat, atlas.chair.back], table: [atlas.table.back, atlas.table.top] }));
  ok('drawGrout is gone from the renderer', atlas.grout === false, String(atlas.grout));
  ok('every prop layer paints: finite box, repeat of at least one',
    atlas.catalog.length === 0, atlas.catalog.slice(0, 6).join(' '));
  ok('no layer slices past its art', atlas.empty.length === 0, atlas.empty.slice(0, 6).join(' '));

  // The sitter's own geometry and machine: no standing-sprite lift anywhere in
  // the renderer, the tabletop cutting below the shoulder line, the desk
  // reaching the floor, the chair back landing on the sitter — and the action
  // table, chair tracks and seat ownership the poses ride on.
  const seat = JSON.parse(await cdp.ev(SEAT_PROOF));
  ok('a sitter is drawn at floor level, cut at the lap, chair back over them',
    seat.noLift &&
    seat.deskTop[0] > seat.shoulders &&
    seat.deskBase[0] >= seat.spriteBottom &&
    seat.chairBack[0] > seat.spriteTop && seat.chairBack[0] < seat.spriteBottom &&
    seat.chairBack[1] > seat.deskTop[0],
    JSON.stringify({ noLift: seat.noLift, top: seat.deskTop, base: seat.deskBase, back: seat.chairBack, shoulders: seat.shoulders }));
  ok('nine actions, 4-6 frame transitions with anticipation and a settle',
    seat.tableOk && seat.transOk && seat.settles && seat.seatedFlags,
    JSON.stringify({ trans: seat.trans, settles: seat.settles, seated: seat.seatedFlags }));
  ok('seated entities read chair tracks through updateActor',
    seat.sitAnim === 'sitidle' && seat.typeAnim === 'type' && seat.sitdownAnim === 'sit',
    JSON.stringify({ sit: seat.sitAnim, type: seat.typeAnim, sitdown: seat.sitdownAnim }));
  ok('a seat reports one owner, snaps to its pivot, faces its prop',
    seat.first && seat.refused && seat.held && seat.freed && seat.pivotOk && seat.approachOk,
    JSON.stringify({ first: seat.first, refused: seat.refused, held: seat.held, freed: seat.freed, pivot: seat.pivotOk, approach: seat.approachOk }));

  // The catalog against the renderer: every seat pivot the map built, and the
  // actual draw order of the plate at a desk, read off a logged drawWorld.
  const cat = JSON.parse(await cdp.ev(CATALOG_PROOF));
  ok('every seat pivot, facing, foot and approach comes from the catalog',
    !cat.error && cat.seats > 0 && cat.seatBad.length === 0,
    JSON.stringify({ seats: cat.seats, bad: cat.seatBad, error: cat.error }));
  ok('settled sitters stand exactly on their seat pivot',
    !cat.error && cat.sitterBad.length === 0, JSON.stringify(cat.sitterBad));
  ok('the renderer blits the plate in catalog foot+bias order',
    !cat.error && cat.firstBad === -1 && cat.blits === cat.want && cat.want > 20,
    JSON.stringify({ blits: cat.blits, want: cat.want, firstBad: cat.firstBad, at: cat.at }));
  ok('wall caps run after every ordinary plate layer, in their own bias order',
    !cat.error && cat.capsAfter && cat.capCount === cat.capWant,
    JSON.stringify({ caps: cat.capCount, want: cat.capWant, after: cat.capsAfter }));
  ok('the sitter draws over the desk far half, under tabletop and chair back',
    !cat.error && cat.chainOk && cat.pivotDrawn,
    JSON.stringify({ chain: cat.chain, pivotDrawn: cat.pivotDrawn, dx: cat.dx, dy: cat.dy }));

  const foot = JSON.parse(await cdp.ev(FOOTPRINT_PROOF));
  ok('walkability is the footprint set, tile for tile',
    foot.extra.length === 0 && foot.missing.length === 0 && foot.size[0] === 30 && foot.size[1] === 28,
    `extra ${foot.extra.join(' ') || '-'} / missing ${foot.missing.join(' ') || '-'}`);
  ok('3x2 desks and a 3x2 table in a room of two-tile aisles',
    foot.desks === 9 && foot.tables === 1 && foot.aisles.length === 0 &&
    foot.seats === 28 && foot.seatTiles === foot.seats && foot.walls === 84 && foot.sills === 26,
    JSON.stringify({ desks: foot.desks, tables: foot.tables, blockedAisles: foot.aisles, seats: foot.seats, onSolid: foot.seatTiles, walls: foot.walls, sills: foot.sills }));
  ok('the two-tile door is walkable and marked as a passage',
    foot.doors === 6 && foot.doorOpen === true && foot.lights === 10,
    JSON.stringify({ doors: foot.doors, open: foot.doorOpen, lights: foot.lights }));
  // A cap is the top slab of a run: the north wall is 30 modules along one run
  // and the two side walls run into it at row 0, so 30 tops, not 84. Every other
  // module has a wall behind it and must not draw one.
  ok('a wall run shows one cap at its back, never one per tile',
    foot.caps.modules === 84 && foot.caps.shown === 30 && foot.caps.wrong === 0,
    JSON.stringify(foot.caps));

  const reach = JSON.parse(await cdp.ev(REACH_PROOF));
  ok('one connected floor: every zone reached from the spawn',
    reach.reached === reach.walkable && reach.zonesBad.length === 0,
    JSON.stringify({ walkable: reach.walkable, reached: reach.reached, zonesBad: reach.zonesBad }));
  ok('every station is a walkable tile beside its prop',
    reach.stationsBad.length === 0, JSON.stringify(reach.stationsBad));
  ok('no prop blocks a doorway, every door open on two sides',
    reach.doorsBad.length === 0 && reach.doors === 6, JSON.stringify(reach.doorsBad));

  const mach = JSON.parse(await cdp.ev(MACHINE_PROOF));
  ok('coffee brews, printer feeds, booth door runs its state machine',
    ['idle', 'brewing', 'ready'].every((p) => mach.phases.includes(p)) && mach.paperMax === 1 &&
    ['vacant', 'entering', 'occupied', 'leaving'].every((s) => mach.states.includes(s)) &&
    mach.shut === 0 && mach.lamp === 'vacant',
    JSON.stringify(mach));

  // The camera has to be able to show the wall a room opens onto: one wall of
  // headroom above the first row, and not a pixel more, or the void above it.
  const sky = JSON.parse(await cdp.ev(`(async () => {
    const k = await import('/src/world/camera.js?v=24');
    const pr = await import('/src/art/props.js?v=24');
    const c = await import('/src/core/config.js?v=24');
    const s = window.__office.state;
    const saved = { x: s.cam.x, y: s.cam.y };
    s.cam.x = 0; s.cam.y = -9999;
    k.clampCamera(s);
    const top = s.cam.y;
    s.cam.x = saved.x; s.cam.y = saved.y;
    return JSON.stringify({
      top, want: -pr.WALL_RISE * c.TILE,
      rise: pr.WALL_RISE, top3: pr.WALL_TOP
    });
  })()`));
  // Exactly the part of the wall that stands over the first row: the cap's top
  // edge, so the frame ends on the wall and not on the void above it.
  ok('the camera stops at the top of the wall, never above it',
    sky.top < 0 && Math.abs(-sky.top - sky.rise * 32) <= 0.25 && sky.rise < sky.top3,
    JSON.stringify(sky));

  const t1 = Number(await cdp.ev(`+window.__office.wall.now()`)); await sleep(1600);
  const t2 = Number(await cdp.ev(`+window.__office.wall.now()`));
  ok('clock ticks', t2 - t1 >= 1400, `${new Date(t1).toISOString()} -> ${new Date(t2).toISOString()}`);
  ok('no mission text', await cdp.ev(`!document.body.innerText.match(/DEF PROJECT|objectives|\\bpts\\b/i)`));

  const px1 = await cdp.ev(PIXEL_PROOF);
  ok('canvas painted (day)', px1.distinctColors > 30, JSON.stringify(px1));
  await cdp.shot('qa_desktop');

  const p1 = await cdp.ev(`[window.__office.state.player.tx, window.__office.state.player.ty]`);
  await key(cdp, 'ArrowRight');
  // Sample the camera mid-stride: it rides the device pixel grid, so the room
  // slides by whole pixels of the buffer instead of shimmering across them.
  const cams = JSON.parse(await cdp.ev(`(async () => {
    const s = window.__office.state;
    const out = [];
    for (let i = 0; i < 14; i++) { await new Promise((r) => requestAnimationFrame(r)); out.push([s.cam.x, s.cam.y]); }
    return JSON.stringify(out);
  })()`));
  await sleep(700); await key(cdp, 'ArrowRight', 'keyup');
  await sleep(400);
  const p2 = await cdp.ev(`[window.__office.state.player.tx, window.__office.state.player.ty]`);
  ok('walking moves player', p1[0] !== p2[0] || p1[1] !== p2[1], `${p1} -> ${p2}`);
  const onGrid = cams.every(([x, y]) =>
    Math.abs(x * 4 - Math.round(x * 4)) < 1e-9 && Math.abs(y * 4 - Math.round(y * 4)) < 1e-9);
  ok('camera on the device pixel grid', onGrid, JSON.stringify(cams.slice(0, 4)));

  // ---- dialogue -------------------------------------------------------------
  // The crowd keeps walking, so the placement is retried: a colleague that steps
  // off their tile between the placement and the key press is a flaky test, not
  // a broken game.
  let spot = null;
  let dOpen = false;
  for (let i = 0; i < 5 && !dOpen; i++) {
    spot = await cdp.ev(`(() => {
      const s = window.__office.state;
      const n = s.npcs.find((m) => !m.seated && !m.moving) || s.npcs.find((m) => !m.seated) || s.npcs[0];
      // Hold the colleague in the game's own dwell so a wander cannot step out
      // of the adjacency between the staging and the key press on a slow box.
      n.wait = 300;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const x = n.tx + dx, y = n.ty + dy;
        if (s.walkable(x, y)) {
          const p = s.player;
          p.moving = false; p.step = 0; p.frame = 0;
          p.tx = x; p.ty = y; p.px = x * 32; p.py = y * 32;
          return { npc: n.id, npcAt: [n.tx, n.ty], x, y };
        }
      }
      return null;
    })()`);
    await sleep(220);
    await key(cdp, 'z'); await key(cdp, 'z', 'keyup');
    await sleep(420);
    dOpen = await cdp.ev(`!!window.__office.state.dialogue`);
  }
  ok('dialogue opens beside NPC', dOpen === true, JSON.stringify(spot));
  await cdp.shot('qa_dialogue');
  await cdp.shot('qa_golden_dialogue');
  // Stop at the first close: one more press beside the same colleague would
  // legitimately start the conversation again.
  let dClosed = false;
  for (let i = 0; i < 16 && !dClosed; i++) {
    await key(cdp, ' '); await key(cdp, ' ', 'keyup'); await sleep(220);
    dClosed = await cdp.ev(`window.__office.state.dialogue === null`);
  }
  const talks = await cdp.ev(`window.__office.state.talks.size`);
  ok('dialogue advances and closes', dClosed === true && talks >= 1, `talks=${talks}`);

  // ---- expressions -------------------------------------------------------------
  // The acceptance, as state rather than as a picture: all fourteen faces
  // reachable through setMood, the blink gate, the timer windows, poses as
  // borrowed anim frames, and the dialogue tag landing on the speaker's mood.
  const EXPR_PROOF = `(async () => {
    const ex = await import('/src/art/expressions.js?v=24');
    const rig = await import('/src/art/rig.js?v=24');
    const s = window.__office.state;
    const names = Object.keys(ex.EXPRESSION).filter((n) => n !== 'neutral');
    const shapeBad = names.filter((n) => {
      const e = ex.EXPRESSION[n];
      return ![e.brows, e.eyes, e.mouth].every((v) => Number.isInteger(v) && v >= 0 && v < 8) ||
        !ex.POSES[e.pose] || (e.overlay !== null && !ex.OVERLAYS.includes(e.overlay)) ||
        !(e.weight > 0 && e.weight <= 1);
    });
    const overlayKinds = [...new Set(names.map((n) => ex.EXPRESSION[n].overlay).filter(Boolean))];

    // All fourteen reachable through state: set, settle the ease, and the
    // blend has to read the expression's own weight at full presence.
    const a = rig.actorFor(s.player);
    const unreachable = [];
    for (const n of names) {
      ex.setMood(a, n, 600);
      for (let i = 0; i < 24; i++) ex.updateMood(a, 1 / 60);
      const b = ex.faceBlend(a.mood);
      if (a.mood.target !== n || b.dom !== ex.EXPRESSION[n] || Math.abs(b.presence - ex.EXPRESSION[n].weight) > 1e-6) unreachable.push(n);
    }
    ex.setMood(a, 'neutral', 0);
    for (let i = 0; i < 24; i++) ex.updateMood(a, 1 / 60);
    const rests = ex.faceBlend(a.mood).presence === 0;

    // Timer windows, sampled off fresh moods: blink 3-6 s, gaze 2-5 s.
    let blinkOk = true, gazeOk = true;
    for (let i = 0; i < 300; i++) {
      const m = ex.createMood();
      if (m.blinkIn < 180 || m.blinkIn > 360) blinkOk = false;
      if (m.gazeIn < 120 || m.gazeIn > 300) gazeOk = false;
    }

    // The blink gate: a hard expression or an overlay owns the eyes — a due
    // blink never starts, and one in flight is cancelled rather than cutting
    // across the face. A soft face with no overlay still blinks.
    const mk = (n) => { const t = rig.createActor('blink-probe'); ex.setMood(t, n, 100000); return t; };
    const hard = mk('angry');
    hard.mood.blinkIn = 1;
    for (let i = 0; i < 30; i++) ex.updateMood(hard, 1 / 60);
    const hardNoBlink = hard.mood.blink === 0;
    const soft = mk('ambitious');
    soft.mood.blink = 5;
    ex.setMood(soft, 'crying', 100000);
    // Past the crossfade midpoint the hard side owns the eyes: a blink in
    // flight is cancelled rather than cutting across the face.
    for (let i = 0; i < 12; i++) ex.updateMood(soft, 1 / 60);
    const cancels = soft.mood.blink === 0;
    const calm = mk('ambitious');
    calm.mood.blinkIn = 1;
    let softBlinks = false;
    for (let i = 0; i < 30; i++) { ex.updateMood(calm, 1 / 60); if (calm.mood.blink > 0) softBlinks = true; }
    const held = mk('sleepy');
    for (let i = 0; i < 200; i++) ex.updateMood(held, 1 / 60);
    const overlayHolds = held.mood.target === 'sleepy' && ex.faceBlend(held.mood).hard;

    // Poses borrow frames the rig already owns — never a new sheet — and a
    // seated doll keeps its chair track. The pose rides the blend's dominant
    // side, so each probe settles past the crossfade before it is read.
    const poseA = rig.createActor(s.player.id);
    ex.setMood(poseA, 'excited', 100000);
    for (let i = 0; i < 24; i++) rig.updateActor(poseA, 1 / 60);
    const wave = poseA.anim === 'wave' && poseA.frame === 2;
    ex.setMood(poseA, 'crying', 100000);
    for (let i = 0; i < 24; i++) rig.updateActor(poseA, 1 / 60);
    const sip = poseA.anim === 'sip' && poseA.frame === 6;
    const sitter = rig.createActor(s.player.id);
    sitter.entity = { seated: true, dir: 'up', off: 0, say: 0 };
    ex.setMood(sitter, 'excited', 100000);
    for (let i = 0; i < 24; i++) rig.updateActor(sitter, 1 / 60);
    const seatedKeeps = sitter.anim === 'type';

    // Every expression is authored somewhere in the dialogue, and the window
    // puts the page's tag on the speaker's mood when the page opens.
    const src = await (await fetch('/src/ui/dialogue.js?v=24')).text();
    const tagged = [...new Set([...src.matchAll(/\\[([a-z-]+)\\]/g)].map((m) => m[1]))];
    const untagged = names.filter((n) => !tagged.includes(n));
    const firstTag = {};
    for (const m of src.matchAll(/^  '?([a-z-]+)'?: \\[/gm)) {
      const rest = src.slice(m.index + m[0].length);
      const t = /'\\[([a-z-]+)\\]/.exec(rest);
      if (t) firstTag[m[1]] = t[1];
    }
    return JSON.stringify({
      count: names.length, shapeBad, overlayKinds, unreachable, rests,
      blinkOk, gazeOk, hardNoBlink, cancels, softBlinks, overlayHolds,
      wave, sip, seatedKeeps, untagged, firstTag
    });
  })()`;
  const xp = JSON.parse(await cdp.ev(EXPR_PROOF));
  ok('all 14 expressions reachable through mood state',
    xp.count === 14 && xp.unreachable.length === 0 && xp.rests && xp.shapeBad.length === 0,
    JSON.stringify({ unreachable: xp.unreachable, shapeBad: xp.shapeBad, rests: xp.rests }));
  ok('nine overlay kinds cover the table', xp.overlayKinds.length === 9, xp.overlayKinds.join(' '));
  ok('blink 3-6 s and gaze 2-5 s, random per actor', xp.blinkOk && xp.gazeOk);
  ok('blink never interrupts a hard expression or an overlay',
    xp.hardNoBlink && xp.cancels && xp.softBlinks && xp.overlayHolds,
    JSON.stringify({ hardNoBlink: xp.hardNoBlink, cancels: xp.cancels, softBlinks: xp.softBlinks, overlayHolds: xp.overlayHolds }));
  ok('poses borrow rig frames, seated dolls keep their chair track',
    xp.wave && xp.sip && xp.seatedKeeps, JSON.stringify({ wave: xp.wave, sip: xp.sip, seatedKeeps: xp.seatedKeeps }));
  ok('every expression is authored in the dialogue', xp.untagged.length === 0, xp.untagged.join(' ') || 'all 14 tagged');

  // The tag on open, live: park beside a colleague whose first page carries a
  // tag, talk, and read the mood straight off their actor.
  const tagSpot = await cdp.ev(`(() => {
    const firstTag = ${JSON.stringify(xp.firstTag)};
    const s = window.__office.state;
    const n = s.npcs.find((m) => firstTag[m.id] && !m.seated);
    if (!n) return null;
    n.moving = false; n.step = 0; n.wait = 100000;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const x = n.tx + dx, y = n.ty + dy;
      if (s.walkable(x, y)) {
        const p = s.player;
        p.moving = false; p.step = 0; p.frame = 0;
        p.tx = x; p.ty = y; p.px = x * 32; p.py = y * 32;
        return { id: n.id, tag: firstTag[n.id] };
      }
    }
    return null;
  })()`);
  let tagOpen = false;
  if (tagSpot) {
    await sleep(220);
    await key(cdp, 'z'); await key(cdp, 'z', 'keyup');
    await sleep(420);
    tagOpen = await cdp.ev(`!!window.__office.state.dialogue`);
  }
  const tagMood = tagOpen ? await cdp.ev(`window.__office.state.dialogue.npc.actor.mood.target`) : null;
  ok('dialogue applies the expression tag on open', tagOpen && tagMood === tagSpot.tag,
    JSON.stringify({ npc: tagSpot && tagSpot.id, want: tagSpot && tagSpot.tag, got: tagMood }));
  let tagClosed = false;
  for (let i = 0; i < 16 && !tagClosed; i++) {
    await key(cdp, ' '); await key(cdp, ' ', 'keyup'); await sleep(220);
    tagClosed = await cdp.ev(`window.__office.state.dialogue === null`);
  }
  const tagRest = tagClosed ? await cdp.ev(`window.__office.state.npcs.find((n) => n.id === ${JSON.stringify(tagSpot && tagSpot.id)}).actor.mood.target`) : null;
  ok('closing releases the face back to rest', tagClosed && tagRest === 'neutral', String(tagRest));

  // The acceptance picture: four standing colleagues staged around the parked
  // player, faces to the camera, each holding a different hard mood — overlays
  // and borrowed pose frames included. Seated dolls face their desks, so a
  // mood on one would only ever show the back of a head.
  await cdp.ev(`(async () => {
    const ex = await import('/src/art/expressions.js?v=24');
    const s = window.__office.state;
    const p = s.player;
    p.tx = 9; p.ty = 4; p.px = 9 * 32; p.py = 4 * 32; p.moving = false; p.step = 0;
    const standing = s.npcs.filter((n) => !n.seated).slice(0, 4);
    const slots = [[7, 4], [11, 4], [7, 6], [11, 6]];
    const moods = ['excited', 'angry', 'crying', 'in-love'];
    standing.forEach((n, i) => {
      const [sx, sy] = slots[i];
      let at = null;
      for (let r = 0; r < 4 && !at; r++) {
        for (let dy = -r; dy <= r && !at; dy++) {
          for (let dx = -r; dx <= r && !at; dx++) {
            const x = sx + dx, y = sy + dy;
            if (s.walkable(x, y) && !s.occupied.has(x + ',' + y) && !(x === 9 && y === 4)) at = [x, y];
          }
        }
      }
      if (!at) return;
      n.tx = at[0]; n.ty = at[1]; n.x = at[0]; n.y = at[1];
      n.px = at[0] * 32; n.py = at[1] * 32;
      n.moving = false; n.step = 0; n.wait = 100000; n.say = 0; n.dir = 'down';
      ex.setMood(n.actor, moods[i], 600);
    });
  })()`);
  await sleep(800);
  await cdp.shot('qa_expressions');
  const decay = JSON.parse(await cdp.ev(`(async () => {
    const ex = await import('/src/art/expressions.js?v=24');
    const rig = await import('/src/art/rig.js?v=24');
    const a = rig.createActor('decay-probe');
    ex.setMood(a, 'happy', 60);
    for (let i = 0; i < 120; i++) ex.updateMood(a, 1 / 60);
    return JSON.stringify({ target: a.mood.target, presence: ex.faceBlend(a.mood).presence });
  })()`));
  ok('a held mood decays back to rest when its hold runs out',
    decay.target === 'neutral' && decay.presence === 0, JSON.stringify(decay));

  // ---- zoom stops -----------------------------------------------------------
  // The HUD is authored in the 480x288 design space and drawn outside the world
  // pass, so it has to land on exactly the same device pixels at both stops: if
  // it moved or scaled with the zoom, it would sit on a different box.
  // The clock's own parchment, and nothing near it: the sample region sits over
  // the room, and at the far stop the room holds pale pixels too. A box edge has
  // to be a run of the slab — a column of it, a row of it — so one light pixel
  // twenty units to the left cannot become the HUD's left edge.
  const hudBox = async () => JSON.parse(await cdp.ev(`(() => {
    const b = window.__office.buffer;
    const W = 260, H = 140;
    const d = b.getContext('2d').getImageData(1020, 0, W, H).data;
    const cols = new Array(W).fill(0), rows = new Array(H).fill(0);
    let n = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const r = d[i], g = d[i + 1], bl = d[i + 2];
        if (r >= 243 && r <= 252 && g >= 234 && g <= 248 && bl >= 205 && bl <= 230) {
          n++;
          cols[x]++;
          rows[y]++;
        }
      }
    }
    const edges = (a, need) => {
      let lo = -1, hi = -1;
      for (let i = 0; i < a.length; i++) if (a[i] >= need) { if (lo < 0) lo = i; hi = i; }
      return [lo, hi];
    };
    const cx = edges(cols, 60), cy = edges(rows, 100);
    return JSON.stringify({ n, box: [cx[0], cy[0], cx[1], cy[1]] });
  })()`));
  const hudNear = await hudBox();

  // The re-frame, sampled frame by frame from the live game. Whatever the frame
  // rate, the plate may not swap before the midpoint of the ease and must have
  // swapped by it: a sample pairs the ease's own step count with what is drawn.
  const zap = JSON.parse(await cdp.ev(`(async () => {
    const s = window.__office.state;
    const t0 = performance.now();
    document.getElementById('zoomBtn').click();
    const seen = [];
    while (performance.now() - t0 < 1200) {
      await new Promise((r) => requestAnimationFrame(r));
      seen.push([s.zoom ? s.zoom.n : 0, s.view]);
      if (!s.zoom && s.view === 'far') break;
    }
    return JSON.stringify({
      total: Math.round(performance.now() - t0),
      seen,
      settled: !s.zoom && s.view === 'far',
      canvas: [gameCanvas.width, gameCanvas.height]
    });
  })()`));
  // Half of nine frames is the fifth step, so the near plate owns 1..4.
  const earlySwap = zap.seen.some(([n, v]) => v === 'far' && n > 0 && n < 5);
  const lateSwap = zap.seen.some(([n, v]) => v === 'near' && n >= 5);
  ok('live re-frame swaps the plate at the midpoint, never before',
    zap.settled && !earlySwap && !lateSwap,
    JSON.stringify({ samples: zap.seen.map(([n, v]) => `${n}${v[0]}`).join(' '), ms: zap.total }));

  // The ease itself, stepped on a scratch camera so the count cannot be blurred
  // by the frame rate: 150 ms is nine frames, and the plate changes on the fifth.
  const ease = JSON.parse(await cdp.ev(`(async () => {
    const c = await import('/src/core/config.js?v=24');
    const k = await import('/src/world/camera.js?v=24');
    const live = window.__office.state;
    const s = {
      view: 'near', zoom: null, cam: { x: 0, y: 0, shake: 0 }, map: live.map,
      player: { px: live.player.px, py: live.player.py }
    };
    s.cam.x = 0; s.cam.y = 0;
    k.centerCamera(s);
    k.setView(s, 'far');
    const steps = [];
    for (let i = 0; i < 16; i++) {
      k.updateCamera(s);
      steps.push([s.zoom ? s.zoom.n : 0, s.view]);
      if (!s.zoom) break;
    }
    return JSON.stringify({ ms: k.ZOOM_MS, frameMs: c.FRAME_MS, steps });
  })()`));
  const swapStep = ease.steps.findIndex(([, v]) => v === 'far');
  ok('150 ms is nine frames, plate swapped on the fifth',
    ease.ms === 150 && ease.steps.length === Math.round(150 / ease.frameMs) && swapStep >= 0 &&
    swapStep === Math.round(150 / ease.frameMs / 2) - 1,
    JSON.stringify({ ms: ease.ms, frames: ease.steps.length, swapStep }));
  ok('far view keeps the buffer', zap.canvas[0] === 1280 && zap.canvas[1] === 720, JSON.stringify(zap.canvas));
  await cdp.shot('qa_view_far');
  const vf = JSON.parse(await cdp.ev(VIEW_PROOF));
  ok('far stop: 1280x720 backing, live far view, 20 x 11.25 tiles',
    viewOk(vf, 'far', 20, 11.25), JSON.stringify(vf));
  await cdp.shot('qa_golden_far');

  const hudFar = await hudBox();
  const far = JSON.parse(await cdp.ev(`(async () => {
    const pr = await import('/src/art/props.js?v=24');
    return JSON.stringify({
      view: window.__office.state.view,
      cam: [window.__office.state.cam.x, window.__office.state.cam.y],
      map: [window.__office.state.map.w, window.__office.state.map.h],
      zoom: window.__office.state.zoom,
      rise: pr.WALL_RISE * 32
    });
  })()`));
  ok('hud neither moves nor scales with the zoom',
    JSON.stringify(hudNear.box) === JSON.stringify(hudFar.box) &&
    hudNear.box[0] >= 0 && hudNear.box[1] >= 0 && hudNear.n > 4000 && hudFar.n > 4000,
    `${JSON.stringify(hudNear.box)} n=${hudNear.n} / ${JSON.stringify(hudFar.box)} n=${hudFar.n}`);
  // Far frames 640x360 units in a 1280x720 buffer, so the camera has to sit
  // inside the map on the 2 px grid — a frame past the edge would be void. The
  // top edge is the exception: it may sit in the headroom the walls take, and
  // never below the wall's own top.
  const rise = far.rise;
  const inBounds = far.cam[0] >= 0 && far.cam[1] >= -rise &&
    far.cam[0] <= far.map[0] * 32 - 640 + 1e-9 && far.cam[1] <= far.map[1] * 32 - 360 + 1e-9;
  const onGrid2 = far.cam.every((v) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-9);
  ok('far view sits inside the map, on the 2 px device grid',
    inBounds && onGrid2 && far.zoom === null, JSON.stringify(far));

  const spans = JSON.parse(await cdp.ev(`(async () => {
    const c = await import('/src/core/config.js?v=24');
    return JSON.stringify({
      near: c.BUFFER_W / c.VIEWS.near.ppu,
      far: c.BUFFER_W / c.VIEWS.far.ppu,
      tall: [c.BUFFER_H / c.VIEWS.near.ppu, c.BUFFER_H / c.VIEWS.far.ppu]
    });
  })()`));
  ok('zooming out shows exactly twice the world',
    spans.far === spans.near * 2 && spans.tall[1] === spans.tall[0] * 2,
    JSON.stringify(spans));

  const wheel = (dy) => cdp.ev(`document.getElementById('stage').dispatchEvent(
    new WheelEvent('wheel', { deltaY: ${dy}, bubbles: true, cancelable: true }))`);
  await wheel(-120);
  await sleep(400);
  const wheelIn = await cdp.ev(`window.__office.state.view`);
  await wheel(140);
  await sleep(400);
  const wheelOut = await cdp.ev(`window.__office.state.view`);
  await key(cdp, '='); await key(cdp, '=', 'keyup'); await sleep(400);
  const plusIn = await cdp.ev(`window.__office.state.view`);
  await key(cdp, '-'); await key(cdp, '-', 'keyup'); await sleep(400);
  const minusOut = await cdp.ev(`window.__office.state.view`);
  ok('wheel and +/- pick the same two stops',
    wheelIn === 'near' && wheelOut === 'far' && plusIn === 'near' && minusOut === 'far',
    `${wheelIn} / ${wheelOut} / ${plusIn} / ${minusOut}`);

  // A wheel flicked both ways before the ease lands has to come back to a stop
  // rather than leaving the camera stranded between them.
  await wheel(-120); await sleep(40); await wheel(140);
  await sleep(500);
  const flick = JSON.parse(await cdp.ev(`JSON.stringify({
    view: window.__office.state.view, zoom: window.__office.state.zoom
  })`));
  ok('an interrupted re-frame still lands on a stop',
    flick.view === 'far' && flick.zoom === null, JSON.stringify(flick));

  await cdp.ev(`document.getElementById('zoomBtn').click()`);
  await sleep(400);
  const pill = JSON.parse(await cdp.ev(`JSON.stringify({
    view: window.__office.state.view,
    label: document.querySelector('#zoomBtn .zoom-label').textContent,
    pressed: document.getElementById('zoomBtn').getAttribute('aria-pressed'),
    focused: document.activeElement === document.getElementById('zoomBtn')
  })`));
  ok('pill toggles back and names the next stop',
    pill.view === 'near' && /zoom out/i.test(pill.label) && pill.pressed === 'false' && pill.focused === false,
    JSON.stringify(pill));

  // The three things the prop pass exists for, in the zoom the player plays at.
  // The first frames a desk bank with its sitters — the tabletop must cut
  // their lap and not their chest, and each chair back must sit over the person
  // in it. The second puts the pantry's tall fridge beside a 1.5-tile person.
  // The third frames the two-tile doorway you spawn at.
  const park = (tx, ty) => cdp.ev(`(() => {
    const s = window.__office.state, p = s.player;
    p.tx = ${tx}; p.ty = ${ty}; p.px = ${tx} * 32; p.py = ${ty} * 32; p.moving = false; p.step = 0; p.frame = 0;
  })()`);

  ok('back to the near view', (await cdp.ev(`window.__office.state.view`)) === 'near');

  await park(6, 4);
  await sleep(1100);
  await cdp.shot('qa_props');
  await park(21, 24);
  await sleep(1100);
  await cdp.shot('qa_props_pantry');
  await park(3, 25);
  await sleep(1100);
  await cdp.shot('qa_props_door');
  // The golden doorway: stand on the approach tile and let the live machine
  // swing both leaves fully open before the shot — an open door is a state,
  // not a framing accident.
  await park(3, 26);
  let doorShot = null;
  for (let i = 0; i < 20; i++) {
    await sleep(200);
    doorShot = JSON.parse(await cdp.ev(`(() => {
      const s = window.__office.state;
      const d = s.map.doors.find((v) => v.y === s.map.h - 1);
      return JSON.stringify({ state: d.anim.state, open: d.anim.open });
    })()`));
    if (doorShot.state === 'open' && doorShot.open >= 1) break;
  }
  ok('the entrance stands fully open for the golden shot',
    doorShot.state === 'open' && doorShot.open >= 1, JSON.stringify(doorShot));
  await cdp.shot('qa_golden_door_open');
  // The remaining zones, each framed from inside its own aisle: the glazed
  // meeting room, the lounge rug, the manager's glass box and the booth spine.
  await park(22, 5);
  await sleep(1100);
  await cdp.shot('qa_props_meeting');
  await park(12, 24);
  await sleep(1100);
  await cdp.shot('qa_props_lounge');
  await park(22, 13);
  await sleep(1100);
  await cdp.shot('qa_props_manager');
  await park(15, 11);
  await sleep(1100);
  await cdp.shot('qa_props_booth');

  // A sitter at a known chair, so the same desk is framed on every run instead
  // of whichever seat the shuffle happened to fill: the shot is the acceptance
  // for "the tabletop hides the legs and the chair back covers their back".
  await cdp.ev(`(() => {
    const s = window.__office.state;
    const n = s.npcs[0];
    // Hand the doll a clean dwell on the mark: release whatever chair it owned,
    // clear the mark's claim, and adopt it seated with the schedule parked, so
    // the day's logic keeps it on the chair instead of walking it off.
    if (n.seat) s.map.releaseSeat(n.seat, n.id);
    const mark = s.map.seatAt(9, 3);
    if (mark) mark.occupiedBy = null;
    n.seated = true; n.dir = 'up'; n.moving = false; n.step = 0; n.say = 0;
    n.tx = 9; n.ty = 3; n.x = 9; n.y = 3; n.px = 9 * 32; n.py = 3 * 32;
    n.home = { x: 9, y: 3 };
    n.seat = null; n.leaving = null; n.phase = 'dwell'; n.dwell = 100000;
    n.stopIdx = 0; n.action = 'type'; n.act = 0; n.path = null; n.target = null;
    n.wait = 0; n.stepLen = 12;
  })()`);
  await park(9, 4);
  await sleep(900);
  await cdp.shot('qa_seated');
  await cdp.shot('qa_golden_seated');

  // A wall in full, from the side the camera can see all of: 2.5 tiles of face
  // and the cap along the top.
  await park(2, 9);
  await sleep(900);
  await cdp.shot('qa_wall');

  // The north wall seen head on: face, skirting and the board hung at eye
  // height, with a colleague standing in front of it so the wall is behind
  // them and not through them.
  await park(24, 1);
  await sleep(1200);
  await cdp.shot('qa_wallface');

  // Zoomed out on the same tile the camera can look highest from — the one place
  // the room has no floor above it to hide behind — the stop goes up by exactly
  // the wall's overhang and the frame ends on the wall's own top edge. What is
  // above that line is the void, so a band of it at the top means the headroom
  // was taken too far: the ink is 20,23,31 and a painted cap is never that dark
  // across the whole width.
  const over = JSON.parse(await cdp.ev(`(async () => {
    const pr = await import('/src/art/props.js?v=24');
    const s = window.__office.state;
    document.getElementById('zoomBtn').click();
    const t0 = performance.now();
    while (performance.now() - t0 < 1500) {
      await new Promise((r) => requestAnimationFrame(r));
      if (!s.zoom && s.view === 'far') break;
    }
    const d = document.getElementById('gameCanvas').getContext('2d')
      .getImageData(200, 0, 700, 16).data;
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { sum += (d[i] + d[i + 1] + d[i + 2]) / 3; n++; }
    return JSON.stringify({
      mean: Math.round(sum / n), cam: [s.cam.x, s.cam.y], view: s.view,
      rise: pr.WALL_RISE * 32
    });
  })()`));
  ok('the band over the wall is wall, not void, at the top of its headroom',
    over.view === 'far' && over.mean > 60 && Math.abs(-over.cam[1] - over.rise) <= 0.25,
    JSON.stringify(over));
  await cdp.ev(`(async () => {
    const s = window.__office.state;
    document.getElementById('zoomBtn').click();
    const t0 = performance.now();
    while (performance.now() - t0 < 1500) {
      await new Promise((r) => requestAnimationFrame(r));
      if (!s.zoom && s.view === 'near') break;
    }
  })()`);
  await sleep(400);

  // ---- acceptance: the door, the coffee run, the player's own chair ---------
  const doorCycle = JSON.parse(await cdp.ev(DOOR_PROOF));
  ok('the entrance leaf opens on approach, holds for a body, closes and reopens',
    doorCycle.closed === 'closed' && doorCycle.solid === true &&
    doorCycle.opened === 'open' && doorCycle.passable === true &&
    doorCycle.heldOpen === 'open' && doorCycle.closing === 'closing' &&
    doorCycle.shutMid === true && doorCycle.reopened === 'open',
    JSON.stringify(doorCycle));

  const run = JSON.parse(await cdp.ev(NPC_RUN_PROOF));
  ok('a colleague walks to the pantry, drinks, comes home, sits and types',
    run.drank === true && run.sat === true && run.typed === true && run.drinkDir === 'down',
    JSON.stringify(run));
  ok('the coffee run never teleports: one tile, one stride at a time',
    run.maxTile <= 1 && run.maxPx <= 32,
    JSON.stringify({ maxTile: run.maxTile, maxPx: run.maxPx, ticks: run.ticks }));

  // The player's own actions, live through the real keys. The crowd holds
  // still for the test so no colleague wanders into the talk range or the
  // chair's approach, then the day resumes exactly where it was.
  const waits = JSON.parse(await cdp.ev(`JSON.stringify(window.__office.state.npcs.map((n) => n.wait))`));
  await cdp.ev(`window.__office.state.npcs.forEach((n) => { n.wait = 100000; })`);

  const sip = JSON.parse(await cdp.ev(`(() => {
    const s = window.__office.state;
    const kinds = new Set(['coffeeMachine', 'kettle', 'waterCooler', 'mugShelf', 'mug']);
    const clear = (x, y) => s.walkable(x, y) &&
      !s.npcs.some((n) => Math.abs(n.tx - x) + Math.abs(n.ty - y) <= 1);
    for (const pr of s.map.props) {
      if (!kinds.has(pr.kind)) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = pr.x + dx, y = pr.y + dy;
        if (!clear(x, y)) continue;
        const p = s.player;
        p.tx = x; p.ty = y; p.px = x * 32; p.py = y * 32;
        p.moving = false; p.step = 0; p.seated = false; p.seat = null;
        p.leaving = null; p.working = false; p.action = 'idle'; p.act = 0;
        return JSON.stringify({ x, y, prop: [pr.x, pr.y] });
      }
    }
    return 'null';
  })()`));
  let sipOk = false;
  if (sip) {
    await sleep(200);
    await key(cdp, 'z'); await key(cdp, 'z', 'keyup');
    await sleep(150);
    const sipping = JSON.parse(await cdp.ev(`JSON.stringify({
      action: window.__office.state.player.action,
      dialogue: !!window.__office.state.dialogue
    })`));
    sipOk = sipping.action === 'drink' && !sipping.dialogue;
    await sleep(600);
  }
  ok('one key beside the coffee things takes a sip', sipOk, JSON.stringify(sip));

  const pick = JSON.parse(await cdp.ev(`(() => {
    const s = window.__office.state;
    const seat = s.map.seats.find((t) => (t.kind === 'chair' || t.kind === 'chairOlive') &&
      !t.occupiedBy && s.walkable(t.approach.x, t.approach.y) &&
      !s.npcs.some((n) => Math.abs(n.tx - t.approach.x) + Math.abs(n.ty - t.approach.y) <= 1));
    if (!seat) return 'null';
    const p = s.player;
    p.tx = seat.approach.x; p.ty = seat.approach.y;
    p.px = p.tx * 32; p.py = p.ty * 32;
    p.moving = false; p.step = 0; p.seated = false; p.seat = null;
    p.leaving = null; p.working = false; p.action = 'idle'; p.act = 0;
    p.dir = seat.dir; p.stepLen = 12;
    return JSON.stringify({ x: seat.x, y: seat.y, ax: seat.approach.x, ay: seat.approach.y, dir: seat.dir });
  })()`));
  let sitState = null;
  if (pick) {
    await sleep(700);
    await key(cdp, 'z'); await key(cdp, 'z', 'keyup');
    await sleep(900);
    sitState = JSON.parse(await cdp.ev(`(() => {
      const s = window.__office.state, p = s.player;
      return JSON.stringify({
        seated: p.seated, tx: p.tx, ty: p.ty, py: p.py, dir: p.dir,
        action: p.action, anim: p.actor ? p.actor.anim : null,
        owner: p.seat ? p.seat.occupiedBy : null, id: p.id,
        dialogue: !!s.dialogue
      });
    })()`));
  }
  const satOk = !!pick && !!sitState && sitState.seated === true &&
    sitState.tx === pick.x && sitState.ty === pick.y && sitState.py === pick.y * 32 &&
    sitState.owner === sitState.id && sitState.anim === 'sitidle' &&
    sitState.dir === pick.dir && !sitState.dialogue;
  ok('the player sits: a seated sprite on the seat pivot, facing the desk', satOk,
    JSON.stringify({ pick, sitState }));
  await sleep(400);
  await cdp.shot('qa_player_seated');

  let lap = null, up = null;
  if (pick && satOk) {
    await key(cdp, 'z'); await key(cdp, 'z', 'keyup');
    await sleep(400);
    lap = JSON.parse(await cdp.ev(`JSON.stringify({
      action: window.__office.state.player.action,
      anim: window.__office.state.player.actor ? window.__office.state.player.actor.anim : null,
      seated: window.__office.state.player.seated
    })`));
    // A tap of the way out: the stand-up glide plays, the chair is freed, and
    // the released key leaves the player standing on the approach tile.
    // Freezing n.wait stops new decisions but not a stride already in flight:
    // a colleague can still land on (or reserve) the approach after the pick,
    // and standUp stays seated while state.walkable(approach) is false. Evict
    // anyone on or bound for the tile and release their claim before tapping.
    const clearApproach = () => cdp.ev(`(() => {
      const s = window.__office.state;
      const ax = ${pick.ax}, ay = ${pick.ay};
      for (const n of s.npcs) {
        const onIt = (n.tx === ax && n.ty === ay) ||
          (n.moving && n.to && n.to.x === ax && n.to.y === ay);
        if (!onIt) continue;
        if (n.from) s.occupied.delete(n.from.x + ',' + n.from.y);
        if (n.to) s.occupied.delete(n.to.x + ',' + n.to.y);
        n.moving = false; n.step = 0; n.path = null; n.target = null;
        n.tx = -999; n.ty = -999; n.px = -999 * 32; n.py = -999 * 32;
      }
      s.occupied.delete(ax + ',' + ay);
      return s.walkable(ax, ay);
    })()`);
    for (let i = 0; i < 3; i++) {
      await clearApproach();
      await key(cdp, 'ArrowDown'); await sleep(200); await key(cdp, 'ArrowDown', 'keyup');
      await sleep(800);
      up = JSON.parse(await cdp.ev(`(() => {
        const s = window.__office.state, p = s.player;
        const seat = s.map.seatAt(${pick.x}, ${pick.y});
        return JSON.stringify({ seated: p.seated, ty: p.ty, action: p.action,
          owner: seat ? seat.occupiedBy : 'gone' });
      })()`));
      if (up.seated === false) break;
    }
  }
  ok('a second key opens the laptop on the desk',
    !!lap && lap.action === 'laptop' && lap.anim === 'type' && lap.seated === true, JSON.stringify(lap));
  ok('a direction stands the player up and frees the chair',
    !!up && up.seated === false && up.ty === pick.ay && up.owner === null && up.action === 'idle',
    JSON.stringify(up));

  await cdp.ev(`(() => {
    const w = ${JSON.stringify(waits)};
    window.__office.state.npcs.forEach((n, i) => { n.wait = w[i]; });
  })()`);

  await key(cdp, 'Escape'); await sleep(300);
  const paused = await cdp.ev(`window.__office.state.paused`);
  await cdp.shot('qa_pause');
  await key(cdp, 'Escape'); await sleep(300);
  ok('pause / resume', paused === true && (await cdp.ev(`window.__office.state.paused`)) === false, String(paused));

  // ---- evening --------------------------------------------------------------
  await cdp.send('Page.navigate', { url: 'http://localhost:8000/?time=18:05' });
  await sleep(2200);
  await enlist(cdp);
  let modal = false;
  for (let i = 0; i < 24 && !modal; i++) { await sleep(300); modal = await cdp.ev(`!document.getElementById('clockOutModal').hidden`); }
  ok('18:00 question pops centred', modal === true);
  await cdp.shot('qa_modal');
  await cdp.ev(`document.getElementById('clockOutNo').click()`);
  await sleep(300);
  ok('decline keeps header offer', await cdp.ev(`document.getElementById('clockOutBtn').hidden === false`));
  await cdp.ev(`document.getElementById('clockOutBtn').click()`);
  await sleep(300);
  await cdp.ev(`document.getElementById('clockOutYes').click()`);
  await sleep(1200);
  const out = JSON.parse(await cdp.ev(`JSON.stringify({
    phase: window.__office.state.phase,
    clockedOut: window.__office.state.clockedOut,
    result: window.__office.state.result && { steps: window.__office.state.result.steps, talks: window.__office.state.result.talks, total: window.__office.state.result.total }
  })`));
  ok('clock-out receipt', out.phase === 'done' && out.clockedOut === true && !!out.result, JSON.stringify(out));
  const px2 = await cdp.ev(PIXEL_PROOF);
  ok('canvas painted (receipt)', px2.distinctColors > 20, JSON.stringify(px2));
  await cdp.shot('qa_receipt');
  await key(cdp, 'r'); await key(cdp, 'r', 'keyup');
  await sleep(800);
  ok('R restarts clean', await cdp.ev(`window.__office.state.phase === 'play' && !window.__office.state.clockedOut`));

  // ---- actor rig --------------------------------------------------------------
  // The layered renderer has to be the monolithic sheet pixel for pixel — the
  // split is a re-packaging of the same art, not a redraw. Both sides draw
  // through the production transform (4 device px per world unit, smoothing
  // off) on scratch canvases, so the proof exercises the real blit path.
  const RIG_PROOF = `(async () => {
    const rig = await import('/src/art/rig.js?v=24');
    const chars = await import('/src/art/characters.js?v=24');
    const s = window.__office.state;
    const kindOf = (id) => rig.actorRigFor(id) ? 'LAYERED'
      : (chars.rigFor(id, 'near') || chars.rigFor(id, 'far')) ? 'BAKED' : 'LEGACY';
    const ids = [s.player.id, ...s.npcs.map((n) => n.id)];
    const kinds = {};
    for (const id of new Set(ids)) kinds[id] = kindOf(id);
    const noArt = ids.filter((id) => !rig.actorRigFor(id) && !chars.rigFor(id, 'near') && !chars.rigFor(id, 'far') && !chars.sheetFor(id));

    const id = Object.keys(kinds).find((k) => kinds[k] === 'LAYERED');
    if (!id) return { kinds, noArt, layered: false };
    // Residency may have evicted this id's near sheet; the parity reference
    // needs it resident, exactly as the close view would.
    await chars.loadRigNear(id);
    const meta = rig.actorRigFor(id).meta;
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 192;
      const x = c.getContext('2d');
      x.imageSmoothingEnabled = false;
      x.setTransform(4, 0, 0, 4, 0, 0);
      return { c, x };
    };
    const draw = (x, dir, anim, frame, intensity) => {
      x.save();
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.clearRect(0, 0, 128, 192);
      x.restore();
      const a = rig.createActor(id);
      a.dir = dir; a.anim = anim; a.frame = frame; a.dx = 0; a.dy = 0;
      rig.setExpression(a, 'neutral', intensity);
      return rig.drawActor(x, a, 4);
    };
    const pixels = (c) => c.getContext('2d').getImageData(0, 0, 128, 192).data;
    const diff = (p, q) => {
      let n = 0;
      for (let i = 0; i < p.length; i += 4) {
        if (p[i] !== q[i] || p[i+1] !== q[i+1] || p[i+2] !== q[i+2] || p[i+3] !== q[i+3]) n++;
      }
      return n;
    };

    // Parity: every authored direction x every anim x every frame, layered
    // drawActor against the monolithic drawRigChar (side is the baked right row).
    const A = mk(), B = mk();
    const mismatch = [];
    let cells = 0;
    for (const [dir, bakedDir] of [['down', 'down'], ['side', 'right'], ['up', 'up']]) {
      for (const [name, a] of Object.entries(meta.anims)) {
        for (let f = 0; f < a.frames; f++) {
          draw(A.x, dir, name, f, 1);
          B.x.save();
          B.x.setTransform(1, 0, 0, 1, 0, 0);
          B.x.clearRect(0, 0, 128, 192);
          B.x.restore();
          chars.drawRigChar(B.x, id, bakedDir, name, f, 0, 0, 'near');
          const d = diff(pixels(A.c), pixels(B.c));
          if (d > 0) mismatch.push(dir + '/' + name + '/' + f + ':' + d);
          cells++;
        }
      }
    }

    // Left is the side block mirrored at draw time: flipping the left render
    // back has to land exactly on the side render.
    draw(A.x, 'side', 'idle', 0, 1);
    draw(B.x, 'left', 'idle', 0, 1);
    const ps = pixels(A.c), pl = pixels(B.c);
    let mirrorBad = 0;
    for (let y = 0; y < 192; y++) {
      for (let x = 0; x < 128; x++) {
        const i = (y * 128 + x) * 4, j = (y * 128 + (127 - x)) * 4;
        for (let k = 0; k < 4; k++) if (pl[i+k] !== ps[j+k]) mirrorBad++;
      }
    }

    // The face layer rides expression intensity: intensity is hold time, so a
    // held expression and a released one, settled through updateActor, must
    // differ on the face. 130 steps: past the half hold, inside the full one.
    const clear = (x) => {
      x.save();
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.clearRect(0, 0, 128, 192);
      x.restore();
    };
    const held = rig.createActor(id), released = rig.createActor(id);
    rig.setExpression(held, 'happy', 1);
    rig.setExpression(released, 'happy', 0);
    for (let s = 0; s < 130; s++) {
      rig.updateActor(held, 1 / 60);
      rig.updateActor(released, 1 / 60);
    }
    for (const a of [held, released]) {
      a.dir = 'down'; a.anim = 'talk'; a.frame = 1; a.dx = 0; a.dy = 0;
    }
    clear(A.x); rig.drawActor(A.x, held, 4);
    clear(B.x); rig.drawActor(B.x, released, 4);
    const faceDiff = diff(pixels(A.c), pixels(B.c));

    // An id with no art at all returns false, never throws.
    const ghost = rig.createActor('no-such-colleague');
    const ghostDraws = rig.drawActor(A.x, ghost, 4);

    return { kinds, noArt, layered: true, id, cells, mismatch, mirrorBad, faceDiff, ghostDraws };
  })()`;
  const rp = await cdp.ev(RIG_PROOF);
  ok('every cast member carries art, zuhdi is layered',
    rp.noArt.length === 0 && Object.values(rp.kinds).includes('LAYERED'),
    JSON.stringify({ kinds: rp.kinds, noArt: rp.noArt }));
  if (rp.layered) {
    ok('layered drawActor is the monolithic sheet, pixel for pixel',
      rp.mismatch.length === 0 && rp.cells > 100,
      `${rp.cells} cells, mismatch: ${rp.mismatch.slice(0, 6).join(' ') || 'none'}`);
    ok('left is the side block mirrored at draw time', rp.mirrorBad === 0, `${rp.mirrorBad} channel diffs`);
    ok('expression intensity drives the face layer', rp.faceDiff > 0, `${rp.faceDiff} px`);
    ok('unknown id draws nothing, never throws', rp.ghostDraws === false, String(rp.ghostDraws));
  }

  // ---- contact sheet ----------------------------------------------------------
  // ?rig=1 skips enlist and lays out every anim and direction of every
  // colleague through the same drawActor the floor uses. The route has to
  // load clean: whatever the world run logged, this one adds nothing.
  const rigErrBase = cdp.errors.length;
  await cdp.send('Page.navigate', { url: 'http://localhost:8000/?rig=1&time=10:30' });
  let rigReady = false;
  for (let i = 0; i < 40 && !rigReady; i++) {
    await sleep(300);
    rigReady = await cdp.ev(`!!(window.__office && window.__office.rig)`);
  }
  const cs = JSON.parse(await cdp.ev(`JSON.stringify({
    mode: window.__office.state.mode,
    running: window.__office.state.running,
    page: window.__office.rig.page,
    lod: window.__office.rig.lod,
    kind: window.__office.rig.kindOf('zuhdi'),
    anim: window.__office.rig.anim
  })`));
  ok('?rig=1 opens the contact sheet', rigReady && cs.mode === 'rig' && cs.running === true && cs.kind === 'LAYERED', JSON.stringify(cs));
  await sleep(400);
  await cdp.shot('qa_rig_layered');
  await key(cdp, 'ArrowRight'); await sleep(900);
  const cs2 = JSON.parse(await cdp.ev(`JSON.stringify({
    page: window.__office.rig.page,
    kind: window.__office.rig.kindOf(window.__office.rig.actors[window.__office.rig.page].id)
  })`));
  ok('paging walks the cast', cs2.page === cs.page + 1 && cs2.kind !== 'LAYERED', JSON.stringify(cs2));
  await cdp.shot('qa_rig_baked');
  const anim0 = await cdp.ev(`window.__office.rig.anim`);
  await key(cdp, 'ArrowDown'); await sleep(200);
  const anim1 = await cdp.ev(`window.__office.rig.anim`);
  ok('up/down picks the live anim', anim0 !== anim1, `${anim0} -> ${anim1}`);
  await key(cdp, 'z'); await sleep(300);
  ok('Z swaps the LOD', (await cdp.ev(`window.__office.rig.lod`)) === '2');
  await key(cdp, 'z'); await sleep(200);
  // Sample across more than one full cycle: two reads one cycle apart can
  // alias onto the same frame and read a running strip as frozen.
  const frames = new Set();
  for (let i = 0; i < 10; i++) {
    frames.add(await cdp.ev(`window.__office.rig.actors[window.__office.rig.page].frame`));
    await sleep(150);
  }
  ok('the live strip runs updateActor', frames.size > 1, [...frames].join(','));
  const px3 = await cdp.ev(PIXEL_PROOF);
  ok('canvas painted (contact sheet)', px3.distinctColors > 20, JSON.stringify(px3));
  ok('?rig=1 loads without console errors', cdp.errors.length === rigErrBase,
    cdp.errors.slice(rigErrBase, rigErrBase + 4).join(' | '));

  // ---- expression contact sheet ------------------------------------------------
  // ?faces=1 lays out all fourteen faces on every skin tone through the same
  // drawFace the floor uses. Every cell is sampled where the sheet itself says
  // it put the head: painted, and distinct from its neighbours in both axes.
  const facesErrBase = cdp.errors.length;
  await cdp.send('Page.navigate', { url: 'http://localhost:8000/?faces=1&time=10:30' });
  let facesReady = false;
  for (let i = 0; i < 40 && !facesReady; i++) {
    await sleep(300);
    facesReady = await cdp.ev(`!!(window.__office && window.__office.faces)`);
  }
  // The handle appears in open(), before the loop's first frame: on a loaded
  // machine the buffer can still be transparent when the handle lands. Wait
  // for a sim tick — update and draw share one rAF callback, so a tick means
  // the sheet has actually been painted.
  for (let i = 0; i < 40; i++) {
    if (await cdp.ev(`window.__office.state.tick > 0`)) break;
    await sleep(200);
  }
  const FACES_PROOF = `(() => {
    const f = window.__office.faces;
    const b = window.__office.buffer;
    const g = b.getContext('2d');
    const names = f.names.filter((n) => n !== 'neutral');
    const rows = 13, cols = names.length;
    const sig = (x, y) => {
      const d = g.getImageData(x, y, 36, 36).data;
      let n = 0, h = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i+3] > 8 && !(d[i] < 30 && d[i+1] < 34 && d[i+2] < 42)) n++;
        h = (h * 31 + d[i] + d[i+1] * 3 + d[i+2] * 7) >>> 0;
      }
      return { n, h };
    };
    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = f.sheet.x0 + c * f.sheet.cw + f.sheet.cw / 2;
        const cy = f.sheet.y0 + r * f.sheet.ch + f.sheet.ch / 2;
        cells.push(sig(Math.round(cx - 18), Math.round(cy - 18)));
      }
    }
    const unpainted = cells.filter((s) => s.n < 150).length;
    const dupCols = [], dupRows = [];
    for (let r = 0; r < rows; r++) for (let c = 1; c < cols; c++)
      if (cells[r * cols + c].h === cells[r * cols + c - 1].h) dupCols.push(r + ',' + c);
    for (let c = 0; c < cols; c++) for (let r = 1; r < rows; r++)
      if (cells[r * cols + c].h === cells[(r - 1) * cols + c].h) dupRows.push(r + ',' + c);
    return JSON.stringify({
      mode: window.__office.state.mode, running: window.__office.state.running,
      names: f.names.length, overlays: f.overlays.length, skins: f.skins.length,
      unpainted, dupCols, dupRows
    });
  })()`;
  const fp = JSON.parse(await cdp.ev(FACES_PROOF));
  ok('?faces=1 opens the expression sheet', facesReady && fp.mode === 'faces' && fp.running === true,
    JSON.stringify({ mode: fp.mode, running: fp.running }));
  ok('sheet carries 14 expressions, 9 overlays, 6 skin tones',
    fp.names === 15 && fp.overlays === 9 && fp.skins === 6,
    JSON.stringify({ names: fp.names, overlays: fp.overlays, skins: fp.skins }));
  ok('every expression x tone cell is painted', fp.unpainted === 0, `${fp.unpainted} empty of 182`);
  ok('no two neighbouring cells repeat a face', fp.dupCols.length === 0 && fp.dupRows.length === 0,
    JSON.stringify({ dupCols: fp.dupCols.slice(0, 6), dupRows: fp.dupRows.slice(0, 6) }));
  await sleep(400);
  await cdp.shot('qa_faces_sheet');
  await cdp.shot('qa_golden_faces');
  const px4 = await cdp.ev(PIXEL_PROOF);
  ok('canvas painted (expression sheet)', px4.distinctColors > 20, JSON.stringify(px4));
  ok('?faces=1 loads without console errors', cdp.errors.length === facesErrBase,
    cdp.errors.slice(facesErrBase, facesErrBase + 4).join(' | '));

  // ---- mobile ---------------------------------------------------------------
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Page.navigate', { url: 'http://localhost:8000/?time=14:30' });
  await sleep(2200);
  await enlist(cdp);
  const mob = JSON.parse(await cdp.ev(`JSON.stringify({
    coarse: matchMedia('(hover: none) and (pointer: coarse)').matches,
    pad: getComputedStyle(document.getElementById('touchPad')).display,
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    canvas: document.getElementById('gameCanvas').getBoundingClientRect().width,
    backing: [gameCanvas.width, gameCanvas.height],
    view: window.__office.state.view
  })`));
  ok('mobile pad visible, no overflow', mob.pad === 'grid' && mob.scrollW <= mob.innerW, JSON.stringify(mob));
  ok('mobile keeps the pixel budget', mob.backing[0] === 1280 && mob.backing[1] === 720 && mob.canvas <= mob.innerW, JSON.stringify({ backing: mob.backing, css: mob.canvas, innerW: mob.innerW }));
  const m1 = await cdp.ev(`[window.__office.state.player.tx, window.__office.state.player.ty]`);
  await cdp.ev(`document.querySelector('#touchPad [data-dir="right"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
  await sleep(1100);
  await cdp.ev(`document.querySelector('#touchPad [data-dir="right"]').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))`);
  await sleep(400);
  const m2 = await cdp.ev(`[window.__office.state.player.tx, window.__office.state.player.ty]`);
  ok('touch pad walks', m1[0] !== m2[0] || m1[1] !== m2[1], `${m1} -> ${m2}`);
  await cdp.shot('qa_mobile');

  ok('no console errors / exceptions', cdp.errors.length === 0, cdp.errors.slice(0, 6).join(' | '));

  console.log(report.join('\n'));
  ws.close();
  chrome.kill();
  process.exit(report.some((l) => l.startsWith('FAIL')) ? 1 : 0);
}

main().catch((e) => { console.error(report.join('\n')); console.error('QA CRASH', e); chrome.kill(); process.exit(2); });