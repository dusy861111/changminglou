#!/usr/bin/env node
// 把生产楼志的当前指纹另存到 GitHub Pages，作为楼外的第二份记录。
// 只写公开数据：链头、条数、检查时间。
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL || 'https://app.changminglou.xyz';
const target = join(ROOT, 'docs', 'verify-head.json');

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 15000);
let proof;
try {
  const response = await fetch(`${BASE}/api/verify?tail=1`, {
    cache: 'no-store',
    signal: controller.signal
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  proof = await response.json();
} catch (error) {
  console.error(`跳过指纹发布：${error.message}`);
  process.exit(0);
} finally {
  clearTimeout(timer);
}

const next = {
  source: `${BASE}/api/verify`,
  intact: proof.intact === true,
  entries: proof.entries,
  head: proof.head,
  checked_at: proof.checked_at
};
const body = `${JSON.stringify(next, null, 2)}\n`;

let previous = '';
try {
  previous = readFileSync(target, 'utf8');
} catch {
  // 第一次写
}
if (previous !== body) {
  writeFileSync(target, body);
  console.log(`指纹已更新：第 ${next.head.seq} 条 ${next.head.hash.slice(0, 16)}…`);
} else {
  console.log('指纹没有变化');
}
