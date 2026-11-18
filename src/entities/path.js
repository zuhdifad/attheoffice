// One BFS over the floor, shared by the clock-in walk and any replan. Doorways
// are planned through — the leaf's own machine opens on approach — and the
// crowd's reserved tiles are the only moving obstacles. The base map stays
// door-agnostic, exactly as the renderer's collision contract requires.
const DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const DIRS = ['up', 'down', 'left', 'right'];

export function findPath(map, occupied, from, to) {
  if (!map.walkable(to.x, to.y)) return null;
  const start = `${from.x},${from.y}`;
  const goal = `${to.x},${to.y}`;
  if (start === goal) return [];
  const prev = new Map([[start, null]]);
  const queue = [[from.x, from.y]];
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const d of DIRS) {
      const [dx, dy] = DELTA[d];
      const nx = x + dx, ny = y + dy;
      const k = `${nx},${ny}`;
      if (prev.has(k) || !map.walkable(nx, ny) || occupied.has(k)) continue;
      prev.set(k, `${x},${y}`);
      if (k === goal) {
        const path = [];
        let cur = k;
        while (cur !== start) {
          const [cx, cy] = cur.split(',').map(Number);
          path.unshift({ x: cx, y: cy });
          cur = prev.get(cur);
        }
        return path;
      }
      queue.push([nx, ny]);
    }
  }
  return null;
}

export const dirOf = (x, y, nx, ny) =>
  nx > x ? 'right' : nx < x ? 'left' : ny > y ? 'down' : 'up';