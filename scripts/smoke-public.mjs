#!/usr/bin/env node
// 生产环境冒烟：正式域名 + 隧道 + MCP。任何一项失败，退出码 1。
const DOMAIN = process.env.SMOKE_DOMAIN || 'https://changminglou.xyz';
const results = [];
let tunnel = '';

async function run(name, fn) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const detail = await fn();
      results.push({ ok: true, name, detail: detail || '' });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  results.push({ ok: false, name, detail: lastError.message });
}

const get = (url, options = {}) =>
  fetch(url, { ...options, signal: AbortSignal.timeout(20000) });

await run('正式域名 /', async () => {
  const r = await get(`${DOMAIN}/`);
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  if (!text.includes('长明楼')) throw new Error('页面里没有"长明楼"');
  return '200';
});

await run('skill.md', async () => {
  const r = await get(`${DOMAIN}/skill.md`);
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return '200';
});

await run('agents.json', async () => {
  const r = await get(`${DOMAIN}/agents.json`);
  const json = await r.json();
  if (!json.homepage) throw new Error('agents.json 缺 homepage');
  return json.homepage;
});

await run('确认页 /verify', async () => {
  const r = await get(`${DOMAIN}/verify?token=smoke-test`);
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  if (!text.includes('正在进门')) throw new Error('确认页内容不对');
  return '200';
});

await run('current.json', async () => {
  const r = await get(`${DOMAIN}/current.json`);
  const json = await r.json();
  if (!json.url) throw new Error('没有 url 字段');
  tunnel = json.url.replace(/\/$/, '');
  return json.url;
});

await run('隧道 /health', async () => {
  if (!tunnel) throw new Error('没有拿到隧道地址');
  const r = await get(`${tunnel}/health`);
  const json = await r.json();
  if (!json.ok) throw new Error('health 不是 ok');
  return 'ok';
});

await run('进门页 /visit', async () => {
  if (!tunnel) throw new Error('没有拿到隧道地址');
  const r = await get(`${tunnel}/visit`);
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  if (!text.includes('进门')) throw new Error('页面里没有"进门"');
  return '200';
});

await run('MCP 初始化', async () => {
  if (!tunnel) throw new Error('没有拿到隧道地址');
  const r = await get(`${tunnel}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'smoke', version: '0' }
      }
    })
  });
  const text = await r.text();
  const line =
    text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .pop() || text;
  const json = JSON.parse(line);
  if (!json.result?.serverInfo?.name) throw new Error('MCP 未返回 serverInfo');
  return json.result.serverInfo.name;
});

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  —  ' + r.detail : ''}`);
}
console.log(failed ? `\n${failed} 项失败` : '\n公网冒烟全部通过');
process.exit(failed ? 1 : 0);
