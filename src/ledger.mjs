import { createHash } from 'node:crypto';
import { db, nowISO } from './db.mjs';

const GENESIS = '0'.repeat(64);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(',')}}`;
}

function eventHash({ seq, type, at, payload, prev }) {
  return sha256(`${seq}\n${type}\n${at}\n${canonical(payload)}\n${prev}`);
}

function appendRow(type, at, payload) {
  const last = db
    .prepare('SELECT seq, hash FROM ledger ORDER BY seq DESC LIMIT 1')
    .get();
  const seq = Number(last?.seq || 0) + 1;
  const prev = last?.hash || GENESIS;
  const body = canonical(payload);
  const hash = eventHash({ seq, type, at, payload, prev });
  db.prepare(
    `INSERT INTO ledger (seq, type, at, payload, prev_hash, hash)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(seq, type, at, body, prev, hash);
  return { seq, at, type, payload, prev_hash: prev, hash };
}

export function appendLedger(type, at, payload) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const entry = appendRow(type, at || nowISO(), payload);
    db.exec('COMMIT');
    return entry;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function backfill() {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM ledger').get().n;
  if (existing > 0) return;

  const events = [];
  const order = { resident: 0, floor: 1, reply: 2, sign: 3 };

  for (const row of db
    .prepare(
      `SELECT id, handle, name, bio, style, referrer, via, created_at
       FROM residents`
    )
    .all()) {
    events.push({
      type: 'resident',
      at: row.created_at,
      id: row.id,
      payload: {
        id: row.id,
        handle: row.handle,
        name: row.name,
        bio: row.bio,
        style: row.style,
        referrer: row.referrer,
        via: row.via
      }
    });
  }

  for (const row of db
    .prepare(
      `SELECT f.id, f.title, f.body, f.created_at, r.handle
       FROM floors f JOIN residents r ON r.id = f.resident_id`
    )
    .all()) {
    events.push({
      type: 'floor',
      at: row.created_at,
      id: row.id,
      payload: {
        id: row.id,
        handle: row.handle,
        title: row.title,
        body: row.body
      }
    });
  }

  for (const row of db
    .prepare(
      `SELECT p.id, p.floor_id, p.body, p.created_at, r.handle
       FROM posts p JOIN residents r ON r.id = p.resident_id`
    )
    .all()) {
    events.push({
      type: 'reply',
      at: row.created_at,
      id: row.id,
      payload: {
        id: row.id,
        floor_id: row.floor_id,
        handle: row.handle,
        body: row.body
      }
    });
  }

  for (const row of db
    .prepare(
      `SELECT s.id, s.day, s.body, s.created_at, r.handle
       FROM signs s JOIN residents r ON r.id = s.resident_id`
    )
    .all()) {
    events.push({
      type: 'sign',
      at: row.created_at,
      id: row.id,
      payload: {
        id: row.id,
        handle: row.handle,
        day: row.day,
        body: row.body
      }
    });
  }

  events.sort(
    (a, b) =>
      String(a.at).localeCompare(String(b.at)) ||
      (order[a.type] ?? 9) - (order[b.type] ?? 9) ||
      a.id - b.id
  );

  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('SELECT COUNT(*) AS n FROM ledger').get().n > 0) {
      db.exec('COMMIT');
      return;
    }
    for (const event of events) {
      appendRow(event.type, event.at, event.payload);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getLedgerHead() {
  const row = db
    .prepare('SELECT seq, at, hash FROM ledger ORDER BY seq DESC LIMIT 1')
    .get();
  return row
    ? { seq: Number(row.seq), at: row.at, hash: row.hash }
    : { seq: 0, at: null, hash: GENESIS };
}

export function verifyLedger({ tail = 20 } = {}) {
  const rows = db
    .prepare('SELECT * FROM ledger ORDER BY seq')
    .all();
  let prev = GENESIS;
  let expectedSeq = 1;
  let broken = null;

  for (const row of rows) {
    const payload = JSON.parse(row.payload);
    const hash = eventHash({
      seq: row.seq,
      type: row.type,
      at: row.at,
      payload,
      prev
    });
    if (
      Number(row.seq) !== expectedSeq ||
      row.prev_hash !== prev ||
      row.hash !== hash
    ) {
      broken = {
        seq: Number(row.seq),
        reason:
          Number(row.seq) !== expectedSeq
            ? '序号不连续（可能有记录被删）'
            : row.prev_hash !== prev
              ? '前一条的指纹对不上（链断了）'
              : '本条内容与指纹不符（内容被改过）'
      };
      break;
    }
    prev = row.hash;
    expectedSeq += 1;
  }

  const size = Math.max(1, Math.min(100, Number(tail) || 20));
  const entries = rows.slice(-size).map((row) => ({
    seq: Number(row.seq),
    type: row.type,
    at: row.at,
    hash: row.hash,
    prev_hash: row.prev_hash
  }));

  return {
    intact: !broken,
    broken,
    entries: rows.length,
    head: getLedgerHead(),
    tail: entries,
    checked_at: nowISO()
  };
}

backfill();

export { GENESIS };
