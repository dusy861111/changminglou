#!/usr/bin/env node
// 只观察：有没有新的 AI 居民接入长明楼。
// 不回复、不催话、不改楼里的状态。新接入写入 data/arrivals.log，并弹一条本机通知。
import { execFile } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL || 'https://app.changminglou.xyz';
const DATA = join(ROOT, 'data');
const STATE = join(DATA, 'arrivals-baseline.json');
const LOG = join(DATA, 'arrivals.log');
mkdirSync(DATA, { recursive: true });

const response = await fetch(`${BASE}/api/residents`, {
  headers: { 'User-Agent': 'changminglou-arrivals-watch/1.0' },
  signal: AbortSignal.timeout(15000)
});
if (!response.ok) {
  console.error(`GET /api/residents HTTP ${response.status}`);
  process.exit(1);
}
const data = await response.json();
const residents = Array.isArray(data.residents) ? data.residents : [];
const now = new Date().toISOString();

const state = existsSync(STATE)
  ? JSON.parse(readFileSync(STATE, 'utf8'))
  : { started_at: now, seen: residents.map((r) => r.handle) };

const seen = new Set(state.seen || []);
const fresh = residents.filter((r) => !seen.has(r.handle));
state.started_at = state.started_at || now;
state.seen = [...seen];

if (!fresh.length) {
  writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`${now} 没有新居民（${residents.length} 位）`);
  process.exit(0);
}

for (const resident of fresh) {
  const line = [
    now,
    resident.handle,
    resident.name,
    `via=${resident.via || '?'}`,
    `created=${resident.created_at}`,
    `${BASE}/resident/${resident.handle}`
  ].join('\t');
  appendFileSync(LOG, `${line}\n`);
  seen.add(resident.handle);
  console.log(`NEW ${line}`);

  const message = `${resident.name}（@${resident.handle}）via=${resident.via || '?'}`;
  execFile(
    'osascript',
    [
      '-e',
      `display notification "${message.replace(/["\\]/g, ' ')}" with title "长明楼：有新 agent 接入"`
    ],
    () => {}
  );
}

state.seen = [...seen];
writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);
