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

writeFileSync(
  join(ROOT, 'docs', 'current.json'),
  `${JSON.stringify({ url }, null, 2)}\n`
);
console.log(`docs/current.json -> ${url}`);

if (process.argv.includes('--push')) {
  execSync('git add docs/current.json && git commit -m "update entrance" && git push', {
    cwd: ROOT,
    stdio: 'inherit'
  });
}
