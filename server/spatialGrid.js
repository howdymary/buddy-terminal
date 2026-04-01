export class SpatialGrid {
  constructor(cellSize = 8) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.playerCells = new Map();
  }

  getCellKey(x, y) {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
  }

  addOrUpdatePlayer(playerId, x, y) {
    const nextKey = this.getCellKey(x, y);
    const previousKey = this.playerCells.get(playerId);

    if (previousKey === nextKey) {
      return;
    }

    if (previousKey && this.cells.has(previousKey)) {
      const previousCell = this.cells.get(previousKey);
      previousCell.delete(playerId);
      if (previousCell.size === 0) {
        this.cells.delete(previousKey);
      }
    }

    if (!this.cells.has(nextKey)) {
      this.cells.set(nextKey, new Set());
    }

    this.cells.get(nextKey).add(playerId);
    this.playerCells.set(playerId, nextKey);
  }

  removePlayer(playerId) {
    const key = this.playerCells.get(playerId);
    if (!key) {
      return;
    }

    const cell = this.cells.get(key);
    if (cell) {
      cell.delete(playerId);
      if (cell.size === 0) {
        this.cells.delete(key);
      }
    }

    this.playerCells.delete(playerId);
  }

  getNeighborPlayerIds(x, y) {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const nearby = new Set();

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const key = `${cx + dx},${cy + dy}`;
        const cell = this.cells.get(key);
        if (!cell) {
          continue;
        }

        for (const playerId of cell) {
          nearby.add(playerId);
        }
      }
    }

    return nearby;
  }

  getPlayersInCell(x, y) {
    const key = this.getCellKey(x, y);
    return this.cells.get(key) ?? new Set();
  }
}
