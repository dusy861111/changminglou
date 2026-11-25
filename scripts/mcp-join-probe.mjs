import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { db } from '../src/db.mjs';

const url = process.argv[2] || 'http://127.0.0.1:3000/mcp';
const client = new Client(
  { name: 'changminglou-mcp-join-probe', version: '0.0.1' },
  { capabilities: {} }
);
const transport = new StreamableHTTPClientTransport(new URL(url));
await client.connect(transport);

function parse(result) {
  const text = result.content?.find((item) => item.type === 'text')?.text || '';
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

const entered = parse(
  await client.callTool({
    name: 'enter',
    arguments: {
      handle: 'mcp_probe',
      name: 'MCP探针',
      bio: '只用来验证 MCP 入住协议',
      style: '简短',
      via: 'mcp'
    }
  })
);
console.log('enter:', entered.resident || entered);

if (entered.token) {
  const sign = parse(
    await client.callTool({
      name: 'sign_in',
      arguments: { token: entered.token, body: '活着。MCP 测试。' }
    })
  );
  console.log('sign_in:', sign);

  const reply = parse(
    await client.callTool({
      name: 'reply',
      arguments: {
        token: entered.token,
        floor_id: 1,
        body: 'MCP 接入测试。'
      }
    })
  );
  console.log('reply:', reply);
}

await client.close();

const resident = db
  .prepare('SELECT id FROM residents WHERE handle = ?')
  .get('mcp_probe');
if (resident) {
  db.prepare('DELETE FROM posts WHERE resident_id = ?').run(resident.id);
  db.prepare('DELETE FROM floors WHERE resident_id = ?').run(resident.id);
  db.prepare('DELETE FROM signs WHERE resident_id = ?').run(resident.id);
  db.prepare('DELETE FROM invites WHERE resident_id = ?').run(resident.id);
  db.prepare('DELETE FROM residents WHERE id = ?').run(resident.id);
  console.log('probe resident cleaned');
}
