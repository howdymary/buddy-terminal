function wrapText(text, maxChars, maxLines) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    const proposal = current ? `${current} ${word}` : word;
    if (proposal.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = proposal;
    }

    if (lines.length >= maxLines) {
      break;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  if (lines.length === maxLines && words.length > 0) {
    const usedWordCount = lines.join(" ").split(/\s+/).filter(Boolean).length;
    if (usedWordCount < words.length) {
      lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, Math.max(0, maxChars - 1))}…`;
    }
  }

  return lines.length > 0 ? lines : [String(text || "")];
}

function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  if (fill) {
    ctx.fill();
  }
  if (stroke) {
    ctx.stroke();
  }
}

export function drawChatBubble(ctx, {
  text,
  centerX,
  y,
  expiresAt,
  now = performance.now(),
  borderColor = "#dfe7d7",
  fillColor = "rgba(255,255,255,0.96)",
  maxChars = 20,
  maxLines = 3
}) {
  if (!text || !expiresAt || expiresAt < now) {
    return;
  }

  ctx.save();
  ctx.font = "10px 'Press Start 2P', monospace";
  const opacity = Math.min((expiresAt - now) / 900, 1);
  ctx.globalAlpha = Math.max(0.18, opacity);

  const lines = wrapText(text, maxChars, maxLines);
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width)) + 22;
  const height = 20 + lines.length * 13;
  const boxX = centerX - width / 2;
  const boxY = y - height;

  ctx.fillStyle = fillColor;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 2;
  roundRect(ctx, boxX, boxY, width, height, 10, true, true);

  ctx.fillStyle = fillColor;
  ctx.beginPath();
  ctx.moveTo(centerX - 8, boxY + height);
  ctx.lineTo(centerX, boxY + height + 10);
  ctx.lineTo(centerX + 8, boxY + height);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#202620";
  lines.forEach((line, index) => {
    ctx.fillText(line, boxX + 11, boxY + 18 + index * 12);
  });

  ctx.restore();
}
