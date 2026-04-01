export const TILE_IDS = {
  GRASS: 0,
  PATH: 1,
  SERVER_RACK: 2,
  NEURAL_FOUNTAIN: 3,
  FIREWALL_BORDER: 4,
  PROMPT_SIGN: 5,
  CIRCUIT_FLOWERS: 6,
  DATA_CENTER_WALL: 7,
  DATA_CENTER_DOOR: 8,
  TERMINAL_BENCH: 9,
  ANTENNA_TOWER: 10
};

export const MAP_WIDTH = 50;
export const MAP_HEIGHT = 40;
export const SPAWN_POINT = { x: 10, y: 30 };
export const MEMORIAL_GARDEN = {
  x: 4,
  y: 8,
  width: 8,
  height: 5,
  label: "Memorial Garden"
};
export const WELCOME_SIGN = {
  x: 12,
  y: 30,
  message: "Welcome to buddyterminal.com! Collect compute tokens, chat with buddies, and explore the Claude campus. 👋"
};

function createBaseMap() {
  const tiles = Array.from({ length: MAP_HEIGHT }, () =>
    Array.from({ length: MAP_WIDTH }, () => TILE_IDS.GRASS)
  );

  paintBorder(tiles);
  paintPaths(tiles);
  paintNeuralFountain(tiles);
  paintDataCenter(tiles);
  paintServerRackGarden(tiles);
  paintBenches(tiles);
  paintAntennaTower(tiles);
  paintFlowers(tiles);
  paintPromptSign(tiles);

  return tiles;
}

function paintBorder(tiles) {
  for (let x = 0; x < MAP_WIDTH; x += 1) {
    tiles[0][x] = TILE_IDS.FIREWALL_BORDER;
    tiles[MAP_HEIGHT - 1][x] = TILE_IDS.FIREWALL_BORDER;
  }

  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    tiles[y][0] = TILE_IDS.FIREWALL_BORDER;
    tiles[y][MAP_WIDTH - 1] = TILE_IDS.FIREWALL_BORDER;
  }
}

function paintPaths(tiles) {
  fillRect(tiles, 4, 30, 42, 1, TILE_IDS.PATH);
  fillRect(tiles, 8, 12, 34, 1, TILE_IDS.PATH);
  fillRect(tiles, 25, 8, 1, 25, TILE_IDS.PATH);
  fillRect(tiles, 10, 24, 1, 9, TILE_IDS.PATH);
  fillRect(tiles, 18, 20, 20, 1, TILE_IDS.PATH);
  fillRect(tiles, 36, 12, 1, 19, TILE_IDS.PATH);
  fillRect(tiles, 6, 18, 11, 1, TILE_IDS.PATH);
}

function paintNeuralFountain(tiles) {
  fillRect(tiles, 23, 18, 5, 5, TILE_IDS.NEURAL_FOUNTAIN);
}

function paintDataCenter(tiles) {
  fillRect(tiles, 35, 6, 8, 8, TILE_IDS.DATA_CENTER_WALL);
  tiles[13][38] = TILE_IDS.DATA_CENTER_DOOR;
}

function paintServerRackGarden(tiles) {
  const racks = [
    [14, 9],
    [16, 11],
    [18, 8],
    [31, 10],
    [33, 22],
    [39, 22]
  ];

  for (const [x, y] of racks) {
    tiles[y][x] = TILE_IDS.SERVER_RACK;
    tiles[y - 1][x] = TILE_IDS.SERVER_RACK;
  }
}

function paintBenches(tiles) {
  const benches = [
    [14, 29],
    [15, 29],
    [27, 17],
    [28, 17],
    [31, 29],
    [32, 29]
  ];

  for (const [x, y] of benches) {
    tiles[y][x] = TILE_IDS.TERMINAL_BENCH;
  }
}

function paintAntennaTower(tiles) {
  tiles[5][6] = TILE_IDS.ANTENNA_TOWER;
  tiles[4][6] = TILE_IDS.ANTENNA_TOWER;
}

function paintFlowers(tiles) {
  const patches = [
    [7, 9], [8, 9], [9, 9],
    [21, 10], [22, 10], [11, 15],
    [18, 26], [19, 26], [20, 26],
    [29, 27], [40, 18], [42, 18],
    [43, 28], [7, 33], [8, 33], [45, 10]
  ];

  for (const [x, y] of patches) {
    if (tiles[y][x] === TILE_IDS.GRASS) {
      tiles[y][x] = TILE_IDS.CIRCUIT_FLOWERS;
    }
  }
}

function paintPromptSign(tiles) {
  tiles[WELCOME_SIGN.y][WELCOME_SIGN.x] = TILE_IDS.PROMPT_SIGN;
}

function fillRect(tiles, startX, startY, width, height, tileId) {
  for (let y = startY; y < startY + height; y += 1) {
    for (let x = startX; x < startX + width; x += 1) {
      if (x >= 0 && x < MAP_WIDTH && y >= 0 && y < MAP_HEIGHT) {
        tiles[y][x] = tileId;
      }
    }
  }
}

export const mapTiles = createBaseMap();

const BLOCKED_TILES = new Set([
  TILE_IDS.SERVER_RACK,
  TILE_IDS.NEURAL_FOUNTAIN,
  TILE_IDS.FIREWALL_BORDER,
  TILE_IDS.PROMPT_SIGN,
  TILE_IDS.DATA_CENTER_WALL,
  TILE_IDS.DATA_CENTER_DOOR,
  TILE_IDS.ANTENNA_TOWER
]);

export function isInBounds(x, y) {
  return x >= 0 && x < MAP_WIDTH && y >= 0 && y < MAP_HEIGHT;
}

export function isWalkable(x, y) {
  if (!isInBounds(x, y)) {
    return false;
  }

  return !BLOCKED_TILES.has(mapTiles[y][x]);
}

export function isPathTile(x, y) {
  return isInBounds(x, y) && mapTiles[y][x] === TILE_IDS.PATH;
}

export function getMapPayload() {
  return {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    tiles: mapTiles,
    spawn: SPAWN_POINT,
    sign: WELCOME_SIGN,
    graveyard: MEMORIAL_GARDEN
  };
}
