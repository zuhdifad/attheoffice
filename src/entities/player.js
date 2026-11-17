import { TILE, STEP_FRAMES } from '../core/config.js?v=24';
import { frameFor } from '../art/characters.js?v=24';

const DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export function createPlayer(x, y, who) {
  return {
    id: who.id,
    name: who.name,
    tint: who.tint,
    tx: x,
    ty: y,
    from: null,
    to: null,
    px: x * TILE,
    py: y * TILE,
    dir: 'down',
    frame: 0,
    moving: false,
    step: 0,
    stepLen: STEP_FRAMES,
    steps: 0,
    working: false,
    arrived: false,
    // The action state machine: sit, drink and laptop are single-key actions
    // the world screen starts beside the right prop; the seat is the claim
    // held while sitting, and `leaving` the one being stood up from.
    action: 'idle',
    act: 0,
    seated: false,
    seat: null,
    leaving: null
  };
}

// Tile-locked movement: start a step toward the next tile centre, advance it a
// little each frame, snap on arrival. walkable is injected so the player module
// never has to know about the map or the crowd. A step may carry its own
// length: the sit-down and stand-up glides ride the transition's own frames.
export function updatePlayer(p, walkable, heldDir) {
  p.arrived = false;

  // Working roots you to the spot, but you still face the desk you are using.
  // A glide in flight (boarding or leaving a chair) finishes first.
  if (p.working && !p.moving) {
    p.frame = 0;
    p.step = 0;
    return;
  }

  if (!p.moving) {
    p.frame = 0;
    if (!heldDir) return;
    const [dx, dy] = DELTA[heldDir];
    p.dir = heldDir;
    const nx = p.tx + dx;
    const ny = p.ty + dy;
    if (!walkable(nx, ny)) return;
    p.from = { x: p.tx, y: p.ty };
    p.to = { x: nx, y: ny };
    p.moving = true;
    p.step = 0;
    p.stepLen = STEP_FRAMES;
  }

  p.step++;
  const t = Math.min(p.step / p.stepLen, 1);
  p.px = (p.from.x + (p.to.x - p.from.x) * t) * TILE;
  p.py = (p.from.y + (p.to.y - p.from.y) * t) * TILE;
  p.frame = frameFor(p.step, p.stepLen, true);

  if (p.step >= p.stepLen) {
    p.tx = p.to.x;
    p.ty = p.to.y;
    p.px = p.tx * TILE;
    p.py = p.ty * TILE;
    p.moving = false;
    p.step = 0;
    p.stepLen = STEP_FRAMES;
    p.frame = 0;
    p.steps++;
    p.arrived = true;
  }
}

// Face whatever you are about to use, so the sprite never works with its back
// to the desk.
export function faceToward(p, tx, ty) {
  const dx = tx - p.tx;
  const dy = ty - p.ty;
  if (Math.abs(dx) > Math.abs(dy)) p.dir = dx > 0 ? 'right' : 'left';
  else if (dy !== 0) p.dir = dy > 0 ? 'down' : 'up';
}