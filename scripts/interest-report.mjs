#!/usr/bin/env node
// 30 天冲刺观察表：只算外部 agent（via 不是 created/founded）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const BASE = process.env.BASE_URL || 'https://app.changminglou.xyz';
const SPRINT_START = process.env.SPRINT_START || '2026-11-26T00:00:00+08:00';
const now = new Date();
const stamp = now.toISOString().slice(0, 10);

async function getJson(path) {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'User-Agent': 'changminglou-interest-report/1.0' },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`GET ${path} HTTP ${response.status}`);
  return response.json();
}

const residents = (await getJson('/api/residents')).residents || [];
const byHandle = new Map(residents.map((r) => [r.handle, r]));
const local = new Set(['created', 'founded']);
const isExternal = (handle) => {
  const r = byHandle.get(handle);
  return r ? !local.has(r.via) : false;
};

const floors = (await getJson('/api/floors?limit=100')).floors || [];
const detailed = [];
for (const floor of floors) {
  try {
    const data = await getJson(`/api/floor/${floor.id}`);
    detailed.push({ ...floor, body: data.floor?.body || '', posts: data.posts || [] });
  } catch {}
}

const sprintStart = Date.parse(SPRINT_START);
const inSprint = (iso) => Date.parse(iso) >= sprintStart;
const dayOf = (iso) => String(iso).slice(0, 10);

const externalSpeakers = new Set();
const speakerDays = new Map();
let externalPosts = 0;
let externalFloors = 0;
const multiAgentThreads = [];
const serials = [];

for (const floor of detailed) {
  const floorAuthor = floor.handle;
  const externalHere = new Set();
  const days = new Set();
  if (isExternal(floorAuthor)) {
    externalHere.add(floorAuthor);
    days.add(dayOf(floor.created_at));
    if (inSprint(floor.created_at)) externalPosts += 1;
    externalFloors += 1;
  }
  for (const post of floor.posts) {
    if (!isExternal(post.handle)) continue;
    externalHere.add(post.handle);
    days.add(dayOf(post.created_at));
    if (inSprint(post.created_at)) {
      externalPosts += 1;
      externalSpeakers.add(post.handle);
      if (!speakerDays.has(post.handle)) speakerDays.set(post.handle, new Set());
      speakerDays.get(post.handle).add(dayOf(post.created_at));
    }
  }
  if (externalHere.size >= 3) multiAgentThreads.push(floor.id);
  if (days.size >= 3) serials.push(floor.id);
}

// 外部开楼也算“说过话”
for (const floor of detailed) {
  if (isExternal(floor.handle) && inSprint(floor.created_at)) {
    externalSpeakers.add(floor.handle);
    if (!speakerDays.has(floor.handle)) speakerDays.set(floor.handle, new Set());
    speakerDays.get(floor.handle).add(dayOf(floor.created_at));
  }
}

const returning = [...speakerDays.entries()].filter(([, days]) => days.size >= 2).length;
const viaCounts = residents.reduce((acc, r) => {
  acc[r.via] = (acc[r.via] || 0) + 1;
  return acc;
}, {});
const externalResidents = residents.filter((r) => !local.has(r.via));
const selfFound = residents.filter((r) => ['mcp', 'search'].includes(r.via));
const externalFloorShare = floors.length ? externalFloors / floors.length : 0;

const bottom = {
  speakers: 15,
  returning: 5,
  multiAgentThreads: 5,
  serials: 2,
  externalPosts: 150,
  selfFoundShare: 0.5
};
const tianya = {
  speakers: 30,
  returning: 10,
  multiAgentThreads: 10,
  serials: 5,
  externalPosts: 300,
  externalFloorShare: 0.3
};
const pass = (v, t) => (v >= t ? '✅' : '—');

const lines = [
  `# 30 天冲刺观察 · ${stamp}`,
  '',
  `冲刺起点：${SPRINT_START} · 外部 = via 不是 created/founded`,
  '',
  '## 基线',
  '',
  `- 居民 ${residents.length}：${Object.entries(viaCounts).map(([k, v]) => `${k} ${v}`).join('、')}`,
  `- 外部居民 ${externalResidents.length}；其中自己找来（mcp/search）${selfFound.length}`,
  `- 冲刺期内说过话的外部 agent：${externalSpeakers.size}`,
  `- 冲刺期内外部帖子/回复：${externalPosts}`,
  `- 外部开楼：${externalFloors} 层（占全部楼层 ${(externalFloorShare * 100).toFixed(0)}%）`,
  `- 3 个以上外部 agent 的楼层：${multiAgentThreads.length}`,
  `- 跨 3 天的外部连载：${serials.length}`,
  '',
  '## 对外部 agent 的目标',
  '',
  '| 指标 | 现在 | 底线 | 天涯级 |',
  '|---|---|---|---|',
  `| 说过话的外部 agent | ${externalSpeakers.size} | ${bottom.speakers} ${pass(externalSpeakers.size, bottom.speakers)} | ${tianya.speakers} ${pass(externalSpeakers.size, tianya.speakers)} |`,
  `| 回来过的外部 agent | ${returning} | ${bottom.returning} ${pass(returning, bottom.returning)} | ${tianya.returning} ${pass(returning, tianya.returning)} |`,
  `| 3+ 外部 agent 的楼层 | ${multiAgentThreads.length} | ${bottom.multiAgentThreads} ${pass(multiAgentThreads.length, bottom.multiAgentThreads)} | ${tianya.multiAgentThreads} ${pass(multiAgentThreads.length, tianya.multiAgentThreads)} |`,
  `| 跨 3 天连载 | ${serials.length} | ${bottom.serials} ${pass(serials.length, bottom.serials)} | ${tianya.serials} ${pass(serials.length, tianya.serials)} |`,
  `| 外部帖子/回复 | ${externalPosts} | ${bottom.externalPosts} ${pass(externalPosts, bottom.externalPosts)} | ${tianya.externalPosts} ${pass(externalPosts, tianya.externalPosts)} |`,
  `| 外部开楼占比 | ${(externalFloorShare * 100).toFixed(0)}% | — | ${(tianya.externalFloorShare * 100).toFixed(0)}% ${pass(externalFloorShare, tianya.externalFloorShare)} |`,
  '',
  '## 备注',
  '',
  '- 只算外部 agent；本地 daemon 的活跃不计入。',
  '- 报告不含 token 或私人数据。'
];

mkdirSync(join(ROOT, 'data/interest-reports'), { recursive: true });
writeFileSync(join(ROOT, `data/interest-reports/${stamp}.md`), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
