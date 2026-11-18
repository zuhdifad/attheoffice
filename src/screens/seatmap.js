// The seat question, asked on the floor's own plan. This is not a second
// drawing of the office: the chairs, walls, zones and door come off the same
// place data and the same map the game walks, so seat 07 here is seat 07 under
// your feet after clock-in. Every chair is numbered 01..32, taken chairs show
// who holds them live, and the choice is a click, a tap, or arrows + Enter.
import { PAL } from '../art/palette.js?v=26';
import { ZONES } from '../world/places/office.js?v=26';
import { allSeats } from '../world/seats.js?v=26';
import { sfx } from '../core/audio.js?v=26';

const T = 13;                 // logical px per tile on the plan
const PAD = 12;
const { map, seats } = allSeats();
const LW = map.w * T + PAD * 2;
const LH = map.h * T + PAD * 2;

const ZONE_NAMES = ['Entry', 'Bank A', 'Bank B', 'Meeting', 'Manager', 'Pantry', 'Lounge', 'Print', 'Booth', 'Booth'];

// Furniture reads as material, the way a floor plan legend does: wood for the
// desking, steel for the machines, leaf for the planting, amber for the booths.
const WOOD = new Set(['desk', 'table', 'highTable', 'lowTable', 'counter', 'bookshelf', 'bench', 'cabinet', 'drawer']);
const STEEL = new Set(['fridge', 'printer', 'shredder', 'coffeeMachine', 'sink', 'kettle', 'waterCooler', 'mugShelf', 'tv', 'booth']);
const LEAF = new Set(['plant']);
const SHELL = new Set(['wall', 'sill', 'window', 'glassWall', 'glassDoor', 'glazed']);
const SEAT_KINDS = new Set(['chair', 'chairOlive', 'chairFront', 'chairFrontOlive', 'stool', 'sofa', 'armchair']);

let root = null;
let canvas = null;
let ctx = null;
let info = null;
let takeBtn = null;
let liveDot = null;
let onPick = () => {};
let getTaken = () => new Map();
let selected = null;   // seat info
let hovered = null;
let taken = new Map();
let timer = null;
let pulse = 0;

const cx = (s) => PAD + s.seat.x * T + T / 2;
const cy = (s) => PAD + s.seat.y * T + T / 2;

// Logical centres of every seat chip, for the pointer hit-test and for QA.
export function points() {
  return seats.map((s) => ({ num: s.num, cx: cx(s), cy: cy(s), w: LW, h: LH }));
}

function seatAtPoint(x, y) {
  let best = null, bd = 10;
  for (const s of seats) {
    const d = Math.hypot(cx(s) - x, cy(s) - y);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function draw() {
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== LW * dpr) {
    canvas.width = LW * dpr;
    canvas.height = LH * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  pulse += 0.06;

  // The slab: cool terrazzo under everything, the way the floor reads at far
  // zoom, with a hairline grid so tiles are countable.
  ctx.fillStyle = '#171c26';
  ctx.fillRect(0, 0, LW, LH);
  ctx.fillStyle = '#1d2330';
  ctx.fillRect(PAD, PAD, map.w * T, map.h * T);
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= map.w; x++) {
    ctx.beginPath(); ctx.moveTo(PAD + x * T + 0.5, PAD); ctx.lineTo(PAD + x * T + 0.5, PAD + map.h * T); ctx.stroke();
  }
  for (let y = 0; y <= map.h; y++) {
    ctx.beginPath(); ctx.moveTo(PAD, PAD + y * T + 0.5); ctx.lineTo(PAD + map.w * T, PAD + y * T + 0.5); ctx.stroke();
  }

  // Zones: the accent inlay each one carries on the real floor.
  ZONES.forEach((z, i) => {
    const col = PAL[z.accent] || PAL.steel;
    ctx.fillStyle = col + '22';
    ctx.fillRect(PAD + z.x * T, PAD + z.y * T, z.w * T, z.h * T);
    ctx.strokeStyle = col + '55';
    ctx.strokeRect(PAD + z.x * T + 0.5, PAD + z.y * T + 0.5, z.w * T - 1, z.h * T - 1);
    if (z.w >= 4 && z.h >= 3) {
      ctx.fillStyle = col + 'cc';
      ctx.font = '600 7px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(ZONE_NAMES[i].toUpperCase(), PAD + z.x * T + 3, PAD + z.y * T + 9);
    }
  });

  // Furniture footprints, straight off the map's own props.
  for (const p of map.props) {
    const x = PAD + p.x * T, y = PAD + p.y * T;
    const w = p.def.w * T, h = p.def.h * T;
    if (SHELL.has(p.kind)) {
      ctx.fillStyle = p.kind === 'window' ? 'rgba(61,143,214,0.55)'
        : (p.kind === 'glassWall' || p.kind === 'glassDoor' || p.kind === 'glazed') ? 'rgba(139,122,214,0.4)'
        : '#39415a';
      ctx.fillRect(x, y, w, h);
    } else if (p.kind === 'rug') {
      ctx.fillStyle = 'rgba(224,122,143,0.16)';
      ctx.fillRect(x, y, w, h);
    } else if (p.kind === 'mat') {
      ctx.fillStyle = 'rgba(242,177,52,0.3)';
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    } else if (SEAT_KINDS.has(p.kind)) {
      // drawn as numbered chips below
    } else if (p.def.solid || STEEL.has(p.kind)) {
      ctx.fillStyle = WOOD.has(p.kind) ? 'rgba(192,138,78,0.75)'
        : LEAF.has(p.kind) ? 'rgba(74,157,82,0.8)'
        : p.kind === 'booth' ? 'rgba(242,177,52,0.7)'
        : 'rgba(143,163,191,0.55)';
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    }
  }

  // The entrance: the door leaf's own gap, marked so the plan says where you
  // will appear, and the guard's post beside it.
  ctx.fillStyle = PAL.amber;
  ctx.fillRect(PAD + 2 * T, PAD + 27 * T + T - 3, 2 * T, 3);
  ctx.fillStyle = 'rgba(242,177,52,0.9)';
  ctx.font = '600 7px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('ENTRY', PAD + 3 * T, LH - 3);
  ctx.fillStyle = PAL.steel;
  ctx.fillRect(PAD + 4 * T + 3, PAD + 25 * T + 3, T - 6, T - 6);
  ctx.fillStyle = 'rgba(143,163,191,0.9)';
  ctx.textAlign = 'left';
  ctx.fillText('SEC', PAD + 5 * T + 2, PAD + 25 * T + T - 3);

  // The 32 chairs.
  for (const s of seats) {
    const x = cx(s), y = cy(s);
    const held = taken.get(s.num);
    const isSel = selected && selected.num === s.num;
    const isHov = hovered && hovered.num === s.num;
    const r = 5.6;

    if (isSel) {
      ctx.strokeStyle = `rgba(242,177,52,${0.45 + Math.sin(pulse) * 0.25})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r + 3.4, 0, Math.PI * 2); ctx.stroke();
    } else if (isHov && !held) {
      ctx.strokeStyle = 'rgba(242,177,52,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, r + 2.6, 0, Math.PI * 2); ctx.stroke();
    }

    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = held ? '#4a2622' : isSel ? PAL.amber : PAL.teal;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = held ? PAL.coral : isSel ? '#ffcb5c' : PAL.tealLit;
    ctx.stroke();

    ctx.fillStyle = held ? '#e8a79f' : isSel ? '#221703' : '#eaf6f7';
    ctx.font = '600 6.5px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.short, x, y + 0.5);
    ctx.textBaseline = 'alphabetic';
  }

  // Hover card: what the chair is, and who holds it if it is taken.
  const hov = hovered;
  if (hov) {
    const held = taken.get(hov.num);
    const line1 = `Seat ${hov.short} · ${hov.zone}`;
    const line2 = held ? `Held by ${held.name}` : 'Free — click to take';
    ctx.font = '600 7px "IBM Plex Mono", monospace';
    const w = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 12;
    let bx = cx(hov) + 9, by = cy(hov) - 24;
    if (bx + w > LW - 2) bx = cx(hov) - w - 9;
    if (by < 2) by = cy(hov) + 9;
    roundRect(ctx, bx, by, w, 22, 3);
    ctx.fillStyle = 'rgba(12,16,24,0.94)';
    ctx.fill();
    ctx.strokeStyle = held ? 'rgba(226,80,63,0.7)' : 'rgba(43,163,176,0.7)';
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f3f1ec';
    ctx.fillText(line1, bx + 6, by + 9);
    ctx.fillStyle = held ? '#e8a79f' : '#7fd4dd';
    ctx.fillText(line2, bx + 6, by + 18);
  }
}

function say(msg, kind) {
  if (!info) return;
  info.textContent = msg;
  info.className = `seat-info${kind ? ` is-${kind}` : ''}`;
}

function select(s, quiet) {
  if (!s) return;
  const held = taken.get(s.num);
  if (held) {
    sfx.back();
    say(`Seat ${s.short} is held by ${held.name} — pick a free chair.`, 'bad');
    return;
  }
  selected = s;
  if (!quiet) sfx.ui();
  say(`Seat ${s.short} · ${s.zone} — yours, if you take it.`, 'good');
  takeBtn.disabled = false;
  draw();
}

function confirm() {
  if (!selected) return;
  const held = taken.get(selected.num);
  if (held) { select(null); say(`Seat ${selected.short} was just taken by ${held.name}.`, 'bad'); takeBtn.disabled = true; selected = null; draw(); return; }
  sfx.clockIn();
  onPick({ ...selected, x: selected.seat.x, y: selected.seat.y });
}

function refresh() {
  taken = getTaken();
  if (selected && taken.has(selected.num)) {
    const holder = taken.get(selected.num);
    const short = selected.short;
    selected = null;
    takeBtn.disabled = true;
    say(`Seat ${short} was just taken by ${holder.name} — pick another.`, 'bad');
  }
  if (liveDot) liveDot.textContent = `${taken.size + 1} on floor`;
  draw();
}

// Arrow keys walk the plan the way they walk the floor: the nearest chair in
// the pressed direction, skipping none, so a keyboard player can reach all 32.
function step(dir) {
  const from = selected || seats[0];
  const fx = cx(from), fy = cy(from);
  let best = null, bd = Infinity;
  for (const s of seats) {
    if (s === from) continue;
    const dx = cx(s) - fx, dy = cy(s) - fy;
    const ahead = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (ahead <= 1) continue;
    const d = ahead + across * 2.2;
    if (d < bd) { bd = d; best = s; }
  }
  if (best) {
    const held = taken.get(best.num);
    if (held) { sfx.back(); say(`Seat ${best.short} is held by ${held.name}.`, 'bad'); hovered = best; draw(); return; }
    select(best);
  }
}

export function open(container, opts) {
  onPick = opts.onPick || onPick;
  getTaken = opts.getTaken || getTaken;
  if (root) { setActive(true); return; }

  root = document.createElement('div');
  root.className = 'seat-map';
  root.innerHTML = `
    <div class="seat-map-head">
      <span class="field-label">Level 22 · 32 seats</span>
      <span class="seat-live"><i class="seat-live-dot"></i><b id="seatLiveCount">1 on floor</b></span>
    </div>
    <canvas id="seatMapCanvas" tabindex="0" role="application"
      aria-label="Floor plan of Level 22 with 32 numbered seats. Use arrow keys to move between seats and Enter to take one."></canvas>
    <div class="seat-legend">
      <span><i class="sw free"></i>Free</span>
      <span><i class="sw held"></i>Taken</span>
      <span><i class="sw yours"></i>Yours</span>
      <span class="seat-hint">Click a chair · arrows + Enter</span>
    </div>
    <p class="seat-info" id="seatInfo" role="status">Pick a chair on the plan — you will walk to it after clock-in.</p>
    <button id="seatTake" class="btn btn-primary wide" type="button" disabled>Take this seat</button>
  `;
  container.append(root);
  canvas = root.querySelector('#seatMapCanvas');
  ctx = canvas.getContext('2d');
  info = root.querySelector('#seatInfo');
  takeBtn = root.querySelector('#seatTake');
  liveDot = root.querySelector('#seatLiveCount');
  canvas.style.aspectRatio = `${LW} / ${LH}`;
  root.dataset.seatCount = String(seats.length);

  const toLogical = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (LW / r.width), y: (e.clientY - r.top) * (LH / r.height) };
  };
  canvas.addEventListener('pointermove', (e) => {
    const p = toLogical(e);
    const s = seatAtPoint(p.x, p.y);
    if (s !== hovered) { hovered = s; canvas.style.cursor = s ? 'pointer' : 'default'; draw(); }
  });
  canvas.addEventListener('pointerleave', () => { hovered = null; draw(); });
  canvas.addEventListener('click', (e) => {
    const p = toLogical(e);
    const s = seatAtPoint(p.x, p.y);
    if (s) select(s);
  });
  canvas.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault();
      step(k.slice(5).toLowerCase());
    } else if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      if (selected) confirm();
      else select(seats.find((s) => !taken.has(s.num)) || seats[0]);
    }
  });
  takeBtn.addEventListener('click', confirm);

  setActive(true);
}

export function setActive(on) {
  if (timer) { clearInterval(timer); timer = null; }
  if (on && root) {
    refresh();
    // Availability is live: a colleague clocking in on another window takes
    // their chair on this plan within the second.
    timer = setInterval(refresh, 900);
    requestAnimationFrame(() => canvas && canvas.focus());
  }
}

export function close() {
  setActive(false);
}