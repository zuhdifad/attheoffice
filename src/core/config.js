// The new art is authored at 128px per tile and 256px per character frame, so the
// screen is built on a 32px grid rather than the old 16px one: enough resolution
// that a desk keeps its monitor and a chair keeps its castors.
export const TILE = 32;
export const CHAR_W = 32;
export const CHAR_H = 48;

// 15 x 9 tiles, the same shape as a handheld screen but at twice the density.
export const VIEW_W = 15;
export const VIEW_H = 9;
export const SCREEN_W = TILE * VIEW_W;
export const SCREEN_H = TILE * VIEW_H;

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 6;

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

// Atlas layout: 8 x 8 cells, each 32 wide and 48 tall. Ground art fills the
// bottom 32; standing art uses the full 48 and is anchored on the tile's foot.
export const ATLAS_COLS = 8;
export const ATLAS_CELL_W = 32;
export const ATLAS_CELL_H = 48;
export const ATLAS_HEADROOM = ATLAS_CELL_H - TILE;

// The workday. Three pressures, one clock. `bonus` scales the reward for
// finishing early, so the harder shift is worth more of the same clock.
export const DIFFICULTY = {
  chill: { label: 'Chill', daySeconds: 240, workFrames: 66, bonus: 0.8 },
  normal: { label: 'Normal', daySeconds: 180, workFrames: 84, bonus: 1.0 },
  crunch: { label: 'Crunch', daySeconds: 135, workFrames: 102, bonus: 1.35 }
};

export const DAY_START = 9 * 60;      // 09:00, in minutes
export const DAY_END = 17 * 60;       // 17:00
