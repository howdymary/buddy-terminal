const DIR_KEYS = new Map([
  ["ArrowUp", "up"],
  ["w", "up"],
  ["W", "up"],
  ["ArrowDown", "down"],
  ["s", "down"],
  ["S", "down"],
  ["ArrowLeft", "left"],
  ["a", "left"],
  ["A", "left"],
  ["ArrowRight", "right"],
  ["d", "right"],
  ["D", "right"]
]);

const EMOTE_KEYS = {
  1: "👋",
  2: "❤️",
  3: "✨",
  4: "😂"
};

export class InputController {
  constructor() {
    this.pressedDirections = new Set();
    this.lastMoveAt = 0;
    this.moveIntervalMs = 90;
    this.onToggleChat = null;
    this.onCloseChat = null;
    this.onEmote = null;
    this.onToggleChatPanel = null;
    this.onHelp = null;
    this.isTextInputActive = null;
  }

  attach() {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
  }

  detach() {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
  }

  setCallbacks(callbacks) {
    this.onToggleChat = callbacks.onToggleChat;
    this.onCloseChat = callbacks.onCloseChat;
    this.onEmote = callbacks.onEmote;
    this.onToggleChatPanel = callbacks.onToggleChatPanel;
    this.onHelp = callbacks.onHelp;
    this.isTextInputActive = callbacks.isTextInputActive;
  }

  consumeMovement(now = performance.now()) {
    if (this.pressedDirections.size === 0) {
      return null;
    }

    if (now - this.lastMoveAt < this.moveIntervalMs) {
      return null;
    }

    this.lastMoveAt = now;
    return Array.from(this.pressedDirections).at(-1);
  }

  pushDirection(direction) {
    this.pressedDirections.delete(direction);
    this.pressedDirections.add(direction);
  }

  releaseDirection(direction) {
    this.pressedDirections.delete(direction);
  }

  clearDirections() {
    this.pressedDirections.clear();
  }

  handleKeyDown = (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    if (this.isTextInputActive?.()) {
      if (event.key === "Escape") {
        event.preventDefault();
        this.onCloseChat?.();
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      this.onToggleChat?.();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      this.onCloseChat?.();
      return;
    }

    if (event.key === "t" || event.key === "T") {
      event.preventDefault();
      this.onToggleChatPanel?.();
      return;
    }

    if (event.key === "h" || event.key === "H") {
      event.preventDefault();
      this.onHelp?.();
      return;
    }

    if (EMOTE_KEYS[event.key]) {
      this.onEmote?.(EMOTE_KEYS[event.key]);
      return;
    }

    const direction = DIR_KEYS.get(event.key);
    if (!direction) {
      return;
    }

    event.preventDefault();
    this.pushDirection(direction);
  };

  handleKeyUp = (event) => {
    const direction = DIR_KEYS.get(event.key);
    if (!direction) {
      return;
    }

    this.releaseDirection(direction);
  };
}
