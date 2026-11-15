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

const key = (cdp, k, type = 'keydown') =>
  cdp.ev(`window.dispatchEvent(new KeyboardEvent('${type}', { key: ${JSON.stringify(k)}, bubbles: true }))`);

async function enlist(cdp) {
  await cdp.ev(`document.getElementById('clockInBtn').click()`);
  await sleep(2200);
  await cdp.ev(`document.getElementById('whoInput').value = 'Tester'; document.getElementById('whoForm').requestSubmit()`);
  await sleep(300);
  await cdp.ev(`document.querySelector('#floorPick [data-floor="Level 22"]').click()`);
  await sleep(500);
  await cdp.ev(`document.getElementById('confirmCharBtn').click()`);
  await sleep(1200);
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
  await cdp.send('Page.navigate', { url: 'http://localhost:8000/' });
  await sleep(2500);
  await enlist(cdp);

  const head = await cdp.ev(`JSON.stringify({
    body: document.body.className,
    gameDisplay: getComputedStyle(document.getElementById('gameArea')).display,
    wallTime: document.getElementById('wallTime').textContent,
    wallDate: document.getElementById('wallDate').textContent,
    label: document.getElementById('clockStateLabel').textContent,
    phase: window.__office.state.phase,
    player: [window.__office.state.player.tx, window.__office.state.player.ty],
    npcs: window.__office.state.npcs.length
  })`);
  const h = JSON.parse(head);
  ok('boot into world', h.gameDisplay === 'grid' && h.phase === 'play', head);
  ok('header clock + date + clocked-in', /^\d{2}:\d{2}:\d{2}$/.test(h.wallTime) && /^\d{2}\/\d{2}\/\d{4}$/.test(h.wallDate) && h.label === 'clocked-in');
  const t1 = h.wallTime; await sleep(1600);
  const t2 = await cdp.ev(`document.getElementById('wallTime').textContent`);
  ok('clock ticks', t1 !== t2, `${t1} -> ${t2}`);
  ok('no mission text', await cdp.ev(`!document.body.innerText.match(/DEF PROJECT|objectives|\\bpts\\b/i)`));

  const px1 = await cdp.ev(PIXEL_PROOF);
  ok('canvas painted (day)', px1.distinctColors > 30, JSON.stringify(px1));
  await cdp.shot('qa_desktop');

  const p1 = await cdp.ev(`[window.__office.state.player.tx, window.__office.state.player.ty]`);
  await key(cdp, 'ArrowRight'); await sleep(1200); await key(cdp, 'ArrowRight', 'keyup');
  await sleep(400);
  const p2 = await cdp.ev(`[window.__office.state.player.tx, window.__office.state.player.ty]`);
  ok('walking moves player', p1[0] !== p2[0] || p1[1] !== p2[1], `${p1} -> ${p2}`);

  // ---- dialogue -------------------------------------------------------------
  const spot = await cdp.ev(`(() => {
    const s = window.__office.state;
    const n = s.npcs.find((n) => !n.seated) || s.npcs[0];
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const x = n.tx + dx, y = n.ty + dy;
      if (s.walkable(x, y)) {
        const p = s.player;
        p.moving = false; p.step = 0; p.frame = 0;
        p.tx = x; p.ty = y; p.px = x * 32; p.py = y * 32;
        return { npc: n.id, x, y };
      }
    }
    return null;
  })()`);
  await sleep(300);
  await key(cdp, 'e'); await key(cdp, 'e', 'keyup');
  await sleep(500);
  const dOpen = await cdp.ev(`!!window.__office.state.dialogue`);
  ok('dialogue opens beside NPC', dOpen === true, JSON.stringify(spot));
  await cdp.shot('qa_dialogue');
  // Stop at the first close: one more press beside the same colleague would
  // legitimately start the conversation again.
  let dClosed = false;
  for (let i = 0; i < 16 && !dClosed; i++) {
    await key(cdp, ' '); await key(cdp, ' ', 'keyup'); await sleep(220);
    dClosed = await cdp.ev(`window.__office.state.dialogue === null`);
  }
  const talks = await cdp.ev(`window.__office.state.talks.size`);
  ok('dialogue advances and closes', dClosed === true && talks >= 1, `talks=${talks}`);

  // ---- rail -----------------------------------------------------------------
  const z1 = await cdp.ev(`window.__office.state.zoom`);
  await cdp.ev(`document.getElementById('zoomIn').click()`);
  const z2 = await cdp.ev(`window.__office.state.zoom`);
  ok('zoom stepper', z2 === z1 + 1, `${z1} -> ${z2}`);
  await cdp.ev(`document.getElementById('optGrid').click()`);
  const grid = await cdp.ev(`window.__office.state.grid`);
  await cdp.shot('qa_grid');
  await cdp.ev(`document.getElementById('optGrid').click()`);
  ok('tile grid toggle', grid === true);
  await cdp.ev(`document.getElementById('optPause').click()`);
  const paused = await cdp.ev(`window.__office.state.paused`);
  await cdp.ev(`document.getElementById('optPause').click()`);
  ok('pause / resume', paused === true && (await cdp.ev(`window.__office.state.paused`)) === false);

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
    label: document.getElementById('clockStateLabel').textContent,
    result: window.__office.state.result && { steps: window.__office.state.result.steps, talks: window.__office.state.result.talks, total: window.__office.state.result.total }
  })`));
  ok('clock-out receipt + header state', out.phase === 'done' && out.label === 'clocked-out' && !!out.result, JSON.stringify(out));
  const px2 = await cdp.ev(PIXEL_PROOF);
  ok('canvas painted (receipt)', px2.distinctColors > 20, JSON.stringify(px2));
  await cdp.shot('qa_receipt');
  await key(cdp, 'r'); await key(cdp, 'r', 'keyup');
  await sleep(800);
  ok('R restarts clean', await cdp.ev(`window.__office.state.phase === 'play' && document.getElementById('clockStateLabel').textContent === 'clocked-in'`));

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
    canvas: document.getElementById('gameCanvas').getBoundingClientRect().width
  })`));
  ok('mobile pad visible, no overflow', mob.pad === 'grid' && mob.scrollW <= mob.innerW, JSON.stringify(mob));
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