import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.join(__dirname, "logs");

export class ChatLog {
  constructor() {
    this.entries = [];
    fs.mkdirSync(logsDir, { recursive: true });
  }

  record(entry) {
    const fullEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      ts: new Date().toISOString(),
      ...entry
    };

    this.entries.push(fullEntry);
    this.prune();
    fs.appendFileSync(this.currentLogPath(), `${JSON.stringify(fullEntry)}\n`);
    return fullEntry;
  }

  getRecent(limit = 50) {
    this.prune();
    return this.entries.slice(-limit);
  }

  prune() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    this.entries = this.entries.filter((entry) => Date.parse(entry.ts) >= cutoff);
  }

  currentLogPath() {
    const stamp = new Date().toISOString().slice(0, 10);
    return path.join(logsDir, `chat-${stamp}.log`);
  }
}
