import { isSolid, isObject } from '../art/tiles.js?v=9';

// Size comes from the grid, never from a module constant. That is what lets a
// kitchen be 18x12 while the office stays 34x26.
//
// The grid names one glyph per tile, but a desk is not a floor — it stands on
// one. So the map carries a second, derived ground layer: every standing piece
// inherits the floor of the nearest open tile, which is what makes a carpet run
// under its sofa and a stone slab run under a desk instead of a black hole.
export function createMap(grid) {
  const h = grid.length;
  const w = grid[0].length;
  const get = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? '#' : grid[y][x]);
  const floor = groundLayer(grid, w, h);
  return {
    w,
    h,
    grid,
    get,
    floorAt(x, y) {
      if (x < 0 || y < 0 || x >= w || y >= h) return '.';
      return floor[y][x];
    },
    walkable(x, y) {
      return !isSolid(get(x, y));
    }
  };
}

// Multi-source breadth-first flood out of every open tile. The first open tile
// to reach a prop wins, so a chair on the edge of a carpet takes the carpet and
// a pillar in the middle of the floor takes the floor. One pass, at build time.
function groundLayer(grid, w, h) {
  const out = [];
  const queue = [];
  for (let y = 0; y < h; y++) {
    const row = new Array(w);
    for (let x = 0; x < w; x++) {
      const id = grid[y][x];
      if (isObject(id)) {
        row[x] = null;
      } else {
        row[x] = id;
        queue.push(x, y);
      }
    }
    out.push(row);
  }

  for (let i = 0; i < queue.length; i += 2) {
    const x = queue[i];
    const y = queue[i + 1];
    const id = out[y][x];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (out[ny][nx] !== null) continue;
      out[ny][nx] = id;
      queue.push(nx, ny);
    }
  }

  // Anything the flood could not reach — a solid block with no open neighbour —
  // falls back to plain stone rather than staying empty.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (out[y][x] === null) out[y][x] = '.';
  }
  return out;
}