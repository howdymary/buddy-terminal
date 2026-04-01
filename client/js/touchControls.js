export function bindTouchControls(root, { onMove, onLook, onChat, onEmote }) {
  const moveStick = root.querySelector('[data-stick="move"]');
  const lookStick = root.querySelector('[data-stick="look"]');
  const actionButtons = root.querySelectorAll("[data-action]");

  bindStick(moveStick, (vector) => onMove?.(vector.x, vector.y));
  bindStick(lookStick, (vector) => onLook?.(vector.x));

  actionButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const action = button.dataset.action;
      if (action === "chat") onChat?.();
      if (action === "wave") onEmote?.("👋");
      if (action === "heart") onEmote?.("❤️");
      if (action === "sparkle") onEmote?.("✨");
      if (action === "laugh") onEmote?.("😂");
    });
  });
}

function bindStick(root, onChange) {
  if (!root) {
    return;
  }

  const knob = root.querySelector(".touch-stick__knob");
  const radius = 34;

  const setFromEvent = (event) => {
    const point = getPoint(event);
    if (!point) {
      return;
    }

    const rect = root.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = point.clientX - centerX;
    const dy = point.clientY - centerY;
    const distance = Math.min(radius, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    const normalized = {
      x: Number.isFinite(angle) ? Math.cos(angle) * (distance / radius) : 0,
      y: Number.isFinite(angle) ? Math.sin(angle) * (distance / radius) : 0
    };

    if (knob) {
      knob.style.transform = `translate(${normalized.x * radius}px, ${normalized.y * radius}px)`;
    }
    onChange?.(normalized);
  };

  const reset = () => {
    if (knob) {
      knob.style.transform = "translate(0px, 0px)";
    }
    onChange?.({ x: 0, y: 0 });
  };

  root.addEventListener("touchstart", (event) => {
    event.preventDefault();
    setFromEvent(event);
  }, { passive: false });
  root.addEventListener("touchmove", (event) => {
    event.preventDefault();
    setFromEvent(event);
  }, { passive: false });
  root.addEventListener("touchend", (event) => {
    event.preventDefault();
    reset();
  }, { passive: false });
  root.addEventListener("touchcancel", reset, { passive: false });

  root.addEventListener("mousedown", (event) => {
    event.preventDefault();
    setFromEvent(event);

    const handleMove = (moveEvent) => setFromEvent(moveEvent);
    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      reset();
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  });
}

function getPoint(event) {
  if (event.touches?.[0]) {
    return event.touches[0];
  }
  if (event.changedTouches?.[0]) {
    return event.changedTouches[0];
  }
  return event;
}
