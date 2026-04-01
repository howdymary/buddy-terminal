import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DB_PATH = path.join(__dirname, "buddy-terminal.db");

export class BuddyTerminalDb {
  constructor(dbPath = process.env.BUDDY_TERMINAL_DB_PATH || DEFAULT_DB_PATH) {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.ensureSchema();
    this.prepare();
  }

  ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ghost_buddies (
        id TEXT PRIMARY KEY,
        identity_key TEXT UNIQUE,
        player_index INTEGER NOT NULL,
        display_name TEXT NOT NULL,
        buddy_name TEXT,
        sprite_hash TEXT,
        sprite_ref TEXT NOT NULL,
        sprite_format TEXT DEFAULT 'sprite',
        rarity TEXT DEFAULT 'common',
        rarity_stars INTEGER DEFAULT 1,
        species TEXT,
        dominant_color TEXT,
        stats_json TEXT,
        personality TEXT DEFAULT 'universal',
        has_real_buddy INTEGER DEFAULT 0,
        last_x INTEGER NOT NULL,
        last_y INTEGER NOT NULL,
        last_direction TEXT DEFAULT 'down',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_active TEXT DEFAULT CURRENT_TIMESTAMP,
        total_visits INTEGER DEFAULT 1,
        is_evicted INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_ghost_position
        ON ghost_buddies(last_x, last_y)
        WHERE is_evicted = 0;

      CREATE TABLE IF NOT EXISTS sprite_cache (
        hash TEXT PRIMARY KEY,
        mime_type TEXT NOT NULL,
        meta_json TEXT,
        sprite_data BLOB NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tombstones (
        id TEXT PRIMARY KEY,
        ghost_id TEXT NOT NULL,
        buddy_name TEXT NOT NULL,
        rarity TEXT DEFAULT 'common',
        rarity_stars INTEGER DEFAULT 1,
        species TEXT,
        dominant_color TEXT,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        epitaph TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tombstones_expires
        ON tombstones(expires_at);
    `);
  }

  prepare() {
    this.upsertGhostStmt = this.db.prepare(`
      INSERT INTO ghost_buddies (
        id, identity_key, player_index, display_name, buddy_name, sprite_hash, sprite_ref, sprite_format,
        rarity, rarity_stars, species, dominant_color, stats_json, personality, has_real_buddy,
        last_x, last_y, last_direction, last_active, total_visits, is_evicted
      ) VALUES (
        @id, @identity_key, @player_index, @display_name, @buddy_name, @sprite_hash, @sprite_ref, @sprite_format,
        @rarity, @rarity_stars, @species, @dominant_color, @stats_json, @personality, @has_real_buddy,
        @last_x, @last_y, @last_direction, @last_active, @total_visits, 0
      )
      ON CONFLICT(id) DO UPDATE SET
        identity_key = excluded.identity_key,
        player_index = excluded.player_index,
        display_name = excluded.display_name,
        buddy_name = excluded.buddy_name,
        sprite_hash = excluded.sprite_hash,
        sprite_ref = excluded.sprite_ref,
        sprite_format = excluded.sprite_format,
        rarity = excluded.rarity,
        rarity_stars = excluded.rarity_stars,
        species = excluded.species,
        dominant_color = excluded.dominant_color,
        stats_json = excluded.stats_json,
        personality = excluded.personality,
        has_real_buddy = excluded.has_real_buddy,
        last_x = excluded.last_x,
        last_y = excluded.last_y,
        last_direction = excluded.last_direction,
        last_active = excluded.last_active,
        total_visits = excluded.total_visits,
        is_evicted = 0
    `);

    this.saveSpriteStmt = this.db.prepare(`
      INSERT INTO sprite_cache (hash, mime_type, meta_json, sprite_data)
      VALUES (@hash, @mime_type, @meta_json, @sprite_data)
      ON CONFLICT(hash) DO UPDATE SET
        mime_type = excluded.mime_type,
        meta_json = excluded.meta_json,
        sprite_data = excluded.sprite_data
    `);

    this.loadSpritesStmt = this.db.prepare(`
      SELECT hash, mime_type, meta_json, sprite_data
      FROM sprite_cache
      ORDER BY created_at DESC
    `);

    this.loadGhostsStmt = this.db.prepare(`
      SELECT *
      FROM ghost_buddies
      WHERE is_evicted = 0
      ORDER BY last_active DESC
      LIMIT ?
    `);

    this.findGhostByIdentityStmt = this.db.prepare(`
      SELECT *
      FROM ghost_buddies
      WHERE identity_key = ?
      LIMIT 1
    `);

    this.markEvictedStmt = this.db.prepare(`
      UPDATE ghost_buddies
      SET is_evicted = 1
      WHERE id = ?
    `);

    this.unEvictStmt = this.db.prepare(`
      UPDATE ghost_buddies
      SET is_evicted = 0,
          last_active = @last_active,
          total_visits = COALESCE(total_visits, 0) + 1
      WHERE identity_key = @identity_key
    `);

    this.countGhostsStmt = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM ghost_buddies
      WHERE is_evicted = 0
    `);

    this.oldestGhostStmt = this.db.prepare(`
      SELECT id
      FROM ghost_buddies
      WHERE is_evicted = 0
      ORDER BY last_active ASC
      LIMIT 1
    `);

    this.upsertTombstoneStmt = this.db.prepare(`
      INSERT INTO tombstones (
        id, ghost_id, buddy_name, rarity, rarity_stars, species, dominant_color,
        x, y, epitaph, created_at, expires_at
      ) VALUES (
        @id, @ghost_id, @buddy_name, @rarity, @rarity_stars, @species, @dominant_color,
        @x, @y, @epitaph, @created_at, @expires_at
      )
      ON CONFLICT(id) DO UPDATE SET
        x = excluded.x,
        y = excluded.y,
        epitaph = excluded.epitaph,
        expires_at = excluded.expires_at
    `);

    this.loadTombstonesStmt = this.db.prepare(`
      SELECT *
      FROM tombstones
      WHERE expires_at > ?
      ORDER BY created_at DESC
    `);

    this.pruneTombstonesStmt = this.db.prepare(`
      DELETE FROM tombstones
      WHERE expires_at <= ?
      RETURNING id
    `);

    this.removeTombstonesForGhostStmt = this.db.prepare(`
      DELETE FROM tombstones
      WHERE ghost_id = ?
      RETURNING id
    `);
  }

  saveSprite(hash, entry) {
    this.saveSpriteStmt.run({
      hash,
      mime_type: entry.mimeType,
      meta_json: JSON.stringify({
        kind: entry.kind ?? "sheet",
        hasRealBuddy: entry.hasRealBuddy ?? false,
        buddyMeta: entry.buddyMeta ?? null
      }),
      sprite_data: entry.buffer
    });
  }

  hydrateSprites(spriteCache) {
    for (const row of this.loadSpritesStmt.all()) {
      const meta = safeJson(row.meta_json, {});
      spriteCache.register(row.sprite_data, row.mime_type, meta, row.hash);
    }
  }

  loadGhosts(limit = 200) {
    return this.loadGhostsStmt.all(limit).map(deserializeGhostRow);
  }

  findGhostByIdentityKey(identityKey) {
    const row = this.findGhostByIdentityStmt.get(identityKey);
    return row ? deserializeGhostRow(row) : null;
  }

  upsertGhost(entity) {
    this.upsertGhostStmt.run(serializeGhostEntity(entity));
  }

  markGhostVisited(identityKey) {
    this.unEvictStmt.run({
      identity_key: identityKey,
      last_active: new Date().toISOString()
    });
  }

  enforceGhostCap(limit = 500) {
    const evictedIds = [];
    while ((this.countGhostsStmt.get().count || 0) > limit) {
      const oldest = this.oldestGhostStmt.get();
      if (!oldest?.id) {
        break;
      }
      this.markEvictedStmt.run(oldest.id);
      evictedIds.push(oldest.id);
    }
    return evictedIds;
  }

  saveTombstone(tombstone) {
    this.upsertTombstoneStmt.run({
      id: tombstone.id,
      ghost_id: tombstone.ghostId,
      buddy_name: tombstone.buddyName,
      rarity: tombstone.rarity ?? "common",
      rarity_stars: tombstone.rarityStars ?? 1,
      species: tombstone.species ?? "terminal friend",
      dominant_color: tombstone.dominantColor ?? "#9aa6a0",
      x: tombstone.x,
      y: tombstone.y,
      epitaph: tombstone.epitaph,
      created_at: tombstone.createdAt,
      expires_at: tombstone.expiresAt
    });
  }

  loadTombstones() {
    return this.loadTombstonesStmt.all(new Date().toISOString()).map((row) => ({
      id: row.id,
      ghostId: row.ghost_id,
      buddyName: row.buddy_name,
      rarity: row.rarity,
      rarityStars: row.rarity_stars,
      species: row.species,
      dominantColor: row.dominant_color,
      x: row.x,
      y: row.y,
      epitaph: row.epitaph,
      createdAt: row.created_at,
      expiresAt: row.expires_at
    }));
  }

  pruneExpiredTombstones() {
    return this.pruneTombstonesStmt.all(new Date().toISOString()).map((row) => row.id);
  }

  removeTombstonesForGhost(ghostId) {
    return this.removeTombstonesForGhostStmt.all(ghostId).map((row) => row.id);
  }
}

function serializeGhostEntity(entity) {
  return {
    id: entity.id,
    identity_key: entity.identityKey,
    player_index: entity.playerIndex,
    display_name: entity.name,
    buddy_name: entity.buddyMeta?.buddyName ?? null,
    sprite_hash: entity.spriteHash ?? null,
    sprite_ref: entity.spriteRef,
    sprite_format: entity.spriteFormat ?? "sprite",
    rarity: entity.buddyMeta?.rarity ?? "common",
    rarity_stars: entity.buddyMeta?.rarityStars ?? 1,
    species: entity.buddyMeta?.species ?? null,
    dominant_color: entity.buddyMeta?.dominantColor ?? null,
    stats_json: JSON.stringify(entity.buddyMeta?.stats ?? {}),
    personality: entity.ghostData?.personality ?? "universal",
    has_real_buddy: entity.hasRealBuddy ? 1 : 0,
    last_x: entity.x,
    last_y: entity.y,
    last_direction: entity.direction,
    last_active: new Date().toISOString(),
    total_visits: entity.totalVisits ?? 1
  };
}

function deserializeGhostRow(row) {
  return {
    id: row.id,
    identityKey: row.identity_key,
    playerIndex: row.player_index,
    name: row.display_name,
    x: row.last_x,
    y: row.last_y,
    direction: row.last_direction,
    spriteHash: row.sprite_hash,
    spriteRef: row.sprite_ref,
    spriteFormat: row.sprite_format,
    hasRealBuddy: Boolean(row.has_real_buddy),
    totalVisits: row.total_visits ?? 1,
    buddyMeta: {
      buddyName: row.buddy_name ?? row.display_name,
      rarity: row.rarity ?? "common",
      rarityStars: row.rarity_stars ?? 1,
      rarityLabel: labelForRarity(row.rarity),
      species: row.species ?? "terminal friend",
      dominantColor: row.dominant_color ?? "#79c4a0",
      stats: safeJson(row.stats_json, {})
    },
    ghostData: {
      originalPlayerId: row.id,
      createdAt: row.created_at,
      personality: row.personality ?? "universal",
      lastSpoke: 0,
      wanderTarget: null
    }
  };
}

function labelForRarity(rarity) {
  const labels = {
    common: "Common",
    uncommon: "Uncommon",
    rare: "Rare",
    epic: "Epic",
    legendary: "Legendary"
  };
  return labels[rarity] || "Common";
}

function safeJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
