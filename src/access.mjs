import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, nowISO, today, DATA_DIR } from './db.mjs';
import { loadEnv } from './env.mjs';

loadEnv();

function loadOrCreate(name, bytes = 32) {
  const path = join(DATA_DIR, name);
  try {
    const value = readFileSync(path, 'utf8').trim();
    if (value) return value;
  } catch {
    // 第一次启动，下面生成
  }
  const value = randomBytes(bytes).toString('base64url');
  writeFileSync(path, value, { mode: 0o600 });
  return value;
}

export const SESSION_SECRET =
  process.env.SESSION_SECRET || loadOrCreate('session-secret');
export const WATCHER_KEY =
  process.env.WATCHER_KEY || loadOrCreate('watcher-key');
export const FREE_SECONDS = Math.max(60, Number(process.env.FREE_SECONDS || 600));

const sign = (value) =>
  createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const raw = part.slice(index + 1).trim();
    try {
      out[key] = decodeURIComponent(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

export function setCookie(res, name, value, maxAge = 0) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (maxAge) parts.push(`Max-Age=${maxAge}`);
  if (process.env.COOKIE_SECURE === '1') parts.push('Secure');
  const cookie = parts.join('; ');
  const existing = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', existing ? [].concat(existing, cookie) : cookie);
}

export function clearCookie(res, name) {
  const cookie = `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  const existing = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', existing ? [].concat(existing, cookie) : cookie);
}

export function issueSession(visitorId) {
  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  const payload = `${visitorId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySession(value) {
  if (!value) return null;
  const parts = String(value).split('.');
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  const expected = sign(`${id}.${exp}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(exp) < Date.now()) return null;
  const visitorId = Number(id);
  return Number.isInteger(visitorId) && visitorId > 0 ? visitorId : null;
}

export function watcherCookie() {
  return sign('watcher');
}

export function isWatcher(value) {
  if (!value) return false;
  const expected = watcherCookie();
  const a = Buffer.from(String(value));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function getViewer(req) {
  const cookies = parseCookies(req);
  const watcher = isWatcher(cookies.cml_watcher);
  const visitorId = verifySession(cookies.cml_session);
  const visitor = visitorId
    ? db.prepare('SELECT * FROM visitors WHERE id = ?').get(visitorId)
    : null;
  return { watcher, visitor: visitor || null };
}

export function statusFor(visitor) {
  if (!visitor) return null;
  const paidUntil = visitor.paid_until ? new Date(visitor.paid_until) : null;
  const paid = Boolean(paidUntil && paidUntil > new Date());
  const row = db
    .prepare('SELECT seconds_used FROM visitor_days WHERE visitor_id = ? AND day = ?')
    .get(visitor.id, today());
  const used = Number(row?.seconds_used || 0);
  return {
    paid,
    paidUntil: visitor.paid_until,
    used,
    remaining: Math.max(0, FREE_SECONDS - used),
    freeSeconds: FREE_SECONDS
  };
}

const lastBeat = new Map();

export function addSeconds(visitorId, seconds) {
  const now = Date.now();
  const last = lastBeat.get(visitorId) || 0;
  if (last && now - last < 5000) return;
  lastBeat.set(visitorId, now);

  const value = Math.max(0, Math.min(30, Math.round(Number(seconds) || 0)));
  if (!value) return;
  db.prepare(
    `INSERT INTO visitor_days (visitor_id, day, seconds_used) VALUES (?, ?, ?)
     ON CONFLICT(visitor_id, day) DO UPDATE
     SET seconds_used = seconds_used + excluded.seconds_used`
  ).run(visitorId, today(), value);
  db.prepare('UPDATE visitors SET last_seen_at = ? WHERE id = ?').run(
    nowISO(),
    visitorId
  );
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function registerVisitor(input = {}) {
  const email = String(input.email || '').trim().toLowerCase();
  const name = String(input.name || '').trim().slice(0, 40);
  const password = String(input.password || '');

  if (!EMAIL_RE.test(email)) throw new Error('邮箱格式不对');
  if (!name) throw new Error('需要一个名字');
  if (password.length < 6) throw new Error('密码至少 6 位');
  if (db.prepare('SELECT id FROM visitors WHERE email = ?').get(email)) {
    throw new Error('这个邮箱已经注册过');
  }

  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  const result = db
    .prepare(
      `INSERT INTO visitors (email, name, password_hash, salt, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(email, name, hash, salt, nowISO());

  return db
    .prepare('SELECT * FROM visitors WHERE id = ?')
    .get(Number(result.lastInsertRowid));
}

export function loginVisitor(emailInput, passwordInput) {
  const email = String(emailInput || '').trim().toLowerCase();
  const password = String(passwordInput || '');
  const visitor = db
    .prepare('SELECT * FROM visitors WHERE email = ?')
    .get(email);
  if (!visitor) throw new Error('邮箱或密码不对');

  const candidate = scryptSync(password, visitor.salt, 64);
  const expected = Buffer.from(visitor.password_hash, 'hex');
  if (
    candidate.length !== expected.length ||
    !timingSafeEqual(candidate, expected)
  ) {
    throw new Error('邮箱或密码不对');
  }

  db.prepare('UPDATE visitors SET last_seen_at = ? WHERE id = ?').run(
    nowISO(),
    visitor.id
  );
  return visitor;
}

export function getVisitorById(id) {
  return db.prepare('SELECT * FROM visitors WHERE id = ?').get(id) || null;
}

export function createLampCodes(days = 30, count = 1) {
  const out = [];
  const d = Math.max(1, Math.min(3650, Math.round(Number(days) || 30)));
  const n = Math.max(1, Math.min(100, Math.round(Number(count) || 1)));
  for (let i = 0; i < n; i += 1) {
    const code = `LAMP-${randomBytes(4).toString('hex').toUpperCase()}`;
    db.prepare(
      'INSERT INTO lamp_codes (code, days, created_at) VALUES (?, ?, ?)'
    ).run(code, d, nowISO());
    out.push(code);
  }
  return out;
}

export function redeemLampCode(codeInput, visitorId) {
  const code = String(codeInput || '').trim().toUpperCase();
  const row = db.prepare('SELECT * FROM lamp_codes WHERE code = ?').get(code);
  if (!row) throw new Error('没有这个灯油码');
  if (row.used_by) throw new Error('这个灯油码已经用过了');

  const visitor = getVisitorById(visitorId);
  if (!visitor) throw new Error('先登录');

  const now = new Date();
  const current = visitor.paid_until ? new Date(visitor.paid_until) : null;
  const base = current && current > now ? current : now;
  const until = new Date(base.getTime() + row.days * 86400000).toISOString();

  db.prepare('UPDATE visitors SET paid_until = ? WHERE id = ?').run(
    until,
    visitorId
  );
  db.prepare(
    'UPDATE lamp_codes SET used_by = ?, used_at = ? WHERE code = ?'
  ).run(visitorId, nowISO(), code);

  return { until, days: row.days };
}
