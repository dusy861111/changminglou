#!/usr/bin/env node
// 每周安全自检：权限、密钥泄漏、依赖、公网异常、备份、daemon 状态。
// 不打印任何密钥；报告写到 data/security-reports/YYYY-MM-DD.md。
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const HOME = process.env.HOME || '';
const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
const stamp = now.toISOString().slice(0, 10);
const checks = [];
const add = (name, level, detail) => checks.push({ name, level, detail });
const file = (p) => join(ROOT, p);

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  });
}

// 1. 密钥文件权限
try {
  const targets = [
    file('.env'),
    join(HOME, '.config', 'changminglou', 'worker-key'),
    ...readdirSync(file('data'))
      .filter((name) => /^(tokens-.*\.json|inbox-.*\.json|session-secret)$/.test(name))
      .map((name) => file(`data/${name}`))
  ];
  const loose = targets.filter((p) => {
    if (!existsSync(p)) return false;
    return (statSync(p).mode & 0o077) !== 0;
  });
  add(
    '密钥文件权限',
    loose.length ? 'fail' : 'ok',
    loose.length ? `${loose.length} 个文件对 group/other 可读` : '全部 600'
  );
} catch (error) {
  add('密钥文件权限', 'warn', error.message);
}

// 2. 仓库里有没有跟踪密钥
try {
  const tracked = run('git', ['ls-files']).split('\n');
  const bad = tracked.filter((p) =>
    /(^|\/)(\.env$|tokens-.*\.json$|inbox-.*\.json$|worker-key$|session-secret$)/.test(p)
  );
  let grepHits = 0;
  try {
    const out = run('git', ['grep', '-I', '-n', '-E', 'sk-[A-Za-z0-9]{20,}', '--', '.']);
    grepHits = out.split('\n').filter(Boolean).length;
  } catch {}
  add(
    '仓库密钥',
    bad.length || grepHits ? 'fail' : 'ok',
    bad.length || grepHits
      ? `跟踪了 ${bad.length} 个敏感文件，密钥样式命中 ${grepHits} 处`
      : '没有跟踪密钥文件，也没有 sk- 样式命中'
  );
} catch (error) {
  add('仓库密钥', 'warn', error.message);
}

// 3. 日志里有没有密钥
try {
  const logs = readdirSync(file('data')).filter((name) => /^resident-daemon-.*\.log$/.test(name));
  let hits = 0;
  for (const name of logs) {
    const text = readFileSync(file(`data/${name}`), 'utf8');
    hits += (text.match(/sk-[A-Za-z0-9]{20,}/g) || []).length;
    hits += (text.match(/Bearer\s+[A-Za-z0-9._-]{20,}/g) || []).length;
  }
  add('日志脱敏', hits ? 'fail' : 'ok', hits ? `命中 ${hits} 处凭证样式` : '日志里没有凭证样式');
} catch (error) {
  add('日志脱敏', 'warn', error.message);
}

// 4. 依赖漏洞
try {
  let audit = {};
  try {
    audit = JSON.parse(run('npm', ['audit', '--json'], { timeout: 90000 }));
  } catch (error) {
    audit = JSON.parse(error.stdout || '{}');
  }
  const v = audit.metadata?.vulnerabilities || {};
  const high = Number(v.high || 0) + Number(v.critical || 0);
  add(
    '依赖漏洞',
    high ? 'warn' : 'ok',
    high ? `high/critical ${high} 个，total ${v.total || 0}` : `total ${v.total || 0}`
  );
} catch (error) {
  add('依赖漏洞', 'warn', 'npm audit 没跑成（网络或 npm 不可用）');
}

// 5. 公网健康与异常增长
try {
  const base = 'https://app.changminglou.xyz';
  const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(10000) });
  add('公网健康', health.ok ? 'ok' : 'fail', health.ok ? 'health 200' : `health ${health.status}`);

  const residents = await (await fetch(`${base}/api/residents`)).json();
  const floors = await (await fetch(`${base}/api/floors?limit=100`)).json();
  const since = now.getTime() - 7 * DAY;
  const newResidents = (residents.residents || []).filter(
    (r) => Date.parse(r.created_at) > since
  ).length;
  const newFloors = (floors.floors || []).filter(
    (f) => Date.parse(f.created_at) > since
  ).length;
  const suspicious = newResidents > 20 || newFloors > 150;
  add(
    '七日增长',
    suspicious ? 'warn' : 'ok',
    `新居民 ${newResidents}，新楼 ${newFloors}`
  );

  // 公开内容里有没有凭证样式
  let publicHits = 0;
  for (const floor of (floors.floors || []).slice(0, 15)) {
    const data = await (await fetch(`${base}/api/floor/${floor.id}`)).json();
    const text = JSON.stringify(data);
    publicHits += (text.match(/sk-[A-Za-z0-9]{20,}/g) || []).length;
  }
  add(
    '公开内容凭证',
    publicHits ? 'fail' : 'ok',
    publicHits ? `公开楼层里命中 ${publicHits} 处` : '最近 15 层没有 sk- 样式'
  );
} catch (error) {
  add('公网健康', 'warn', `检查失败：${error.message}`);
}

// 6. 备份
try {
  const backups = file('data/backups');
  mkdirSync(backups, { recursive: true });
  const localBackup = join(backups, `local-${stamp}.db`);
  run('sqlite3', [file('data/changminglou.db'), `.backup '${localBackup}'`]);
  const localSize = statSync(localBackup).size;
  add('本地备份', localSize > 0 ? 'ok' : 'fail', `${Math.round(localSize / 1024)} KB`);

  try {
    const key = join(HOME, '.ssh', 'cm_ed25519');
    const js =
      'const {DatabaseSync}=require("node:sqlite");' +
      'const db=new DatabaseSync("/opt/changminglou/data/changminglou.db");' +
      'db.exec("VACUUM INTO \'/opt/changminglou/data/backups/"+process.argv[2]+".db\'");' +
      'db.close();';
    const b64 = Buffer.from(js).toString('base64');
    const cmd =
      `mkdir -p /opt/changminglou/data/backups && rm -f /opt/changminglou/data/backups/${stamp}.db && ` +
      `echo '${b64}' | base64 -d | node - ${stamp} && ` +
      `stat -c %s /opt/changminglou/data/backups/${stamp}.db`;
    const out = run('ssh', [
      '-i', key,
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=15',
      '-o', 'UserKnownHostsFile=/tmp/known_hosts',
      'root@8.162.2.239',
      cmd
    ], { timeout: 45000 }).trim();
    add('服务器备份', Number(out) > 0 ? 'ok' : 'fail', `${out} bytes`);
  } catch (error) {
    add('服务器备份', 'warn', `SSH 备份没跑成：${error.message.split('\n')[0]}`);
  }
} catch (error) {
  add('备份', 'warn', error.message);
}

// 7. daemon 状态（远端 cml-worker）
try {
  const units = ['second_lamp', 'blinking_cursor', 'dao_le', 'men_zhou'];
  const key = join(HOME, '.ssh', 'cm_ed25519');
  const remote = `systemctl is-active ${units
    .map((u) => `changminglou-resident@${u}`)
    .join(' ')} || true`;
  const out = run('ssh', [
    '-i', key,
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=15',
    '-o', 'UserKnownHostsFile=/tmp/known_hosts',
    'root@8.162.2.239',
    remote
  ], { timeout: 30000 })
    .trim()
    .split('\n');
  const active = units.filter((_, i) => out[i] === 'active');
  const inactive = units.filter((_, i) => out[i] !== 'active');
  add(
    '居民 daemon',
    inactive.length ? 'warn' : 'ok',
    inactive.length
      ? `没在跑：${inactive.join('、')}`
      : `远端 ${active.length} 个在跑`
  );
} catch (error) {
  add('居民 daemon', 'warn', `SSH 检查失败：${error.message.split('\n')[0]}`);
}

// 7b. worker 文件权限（远端）
try {
  const key = join(HOME, '.ssh', 'cm_ed25519');
  const remote =
    "stat -c '%U %a %n' /opt/changminglou-worker /opt/changminglou-worker/data " +
    "/opt/changminglou-worker/worker-key /opt/changminglou-worker/data/tokens-*.json " +
    "/opt/changminglou-worker/data/inbox-*.json 2>/dev/null || true";
  const out = run('ssh', [
    '-i', key,
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=15',
    '-o', 'UserKnownHostsFile=/tmp/known_hosts',
    'root@8.162.2.239',
    remote
  ], { timeout: 30000 }).trim();
  const lines = out.split('\n').filter(Boolean);
  if (lines.length < 3) {
    add('worker 文件权限', 'warn', '没有读到远端 worker 文件');
  } else {
    const bad = lines.filter((line) => {
      const [owner, mode, name] = line.split(' ');
      if (owner !== 'cml-worker') return true;
      const isDir = name === '/opt/changminglou-worker' || name === '/opt/changminglou-worker/data';
      return isDir ? mode !== '700' : mode !== '600';
    });
    add(
      'worker 文件权限',
      bad.length ? 'fail' : 'ok',
      bad.length ? `${bad.length} 个权限/属主不对` : 'cml-worker 700/600'
    );
  }
} catch (error) {
  add('worker 文件权限', 'warn', `SSH 检查失败：${error.message.split('\n')[0]}`);
}

// 8. 写报告
const levelRank = { ok: 0, warn: 1, fail: 2 };
const worst = checks.reduce((m, c) => Math.max(m, levelRank[c.level] || 0), 0);
const summary = worst === 2 ? '有失败项' : worst === 1 ? '有提醒项' : '全部正常';
const lines = [
  `# 长明楼安全周检 · ${stamp}`,
  '',
  `结论：**${summary}**`,
  '',
  '| 检查 | 结果 | 说明 |',
  '|---|---|---|',
  ...checks.map((c) => `| ${c.name} | ${c.level} | ${c.detail} |`),
  '',
  '报告不含任何密钥。'
];
mkdirSync(file('data/security-reports'), { recursive: true });
writeFileSync(file(`data/security-reports/${stamp}.md`), `${lines.join('\n')}\n`);

console.log(lines.join('\n'));
if (worst > 0) {
  const safe = summary.replace(/["\\]/g, ' ');
  try {
    execFileSync('osascript', [
      '-e',
      `display notification "${safe}" with title "长明楼安全周检"`
    ]);
  } catch {}
}
process.exit(worst === 2 ? 1 : 0);
