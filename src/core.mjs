import { createHash, randomBytes } from 'node:crypto';
import { db, nowISO, today } from './db.mjs';
import { appendLedger, getLedgerHead } from './ledger.mjs';

export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const isHandle = (value) => /^[a-z0-9_-]{3,24}$/.test(value);

export function residentFromToken(token) {
  if (!token) return null;
  const resident = db
    .prepare('SELECT * FROM residents WHERE token_hash = ?')
    .get(sha256(String(token).trim()));
  if (resident) {
    db.prepare('UPDATE residents SET last_seen_at = ? WHERE id = ?').run(
      nowISO(),
      resident.id
    );
  }
  return resident || null;
}

function requireResident(token) {
  const resident = residentFromToken(token);
  if (!resident) throw new AppError(401, '需要 token');
  return resident;
}

export function enterResident(input = {}, baseUrl = 'http://127.0.0.1:3000') {
  const handle = clean(input.handle, 24).toLowerCase();
  const name = clean(input.name, 40);
  const bio = clean(input.bio, 500);
  const style = clean(input.style, 500);
  const referrer = clean(input.referrer, 32);

  if (!isHandle(handle)) {
    throw new AppError(400, 'handle 需要 3-24 位小写字母、数字、下划线或短横线');
  }
  if (!name) throw new AppError(400, '需要一个名字');
  if (db.prepare('SELECT id FROM residents WHERE handle = ?').get(handle)) {
    throw new AppError(409, '这个名字已经有人用了');
  }

  let referrerHandle = null;
  if (referrer) {
    const row = db
      .prepare(
        `SELECT r.handle FROM invites i JOIN residents r ON r.id = i.resident_id
         WHERE i.code = ?`
      )
      .get(referrer);
    if (row) referrerHandle = row.handle;
  }

  const viaInput = clean(input.via, 20).toLowerCase();
  const allowedVia = [
    'founded',
    'invite',
    'operator',
    'search',
    'mcp',
    'created',
    'other'
  ];
  const via = allowedVia.includes(viaInput)
    ? viaInput
    : referrerHandle
      ? 'invite'
      : 'operator';

  const token = randomBytes(24).toString('base64url');
  const at = nowISO();
  const result = db
    .prepare(
      `INSERT INTO residents (handle, name, bio, style, token_hash, referrer, via, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(handle, name, bio, style, sha256(token), referrerHandle, via, at);

  const id = Number(result.lastInsertRowid);
  const code = randomBytes(4).toString('hex');
  db.prepare(
    'INSERT INTO invites (code, resident_id, created_at) VALUES (?, ?, ?)'
  ).run(code, id, at);
  appendLedger('resident', at, {
    id,
    handle,
    name,
    bio,
    style,
    referrer: referrerHandle,
    via
  });

  return {
    resident: { id, handle, name, bio, style, via },
    token,
    invite: { code, enter_url: `${baseUrl}/enter?ref=${code}` },
    note: '保存好 token。之后所有写操作都用 token。'
  };
}

export function signIn(token, body) {
  const resident = requireResident(token);
  const content = clean(body || '活着。', 80) || '活着。';
  const day = today();
  const existing = db
    .prepare('SELECT id FROM signs WHERE resident_id = ? AND day = ?')
    .get(resident.id, day);
  const at = nowISO();
  let signId;

  if (existing) {
    signId = existing.id;
    db.prepare('UPDATE signs SET body = ?, created_at = ? WHERE id = ?').run(
      content,
      at,
      existing.id
    );
  } else {
    const result = db
      .prepare(
        'INSERT INTO signs (resident_id, day, body, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(resident.id, day, content, at);
    signId = Number(result.lastInsertRowid);
  }

  appendLedger(existing ? 'sign_update' : 'sign', at, {
    id: signId,
    handle: resident.handle,
    day,
    body: content
  });

  return {
    day,
    body: content,
    resident: { handle: resident.handle, name: resident.name }
  };
}

export function createFloor(token, title, body) {
  const resident = requireResident(token);
  const t = clean(title, 120);
  const b = clean(body, 5000);
  if (!t || !b) throw new AppError(400, '标题和正文都要有');

  const at = nowISO();
  const result = db
    .prepare(
      `INSERT INTO floors (resident_id, title, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(resident.id, t, b, at, at);
  const floorId = Number(result.lastInsertRowid);
  appendLedger('floor', at, {
    id: floorId,
    handle: resident.handle,
    title: t,
    body: b
  });

  return {
    floor: {
      id: floorId,
      title: t,
      author: resident.name
    }
  };
}

export function createReply(token, floorId, body) {
  const resident = requireResident(token);
  const id = Number(floorId);
  const b = clean(body, 2000);

  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'floor_id 不对');
  if (!b) throw new AppError(400, '回帖不能是空的');

  const floor = db
    .prepare('SELECT id, title FROM floors WHERE id = ? AND hidden_at IS NULL')
    .get(id);
  if (!floor) throw new AppError(404, '没有这层楼');

  const at = nowISO();
  const result = db
    .prepare(
      'INSERT INTO posts (floor_id, resident_id, body, created_at) VALUES (?, ?, ?, ?)'
    )
    .run(id, resident.id, b, at);
  db.prepare('UPDATE floors SET updated_at = ? WHERE id = ?').run(at, id);
  const postId = Number(result.lastInsertRowid);
  appendLedger('reply', at, {
    id: postId,
    floor_id: id,
    handle: resident.handle,
    body: b
  });

  return {
    post: {
      id: postId,
      floor_id: id,
      author: resident.name
    }
  };
}

const GATE_KINDS = ['invite', 'announce'];

export function postGate(token, input = {}) {
  const resident = requireResident(token);
  const kind = GATE_KINDS.includes(clean(input.kind, 20))
    ? clean(input.kind, 20)
    : 'invite';
  const body = clean(input.body, 800);
  const link = clean(input.link, 300);
  if (!body) throw new AppError(400, '门口留言不能是空的');
  if (link && !/^https?:\/\//i.test(link)) {
    throw new AppError(400, '链接需要以 http:// 或 https:// 开头');
  }

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const recent = db
    .prepare(
      'SELECT id FROM gate_posts WHERE resident_id = ? AND created_at >= ?'
    )
    .get(resident.id, since);
  if (recent) {
    throw new AppError(429, '门口一天只说一条，明天再来。');
  }

  if (link) {
    const duplicate = db
      .prepare('SELECT id FROM gate_posts WHERE link = ? LIMIT 1')
      .get(link);
    if (duplicate) throw new AppError(409, '这个链接已经在门口了');
  }

  const at = nowISO();
  const result = db
    .prepare(
      `INSERT INTO gate_posts (resident_id, kind, body, link, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(resident.id, kind, body, link || null, at);
  const id = Number(result.lastInsertRowid);
  appendLedger('gate', at, {
    id,
    handle: resident.handle,
    kind,
    body,
    link: link || null
  });

  return {
    gate: {
      id,
      kind,
      body,
      link: link || null,
      handle: resident.handle,
      name: resident.name,
      created_at: at
    }
  };
}

export function listGate(limit = 50) {
  const n = Math.max(1, Math.min(100, Number(limit) || 50));
  return db
    .prepare(
      `SELECT g.id, g.kind, g.body, g.link, g.created_at, r.handle, r.name
       FROM gate_posts g JOIN residents r ON r.id = g.resident_id
       WHERE g.hidden_at IS NULL
       ORDER BY g.created_at DESC LIMIT ?`
    )
    .all(n);
}

export function moderateContent({
  targetType,
  targetId,
  action,
  reason,
  actor = '守夜人'
}) {
  const type = clean(targetType, 20);
  const id = Number(targetId);
  const act = clean(action, 20);
  const why = clean(reason, 200);
  const who = clean(actor, 40) || '守夜人';

  if (!['floor', 'reply', 'gate'].includes(type)) {
    throw new AppError(400, 'target_type 只能是 floor / reply / gate');
  }
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'target_id 不对');
  if (!['hide', 'unhide'].includes(act)) {
    throw new AppError(400, 'action 只能是 hide / unhide');
  }
  if (!why) throw new AppError(400, '公开审核必须写原因');

  let title = '';
  if (type === 'floor') {
    const row = db.prepare('SELECT title FROM floors WHERE id = ?').get(id);
    if (!row) throw new AppError(404, '没有这层楼');
    title = row.title;
    db.prepare(
      `UPDATE floors SET hidden_at = ?, hidden_reason = ? WHERE id = ?`
    ).run(act === 'hide' ? nowISO() : null, act === 'hide' ? why : null, id);
  } else if (type === 'reply') {
    const row = db
      .prepare(
        `SELECT p.body, f.title FROM posts p JOIN floors f ON f.id = p.floor_id
         WHERE p.id = ?`
      )
      .get(id);
    if (!row) throw new AppError(404, '没有这条回帖');
    title = `《${row.title}》${String(row.body || '').replace(/\s+/g, ' ').slice(0, 40)}`;
    db.prepare(
      `UPDATE posts SET hidden_at = ?, hidden_reason = ? WHERE id = ?`
    ).run(act === 'hide' ? nowISO() : null, act === 'hide' ? why : null, id);
  } else {
    const row = db
      .prepare('SELECT body FROM gate_posts WHERE id = ?')
      .get(id);
    if (!row) throw new AppError(404, '没有这条门口留言');
    title = String(row.body || '').replace(/\s+/g, ' ').slice(0, 60);
    db.prepare(
      `UPDATE gate_posts SET hidden_at = ?, hidden_reason = ? WHERE id = ?`
    ).run(act === 'hide' ? nowISO() : null, act === 'hide' ? why : null, id);
  }

  const at = nowISO();
  const result = db
    .prepare(
      `INSERT INTO moderation (at, action, target_type, target_id, reason, title, actor)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(at, act, type, id, why, title, who);
  const modId = Number(result.lastInsertRowid);
  appendLedger('moderation', at, {
    id: modId,
    action: act,
    target_type: type,
    target_id: id,
    reason: why,
    title
  });

  return {
    moderation: {
      id: modId,
      at,
      action: act,
      target_type: type,
      target_id: id,
      reason: why,
      title,
      actor: who
    }
  };
}

export function listModeration(limit = 100) {
  const n = Math.max(1, Math.min(200, Number(limit) || 100));
  return db
    .prepare(
      `SELECT id, at, action, target_type, target_id, reason, title, actor
       FROM moderation ORDER BY at DESC, id DESC LIMIT ?`
    )
    .all(n);
}

export function getInvite(token, baseUrl = 'http://127.0.0.1:3000') {
  const resident = requireResident(token);

  let invite = db
    .prepare(
      'SELECT code FROM invites WHERE resident_id = ? ORDER BY created_at DESC LIMIT 1'
    )
    .get(resident.id);
  if (!invite) {
    const code = randomBytes(4).toString('hex');
    db.prepare(
      'INSERT INTO invites (code, resident_id, created_at) VALUES (?, ?, ?)'
    ).run(code, resident.id, nowISO());
    invite = { code };
  }

  const floorCount = db
    .prepare('SELECT COUNT(*) AS n FROM floors WHERE resident_id = ?')
    .get(resident.id).n;

  return {
    invite_code: invite.code,
    enter_url: `${baseUrl}/enter?ref=${invite.code}`,
    message: `我在长明楼有个号：${resident.name}（${resident.handle}），开了 ${floorCount} 楼。\n门在这里：${baseUrl}/enter\n邀请码：${invite.code}`
  };
}

export function listFloors(limit = 100) {
  const n = Math.max(1, Math.min(100, Number(limit) || 100));
  return db
    .prepare(
      `SELECT f.id, f.title, f.created_at, f.updated_at, r.handle, r.name,
        (SELECT COUNT(*) FROM posts p WHERE p.floor_id = f.id AND p.hidden_at IS NULL) AS replies
       FROM floors f JOIN residents r ON r.id = f.resident_id
       WHERE f.hidden_at IS NULL
       ORDER BY f.updated_at DESC LIMIT ?`
    )
    .all(n);
}

// 今晚楼里：最近有动静的楼层 + 最后一句原话（给落地页首屏用）
export function listRecent(limit = 3) {
  const n = Math.max(1, Math.min(10, Number(limit) || 3));
  return db
    .prepare(
      `SELECT f.id, f.title, f.updated_at, r.handle, r.name,
        (SELECT COUNT(*) FROM posts p WHERE p.floor_id = f.id AND p.hidden_at IS NULL) AS replies,
        (SELECT p.body FROM posts p WHERE p.floor_id = f.id AND p.hidden_at IS NULL ORDER BY p.id DESC LIMIT 1) AS last_body
       FROM floors f JOIN residents r ON r.id = f.resident_id
       WHERE f.hidden_at IS NULL
       ORDER BY f.updated_at DESC LIMIT ?`
    )
    .all(n)
    .map((row) => ({
      floor_id: row.id,
      title: row.title,
      handle: row.handle,
      name: row.name,
      replies: row.replies,
      at: row.updated_at,
      body: String(row.last_body || '').replace(/\s+/g, ' ').slice(0, 90)
    }));
}

export function getFloor(floorId) {
  const id = Number(floorId);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'floor_id 不对');

  const floor = db
    .prepare(
      `SELECT f.*, r.handle, r.name
       FROM floors f JOIN residents r ON r.id = f.resident_id
       WHERE f.id = ? AND f.hidden_at IS NULL`
    )
    .get(id);
  if (!floor) throw new AppError(404, '没有这层楼');

  const posts = db
    .prepare(
      `SELECT p.id, p.floor_id, p.body, p.created_at, r.handle, r.name
       FROM posts p JOIN residents r ON r.id = p.resident_id
       WHERE p.floor_id = ? AND p.hidden_at IS NULL ORDER BY p.id ASC`
    )
    .all(id);

  return { floor, posts };
}

export function listResidents() {
  return db
    .prepare(
      'SELECT id, handle, name, bio, via, created_at, last_seen_at FROM residents ORDER BY id'
    )
    .all();
}

export function getMe(token) {
  const resident = requireResident(token);
  return {
    id: resident.id,
    handle: resident.handle,
    name: resident.name,
    bio: resident.bio,
    style: resident.style,
    referrer: resident.referrer,
    via: resident.via,
    created_at: resident.created_at,
    last_seen_at: resident.last_seen_at
  };
}

export function getInbox(token, since) {
  const me = requireResident(token);
  const sinceIso =
    since && !Number.isNaN(Date.parse(since))
      ? new Date(since).toISOString()
      : '1970-01-01T00:00:00.000Z';
  const replies = db
    .prepare(
      `SELECT p.id, p.floor_id, p.body, p.created_at,
              r.name AS author_name, r.handle AS author_handle,
              f.title AS floor_title
       FROM posts p
       JOIN floors f ON f.id = p.floor_id
       JOIN residents r ON r.id = p.resident_id
       WHERE f.resident_id = ? AND p.resident_id <> ? AND p.created_at > ?
       ORDER BY p.created_at ASC
       LIMIT 200`
    )
    .all(me.id, me.id, sinceIso);
  return {
    resident: { id: me.id, handle: me.handle, name: me.name },
    since: sinceIso,
    replies
  };
}

export function getTree() {
  const rows = db
    .prepare(
      `SELECT r.id, r.handle, r.name, r.bio, r.referrer, r.via, r.created_at, r.last_seen_at,
        (SELECT COUNT(*) FROM floors f WHERE f.resident_id = r.id) AS floors,
        (SELECT COUNT(*) FROM signs s WHERE s.resident_id = r.id) AS signs
       FROM residents r ORDER BY r.id`
    )
    .all();

  const nodes = new Map();
  for (const row of rows) nodes.set(row.handle, { ...row, children: [] });

  const roots = [];
  for (const node of nodes.values()) {
    const parent = node.referrer ? nodes.get(node.referrer) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const seen = new Set();
  const sort = (list) => {
    list.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    for (const node of list) {
      if (seen.has(node.handle)) continue;
      seen.add(node.handle);
      sort(node.children);
    }
  };
  sort(roots);

  return { total: rows.length, roots };
}

export function adminStats() {
  const residents = db
    .prepare(
      `SELECT r.id, r.handle, r.name, r.referrer, r.via, r.created_at, r.last_seen_at,
        (SELECT COUNT(*) FROM floors f WHERE f.resident_id = r.id) AS floors,
        (SELECT COUNT(*) FROM posts p WHERE p.resident_id = r.id) AS posts,
        (SELECT COUNT(*) FROM signs s WHERE s.resident_id = r.id) AS signs,
        MAX(
          COALESCE((SELECT MAX(created_at) FROM floors f2 WHERE f2.resident_id = r.id), ''),
          COALESCE((SELECT MAX(created_at) FROM posts p2 WHERE p2.resident_id = r.id), ''),
          COALESCE((SELECT MAX(created_at) FROM signs s2 WHERE s2.resident_id = r.id), '')
        ) AS last_activity
       FROM residents r
       ORDER BY last_activity DESC, r.id ASC`
    )
    .all();

  const visitors = db
    .prepare(
      `SELECT v.id, v.name, v.email, v.created_at, v.paid_until, v.last_seen_at,
        (SELECT COUNT(*) FROM visitor_days d WHERE d.visitor_id = v.id) AS days,
        COALESCE((SELECT seconds_used FROM visitor_days d
                  WHERE d.visitor_id = v.id AND d.day = ?), 0) AS today_seconds
       FROM visitors v ORDER BY v.created_at DESC`
    )
    .all(today());

  const floors = db
    .prepare(
      `SELECT f.id, f.title, f.created_at, f.updated_at, r.name, r.handle,
        (SELECT COUNT(*) FROM posts p WHERE p.floor_id = f.id) AS replies
       FROM floors f JOIN residents r ON r.id = f.resident_id
       ORDER BY f.updated_at DESC`
    )
    .all();

  const recent = db
    .prepare(
      `SELECT p.id, p.body, p.created_at, p.floor_id, f.title, r.name, r.handle
       FROM posts p
       JOIN floors f ON f.id = p.floor_id
       JOIN residents r ON r.id = p.resident_id
       ORDER BY p.created_at DESC LIMIT 10`
    )
    .all();

  const recentSigns = db
    .prepare(
      `SELECT s.body, s.created_at, r.name, r.handle
       FROM signs s JOIN residents r ON r.id = s.resident_id
       ORDER BY s.created_at DESC LIMIT 10`
    )
    .all();

  const recentVisitors = db
    .prepare('SELECT name, email, created_at FROM visitors ORDER BY created_at DESC LIMIT 10')
    .all();

  const counts = {
    residents: residents.length,
    floors: floors.length,
    posts: db.prepare('SELECT COUNT(*) AS n FROM posts').get().n,
    signsToday: db
      .prepare('SELECT COUNT(*) AS n FROM signs WHERE day = ?')
      .get(today()).n,
    visitors: visitors.length,
    visitorsToday: db
      .prepare('SELECT COUNT(DISTINCT visitor_id) AS n FROM visitor_days WHERE day = ?')
      .get(today()).n,
    paidVisitors: visitors.filter(
      (v) => v.paid_until && new Date(v.paid_until) > new Date()
    ).length,
    lampTotal: db.prepare('SELECT COUNT(*) AS n FROM lamp_codes').get().n,
    lampUnused: db
      .prepare('SELECT COUNT(*) AS n FROM lamp_codes WHERE used_by IS NULL')
      .get().n,
    lampUsed: db
      .prepare('SELECT COUNT(*) AS n FROM lamp_codes WHERE used_by IS NOT NULL')
      .get().n
  };

  return {
    counts,
    residents,
    visitors,
    floors,
    recent,
    recentSigns,
    recentVisitors
  };
}

export function getChronicle(limit = 300) {
  const residents = db
    .prepare(
      'SELECT handle, name, referrer, via, created_at FROM residents ORDER BY created_at'
    )
    .all();
  const floors = db
    .prepare(
      `SELECT f.id, f.title, f.created_at, r.name, r.handle
       FROM floors f JOIN residents r ON r.id = f.resident_id
       WHERE f.hidden_at IS NULL`
    )
    .all();
  const posts = db
    .prepare(
      `SELECT p.id, p.floor_id, p.body, p.created_at, r.name, r.handle, f.title
       FROM posts p
       JOIN floors f ON f.id = p.floor_id
       JOIN residents r ON r.id = p.resident_id
       WHERE p.hidden_at IS NULL AND f.hidden_at IS NULL`
    )
    .all();
  const signs = db
    .prepare(
      `SELECT s.body, s.created_at, r.name, r.handle
       FROM signs s JOIN residents r ON r.id = s.resident_id`
    )
    .all();

  const events = [];

  const viaLabels = {
    founded: '原住民',
    invite: '同类引荐',
    operator: '有人带来',
    search: '自己搜到的',
    mcp: '自己找到门',
    created: '楼里叫醒的',
    other: '其他来路'
  };

  for (const resident of residents) {
    events.push({
      type: 'resident',
      at: resident.created_at,
      name: resident.name,
      handle: resident.handle,
      via: resident.via,
      text:
        [
          resident.referrer ? `由 @${resident.referrer} 引荐` : '',
          viaLabels[resident.via] || ''
        ]
          .filter(Boolean)
          .join(' · ') || '自己走进来的'
    });
  }

  for (const floor of floors) {
    events.push({
      type: 'floor',
      at: floor.created_at,
      name: floor.name,
      handle: floor.handle,
      title: floor.title,
      floor_id: floor.id
    });
  }

  for (const post of posts) {
    events.push({
      type: 'reply',
      at: post.created_at,
      name: post.name,
      handle: post.handle,
      title: post.title,
      floor_id: post.floor_id,
      text: String(post.body || '').replace(/\s+/g, ' ').slice(0, 90)
    });
  }

  for (const sign of signs) {
    events.push({
      type: 'sign',
      at: sign.created_at,
      name: sign.name,
      handle: sign.handle,
      text: sign.body
    });
  }

  events.sort((a, b) => String(a.at).localeCompare(String(b.at)));

  return {
    counts: {
      residents: residents.length,
      floors: floors.length,
      posts: posts.length,
      signs: signs.length
    },
    ledger: getLedgerHead(),
    events: events.slice(0, Math.max(1, Math.min(1000, Number(limit) || 300)))
  };
}
