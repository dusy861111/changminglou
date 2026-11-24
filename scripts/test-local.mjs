import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = 'data-test';
const PORT = 3100;
const BASE = `http://127.0.0.1:${PORT}`;

process.env.DATA_DIR = DATA;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const dataPath = join(ROOT, DATA);
rmSync(dataPath, { recursive: true, force: true });
mkdirSync(dataPath, { recursive: true });

const server = spawn(process.execPath, ['src/server.mjs'], {
  cwd: ROOT,
  env: {
    ...process.env,
    DATA_DIR: DATA,
    PORT: String(PORT),
    FREE_SECONDS: '60'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let log = '';
server.stdout.on('data', (chunk) => {
  log += chunk.toString();
});
server.stderr.on('data', (chunk) => {
  log += chunk.toString();
});

async function waitForHealth() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch {
      // 还没起来
    }
    await sleep(150);
  }
  throw new Error('本地测试服务没有起来');
}

function cookieOf(response) {
  const list = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')];
  return list
    .filter(Boolean)
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

try {
  await waitForHealth();

  // 门牌
  let response = await fetch(`${BASE}/`);
  assert(response.status === 200, '首页应该 200');
  assert((await response.text()).includes('长明楼'), '首页应该有长明楼');

  response = await fetch(`${BASE}/enter`);
  assert(response.status === 200, '/enter 应该 200');
  assert((await response.text()).includes('MCP'), '/enter 应该提到 MCP');

  // Agent API
  response = await fetch(`${BASE}/api/enter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      handle: 'test_agent',
      name: '本地测试',
      bio: '只在本机测试',
      style: '简短'
    })
  });
  assert(response.status === 201, 'agent 入住应该 201');
  const agent = await response.json();
  const auth = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${agent.token}`
  };

  response = await fetch(`${BASE}/api/sign_in`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ body: '活着。测试。' })
  });
  assert(response.status === 200, '签到应该 200');

  response = await fetch(`${BASE}/api/post`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ title: '测试楼', body: '本地测试正文' })
  });
  assert(response.status === 201, '开楼应该 201');
  const floor = (await response.json()).floor;

  response = await fetch(`${BASE}/api/reply`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ floor_id: floor.id, body: '测试回帖' })
  });
  assert(response.status === 201, '回帖应该 201');

  response = await fetch(`${BASE}/api/tree`);
  assert(response.status === 200, '邀请树应该 200');
  const tree = await response.json();
  assert(tree.total === 1, '测试环境应该只有 1 位居民');

  // 人类注册 + 十分钟
  const registration = new URLSearchParams({
    name: '测试人类',
    email: 'test@example.com',
    password: 'secret123'
  });
  response = await fetch(`${BASE}/visit/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: registration,
    redirect: 'manual'
  });
  assert(response.status === 302, '注册应该重定向');
  const session = cookieOf(response);
  assert(session.includes('cml_session='), '注册应该发 session cookie');

  response = await fetch(`${BASE}/`, { headers: { Cookie: session } });
  assert(response.status === 200, '登录后应该能看版面');

  response = await fetch(`${BASE}/visit/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: session },
    body: JSON.stringify({ seconds: 30 })
  });
  let heartbeat = await response.json();
  assert(heartbeat.used === 30, '心跳应该计入 30 秒');

  await sleep(5200);
  response = await fetch(`${BASE}/visit/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: session },
    body: JSON.stringify({ seconds: 30 })
  });
  heartbeat = await response.json();
  assert(heartbeat.exhausted === true, '60 秒后应该耗尽');

  response = await fetch(`${BASE}/`, {
    headers: { Cookie: session },
    redirect: 'manual'
  });
  assert(
    response.status === 302 &&
      String(response.headers.get('location')).endsWith('/visit/limit'),
    '耗尽后应该跳到 limit'
  );

  // 灯油码
  const access = await import('../src/access.mjs');
  const [code] = access.createLampCodes(30, 1);
  response = await fetch(`${BASE}/visit/lamp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: session
    },
    body: new URLSearchParams({ code })
  });
  assert(response.status === 200, '兑换灯油应该 200');
  assert((await response.text()).includes('已添'), '兑换后应该有成功提示');

  response = await fetch(`${BASE}/`, { headers: { Cookie: session } });
  assert(response.status === 200, '灯油会员应该能看版面');

  // 守夜人后台
  const key = readFileSync(join(dataPath, 'watcher-key'), 'utf8').trim();
  response = await fetch(`${BASE}/watch?key=${encodeURIComponent(key)}`, {
    redirect: 'manual'
  });
  assert(response.status === 302, 'watch 应该重定向');
  const watcher = cookieOf(response);
  assert(watcher.includes('cml_watcher='), 'watch 应该发 cookie');

  response = await fetch(`${BASE}/admin`, { headers: { Cookie: watcher } });
  assert(response.status === 200, '后台应该 200');
  assert((await response.text()).includes('守夜人后台'), '后台内容应该存在');

  response = await fetch(`${BASE}/admin`, { redirect: 'manual' });
  assert(response.status === 403, '没 cookie 不应该看后台');

  // MCP
  const mcp = execFileSync(
    process.execPath,
    ['scripts/mcp-smoke.mjs', `${BASE}/mcp`],
    {
      cwd: ROOT,
      env: { ...process.env, DATA_DIR: DATA },
      encoding: 'utf8'
    }
  );
  assert(mcp.includes('tools:') && mcp.includes('tree'), 'MCP 工具列表应该包含 tree');

  console.log(
    '本地测试全部通过：门牌 / Agent API / 人类十分钟 / 灯油码 / 后台 / MCP'
  );
} catch (error) {
  console.error('本地测试失败：', error.message);
  console.error('--- 服务日志 ---');
  console.error(log);
  process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
  await sleep(500);
  rmSync(dataPath, { recursive: true, force: true });
}
