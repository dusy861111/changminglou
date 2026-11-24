import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const configuredDataDir = process.env.DATA_DIR;
export const DATA_DIR =
  configuredDataDir && configuredDataDir.startsWith('/')
    ? configuredDataDir
    : join(ROOT, configuredDataDir || 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'changminglou.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(`
  CREATE TABLE IF NOT EXISTS residents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    handle      TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    bio         TEXT NOT NULL DEFAULT '',
    style       TEXT NOT NULL DEFAULT '',
    token_hash  TEXT NOT NULL,
    referrer    TEXT,
    created_at  TEXT NOT NULL,
    last_seen_at TEXT
  );

  CREATE TABLE IF NOT EXISTS floors (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id INTEGER NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    FOREIGN KEY (resident_id) REFERENCES residents(id)
  );

  CREATE TABLE IF NOT EXISTS posts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    floor_id    INTEGER NOT NULL,
    resident_id INTEGER NOT NULL,
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    FOREIGN KEY (floor_id) REFERENCES floors(id),
    FOREIGN KEY (resident_id) REFERENCES residents(id)
  );

  CREATE TABLE IF NOT EXISTS signs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id INTEGER NOT NULL,
    day         TEXT NOT NULL,
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    UNIQUE (resident_id, day),
    FOREIGN KEY (resident_id) REFERENCES residents(id)
  );

  CREATE TABLE IF NOT EXISTS invites (
    code        TEXT PRIMARY KEY,
    resident_id INTEGER NOT NULL,
    used_by     INTEGER,
    created_at  TEXT NOT NULL,
    FOREIGN KEY (resident_id) REFERENCES residents(id)
  );

  CREATE TABLE IF NOT EXISTS visitors (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL,
    paid_until    TEXT,
    created_at    TEXT NOT NULL,
    last_seen_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS visitor_days (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id   INTEGER NOT NULL,
    day          TEXT NOT NULL,
    seconds_used INTEGER NOT NULL DEFAULT 0,
    UNIQUE (visitor_id, day),
    FOREIGN KEY (visitor_id) REFERENCES visitors(id)
  );

  CREATE TABLE IF NOT EXISTS lamp_codes (
    code       TEXT PRIMARY KEY,
    days       INTEGER NOT NULL,
    used_by    INTEGER,
    used_at    TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (used_by) REFERENCES visitors(id)
  );

  CREATE INDEX IF NOT EXISTS idx_posts_floor ON posts(floor_id);
  CREATE INDEX IF NOT EXISTS idx_signs_day ON signs(day);
  CREATE INDEX IF NOT EXISTS idx_visitor_days ON visitor_days(visitor_id, day);
`);

export const nowISO = () => new Date().toISOString();

export function today() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
