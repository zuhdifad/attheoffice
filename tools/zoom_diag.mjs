// One-off zoom diagnostics: per-frame draw cost, present cost and rAF delta
// around two zoom swaps, with the view recorded per frame so the spike can be
// placed before / at / after the plate swap.
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = new URL('..', import.meta.url).pathname;
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
  throw new Error('no target');
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      }
    });
  }
  send(method, params = {}) { return new Promise((res, rej) => {
    const id = ++this.id; this.pending.set(id, { res, rej });
    this.ws.send(JSON.stringify({ id, method, params }));
  }); }
  async ev(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result.value;
  }
}

async function enlist(cdp) {
  await cdp.ev(`document.getElementById('clockInBtn').click()`); await sleep(2200);
  await cdp.ev(`document.getElementById('whoInput').value = 'Tester'; document.getElementById('whoForm').requestSubmit()`); await sleep(300);
  await cdp.ev(`document.querySelector('#floorPick [data-floor="Level 22"]').click()`); await sleep(400);
  await cdp.ev(`document.querySelector('#seatPick .pick-btn').click()`); await sleep(300);
  await cdp.ev(`document.querySelector('#rolePick .pick-btn').click()`); await sleep(300);
  await cdp.ev(`document.getElementById('partnerInput').value = 'mate@example.com'; document.getElementById('partnerForm').requestSubmit()`); await sleep(700);
  await cdp.ev(`document.getElementById('confirmCharBtn').click()`);
  for (let i = 0; i < 40; i++) {
    if (await cdp.ev(`getComputedStyle(document.getElementById('gameArea')).display !== 'none'`)) break;
    await sleep(300);
  }
  await sleep(800);
}

const DIAG = `(async () => {
  const s = window.__office.state;
  const v = await import('/src/world/view.js?v=24');
  const c = await import('/src/core/config.js?v=24');
  const cam = await import('/src/world/camera.js?v=24');
  const d = await import('/src/core/display.js?v=24');
  const p = s.player;
  p.tx = 13; p.ty = 24; p.px = 13 * c.TILE; p.py = 24 * c.TILE;
  p.moving = false; p.seated = false; p.working = false; p.action = 'idle';
  s.view = 'near'; s.zoom = null; cam.centerCamera(s);
  // Wrap the production draw + present to time them per frame.
  const origDraw = v.drawWorld;
  const frames = [];
  let last = performance.now();
  let run = true;
  const tick = (t) => {
    const delta = t - last; last = t;
    const t0 = performance.now();
    origDraw(d.g, s);
    const drawMs = performance.now() - t0;
    const t1 = performance.now();
    d.present();
    const presentMs = performance.now() - t1;
    frames.push({ d: +delta.toFixed(1), draw: +drawMs.toFixed(1), pres: +presentMs.toFixed(1), view: s.view, zoom: !!s.zoom });
    if (run) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  await new Promise((r) => setTimeout(r, 500));
  // Control B first: game running, no zoom clicks yet.
  const idle = frames.slice(0, 25).map((f) => f.d);
  document.getElementById('zoomBtn').click();
  await new Promise((r) => setTimeout(r, 1000));
  document.getElementById('zoomBtn').click();
  await new Promise((r) => setTimeout(r, 1000));
  run = false;
  // Control A: same sampler, game loop paused (no draw, no present, no updates).
  const paused = [];
  s.running = false;
  last = performance.now(); run = true;
  const tick2 = (t) => { paused.push(+(t - last).toFixed(1)); last = t; if (run) requestAnimationFrame(tick2); };
  requestAnimationFrame(tick2);
  await new Promise((r) => setTimeout(r, 1500));
  run = false;
  return { frames, paused, idle };
})()`;


const HIDE = `(async () => {
  const cv = document.getElementById('gameCanvas');
  cv.style.visibility = 'hidden';
  const deltas = [];
  let last = performance.now(); let run = true;
  const tick = (t) => { deltas.push(+(t - last).toFixed(1)); last = t; if (run) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  await new Promise((r) => setTimeout(r, 600));
  document.getElementById('zoomBtn').click();
  await new Promise((r) => setTimeout(r, 1000));
  document.getElementById('zoomBtn').click();
  await new Promise((r) => setTimeout(r, 1000));
  run = false;
  cv.style.visibility = '';
  return deltas;
})()`;

async function main() {
  const page = await target();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  const cdp = new CDP(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: 'http://localhost:8000/?time=10:30' });
  await sleep(2500);
  await enlist(cdp);
  const hidden = await cdp.ev(HIDE);
  const stat0 = (a) => ({ n: a.length, max: Math.max(...a), avg: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1), over50: a.filter((v) => v > 50).length });
  console.log('hidden-canvas zoom:', JSON.stringify(stat0(hidden)));
  const { frames, paused, idle } = await cdp.ev(DIAG);
  fs.writeFileSync(`${ROOT}qa/zoom_diag.json`, JSON.stringify({ frames, paused, idle }, null, 1));
  // Print the worst frames with context.
  const idx = frames.map((f, i) => i).sort((a, b) => frames[b].d - frames[a].d).slice(0, 8).sort((a, b) => a - b);
  for (const i of idx) {
    console.log(`frame ${i}:`, JSON.stringify(frames[i]), '| prev:', JSON.stringify(frames[i - 1]), '| next:', JSON.stringify(frames[i + 1]));
  }
  const steady = frames.slice(0, 20).reduce((a, f) => a + f.d, 0) / 20;
  console.log('steady fps:', (1000 / steady).toFixed(1));
  const stat = (a) => ({ n: a.length, max: Math.max(...a), avg: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1), over50: a.filter((v) => v > 50).length });
  console.log('paused (no game work):', JSON.stringify(stat(paused)));
  console.log('idle (game, no zoom): ', JSON.stringify(stat(idle)));
  ws.close(); chrome.kill(); process.exit(0);
}
main().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });