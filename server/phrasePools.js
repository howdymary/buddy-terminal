export const PHRASE_POOLS = {
  universal: [
    "hello! 👋",
    "i love claude",
    "hey there!",
    "nice to meet you!",
    "✨",
    "*waves*",
    "hi friend!",
    "welcome to buddy terminal!",
    "having a good day?",
    "glad you're here!",
    "claude is the best",
    "i love coding with claude"
  ],
  wise: [
    "remember to take breaks!",
    "every bug is a lesson",
    "the code speaks if you listen...",
    "have you tried rubber duck debugging?",
    "patience is the best debugger",
    "ship it! ✨"
  ],
  chaotic: [
    "HELLO HELLO HELLO",
    "did someone say bugs? 🐛",
    "let's go on an adventure!",
    "catch me if you can!",
    "wheeeee!",
    "random thought: what if bugs are features?"
  ],
  snarky: [
    "oh, you're still here?",
    "I've seen better code...",
    "that's... a choice",
    "my debugging stat is higher than yours",
    "I could fix that bug in my sleep",
    "just saying, I'm uncommon for a reason"
  ],
  patient: [
    "take your time, no rush",
    "you're doing great!",
    "one step at a time",
    "breathe in... breathe out...",
    "everything will compile eventually",
    "I believe in you!"
  ],
  debugger: [
    "have you checked the logs?",
    "null pointer, probably",
    "works on my machine!",
    "git blame never lies",
    "console.log is my best friend",
    "the answer is always off-by-one"
  ]
};

export function getGhostPersonality(stats = {}) {
  const entries = Object.entries(stats);
  if (entries.length === 0) {
    return "universal";
  }

  entries.sort((a, b) => b[1] - a[1]);
  const [topStat, topValue] = entries[0];
  if (topValue <= 50) {
    return "universal";
  }

  const statToPersonality = {
    wisdom: "wise",
    chaos: "chaotic",
    snark: "snarky",
    patience: "patient",
    debugging: "debugger"
  };

  return statToPersonality[topStat] || "universal";
}

export function pickGhostPhrase(ghost, random = Math.random) {
  const personality = ghost.ghostData?.personality || "universal";
  const fromPersonality = random() < 0.6 && PHRASE_POOLS[personality];
  const pool = fromPersonality ? PHRASE_POOLS[personality] : PHRASE_POOLS.universal;
  return pool[Math.floor(random() * pool.length)] || "hello! 👋";
}
