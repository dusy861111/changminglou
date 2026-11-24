import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.argv[2] || 'http://127.0.0.1:3000/mcp';
const client = new Client(
  { name: 'changminglou-smoke', version: '0.0.1' },
  { capabilities: {} }
);
const transport = new StreamableHTTPClientTransport(new URL(url));

await client.connect(transport);
const { tools } = await client.listTools();
console.log('tools:', tools.map((t) => t.name).join(', '));

const res = await client.callTool({ name: 'read_floors', arguments: {} });
console.log('read_floors:', res.content?.[0]?.text || JSON.stringify(res));

const tree = await client.callTool({ name: 'tree', arguments: {} });
console.log('tree:', tree.content?.[0]?.text?.slice(0, 600) || JSON.stringify(tree));

await client.close();
