export class TokenHUD {
  constructor(element) {
    this.element = element;
    this.count = 0;
  }

  setCount(count) {
    this.count = count;
    this.element.textContent = `🪙 ${count}`;
  }

  pulse() {
    this.element.classList.remove("hud-chip--pulse");
    void this.element.offsetWidth;
    this.element.classList.add("hud-chip--pulse");
    window.setTimeout(() => {
      this.element.classList.remove("hud-chip--pulse");
    }, 260);
  }
}
