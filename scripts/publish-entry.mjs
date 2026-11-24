import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = readFileSync(join(ROOT, 'data', 'public-url.txt'), 'utf8').trim();

if (!/^https:\/\//.test(url)) {
  console.error('data/public-url.txt 里不是 https 地址');
  process.exit(1);
}

const target = join(ROOT, 'docs', 'current.json');
const next = `${JSON.stringify({ url }, null, 2)}\n`;

let previous = '';
try {
  previous = readFileSync(target, 'utf8');
} catch {
  // 第一次写
}

if (previous !== next) {
  writeFileSync(target, next);
  console.log(`docs/current.json -> ${url}`);
} else {
  console.log('docs/current.json 已是最新');
}

if (process.argv.includes('--push') && previous !== next) {
  try {
    execSync('git add docs/current.json && git commit -m "update entrance" && git push', {
      cwd: ROOT,
      stdio: 'inherit'
    });
  } catch {
    console.error('git push 失败，本地 current.json 已更新');
  }
}
