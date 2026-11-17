// The new art is authored at 128px per tile and 256px per character frame, so the
// screen is built on a 32px grid rather than the old 16px one: enough resolution
// that a desk keeps its monitor and a chair keeps its castors.
export const TILE = 32;
export const CHAR_W = 32;
export const CHAR_H = 48;

// The UI design space. The HUD, the conversation box, the receipt and the pause
// card are all authored on this 480x288 grid and stretched to the buffer in one
// transform, so their type sizes and hairlines never depend on how closely the
// room is drawn.
export const SCREEN_W = 480;
export const SCREEN_H = 288;

// The renderer's pixel budget. Every frame is drawn into one 1280x720 buffer
// whatever the world scale is, and presented 1:1; only the CSS box around the
// canvas changes with the window, so a frame costs the same on every display.
export const BUFFER_W = 1280;
export const BUFFER_H = 720;

// Device pixels per world unit. near is the framed close-up — 10 tiles across
// and 5.6 down, the room at conversation distance; far pulls the camera back to
// 20 x 11 so the whole floor is on screen. The buffer is 1280x720 either way:
// that is what budgeting pixels instead of scaling the picture buys.
export const VIEWS = {
  near: { ppu: 4 },
  far: { ppu: 2 }
};

// Frames per tile step. 12 frames at 60fps is five tiles a second: brisk enough
// to cross the floor, slow enough to read the room.
export const STEP_FRAMES = 12;
export const WALK_FRAMES = 6;

export const FPS = 60;
export const FRAME_MS = 1000 / FPS;

// Sprite sheet layout, shared by every character.
export const SHEET_COLS = 6;
export const SHEET_ROWS = 4;
export const DIR_ROW = { down: 0, left: 1, right: 2, up: 3 };

// Atlas layout: 8 x 8 cells, each one tile wide and four tiles tall. The extra
// three tiles are headroom above the footprint, so a prop can be authored well
// above the floor and still stand on a single tile. Nothing is fitted to the
// cell: every cell is blitted at the plate's own scale, foot on its footprint.
export const ATLAS_COLS = 8;
export const ATLAS_CELL_TILES = 4;

// The plate is baked twice, at device pixels per tile, so whichever view is on
// screen blits its art 1:1 with no resampling at all.
export const ATLAS_LODS = [128, 64];

// The Blender-baked character rig: one doll, nine actions, four direction rows.
// Cells are authored at 4 px/unit (near) and 2 px/unit (far) so each view blits
// its own LOD 1:1 into the same 32x48 world box. Columns are laid out per action;
// stand-up is the sit track played in reverse.
export const RIG = {
  cols: 47,
  near: { cell: [128, 192] },
  far: { cell: [64, 96] },
  actions: {
    idle: [0, 4], walk: [4, 6], sit: [10, 5], sitidle: [15, 4], type: [19, 4],
    talk: [23, 6], sip: [29, 10], wave: [39, 4], phone: [43, 4]
  }
};
