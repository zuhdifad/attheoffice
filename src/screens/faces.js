// ?faces=1 — the expression contact sheet. Every expression on every skin
// tone, laid out on the same 1280x720 buffer the game draws into. Each cell
// goes through art/expressions.js drawFace — the same face pass drawActor
// applies to every doll on the floor — over a shared head tinted per tone, so
// the sheet proves the production face path rather than a re-implementation.
//
// The overlays keep animating (tears fall, Zzz rises) off the sim tick, so a
// screenshot at any moment shows the sprites mid-life.

import { FRAME_MS } from '../core/config.js?v=26';
import { state } from '../core/state.js?v=26';
import { applyZoom } from '../core/display.js?v=26';
import { drawContactSheet, EXPRESSION, FACE_SHEET, OVERLAYS, SKINS } from '../art/expressions.js?v=26';

export async function open() {
  state.mode = 'faces';
  state.running = true;
  state.view = 'near';
  document.getElementById('gameArea').style.display = 'block';
  document.body.classList.add('in-game');
  applyZoom(state);

  // QA handle: the table and the grid geometry, beside the shared buffer, so
  // a test can sample every cell without guessing where the sheet put it.
  if (window.__office) {
    window.__office.faces = {
      names: Object.keys(EXPRESSION),
      overlays: OVERLAYS,
      skins: Object.keys(SKINS),
      sheet: FACE_SHEET
    };
  }
}

export function update(st) {
  st.tick++;
}

export function draw(g, st) {
  drawContactSheet(g, st.tick * FRAME_MS / 1000);
}