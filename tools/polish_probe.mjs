// Polish probe: before/after evidence for the render polish pass.
// Drives the real game in headless Chrome, screenshots fixed vantage points,
// and measures the production drawWorld path: paint-op counts, per-draw cost
// at both zoom stops, and the frame-time spike across a zoom swap.
// Run: node tools/polish_probe.mjs before|after   (server on :8000, shots in qa/)
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const LABEL = process.argv[2] || 'before';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = new URL('..', import.meta.url).pathname;
const OUT = `${ROOT}qa/`;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
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
    fs.writeFileSync(`${OUT}polish_${LABEL}_${name}.png`, Buffer.from(data, 'base64'));
  }
}

async function enlist(cdp) {
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
  await cdp.ev(`document.getElementById('partnerInput').value = 'mate@example.com'; document.getElementById('partnerForm').requestSubmit()`);
  await sleep(700);
  await cdp.ev(`document.getElementById('confirmCharBtn').click()`);
  for (let i = 0; i < 40; i++) {
    if (await cdp.ev(`getComputedStyle(document.getElementById('gameArea')).display !== 'none'`)) break;
    await sleep(300);
  }
  await sleep(800);
}

// Teleport the player to a tile and re-frame the camera on the current stop.
const stand = (x, y) => `(async () => {
  const s = window.__office.state;
  const c = await import('/src/core/config.js?v=24');
  const cam = await import('/src/world/camera.js?v=24');
  const p = s.player;
  p.tx = ${x}; p.ty = ${y}; p.px = ${x} * c.TILE; p.py = ${y} * c.TILE;
  p.moving = false; p.seated = false; p.working = false; p.action = 'idle';
  cam.centerCamera(s);
  return true;
})()`;

// Paint-op census + timed draws through the production path, on the real buffer.
const bench = (view) => `(async () => {
  const s = window.__office.state;
  const v = await import('/src/world/view.js?v=24');
  const c = await import('/src/core/config.js?v=24');
  const cam = await import('/src/world/camera.js?v=24');
  s.view = '${view}'; s.zoom = null; cam.centerCamera(s);
  const g = window.__office.buffer.getContext('2d');
  const ops = ['drawImage', 'fillRect', 'fill', 'stroke', 'fillText', 'strokeText'];
  let draws = 0;
  const saved = {};
  for (const k of ops) { saved[k] = g[k]; g[k] = function (...a) { draws++; return saved[k].apply(this, a); }; }
  v.drawWorld(g, s);
  for (const k of ops) g[k] = saved[k];
  const census = draws;
  // Warm the caches the way the live loop does, then time 90 production draws.
  for (let i = 0; i < 10; i++) v.drawWorld(g, s);
  const ts = [];
  for (let i = 0; i < 90; i++) {
    const t0 = performance.now();
    v.drawWorld(g, s);
    ts.push(performance.now() - t0);
  }
  ts.sort((a, b) => a - b);
  const avg = ts.reduce((a, b) => a + b, 0) / ts.length;
  return { view: '${view}', draws: census, avgMs: +avg.toFixed(3), p95Ms: +ts[85].toFixed(3), maxMs: +ts[89].toFixed(3) };
})()`;

// Frame deltas across a zoom swap, sampled from the live rAF loop.
const zoomSpike = `(async () => {
  const deltas = [];
  let last = performance.now();
  let run = true;
  const tick = (t) => { deltas.push(t - last); last = t; if (run) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  await new Promise((r) => setTimeout(r, 400));
  document.getElementById('zoomBtn').click();
  await new Promise((r) => setTimeout(r, 900));
  document.getElementById('zoomBtn').click();
  await new Promise((r) => setTimeout(r, 900));
  run = false;
  const steady = deltas.slice(0, 20);
  const fps = 1000 / (steady.reduce((a, b) => a + b, 0) / steady.length);
  return { steadyFps: +fps.toFixed(1), maxDeltaMs: +Math.max(...deltas).toFixed(1), frames: deltas.length };
})()`;

async function main() {
  const page = await target();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  const cdp = new CDP(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  await cdp.send('Page.navigate', { url: 'http://localhost:8000/?time=10:30' });
  await sleep(2500);
  await enlist(cdp);

  const perf = {};
  // Vantage 1: the spawn, near view.
  await cdp.shot('near_spawn');
  // Vantage 2: the desk banks — the densest prop field on the floor.
  await cdp.ev(stand(5, 4)); await sleep(500);
  await cdp.shot('near_desks');
  perf.near = await cdp.ev(bench('near'));
  // Vantage 3: the north glazing, straight on.
  await cdp.ev(stand(6, 2)); await sleep(500);
  await cdp.shot('near_window');
  // Vantage 4: the lounge, lamps and sofa.
  await cdp.ev(stand(13, 24)); await sleep(500);
  await cdp.shot('near_lounge');
  // Vantage 5: the whole floor, far stop.
  await cdp.ev(stand(14, 14)); await sleep(400);
  perf.far = await cdp.ev(bench('far'));
  await cdp.shot('far_floor');
  // Zoom swap spike, from the lounge where lamps and glazing are both on screen.
  await cdp.ev(stand(13, 24)); await sleep(400);
  perf.zoom = await cdp.ev(zoomSpike);

  perf.errors = cdp.errors;
  fs.writeFileSync(`${OUT}polish_${LABEL}_perf.json`, JSON.stringify(perf, null, 2));
  console.log(JSON.stringify(perf, null, 2));
  ws.close();
  chrome.kill();
  process.exit(0);
}

main().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });