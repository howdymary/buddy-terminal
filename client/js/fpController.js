const MOVE_SPEED = 2.8;
const TURN_SPEED = 2.4;
const MOUSE_SENSITIVITY = 0.0032;
const PLAYER_RADIUS = 0.22;

export class FirstPersonController {
  constructor({ canvas, isChatting }) {
    this.canvas = canvas;
    this.isChatting = isChatting;
    this.keys = new Map();
    this.pointerLocked = false;
    this.pendingTurn = 0;
    this.touchMove = { x: 0, y: 0 };
    this.touchLook = 0;
  }

  attach() {
    document.addEventListener("keydown", this.handleKeyDown);
    document.addEventListener("keyup", this.handleKeyUp);
    this.canvas.addEventListener("click", this.handleCanvasClick);
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
    document.addEventListener("mousemove", this.handleMouseMove);
  }

  detach() {
    document.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("keyup", this.handleKeyUp);
    this.canvas.removeEventListener("click", this.handleCanvasClick);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
    document.removeEventListener("mousemove", this.handleMouseMove);
  }

  releasePointerLock() {
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock?.();
    }
  }

  setMoveVector(x, y) {
    this.touchMove.x = clamp(x, -1, 1);
    this.touchMove.y = clamp(y, -1, 1);
  }

  setLookVector(x) {
    this.touchLook = clamp(x, -1, 1);
  }

  clearMotion() {
    this.touchMove.x = 0;
    this.touchMove.y = 0;
    this.touchLook = 0;
  }

  update(player, deltaTime, isWalkable) {
    if (!player || this.isChatting?.()) {
      this.pendingTurn = 0;
      return { moved: false, turned: false };
    }

    const forward = axisValue(this.keys, ["w", "arrowup"], ["s", "arrowdown"]) + (-this.touchMove.y);
    const strafe = axisValue(this.keys, ["d"], ["a"]) + this.touchMove.x;
    const turn = axisValue(this.keys, ["arrowright"], ["arrowleft"]);

    let angleDelta = this.pendingTurn + turn * TURN_SPEED * deltaTime + (this.touchLook * TURN_SPEED * deltaTime);
    this.pendingTurn = 0;

    const hadTurn = Math.abs(angleDelta) > 0.0001;
    if (hadTurn) {
      player.angle = normalizeAngle(player.angle + angleDelta);
    }

    let moveX = 0;
    let moveY = 0;
    const movementMagnitude = Math.hypot(forward, strafe);
    if (movementMagnitude > 0.01) {
      const normalizedForward = forward / Math.max(1, movementMagnitude);
      const normalizedStrafe = strafe / Math.max(1, movementMagnitude);
      const moveAmount = MOVE_SPEED * deltaTime;
      moveX =
        Math.cos(player.angle) * normalizedForward * moveAmount +
        Math.cos(player.angle + Math.PI / 2) * normalizedStrafe * moveAmount;
      moveY =
        Math.sin(player.angle) * normalizedForward * moveAmount +
        Math.sin(player.angle + Math.PI / 2) * normalizedStrafe * moveAmount;
    }

    let moved = false;
    if (Math.abs(moveX) > 0.0001 && isWalkable(player.x + moveX, player.y, PLAYER_RADIUS)) {
      player.x += moveX;
      moved = true;
    }
    if (Math.abs(moveY) > 0.0001 && isWalkable(player.x, player.y + moveY, PLAYER_RADIUS)) {
      player.y += moveY;
      moved = true;
    }

    return { moved, turned: hadTurn };
  }

  handleKeyDown = (event) => {
    if (this.isChatting?.()) {
      return;
    }
    this.keys.set(event.key.toLowerCase(), true);
  };

  handleKeyUp = (event) => {
    this.keys.set(event.key.toLowerCase(), false);
  };

  handleCanvasClick = () => {
    if (!this.isChatting?.()) {
      this.canvas.requestPointerLock?.();
    }
  };

  handlePointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
  };

  handleMouseMove = (event) => {
    if (!this.pointerLocked || this.isChatting?.()) {
      return;
    }
    this.pendingTurn += event.movementX * MOUSE_SENSITIVITY;
  };
}

function axisValue(keys, positive, negative) {
  let value = 0;
  if (positive.some((key) => keys.get(key))) {
    value += 1;
  }
  if (negative.some((key) => keys.get(key))) {
    value -= 1;
  }
  return value;
}

function normalizeAngle(angle) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
