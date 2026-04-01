const DIRECTION_TO_CODE = {
  down: 0,
  up: 1,
  left: 2,
  right: 3
};

const CODE_TO_DIRECTION = ["down", "up", "left", "right"];

export const MESSAGE_TYPES = {
  MOVE: 0x01,
  BATCH: 0x02
};

export function encodeBatch(moves) {
  const buffer = Buffer.alloc(3 + moves.length * 5);
  buffer.writeUInt8(MESSAGE_TYPES.BATCH, 0);
  buffer.writeUInt16BE(moves.length, 1);

  moves.forEach((move, index) => {
    const offset = 3 + index * 5;
    buffer.writeUInt16BE(move.playerIndex, offset);
    buffer.writeUInt8(move.x, offset + 2);
    buffer.writeUInt8(move.y, offset + 3);
    buffer.writeUInt8(DIRECTION_TO_CODE[move.direction] ?? 0, offset + 4);
  });

  return buffer;
}

export function decodeMove(buffer) {
  const view = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (view.length < 4) {
    return null;
  }

  if (view.readUInt8(0) !== MESSAGE_TYPES.MOVE) {
    return null;
  }

  return {
    x: view.readUInt8(1),
    y: view.readUInt8(2),
    direction: CODE_TO_DIRECTION[view.readUInt8(3)] ?? "down"
  };
}
