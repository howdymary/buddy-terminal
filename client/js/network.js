const DIRECTION_CODES = {
  down: 0,
  up: 1,
  left: 2,
  right: 3
};

const CODE_TO_DIRECTION = ["down", "up", "left", "right"];

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

  sendMove(x, y, direction) {
    if (!this.isOpen()) {
      return;
    }

    const payload = new Uint8Array(4);
    payload[0] = 0x01;
    payload[1] = x;
    payload[2] = y;
    payload[3] = DIRECTION_CODES[direction] ?? 0;
    this.ws.send(payload);
  }

  sendChat(message) {
    this.sendJson({ type: "chat", message });
  }

  sendEmote(emote) {
    this.sendJson({ type: "emote", emote });
  }

  sendHeartbeat() {
    this.sendJson({ type: "heartbeat" });
  }

  sendJson(payload) {
    if (!this.isOpen()) {
      return;
    }

    this.ws.send(JSON.stringify(payload));
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
    const offset = 3 + index * 5;
    moves.push({
      playerIndex: view.getUint16(offset),
      x: view.getUint8(offset + 2),
      y: view.getUint8(offset + 3),
      direction: CODE_TO_DIRECTION[view.getUint8(offset + 4)] ?? "down"
    });
  }

  return moves;
}
