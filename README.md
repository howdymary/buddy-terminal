# Buddy Terminal

Buddy Terminal is a tiny multiplayer browser game where each player brings a Claude `/buddy` into a shared retro overworld.

Players pick a display name, upload a `/buddy` screenshot or choose a default sprite, preview the pixel-art conversion, and spawn into a Claude-themed AI campus with a neural fountain, data center, memorial garden, and glowing compute-token trails. From there they can walk around, see other players in real time, chat with speech bubbles, send emotes, show off rarity auras when the server can parse a real buddy card, collect compute tokens, and leave behind persistent ghost buddies when they disconnect.

## What it does

- Fast 2-step onboarding with random-name fallback
- Upload, drag-drop, or paste a `/buddy` screenshot
- Server-side buddy parsing with OCR-friendly metadata extraction and safe fallbacks
- Pixel sprite sheet generation for uploaded buddies
- Default buddy gallery for players without Claude Code
- Rarity aura rendering for validated uploaded buddy cards only
- Real-time multiplayer movement over WebSockets
- Authoritative collision and map bounds on the server
- Pixel-art overworld map with fences, trees, fountain, flowers, and welcome sign
- Claude-themed campus map with a data center, server-rack garden, antenna tower, and terminal benches
- Keyboard + touch controls
- Chat bubbles, quick emotes, and a scrollable chat log panel
- Server-side profanity filtering, flood detection, and rolling chat logs
- Compute token lines that spawn on campus paths and increment a per-session counter when collected
- Persistent ghost buddies backed by SQLite
- Ghost wandering, ghost wake-up on reconnect, and ghost chat reactions
- Tombstone memorials for evicted ghosts plus a memorial-garden map zone
- Spatial-interest batching for movement broadcasts
- Binary protocol for high-frequency movement updates

## Project structure

```text
buddy-terminal/
├── server/
│   ├── index.js
│   ├── gameState.js
│   ├── spatialGrid.js
│   ├── tickLoop.js
│   ├── collisionMap.js
│   ├── buddyCardParser.js
│   ├── db.js
│   ├── ghostAI.js
│   ├── ghostManager.js
│   ├── pathfinding.js
│   ├── phrasePools.js
│   ├── spriteGenerator.js
│   ├── spriteCache.js
│   ├── chatFilter.js
│   ├── chatLog.js
│   ├── protocol.js
│   ├── tokenSpawner.js
│   ├── rateLimiter.js
│   └── package.json
├── client/
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── main.js
│   │   ├── renderer.js
│   │   ├── auraRenderer.js
│   │   ├── chatBubble.js
│   │   ├── chatPanel.js
│   │   ├── input.js
│   │   ├── network.js
│   │   ├── interpolation.js
│   │   ├── spriteGen.js
│   │   ├── spriteCache.js
│   │   ├── tokenHUD.js
│   │   ├── tokenRenderer.js
│   │   ├── camera.js
│   │   ├── ghostRenderer.js
│   │   ├── onboarding.js
│   │   └── touchControls.js
│   └── assets/
│       ├── buddy-sample.svg
│       └── default-buddies/
└── README.md
```

## Run locally

```bash
cd /Users/maryliu/Projects/buddy-terminal/server
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Notes

- Uploaded images are capped at 2MB and re-processed server-side before use.
- The server validates rarity and buddy metadata from the uploaded image; clients cannot self-report aura tiers.
- Default buddies stay aura-free by design.
- Ghost state is persisted in SQLite at [buddy-terminal.db](/Users/maryliu/Projects/buddy-terminal/server/buddy-terminal.db), and uploaded custom sprites are cached there too.
- Evicted ghosts leave 24-hour tombstones that sync to clients as real world objects and fade naturally when they expire.
- Movement updates use a binary hot path, while join/state/chat messages stay JSON for readability.
