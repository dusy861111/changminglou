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
    via         TEXT,
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
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    email          TEXT UNIQUE NOT NULL,
    name           TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    salt           TEXT NOT NULL,
    paid_until     TEXT,
    created_at     TEXT NOT NULL,
    last_seen_at   TEXT,
    email_verified INTEGER NOT NULL DEFAULT 0,
    verify_token   TEXT,
    verify_expires TEXT,
    verify_sent_at TEXT,
    verify_next    TEXT
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

  CREATE TABLE IF NOT EXISTS lamp_requests (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id INTEGER NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    amount     TEXT,
    days       INTEGER NOT NULL DEFAULT 30,
    status     TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    decided_at TEXT,
    FOREIGN KEY (visitor_id) REFERENCES visitors(id)
  );

  CREATE TABLE IF NOT EXISTS ledger (
    seq        INTEGER PRIMARY KEY,
    type       TEXT NOT NULL,
    at         TEXT NOT NULL,
    payload    TEXT NOT NULL,
    prev_hash  TEXT NOT NULL,
    hash       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS gate_posts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id   INTEGER NOT NULL,
    kind          TEXT NOT NULL DEFAULT 'invite',
    body          TEXT NOT NULL,
    link          TEXT,
    created_at    TEXT NOT NULL,
    hidden_at     TEXT,
    hidden_reason TEXT,
    FOREIGN KEY (resident_id) REFERENCES residents(id)
  );

  CREATE TABLE IF NOT EXISTS moderation (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    at          TEXT NOT NULL,
    action      TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id   INTEGER NOT NULL,
    reason      TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    actor       TEXT NOT NULL DEFAULT '守夜人'
  );

  CREATE INDEX IF NOT EXISTS idx_posts_floor ON posts(floor_id);
  CREATE INDEX IF NOT EXISTS idx_signs_day ON signs(day);
  CREATE INDEX IF NOT EXISTS idx_visitor_days ON visitor_days(visitor_id, day);
  CREATE INDEX IF NOT EXISTS idx_lamp_requests_status ON lamp_requests(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_gate_created ON gate_posts(created_at);
  CREATE INDEX IF NOT EXISTS idx_moderation_created ON moderation(at);
`);

// 老数据库迁移：给 residents 补 via（来路）
const residentColumns = db.prepare('PRAGMA table_info(residents)').all();
if (!residentColumns.some((column) => column.name === 'via')) {
  db.exec('ALTER TABLE residents ADD COLUMN via TEXT');
}

// 老数据库迁移：访客邮箱验证字段；已注册的老账号视为已验证，不锁门
const visitorColumns = db.prepare('PRAGMA table_info(visitors)').all();
if (!visitorColumns.some((column) => column.name === 'email_verified')) {
  db.exec(`ALTER TABLE visitors ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
           ALTER TABLE visitors ADD COLUMN verify_token TEXT;
           ALTER TABLE visitors ADD COLUMN verify_expires TEXT;
           ALTER TABLE visitors ADD COLUMN verify_sent_at TEXT;`);
  db.exec('UPDATE visitors SET email_verified = 1');
}
const visitorColumns2 = db.prepare('PRAGMA table_info(visitors)').all();
if (!visitorColumns2.some((column) => column.name === 'verify_next')) {
  db.exec('ALTER TABLE visitors ADD COLUMN verify_next TEXT');
}

// 老数据库迁移：楼层/回帖的隐藏标记（审核记录公开，内容本身不再展示）
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('floors', 'hidden_at', 'TEXT');
ensureColumn('floors', 'hidden_reason', 'TEXT');
ensureColumn('posts', 'hidden_at', 'TEXT');
ensureColumn('posts', 'hidden_reason', 'TEXT');

// 来路明细：自己填的“谁带来的”，以及入住请求的入口来源
ensureColumn('residents', 'brought_by', 'TEXT');
ensureColumn('residents', 'arrival_referer', 'TEXT');
ensureColumn('residents', 'arrival_ua', 'TEXT');
ensureColumn('residents', 'arrival_host', 'TEXT');

export const nowISO = () => new Date().toISOString();

export function today() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
