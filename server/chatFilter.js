const BLOCKED_WORDS = [
  "asshole",
  "bastard",
  "bitch",
  "cunt",
  "damn",
  "dick",
  "faggot",
  "fuck",
  "kys",
  "nigger",
  "piss",
  "rape",
  "retard",
  "shit",
  "slut",
  "stfu",
  "tranny",
  "whore"
];

const LEET_REPLACEMENTS = new Map([
  ["@", "a"],
  ["0", "o"],
  ["1", "i"],
  ["3", "e"],
  ["4", "a"],
  ["5", "s"],
  ["7", "t"],
  ["$", "s"],
  ["!", "i"]
]);

const BLOCKED_PATTERNS = BLOCKED_WORDS.map((word) => {
  const pattern = word
    .split("")
    .map((char) => {
      const alternates = [escapeRegex(char)];
      for (const [leet, plain] of LEET_REPLACEMENTS.entries()) {
        if (plain === char) {
          alternates.push(escapeRegex(leet));
        }
      }
      return `[${alternates.join("")}]`;
    })
    .join("");

  return new RegExp(pattern, "giu");
});

export function sanitizeChatMessage(message) {
  const raw = typeof message === "string" ? message : "";
  const stripped = raw
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  if (!stripped) {
    return { ok: false, reason: "empty" };
  }

  let cleaned = stripped;
  for (const pattern of BLOCKED_PATTERNS) {
    cleaned = cleaned.replace(pattern, (match) => "★".repeat(match.length));
  }

  const starCount = (cleaned.match(/★/g) || []).length;
  const starRatio = cleaned.length > 0 ? starCount / cleaned.length : 0;

  if (starRatio > 0.6) {
    return { ok: false, reason: "shadow_drop" };
  }

  return {
    ok: true,
    cleaned,
    hadProfanity: cleaned !== stripped
  };
}

export function isFlooding(previousMessages, nextMessage) {
  if (!nextMessage || previousMessages.length < 2) {
    return false;
  }

  const normalizedNext = normalizeMessage(nextMessage);
  const recent = previousMessages.slice(-2).map(normalizeMessage);
  return recent.every((entry) => similarity(entry, normalizedNext) >= 0.92);
}

function normalizeMessage(message) {
  return message.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function similarity(a, b) {
  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) {
    return 1;
  }

  const distance = levenshtein(a, b);
  return 1 - distance / maxLength;
}

function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i += 1) {
    matrix[i][0] = i;
  }

  for (let j = 0; j <= b.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
