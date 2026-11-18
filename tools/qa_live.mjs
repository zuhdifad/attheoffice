// Live-floor QA: two real tabs of the real game in headless Chrome, driven over
// CDP. Asserts the whole contract of the rebuild — one character per clocked-in
// user, a guard-only NPC, Level 22 with 6/7 locked, the 32-seat plan, the walk
// from the door to the chosen chair, free roaming afterwards, and BBM/YM-style
// presence, chat and emotes between the two tabs. Screenshots land in qa/.
// Run: node tools/qa_live.mjs
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = `${ROOT}/qa/`;
const PORT = 8123;
const CDP_PORT = 9223;
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = [];
let failures = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) failures++;
  const line = `${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`;
  report.push(line);
  console.log(line);
};

// ---- static server -----------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('nope'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

// ---- chrome ------------------------------------------------------------------
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--window-size=1440,900',
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--autoplay-policy=no-user-gesture-required', '--mute-audio',
  `--user-data-dir=${ROOT}/.qa-live-profile`, 'about:blank'
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });
process.on('uncaughtException', (e) => { console.error(e); try { chrome.kill(); } catch {} process.exit(1); });
process.on('unhandledRejection', (e) => { console.error(e); try { chrome.kill(); } catch {} process.exit(1); });

async function browserWs() {
  for (let i = 0; i < 80; i++) {
    try {
      const v = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
      if (v.webSocketDebuggerUrl) return v.webSocketDebuggerUrl;
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
      this.pending.set(id, { res, rej: (e) => rej(new Error(`${method}: ${e.message}`)) });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async ev(expression) {
    let r;
    try {
      r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    } catch (e) {
      throw new Error(`${e.message}  [eval: ${expression.slice(0, 120)}]`);
    }
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result.value;
  }
  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT + name + '.png', Buffer.from(data, 'base64'));
  }
  async key(k, type = 'keydown') {
    await this.ev(`window.dispatchEvent(new KeyboardEvent(${JSON.stringify(type)}, { key: ${JSON.stringify(k)}, bubbles: true }))`);
  }
  async hold(k, ms) { await this.key(k); await sleep(ms); await this.key(k, 'keyup'); }
  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }
  async wait(expr, timeout = 20000, step = 120) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      // Boolean() keeps CDP from serialising entity objects (circular refs).
      if (await this.ev(`Boolean(${expr})`)) return true;
      await sleep(step);
    }
    return false;
  }
}

async function connect(wsUrl, page = true) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  const c = new CDP(ws);
  if (page) {
    await c.send('Page.enable');
    await c.send('Runtime.enable');
  }
  return c;
}

const bws = await connect(await browserWs(), false);
// Each person gets their own window: two tabs of one window hide each other,
// and a hidden tab's requestAnimationFrame loop sleeps — which would freeze
// one floor while the other walks. Two windows keep both floors live.
async function newTab(url, newWindow = false) {
  const { targetId } = await bws.send('Target.createTarget', { url: 'about:blank', newWindow });
  let info;
  for (let i = 0; i < 40; i++) {
    const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    info = list.find((t) => t.id === targetId);
    if (info?.webSocketDebuggerUrl) break;
    await sleep(150);
  }
  const c = await connect(info.webSocketDebuggerUrl);
  await c.send('Page.navigate', { url });
  await c.wait(`Boolean(window.__office) && document.body.classList.contains('ready')`, 30000);
  return c;
}

const BASE = `http://127.0.0.1:${PORT}/index.html`;
const A = await newTab(`${BASE}?time=09:15`);

// ---- enlist ------------------------------------------------------------------
// The whole badge run through the real DOM: name, level, the seat plan, role,
// partner, then the character picker. seatNum is clicked on the canvas plan at
// the chip's own coordinates, exactly the way a mouse would.
async function enlist(c, { name, seatNum, nextChars = 0, partner = 'teammate@office.co' }) {
  await c.ev(`document.getElementById('clockInBtn').click()`);
  await sleep(2100);
  await c.ev(`(() => {
    const i = document.getElementById('whoInput');
    i.value = ${JSON.stringify(name)};
    document.getElementById('whoForm').dispatchEvent(new Event('submit', { cancelable: true }));
  })()`);
  await sleep(250);
  await c.ev(`document.querySelector('#floorPick [data-floor="Level 22"]').click()`);
  await c.wait(`document.getElementById('stageSeat').classList.contains('is-on')`);
  await sleep(400);
  const pt = await c.ev(`(async () => {
    const m = await import('/src/screens/seatmap.js?v=26');
    const p = m.points().find((q) => q.num === ${seatNum});
    const r = document.getElementById('seatMapCanvas').getBoundingClientRect();
    return { x: r.left + p.cx * r.width / p.w, y: r.top + p.cy * r.height / p.h };
  })()`);
  await c.click(pt.x, pt.y);
  await sleep(200);
  await c.ev(`document.getElementById('seatTake').click()`);
  await c.wait(`document.getElementById('stageRole').classList.contains('is-on')`);
  await c.ev(`document.querySelector('#rolePick .pick-btn').click()`);
  await sleep(200);
  await c.ev(`(() => {
    const i = document.getElementById('partnerInput');
    i.value = ${JSON.stringify(partner)};
    document.getElementById('partnerForm').dispatchEvent(new Event('submit', { cancelable: true }));
  })()`);
  await c.wait(`document.getElementById('characterSelectPopup').style.display === 'flex'`);
  for (let i = 0; i < nextChars; i++) { await c.ev(`document.getElementById('nextBtn').click()`); await sleep(150); }
  await c.ev(`document.getElementById('confirmCharBtn').click()`);
  await c.wait(`window.__office.state.running && window.__office.state.player`, 30000);
}

// ---- tab A: the floor, the plan, the walk -------------------------------------
await A.ev(`document.getElementById('clockInBtn').click()`);
await sleep(2100);
await A.ev(`(() => {
  const i = document.getElementById('whoInput');
  i.value = 'Andi';
  document.getElementById('whoForm').dispatchEvent(new Event('submit', { cancelable: true }));
})()`);
await sleep(250);

const locked = await A.ev(`(() => {
  const b6 = document.querySelector('#floorPick [data-floor="Level 6"]');
  const b7 = document.querySelector('#floorPick [data-floor="Level 7"]');
  b6.click(); b7.click();
  return {
    six: b6.disabled, seven: b7.disabled,
    stillWhere: document.getElementById('stageWhere').classList.contains('is-on')
  };
})()`);
ok('Level 6 and 7 are locked and cannot advance', locked.six && locked.seven && locked.stillWhere, JSON.stringify(locked));
await A.key('1');
const lockNote = await A.ev(`document.getElementById('whereError').textContent`);
ok('Locked floor key says "opens soon"', /soon/i.test(lockNote), lockNote);
await A.shot('live_floors_locked');

await A.ev(`document.querySelector('#floorPick [data-floor="Level 22"]').click()`);
await A.wait(`document.getElementById('stageSeat').classList.contains('is-on')`);
await sleep(500);
const plan = await A.ev(`(() => {
  const root = document.querySelector('.seat-map');
  return { count: root.dataset.seatCount, registry: window.__office.seats.seats.length, canvas: Boolean(document.getElementById('seatMapCanvas')) };
})()`);
ok('Seat plan shows exactly 32 numbered seats', plan.count === '32' && plan.registry === 32 && plan.canvas, JSON.stringify(plan));
await A.shot('live_seat_plan');

// Take seat 07 on the plan, finish the badge, clock in as Zuhdi.
const pt7 = await A.ev(`(async () => {
  const m = await import('/src/screens/seatmap.js?v=26');
  const p = m.points().find((q) => q.num === 7);
  const r = document.getElementById('seatMapCanvas').getBoundingClientRect();
  return { x: r.left + p.cx * r.width / p.w, y: r.top + p.cy * r.height / p.h };
})()`);
await A.click(pt7.x, pt7.y);
await sleep(200);
const picked = await A.ev(`(() => ({
  info: document.getElementById('seatInfo').textContent,
  enabled: !document.getElementById('seatTake').disabled
}))()`);
ok('Clicking a chair selects it and arms the take button', picked.enabled && /07/.test(picked.info), picked.info);
await A.ev(`document.getElementById('seatTake').click()`);
await A.wait(`document.getElementById('stageRole').classList.contains('is-on')`);
await A.ev(`document.querySelector('#rolePick .pick-btn').click()`);
await sleep(200);
await A.ev(`(() => {
  const i = document.getElementById('partnerInput');
  i.value = 'teammate@office.co';
  document.getElementById('partnerForm').dispatchEvent(new Event('submit', { cancelable: true }));
})()`);
await A.wait(`document.getElementById('characterSelectPopup').style.display === 'flex'`);
await A.ev(`document.getElementById('confirmCharBtn').click()`);
await A.wait(`window.__office.state.running && window.__office.state.player`, 30000);

const spawnInfo = await A.ev(`(() => {
  const s = window.__office.state;
  return { tx: s.player.tx, ty: s.player.ty, npcs: s.npcs.length, guard: s.npcs[0].guard === true, post: [s.npcs[0].tx, s.npcs[0].ty], autowalk: Boolean(s.autowalk), seatNum: s.seatNum };
})()`);
ok('Clock-in appears in front of the door (3,26)', spawnInfo.tx === 3 && spawnInfo.ty === 26, JSON.stringify(spawnInfo));
ok('The only NPC is the security guard at his post', spawnInfo.npcs === 1 && spawnInfo.guard && spawnInfo.post[0] === 4 && spawnInfo.post[1] === 25, JSON.stringify(spawnInfo));
ok('The clock-in walk is armed for the chosen seat', spawnInfo.autowalk && spawnInfo.seatNum === 7, JSON.stringify(spawnInfo));
await A.shot('live_spawn_door');

const greeted = await A.wait(`window.__office.state.npcs[0].greeted === true`, 6000);
ok('The guard waves the arrival through', greeted);

const seated = await A.wait(`(() => {
  const s = window.__office.state;
  return s.player.seated && !s.autowalk && s.player.tx === s.seatTile.x && s.player.ty === s.seatTile.y;
})()`, 45000);
ok('The game walks the player to seat 07 and sits them', seated);
await sleep(600);
await A.shot('live_seated_07');

const hudProof = await A.ev(`(() => {
  const b = window.__office.buffer;
  const d = b.getContext('2d').getImageData(b.width - 70, 8, 62, 110).data;
  let parchment = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 225 && d[i+1] > 215 && d[i+2] > 180) parchment++;
  const c = document.getElementById('gameCanvas');
  const full = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  for (let i = 0; i < full.length; i += 40) seen.add((full[i] >> 4) + ',' + (full[i+1] >> 4) + ',' + (full[i+2] >> 4));
  return { parchment, distinctColors: seen.size };
})()`);
ok('HUD chips (clock / seat / online) paint in the corner', hudProof.parchment > 200, JSON.stringify(hudProof));
ok('The room renders a full-colour picture', hudProof.distinctColors > 60, `${hudProof.distinctColors} colours`);

// ---- free roaming after the sit ----------------------------------------------
await A.hold('ArrowDown', 900);
await sleep(500);
const free = await A.ev(`(() => {
  const s = window.__office.state;
  return { seated: s.player.seated, away: s.player.tx !== s.seatTile.x || s.player.ty !== s.seatTile.y, autowalk: s.autowalk };
})()`);
ok('After the auto-sit, a direction key stands you up and frees you', !free.seated && free.away && !free.autowalk, JSON.stringify(free));
await A.hold('ArrowLeft', 500);
await A.hold('ArrowUp', 500);
const steps = await A.ev(`window.__office.state.player.steps`);
ok('The player keeps walking freely afterwards', steps > 2, `${steps} steps`);

// ---- the guard conversation ----------------------------------------------------
await A.ev(`(() => {
  const s = window.__office.state;
  const g = s.npcs[0];
  const t = [[g.tx-1,g.ty],[g.tx+1,g.ty],[g.tx,g.ty-1],[g.tx,g.ty+1]]
    .find(([x,y]) => s.map.walkable(x,y) && !s.occupied.has(x+','+y));
  const p = s.player;
  if (p.seat) { s.map.releaseSeat(p.seat, p.id); p.seat = null; }
  p.seated = false; p.moving = false; p.working = false; p.leaving = null;
  p.tx = t[0]; p.ty = t[1]; p.px = t[0]*32; p.py = t[1]*32; p.action = 'idle'; p.act = 0;
})()`);
await sleep(200);
await A.key('z'); await A.key('z', 'keyup');
await sleep(400);
const talk = await A.ev(`(() => {
  const d = window.__office.state.dialogue;
  return d ? { guard: d.npc.guard === true, name: d.npc.name, pages: d.pages.length } : null;
})()`);
ok('Z beside the guard opens his own conversation', Boolean(talk && talk.guard && talk.pages >= 3), JSON.stringify(talk));
await A.shot('live_guard_dialogue');
await A.key('x'); await A.key('x', 'keyup');
await sleep(250);
ok('X backs out of the conversation', await A.ev(`window.__office.state.dialogue === null`));

// ---- pause card with the controls guide ---------------------------------------
await A.key('Escape'); await A.key('Escape', 'keyup');
await sleep(350);
ok('Esc pauses the room', await A.ev(`window.__office.state.paused === true`));
await A.shot('live_pause_controls');
const pausePixels = await A.ev(`(() => {
  const b = window.__office.buffer;
  // The card body in buffer pixels (design 360x232 centred in 480x288, scaled
  // to 1280x720): sample its interior, where only the pause card paints.
  const d = b.getContext('2d').getImageData(300, 150, 680, 420).data;
  let parchment = 0;
  for (let i = 0; i < d.length; i += 16) if (d[i] > 225 && d[i+1] > 215 && d[i+2] > 180) parchment++;
  return parchment;
})()`);
ok('The pause card paints parchment (badge + controls)', pausePixels > 20000, `${pausePixels} px sampled`);
await A.key('Escape'); await A.key('Escape', 'keyup');
await sleep(250);
ok('Esc resumes', await A.ev(`window.__office.state.paused === false`));

// ---- chat, solo ---------------------------------------------------------------
await A.key('t'); await A.key('t', 'keyup');
await sleep(300);
ok('T opens the floor chat dock', await A.ev(`document.getElementById('chatDock').hidden === false`));
await A.ev(`(() => {
  const i = document.getElementById('chatInput');
  i.value = 'hello floor';
  document.getElementById('chatForm').dispatchEvent(new Event('submit', { cancelable: true }));
})()`);
await sleep(300);
const ownLine = await A.ev(`(() => ({
  log: document.getElementById('chatLog').textContent.includes('hello floor'),
  bubble: window.__office.state.player.say > 0
}))()`);
ok('Own chat line lands in the dock and over your head', ownLine.log && ownLine.bubble, JSON.stringify(ownLine));
await A.shot('live_chat_dock');
await A.key('Escape'); await A.key('Escape', 'keyup');
await sleep(250);
ok('Esc closes the dock before it pauses', await A.ev(`document.getElementById('chatDock').hidden === true && window.__office.state.paused === false`));

// One module instance: the cache key bump held across the whole graph.
const oneInstance = await A.ev(`(async () => {
  const m = await import('/src/core/net.js?v=26');
  return m.net === window.__office.net;
})()`);
ok('One module instance across the graph (?v=26)', oneInstance === true);

// ---- tab B: a second person clocks in ------------------------------------------
const B = await newTab(`${BASE}?time=09:15`, true);
ok('Both floors stay live (two windows, both visible)',
  (await A.ev(`document.visibilityState === 'visible'`)) && (await B.ev(`document.visibilityState === 'visible'`)));
await B.ev(`document.getElementById('clockInBtn').click()`);
await sleep(2100);
await B.ev(`(() => {
  const i = document.getElementById('whoInput');
  i.value = 'Budi';
  document.getElementById('whoForm').dispatchEvent(new Event('submit', { cancelable: true }));
})()`);
await sleep(250);
await B.ev(`document.querySelector('#floorPick [data-floor="Level 22"]').click()`);
await B.wait(`document.getElementById('stageSeat').classList.contains('is-on')`);
await sleep(1200);

const contention = await B.ev(`(() => {
  const taken = [...window.__office.net.takenSeats().keys()];
  return { taken, live: document.getElementById('seatLiveCount').textContent };
})()`);
ok('The plan shows seat 07 held live by the first person', contention.taken.includes(7), JSON.stringify(contention));
const pt7b = await B.ev(`(async () => {
  const m = await import('/src/screens/seatmap.js?v=26');
  const p = m.points().find((q) => q.num === 7);
  const r = document.getElementById('seatMapCanvas').getBoundingClientRect();
  return { x: r.left + p.cx * r.width / p.w, y: r.top + p.cy * r.height / p.h };
})()`);
await B.click(pt7b.x, pt7b.y);
await sleep(250);
const refused = await B.ev(`(() => ({
  bad: document.getElementById('seatInfo').className.includes('is-bad'),
  text: document.getElementById('seatInfo').textContent,
  disabled: document.getElementById('seatTake').disabled
}))()`);
ok('A held chair refuses the second person', refused.bad && refused.disabled, refused.text);
await B.shot('live_seat_held');

// Budi takes seat 20 and clocks in as the next character (Alicia).
const pt20 = await B.ev(`(async () => {
  const m = await import('/src/screens/seatmap.js?v=26');
  const p = m.points().find((q) => q.num === 20);
  const r = document.getElementById('seatMapCanvas').getBoundingClientRect();
  return { x: r.left + p.cx * r.width / p.w, y: r.top + p.cy * r.height / p.h };
})()`);
await B.click(pt20.x, pt20.y);
await sleep(200);
await B.ev(`document.getElementById('seatTake').click()`);
await B.wait(`document.getElementById('stageRole').classList.contains('is-on')`);
await B.ev(`document.querySelector('#rolePick .pick-btn').click()`);
await sleep(200);
await B.ev(`(() => {
  const i = document.getElementById('partnerInput');
  i.value = 'budi@office.co';
  document.getElementById('partnerForm').dispatchEvent(new Event('submit', { cancelable: true }));
})()`);
await B.wait(`document.getElementById('characterSelectPopup').style.display === 'flex'`);
await B.ev(`document.getElementById('nextBtn').click()`);
await sleep(200);
await B.ev(`document.getElementById('confirmCharBtn').click()`);
await B.wait(`window.__office.state.running && window.__office.state.player`, 30000);

const seenByA = await A.wait(`(() => {
  const r = [...window.__office.state.remotes.values()];
  return r.length === 1 && r[0].name === 'Budi';
})()`, 8000);
ok('Budi appears live on Andi\'s floor the moment he clocks in', seenByA);
const seenByB = await B.wait(`(() => {
  const r = [...window.__office.state.remotes.values()];
  return r.length === 1 && r[0].name === 'Andi';
})()`, 8000);
ok('Andi is already on Budi\'s floor (late joiner sees the room)', seenByB);
const joinLine = await A.ev(`document.getElementById('chatLog').textContent.includes('Budi clocked in')`);
ok('The contact list announces the arrival', joinLine);
const badge = await A.ev(`(() => {
  const b = document.getElementById('chatBadge');
  return { hidden: b.hidden, text: b.textContent };
})()`);
ok('Unread badge counts while the dock is shut', !badge.hidden, JSON.stringify(badge));

// Budi walks to seat 20; Andi's puppet of him follows.
const bSeated = await B.wait(`window.__office.state.player.seated && !window.__office.state.autowalk`, 45000);
ok('Budi is auto-walked to his own chosen seat 20', bSeated);
const aSeesSeat = await A.wait(`(() => {
  const r = [...window.__office.state.remotes.values()][0];
  return r && r.seated && r.seatNum === 20;
})()`, 8000);
ok('Andi sees Budi seated at seat 20, claim synced', aSeesSeat);

// ---- chat between the two -------------------------------------------------------
await B.key('t'); await B.key('t', 'keyup');
await sleep(250);
await B.ev(`(() => {
  const i = document.getElementById('chatInput');
  i.value = 'hi from Budi';
  document.getElementById('chatForm').dispatchEvent(new Event('submit', { cancelable: true }));
})()`);
await sleep(500);
const crossChat = await A.ev(`(() => {
  const r = [...window.__office.state.remotes.values()][0];
  return { log: document.getElementById('chatLog').textContent.includes('hi from Budi'), bubble: r && r.say > 0 && r.line.includes('hi from Budi') };
})()`);
ok('Budi\'s line lands in Andi\'s dock and over his head', crossChat.log && crossChat.bubble, JSON.stringify(crossChat));
await A.key('t'); await A.key('t', 'keyup');
await sleep(250);
ok('Opening the dock clears the unread badge', await A.ev(`document.getElementById('chatBadge').hidden === true`));

// ---- movement sync ---------------------------------------------------------------
// Budi's dock is still open from the chat test: Esc hands the keys back to the
// floor first (while the dock is open they belong to the field, by design).
await B.key('Escape'); await B.key('Escape', 'keyup');
await sleep(250);
const bBefore = await B.ev(`(() => ({ tx: window.__office.state.player.tx, ty: window.__office.state.player.ty }))()`);
await B.hold('ArrowLeft', 1200);
await sleep(400);
const bAfter = await B.ev(`(() => ({ tx: window.__office.state.player.tx, ty: window.__office.state.player.ty, seated: window.__office.state.player.seated }))()`);
ok('Budi stands up and walks freely too', !bAfter.seated && (bAfter.tx !== bBefore.tx || bAfter.ty !== bBefore.ty), JSON.stringify({ bBefore, bAfter }));
const syncMove = await A.wait(`(() => {
  const r = [...window.__office.state.remotes.values()][0];
  return r && r.tx === ${bAfter.tx} && r.ty === ${bAfter.ty};
})()`, 6000);
ok('Andi\'s floor sees Budi\'s walk, tile for tile', syncMove);

// ---- emotes -----------------------------------------------------------------------
await A.ev(`document.getElementById('waveBtn').click()`);
const waveSeen = await B.wait(`(() => {
  const r = [...window.__office.state.remotes.values()][0];
  return r && (r.emoteHold > 0 || r.action === 'wave');
})()`, 4000);
ok('A wave from Andi lands on his puppet on Budi\'s floor', waveSeen);
await B.ev(`document.getElementById('nudgeBtn').click()`);
const nudgeSeen = await A.wait(`(() => {
  const r = [...window.__office.state.remotes.values()][0];
  return r && r.say > 0 && r.line.includes('nudge');
})()`, 4000);
ok('A nudge from Budi shows on his puppet on Andi\'s floor', nudgeSeen);

// The two of them, far view, one picture. The dock owns the keys while open,
// so Esc hands them back before the zoom key is pressed.
await A.key('Escape'); await A.key('Escape', 'keyup');
await sleep(250);
await A.key('v'); await A.key('v', 'keyup');
await sleep(800);
ok('V takes the room to the far framing', await A.ev(`window.__office.state.view === 'far'`));
await A.shot('live_far_two_people');
await B.shot('live_budi_floor');
await A.key('v'); await A.key('v', 'keyup');
await sleep(500);

// ---- clock-out: the room says goodbye ----------------------------------------------
// Budi reloads into the evening (?time=18:00), declines the first offer, then
// takes the header button. Andi's floor must lose him at once.
await B.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await B.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await B.send('Page.navigate', { url: `${BASE}?time=18:00` });
await B.wait(`Boolean(window.__office) && document.body.classList.contains('ready')`, 30000);
await sleep(400);
await B.ev(`document.getElementById('clockInBtn').click()`);
await sleep(2100);
await B.ev(`(() => {
  const i = document.getElementById('whoInput');
  i.value = 'Budi';
  document.getElementById('whoForm').dispatchEvent(new Event('submit', { cancelable: true }));
})()`);
await sleep(250);
await B.ev(`document.querySelector('#floorPick [data-floor="Level 22"]').click()`);
await B.wait(`document.getElementById('stageSeat').classList.contains('is-on')`);
await sleep(600);
await B.shot('live_mobile_seat_plan');
const pt21 = await B.ev(`(async () => {
  const m = await import('/src/screens/seatmap.js?v=26');
  const p = m.points().find((q) => q.num === 21);
  const r = document.getElementById('seatMapCanvas').getBoundingClientRect();
  return { x: r.left + p.cx * r.width / p.w, y: r.top + p.cy * r.height / p.h };
})()`);
await B.click(pt21.x, pt21.y);
await sleep(200);
await B.ev(`document.getElementById('seatTake').click()`);
await B.wait(`document.getElementById('stageRole').classList.contains('is-on')`);
await B.ev(`document.querySelector('#rolePick .pick-btn').click()`);
await sleep(200);
await B.ev(`(() => {
  const i = document.getElementById('partnerInput');
  i.value = 'budi@office.co';
  document.getElementById('partnerForm').dispatchEvent(new Event('submit', { cancelable: true }));
})()`);
await B.wait(`document.getElementById('characterSelectPopup').style.display === 'flex'`);
await B.ev(`document.getElementById('confirmCharBtn').click()`);
await B.wait(`window.__office.state.running && window.__office.state.player`, 30000);
await B.wait(`document.getElementById('clockOutModal').hidden === false`, 8000);
await B.shot('live_mobile_clockout_question');
await B.ev(`document.getElementById('clockOutNo').click()`);
await sleep(300);
await B.ev(`document.getElementById('clockOutBtn').click()`);
await sleep(300);
await B.ev(`document.getElementById('clockOutYes').click()`);
await sleep(600);
const outB = await B.ev(`(() => ({ out: window.__office.state.clockedOut, joined: window.__office.net.joined }))()`);
ok('Budi clocks out and leaves the wire', outB.out && !outB.joined, JSON.stringify(outB));
const goneA = await A.wait(`window.__office.state.remotes.size === 0`, 8000);
ok('Budi vanishes from Andi\'s floor immediately', goneA);
const byeLine = await A.ev(`document.getElementById('chatLog').textContent.includes('Budi clocked out')`);
ok('The contact list says goodbye', byeLine);
await B.shot('live_mobile_receipt');

// Andi's phone: the room, the dock, the pad — all reachable at 390px.
await A.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await A.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await sleep(700);
await A.key('t'); await A.key('t', 'keyup');
await sleep(400);
await A.shot('live_mobile_game_chat');
const mobileFit = await A.ev(`(() => {
  const dock = document.getElementById('chatDock').getBoundingClientRect();
  const cv = document.getElementById('gameCanvas').getBoundingClientRect();
  const pad = document.getElementById('touchPad').getBoundingClientRect();
  const coarse = matchMedia('(hover: none) and (pointer: coarse)').matches;
  return {
    coarse,
    dockIn: dock.left >= 0 && dock.right <= window.innerWidth && dock.top >= 0,
    padVisible: pad.width > 0 && pad.bottom <= window.innerHeight + 1,
    padClearOfDock: pad.top >= dock.bottom - 1 || dock.bottom <= pad.top,
    canvasW: cv.width > 0
  };
})()`);
ok('Mobile: chat dock fits the viewport, room renders', mobileFit.dockIn && mobileFit.canvasW, JSON.stringify(mobileFit));
ok('Mobile: touch pad shows under the room, clear of the dock', mobileFit.coarse && mobileFit.padVisible && mobileFit.padClearOfDock, JSON.stringify(mobileFit));
await A.key('Escape'); await A.key('Escape', 'keyup');
await A.send('Emulation.setTouchEmulationEnabled', { enabled: false });
await A.send('Emulation.clearDeviceMetricsOverride');
await sleep(400);
await A.shot('live_andi_final');

// ---- console health ----------------------------------------------------------------
const netNoise = (e) => /fonts\.g|ERR_|Failed to load resource|net::/i.test(e);
const errA = A.errors.filter((e) => !netNoise(e));
const errB = B.errors.filter((e) => !netNoise(e));
ok('No runtime errors on Andi\'s tab', errA.length === 0, errA.slice(0, 3).join(' | '));
ok('No runtime errors on Budi\'s tab', errB.length === 0, errB.slice(0, 3).join(' | '));

// ---- report --------------------------------------------------------------------------
console.log(report.join('\n'));
console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}  ·  screenshots in qa/`);
fs.writeFileSync(OUT + 'live_report.txt', report.join('\n') + `\n\n${failures} failure(s)\n`);

await bws.send('Browser.close').catch(() => {});
chrome.kill();
server.close();
process.exit(failures === 0 ? 0 : 1);