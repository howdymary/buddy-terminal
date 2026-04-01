const POSITION_SCALE = 100;
const ANGLE_SCALE = 1000;

export class BuddyNetwork {
  constructor({ token, handlers }) {
    this.token = token;
    this.handlers = handlers;
    this.ws = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(this.token)}`;
      this.ws = new WebSocket(url);
      this.ws.binaryType = "arraybuffer";

      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", (event) => reject(event));
      this.ws.addEventListener("close", () => {
        this.handlers.onClose?.();
      });
      this.ws.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          const message = JSON.parse(event.data);
          this.handlers.onJson?.(message);
        } else {
          this.handlers.onBatch?.(decodeBatch(event.data));
        }
      });
    });
  }

  sendMove(x, y, angle) {
    if (!this.isOpen()) {
      return false;
    }

    const payload = new ArrayBuffer(7);
    const view = new DataView(payload);
    view.setUint8(0, 0x01);
    view.setUint16(1, encodePosition(x));
    view.setUint16(3, encodePosition(y));
    view.setUint16(5, encodeAngle(angle));
    this.ws.send(payload);
    return true;
  }

  sendChat(message) {
    return this.sendJson({ type: "chat", message });
  }

  sendEmote(emote) {
    return this.sendJson({ type: "emote", emote });
  }

  sendHeartbeat() {
    return this.sendJson({ type: "heartbeat" });
  }

  sendJson(payload) {
    if (!this.isOpen()) {
      return false;
    }

    this.ws.send(JSON.stringify(payload));
    return true;
  }

  isOpen() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

function decodeBatch(buffer) {
  const view = new DataView(buffer);
  const type = view.getUint8(0);
  if (type !== 0x02) {
    return [];
  }

  const count = view.getUint16(1);
  const moves = [];

  for (let index = 0; index < count; index += 1) {
    const offset = 3 + index * 8;
    moves.push({
      playerIndex: view.getUint16(offset),
      x: view.getUint16(offset + 2) / POSITION_SCALE,
      y: view.getUint16(offset + 4) / POSITION_SCALE,
      angle: decodeAngle(view.getUint16(offset + 6))
    });
  }

  return moves;
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
