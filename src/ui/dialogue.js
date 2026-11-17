import { SCREEN_W, SCREEN_H } from '../core/config.js?v=24';
import { canvas, text, px } from '../core/draw.js?v=24';
import { bustFor } from '../art/characters.js?v=24';
import { CHARACTERS } from '../art/palette.js?v=24';
import { faceToward } from '../entities/player.js?v=24';
import { sfx } from '../core/audio.js?v=24';
import { EXPRESSION, setMood } from '../art/expressions.js?v=24';
import { actorFor } from '../art/rig.js?v=24';

// The conversation box, in the register of the handheld reference: a parchment
// panel with a dark-brown rounded border, the speaker's bust framed at the top
// left overlapping the edge, monospace brown text revealed a character at a
// time, and a blinking green heart once a page is fully told.

const INK = '#3a2c1a';
const BORDER = '#5a4632';
const PARCH = '#f7efd3';
const PARCH_HI = '#fbf6e4';
const PARCH_LO = '#e8dcb8';

// Two to three pages apiece, in each colleague's own voice and role. A line may
// open with an expression tag — '[happy] …' — which the window puts on the
// speaker's face when the page opens; untagged pages keep the last face.
const DIALOGUE = {
  zuhdi: [
    '[happy] Morning! The deploy went out clean at eight, so of course something will break by lunch. It always does.',
    '[going-crazy] If the pipeline goes red, do not panic. Roll back first, apologise on Monday, and nobody ever remembers the Friday.',
    '[sad] Oh — and if you find a spare charger, it is mine. It has been missing since the last sprint.'
  ],
  alicia: [
    '[ambitious] The client call is at eleven. I run the room at ten past, so be seated and be brief.',
    '[happy] Clients do not buy the deck, they buy the calm in your voice. Keep it steady and let the numbers do the shouting.',
    '[bored] Good. Now go look busy before someone hands you a committee.'
  ],
  anna: [
    '[happy] Happy almost-Friday! I know every birthday on this floor, and I know exactly who left the mug in the sink.',
    '[crying] Both get followed up. Kindly, but thoroughly. People Ops is just patience with a spreadsheet.',
    '[in-love] If you need anything — a form, an ear, an escape route — my door is the one with the plant.'
  ],
  janice: [
    '[angry] The report prints when I say it prints. Finance approves the coffee budget and questions the coffee consumption.',
    '[ambitious] Every receipt, every line. Bring me clean numbers and I will sign before the kettle boils.',
    '[in-love] Do not look at me like that. The budget is a love language.'
  ],
  phat: [
    '[curious] I drew the diagram before the meeting started. It is always faster to argue with a picture than with a paragraph.',
    '[bored] Three pens in the pocket, one of them working. The architecture is the same: keep the parts that carry load.',
    '[happy] Come find me at the whiteboard when the boxes stop making sense.'
  ],
  philip: [
    '[curious] How is it going? And I will actually wait for the answer, so think before you say "fine".',
    '[happy] Two laps of the floor a day. I am not checking up on you, I am checking the room is breathing.',
    '[ambitious] Good pace today. Keep it steady and go home on time — that is an order.'
  ],
  suhendri: [
    '[tired] First into the queue, last out of the stand-up. The headset tan is permanent, the patience is not.',
    '[happy] Every ticket is a person having a bad day. Answer the person, then fix the ticket.',
    '[sleepy] If the queue spikes, breathe. It always spikes. It always clears.'
  ],
  takuya: [
    '[angry] I aligned the pixel, then I aligned it again. It was one pixel off and it was personally offending me.',
    '[lazy] Cardigan weather indoors, twelve months a year. The vents and I have an understanding.',
    '[curious] If the layout shifts on your screen, tell me. Do not tell the designer first.'
  ],
  tracy: [
    '[happy] I brought the review deck and the good markers. The opinions are held firmly and explained kindly.',
    '[ambitious] Design is not decoration, it is the argument made visible. Show me the flow, not the colour.',
    '[excited] Come to the sprint review. Bring questions, leave the pixel-counting to Takuya.'
  ],
  ayu: [
    '[excited] I found the bug in the happy path. Filed it politely, reproduced it perfectly, attached the video.',
    '[curious] The happy path is where everyone stops looking. That is exactly where I start.',
    '[ambitious] If it works on your machine, wonderful. Now let us watch it work on mine.'
  ],
  'raja-aqilah': [
    '[ambitious] I turned the stand-up into a chart before the stand-up ended. The numbers were exact; the opinions were not.',
    '[bored] Data does not argue, it just waits for you to read it properly. Here, I will show you the axis.',
    '[curious] Bring me a question with a number in it and I will bring you an answer with three.'
  ],
  aaron: [
    '[laughing] Closed on the second call. The first call is for listening; the second is for signing.',
    '[happy] The good coffee pods are in my top drawer. Earn one and I will show you which.',
    '[ambitious] Sales is just confidence with a calendar. Book the follow-up before you hang up.'
  ],
  max: [
    '[happy] Early for the eleven o\'clock, as always. I sign off the review and I remember your name — both matter.',
    '[ambitious] Partnerships are long games. Be the person who shows up prepared and leaves on time.',
    '[happy] Good to see you on the floor. Now go make the client glad they picked us.'
  ]
};

// A measuring context so word-wrap is exact, not guessed.
const measure = canvas(4, 4).ctx;
measure.font = '8px ui-monospace, Menlo, monospace';

const BOX_W = Math.round(SCREEN_W * 0.92);
const BOX_H = Math.round(SCREEN_H * 0.26);
const BOX_X = Math.round((SCREEN_W - BOX_W) / 2);
const BOX_Y = SCREEN_H - BOX_H - 6;
const TEXT_X = BOX_X + 78;
const TEXT_W = BOX_W - 78 - 14;
const LINE_H = 12;
const MAX_LINES = 3;

function wrap(str, width) {
  const words = str.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    if (measure.measureText(trial).width > width && line) {
      lines.push(line);
      line = w;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Author pages become render pages of at most three wrapped lines each, so a
// long thought auto-paginates instead of overflowing the box. A leading
// '[name]' tag rides on the page, not on the text: the window puts it on the
// speaker's face, the box never prints it.
function buildPages(id) {
  const src = DIALOGUE[id] || ['…'];
  const pages = [];
  for (const str of src) {
    const m = /^\[([a-z-]+)\]\s*/.exec(str);
    const tag = m && EXPRESSION[m[1]] ? m[1] : null;
    const lines = wrap(m ? str.slice(m[0].length) : str, TEXT_W);
    for (let i = 0; i < lines.length; i += MAX_LINES) pages.push({ lines: lines.slice(i, i + MAX_LINES), tag });
  }
  return pages;
}

// The face a page asks for. A long hold keeps it up for the whole conversation;
// closing releases it back to the resting face.
function pageMood(npc, page) {
  if (page && page.tag) setMood(actorFor(npc), page.tag, 100000);
}

function pitchFor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return 0.9 + (h % 5) * 0.07;
}

// The colleague standing right beside the player, if any. Orthogonal adjacency
// keeps "next to" honest on a tile grid.
export function nearestTalkable(state) {
  if (state.phase !== 'play' || !state.player) return null;
  const p = state.player;
  let best = null;
  for (const n of state.npcs) {
    const d = Math.abs(n.tx - p.tx) + Math.abs(n.ty - p.ty);
    if (d === 1) { best = n; break; }
  }
  return best;
}

export function openDialogue(state, npc) {
  const pages = buildPages(npc.id);
  state.dialogue = { npc, pages, page: 0, shown: 0, t: 0, pitch: pitchFor(npc.id) };
  // Both turn to face each other; a seated colleague stays seated.
  faceToward(state.player, npc.tx, npc.ty);
  const dx = state.player.tx - npc.tx;
  const dy = state.player.ty - npc.ty;
  npc.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  npc.say = 0;
  // The window applies the page's expression on open, so the face is already
  // turning by the time the first character lands.
  pageMood(npc, pages[0]);
  sfx.talk();
}

export function closeDialogue(state) {
  if (!state.dialogue) return;
  setMood(actorFor(state.dialogue.npc), 'neutral', 0);
  state.dialogue = null;
  sfx.talkClose();
}

// Returns true while a conversation is open so the world knows to freeze.
export function updateDialogue(state, input) {
  const d = state.dialogue;
  if (!d) return false;
  d.t++;
  const full = d.pages[d.page].lines.join('').length;
  if (d.shown < full && d.t % 2 === 0) {
    d.shown++;
    if (d.shown % 2 === 0) sfx.blip(d.pitch);
  }
  if (input.confirmTap) {
    if (d.shown < full) {
      d.shown = full;
    } else if (d.page < d.pages.length - 1) {
      d.page++;
      d.shown = 0;
      d.t = 0;
      pageMood(d.npc, d.pages[d.page]);
      sfx.talk();
    } else {
      closeDialogue(state);
    }
  }
  return true;
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

// A 7x6 pixel heart, blinked once the page is fully revealed.
const HEART = [
  '.XX.XX.',
  'XXXXXXX',
  'XXXXXXX',
  '.XXXXX.',
  '..XXX..',
  '...X...'
];
function heart(g, x, y, on) {
  if (!on) return;
  g.fillStyle = '#3fae4a';
  for (let j = 0; j < HEART.length; j++) {
    for (let i = 0; i < HEART[j].length; i++) {
      if (HEART[j][i] === 'X') g.fillRect(x + i, y + j, 1, 1);
    }
  }
}

export function drawDialogue(g, state) {
  const d = state.dialogue;
  if (!d) return;
  const who = CHARACTERS.find((c) => c.id === d.npc.id);
  const lines = d.pages[d.page].lines;
  const full = lines.join('').length;
  const done = d.shown >= full;

  g.save();

  // Soft drop shadow, then the parchment body with a rounded brown border.
  roundRect(g, BOX_X + 2, BOX_Y + 3, BOX_W, BOX_H, 5);
  g.fillStyle = 'rgba(15,12,6,0.35)';
  g.fill();
  roundRect(g, BOX_X, BOX_Y, BOX_W, BOX_H, 5);
  g.fillStyle = PARCH;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = BORDER;
  g.stroke();
  // Inner bevel: light on the top-left, shade on the bottom-right.
  roundRect(g, BOX_X + 2, BOX_Y + 2, BOX_W - 4, BOX_H - 4, 4);
  g.lineWidth = 1;
  g.strokeStyle = PARCH_HI;
  g.stroke();
  px(g, BOX_X + 3, BOX_Y + BOX_H - 3, BOX_W - 6, 1, PARCH_LO);

  // Framed bust at the top-left, overlapping the box's top edge.
  const PX = BOX_X + 8, PY = BOX_Y - 18, PS = 56;
  px(g, PX + 2, PY + 3, PS, PS, 'rgba(15,12,6,0.35)');
  px(g, PX, PY, PS, PS, PARCH);
  g.lineWidth = 2;
  g.strokeStyle = BORDER;
  g.strokeRect(PX + 1, PY + 1, PS - 2, PS - 2);
  const bust = bustFor(d.npc.id);
  if (bust) g.drawImage(bust, 0, 0, bust.width, bust.height, PX + 4, PY + 4, PS - 8, PS - 8);
  px(g, PX + 3, PY + 3, PS - 6, 1, PARCH_HI);

  // Name tag, then the typewriter text.
  text(g, (who ? who.name : d.npc.name).toUpperCase(), TEXT_X, BOX_Y + 13, BORDER, 'left', 7);
  px(g, TEXT_X, BOX_Y + 16, TEXT_W, 1, PARCH_LO);

  let left = d.shown;
  for (let i = 0; i < lines.length; i++) {
    const take = Math.max(0, Math.min(lines[i].length, left));
    left -= take;
    if (take > 0) text(g, lines[i].slice(0, take), TEXT_X, BOX_Y + 28 + i * LINE_H, INK, 'left', 8);
  }

  // Page dots and the blinking heart, bottom-right.
  const blink = Math.floor(d.t / 22) % 2 === 0;
  heart(g, BOX_X + BOX_W - 16, BOX_Y + BOX_H - 12, done && blink);
  for (let i = 0; i < d.pages.length; i++) {
    px(g, BOX_X + BOX_W - 26 - i * 5, BOX_Y + BOX_H - 8, 3, 3, i === d.page ? BORDER : PARCH_LO);
  }

  g.restore();
}