function heuristic(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

const MAX_PATH_ITERATIONS = 200;

function keyOf(node) {
  return `${node.x},${node.y}`;
}

export function findPath(start, goal, { isWalkable, isOccupied }) {
  if (!start || !goal) {
    return [];
  }

  if (start.x === goal.x && start.y === goal.y) {
    return [];
  }

  const open = [{ x: start.x, y: start.y, g: 0, f: heuristic(start, goal) }];
  const openScores = new Map([[keyOf(start), heuristic(start, goal)]]);
  const cameFrom = new Map();
  const gScore = new Map([[keyOf(start), 0]]);
  const closed = new Set();
  let iterations = 0;

  while (open.length > 0) {
    if ((iterations += 1) > MAX_PATH_ITERATIONS) {
      return [];
    }

    const current = open.shift();
    const currentKey = keyOf(current);

    if (current.x === goal.x && current.y === goal.y) {
      return reconstructPath(cameFrom, current);
    }

    closed.add(currentKey);

    for (const neighbor of neighbors(current)) {
      const neighborKey = keyOf(neighbor);
      if (closed.has(neighborKey)) {
        continue;
      }

      if (!isWalkable(neighbor.x, neighbor.y)) {
        continue;
      }

      if (isOccupied(neighbor.x, neighbor.y) && !(neighbor.x === goal.x && neighbor.y === goal.y)) {
        continue;
      }

      const tentativeG = (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) + 1;
      if (tentativeG >= (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }

      cameFrom.set(neighborKey, { x: current.x, y: current.y });
      gScore.set(neighborKey, tentativeG);
      const score = tentativeG + heuristic(neighbor, goal);
      openScores.set(neighborKey, score);

      const existingIndex = open.findIndex((entry) => entry.x === neighbor.x && entry.y === neighbor.y);
      if (existingIndex >= 0) {
        open.splice(existingIndex, 1);
      }

      if (existingIndex < 0 || score <= (openScores.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
        insertByScore(open, { ...neighbor, g: tentativeG, f: score });
      }
    }
  }

  return [];
}

function reconstructPath(cameFrom, current) {
  const path = [{ x: current.x, y: current.y }];
  let cursor = cameFrom.get(keyOf(current));

  while (cursor) {
    path.unshift(cursor);
    cursor = cameFrom.get(keyOf(cursor));
  }

  return path.slice(1);
}

function neighbors(node) {
  return [
    { x: node.x, y: node.y - 1 },
    { x: node.x, y: node.y + 1 },
    { x: node.x - 1, y: node.y },
    { x: node.x + 1, y: node.y }
  ];
}

function insertByScore(open, candidate) {
  let index = open.length;
  while (index > 0 && open[index - 1].f > candidate.f) {
    index -= 1;
  }
  open.splice(index, 0, candidate);
}
