export class Camera {
  constructor(viewWidth, viewHeight, tilePixels) {
    this.viewWidth = viewWidth;
    this.viewHeight = viewHeight;
    this.tilePixels = tilePixels;
    this.x = 0;
    this.y = 0;
    this.override = null;
  }

  resize(viewWidth, viewHeight) {
    this.viewWidth = viewWidth;
    this.viewHeight = viewHeight;
  }

  focusOn(tileX, tileY, smoothing = 0.16) {
    const targetX = tileX * this.tilePixels - this.viewWidth / 2 + this.tilePixels / 2;
    const targetY = tileY * this.tilePixels - this.viewHeight / 2 + this.tilePixels / 2;
    this.x += (targetX - this.x) * smoothing;
    this.y += (targetY - this.y) * smoothing;
  }

  update(localPlayer, nearestPlayer = null) {
    if (this.override && this.override.expiresAt > performance.now() && nearestPlayer) {
      const targetX = (localPlayer.renderX + nearestPlayer.renderX) / 2;
      const targetY = (localPlayer.renderY + nearestPlayer.renderY) / 2;
      this.focusOn(targetX, targetY, 0.1);
      return;
    }

    this.override = null;
    this.focusOn(localPlayer.renderX, localPlayer.renderY);
  }

  brieflyPan() {
    this.override = {
      expiresAt: performance.now() + 1800
    };
  }
}
