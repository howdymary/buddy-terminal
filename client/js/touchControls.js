export function bindTouchControls(root, { onDirectionStart, onDirectionEnd, onChat, onEmote }) {
  const directionButtons = root.querySelectorAll("[data-dir]");
  const actionButtons = root.querySelectorAll("[data-action]");

  directionButtons.forEach((button) => {
    const direction = button.dataset.dir;

    const start = (event) => {
      event.preventDefault();
      onDirectionStart(direction);
    };

    const end = (event) => {
      event.preventDefault();
      onDirectionEnd(direction);
    };

    button.addEventListener("touchstart", start, { passive: false });
    button.addEventListener("touchend", end, { passive: false });
    button.addEventListener("touchcancel", end, { passive: false });
    button.addEventListener("mousedown", start);
    button.addEventListener("mouseup", end);
    button.addEventListener("mouseleave", end);
  });

  actionButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const action = button.dataset.action;
      if (action === "chat") {
        onChat();
      }

      if (action === "wave") {
        onEmote("👋");
      }

      if (action === "heart") {
        onEmote("❤️");
      }

      if (action === "sparkle") {
        onEmote("✨");
      }

      if (action === "laugh") {
        onEmote("😂");
      }
    });
  });
}
