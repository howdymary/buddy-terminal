import { MAP_HEIGHT, MAP_WIDTH } from "./collisionMap.js";

export const MESSAGE_TYPES = {
  MOVE: 0x01,
  BATCH: 0x02
};

const POSITION_SCALE = 100;
const ANGLE_SCALE = 1000;

export function encodeBatch(moves) {
  const buffer = Buffer.alloc(3 + moves.length * 8);
  buffer.writeUInt8(MESSAGE_TYPES.BATCH, 0);
  buffer.writeUInt16BE(moves.length, 1);

  moves.forEach((move, index) => {
    const offset = 3 + index * 8;
    buffer.writeUInt16BE(move.playerIndex, offset);
    buffer.writeUInt16BE(encodePosition(move.x), offset + 2);
    buffer.writeUInt16BE(encodePosition(move.y), offset + 4);
    buffer.writeUInt16BE(encodeAngle(move.angle ?? 0), offset + 6);
  });

  return buffer;
}

export function decodeMove(buffer) {
  const view = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (view.length !== 7) {
    return null;
  }

  if (view.readUInt8(0) !== MESSAGE_TYPES.MOVE) {
    return null;
  }

  const x = view.readUInt16BE(1) / POSITION_SCALE;
  const y = view.readUInt16BE(3) / POSITION_SCALE;
  if (x >= MAP_WIDTH || y >= MAP_HEIGHT) {
    return null;
  }

  return {
    x,
    y,
    angle: decodeAngle(view.readUInt16BE(5))
  };
}

function encodePosition(value) {
  return Math.max(0, Math.min(65535, Math.round(value * POSITION_SCALE)));
}

function encodeAngle(value) {
  return Math.max(0, Math.min(65535, Math.round(normalizeAngle(value) * ANGLE_SCALE)));
}

function decodeAngle(value) {
  return normalizeAngle(value / ANGLE_SCALE);
}

function normalizeAngle(angle) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}
