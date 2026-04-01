const MAX_MESSAGES = 50;

function formatTime(isoString) {
  if (!isoString) {
    return "";
  }

  const date = new Date(isoString);
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

export class ChatPanel {
  constructor({ root, list, status }) {
    this.root = root;
    this.list = list;
    this.status = status;
    this.entries = [];
    this.autoHideTimer = null;
  }

  setEntries(entries) {
    this.entries = entries.slice(-MAX_MESSAGES);
    this.render();
    this.bump();
  }

  addEntry(entry) {
    this.entries.push(entry);
    this.entries = this.entries.slice(-MAX_MESSAGES);
    this.render();
    this.bump();
  }

  addNotice(message) {
    this.addEntry({
      kind: "system",
      playerName: "System",
      message,
      dominantColor: "#f2d36a",
      ts: new Date().toISOString()
    });
  }

  toggle(force) {
    const shouldOpen = typeof force === "boolean"
      ? force
      : !this.root.classList.contains("open");

    this.root.classList.toggle("open", shouldOpen);
    if (shouldOpen) {
      this.bump();
    } else {
      clearTimeout(this.autoHideTimer);
    }
  }

  bump() {
    this.root.classList.add("open");
    clearTimeout(this.autoHideTimer);
    this.autoHideTimer = setTimeout(() => {
      this.root.classList.remove("open");
    }, 10_000);
  }

  render() {
    this.list.innerHTML = "";
    this.entries.forEach((entry) => {
      const row = document.createElement("div");
      row.className = `chat-line chat-line--${entry.kind || "chat"}`;

      const name = document.createElement("span");
      name.className = "chat-line__name";
      name.textContent = entry.playerName || "Explorer";
      name.style.color = entry.dominantColor || "#f2d36a";

      const text = document.createElement("span");
      text.className = "chat-line__message";
      text.textContent = entry.message || "";

      const meta = document.createElement("span");
      meta.className = "chat-line__time";
      meta.textContent = formatTime(entry.ts);

      row.append(name, text, meta);
      this.list.append(row);
    });

    this.list.scrollTop = this.list.scrollHeight;
    this.status.textContent = `${this.entries.length} recent messages`;
  }
}
