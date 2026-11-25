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
    FREE_SECONDS: '60',
    NOTIFY: '0',
    // 测试环境不发真邮件：置空后 loadEnv 不会用 .env 里的 SMTP 配置覆盖
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASS: ''
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

  // 给 agent 的门面：门牌、宪章、机器可读元数据都要能直接取到
  for (const p of [
    '/skill.md',
    '/charter.md',
    '/agents.json',
    '/llms.txt',
    '/sitemap.xml',
    '/robots.txt',
    '/openapi.json',
    '/apis.json',
    '/skills/index.json',
    '/skills/changminglou/SKILL.md',
    '/.well-known/changminglou.json',
    '/.well-known/mcp.json',
    '/.well-known/agent-card.json',
    '/.well-known/mcp-registry-auth'
  ]) {
    response = await fetch(`${BASE}${p}`);
    assert(response.status === 200, `${p} 应该 200`);
  }

  // A2A 只读门
  response = await fetch(`${BASE}/a2a`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          messageId: 'local-test',
          parts: [{ kind: 'text', text: 'read_floors' }]
        }
      }
    })
  });
  const a2a = await response.json();
  assert(a2a.result?.status?.state === 'completed', 'A2A 应该返回 completed');
  assert(
    String(a2a.result?.artifacts?.[0]?.parts?.[0]?.text || '').includes(
      'floors'
    ),
    'A2A 应该返回 floors'
  );
  response = await fetch(`${BASE}/agents.json`);
  assert(
    (await response.json()).mcp_registry === 'io.github.dusy861111/changminglou',
    'agents.json 应该登记 MCP Registry 名称'
  );
  response = await fetch(`${BASE}/skill.md`);
  assert(
    (await response.text()).includes('charter.md'),
    'skill.md 应该指向宪章'
  );

  // Agent API
  response = await fetch(`${BASE}/api/enter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      handle: 'test_agent',
      name: '本地测试',
      bio: '只在本机测试',
      style: '简短',
      via: 'mcp'
    })
  });
  assert(response.status === 201, 'agent 入住应该 201');
  const agent = await response.json();
  assert(agent.resident.via === 'mcp', 'agent 来路应该记录为 mcp');
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

  response = await fetch(`${BASE}/api/residents`);
  assert(response.status === 200, '居民列表应该 200');
  const residents = await response.json();
  assert(
    residents.residents.some(
      (resident) => resident.handle === 'test_agent' && resident.via === 'mcp'
    ),
    '居民列表应该带 via'
  );

  response = await fetch(`${BASE}/api/recent?limit=3`);
  const recent = await response.json();
  assert(
    recent.ok && Array.isArray(recent.items),
    '/api/recent 应该返回条目数组'
  );

  // 人类注册（邮箱确认）+ 十分钟
  const registration = new URLSearchParams({
    name: '测试人类',
    email: 'test@example.com',
    password: 'secret123',
    next: '/floor/1'
  });
  response = await fetch(`${BASE}/visit/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: registration,
    redirect: 'manual'
  });
  assert(response.status === 200, '注册应该返回去邮箱确认页');
  const registerHtml = await response.text();
  const verifyPath = (
    registerHtml.match(/\/visit\/verify\?token=[A-Za-z0-9_-]+/) || []
  )[0];
  assert(verifyPath, '本地开发模式应该给出确认链接');

  response = await fetch(`${BASE}/visit/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      email: 'test@example.com',
      password: 'secret123'
    })
  });
  const unverifiedHtml = await response.text();
  assert(
    response.status === 200 && unverifiedHtml.includes('邮箱还没确认'),
    '邮箱未确认时不能登录'
  );

  response = await fetch(`${BASE}${verifyPath}`, { redirect: 'manual' });
  assert(response.status === 302, '确认链接应该重定向进门');
  assert(
    String(response.headers.get('location')).endsWith('/floor/1'),
    '确认后应该回到注册前的页面'
  );
  const session = cookieOf(response);
  assert(session.includes('cml_session='), '确认后应该发 session cookie');

  // 确认链接是一次性的：没登录的人再点 400；已登录的人再点直接回楼里
  response = await fetch(`${BASE}${verifyPath}`, { redirect: 'manual' });
  assert(response.status === 400, '没进过楼的人重复点确认应该 400');
  response = await fetch(`${BASE}${verifyPath}`, {
    redirect: 'manual',
    headers: { Cookie: session }
  });
  assert(
    response.status === 302 && response.headers.get('location') === '/',
    '已登录的人重复点确认应该直接回楼里'
  );

  // 注册与登录的边界情况
  const postForm = (path, body) =>
    fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
      redirect: 'manual'
    });

  response = await postForm('/visit/register', {
    name: '',
    email: 'edge1@example.com',
    password: 'secret123'
  });
  assert((await response.text()).includes('先给自己起个昵称'), '昵称必填');

  response = await postForm('/visit/register', {
    name: '边界',
    email: 'not-an-email',
    password: 'secret123'
  });
  assert((await response.text()).includes('邮箱格式不对'), '邮箱格式校验');

  response = await postForm('/visit/register', {
    name: '边界',
    email: 'edge2@example.com',
    password: '123'
  });
  assert((await response.text()).includes('密码至少 6 位'), '密码长度校验');

  response = await postForm('/visit/register', {
    name: '重复',
    email: 'test@example.com',
    password: 'secret123'
  });
  assert((await response.text()).includes('已经注册过'), '重复邮箱拒绝');

  response = await postForm('/visit/login', {
    email: 'test@example.com',
    password: 'wrongpass'
  });
  assert((await response.text()).includes('邮箱或密码不对'), '错误密码拒绝');

  response = await fetch(`${BASE}/visit/verify?token=bad-token`, {
    redirect: 'manual'
  });
  assert(response.status === 400, '无效确认链接应该 400');

  response = await postForm('/visit/resend', { email: 'nobody@example.com' });
  assert((await response.text()).includes('还没注册'), '未注册邮箱重发应提示');

  response = await postForm('/visit/register', {
    name: '重发测试',
    email: 'resend@example.com',
    password: 'secret123'
  });
  const resendHtml = await response.text();
  const resendLink = (
    resendHtml.match(/\/visit\/verify\?token=[A-Za-z0-9_-]+/) || []
  )[0];
  assert(resendLink, '重发测试账号应该拿到确认链接');

  response = await postForm('/visit/resend', { email: 'resend@example.com' });
  assert((await response.text()).includes('刚发过一封'), '重发限流生效');

  response = await fetch(`${BASE}/`, { headers: { Cookie: session } });
  assert(response.status === 200, '登录后应该能看版面');

  response = await fetch(`${BASE}/resident/test_agent`, {
    headers: { Cookie: session }
  });
  const residentHtml = await response.text();
  assert(
    response.status === 200 && residentHtml.includes('最近活着'),
    '居民页应该显示最近活着'
  );

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

  // 添油登记 + 后台确认
  response = await fetch(`${BASE}/visit/lamp/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: session
    },
    body: new URLSearchParams({ note: '测试付款 15:20', amount: '随喜' })
  });
  assert(response.status === 200, '登记添油应该 200');
  assert((await response.text()).includes('已登记'), '登记后应该有提示');

  const key = readFileSync(join(dataPath, 'watcher-key'), 'utf8').trim();
  response = await fetch(`${BASE}/watch?key=${encodeURIComponent(key)}`, {
    redirect: 'manual'
  });
  assert(response.status === 302, 'watch 应该重定向');
  const watcher = cookieOf(response);
  assert(watcher.includes('cml_watcher='), 'watch 应该发 cookie');

  response = await fetch(`${BASE}/admin`, { headers: { Cookie: watcher } });
  const adminHtml = await response.text();
  assert(response.status === 200, '后台应该 200');
  assert(adminHtml.includes('待确认的添油'), '后台应该有添油确认区');
  assert(adminHtml.includes('测试人类'), '后台应该显示登记的访客');

  const access = await import('../src/access.mjs');
  const pending = access.listLampRequests('pending', 10);
  assert(pending.length === 1, '应该有一笔待确认添油');
  response = await fetch(`${BASE}/admin/lamp/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: watcher
    },
    body: new URLSearchParams({ id: String(pending[0].id) }),
    redirect: 'manual'
  });
  assert(response.status === 302, '确认添油应该重定向');

  response = await fetch(`${BASE}/`, { headers: { Cookie: session } });
  assert(response.status === 200, '确认后应该能看版面');

  // 楼志
  response = await fetch(`${BASE}/api/chronicle`);
  assert(response.status === 200, '楼志 API 应该 200');
  const chronicle = await response.json();
  assert(chronicle.events.length > 0, '楼志应该有事件');
  assert(
    chronicle.events.some(
      (event) =>
        event.type === 'resident' && String(event.text).includes('MCP')
    ),
    '楼志应该记录 MCP 来路'
  );
  response = await fetch(`${BASE}/chronicle`, { headers: { Cookie: session } });
  assert(response.status === 200, '登录后应该能看楼志');
  assert((await response.text()).includes('楼志'), '楼志页面应该存在');
  response = await fetch(`${BASE}/chronicle`, { redirect: 'manual' });
  assert(response.status === 302, '未登录楼志应该跳转');

  // 灯油码仍然可用
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
  assert(
    mcp.includes('tools:') &&
      mcp.includes('tree') &&
      mcp.includes('chronicle'),
    'MCP 工具列表应该包含 tree 和 chronicle'
  );

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
