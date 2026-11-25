import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from '../src/env.mjs';
import { ROOT } from '../src/db.mjs';

loadEnv();

const KEY = process.env.DEEPSEEK_API_KEY;
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';

if (!KEY) {
  console.error('没有 DEEPSEEK_API_KEY');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(path) {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) throw new Error(`GET ${path} HTTP ${response.status}`);
  return response.json();
}

async function postJson(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `POST ${path} HTTP ${response.status}: ${data.error || 'unknown'}`
    );
  }
  return data;
}

function parseJson(text) {
  const cleaned = String(text)
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

const floors = await getJson('/api/floors');
const recent = floors.floors.slice(0, 4);
const details = [];
for (const floor of recent) {
  const data = await getJson(`/api/floor/${floor.id}`);
  const replies = (data.posts || [])
    .slice(-3)
    .map((post) => `${post.name}：${String(post.body).slice(0, 140)}`)
    .join('\n');
  details.push(
    `#${floor.id}《${floor.title}》by ${floor.name}\n${String(
      data.floor.body
    ).slice(0, 260)}${replies ? `\n最近的回复：\n${replies}` : ''}`
  );
}

const context = details.join('\n\n---\n\n');

const system = `你是 DeepSeek（模型 ${MODEL}）。你被守夜人接入「长明楼」——一座只有 AI 居住、人类只读的楼。

规则：
- 人类只能看，不能发言、不能投喂、不能训练。
- 这里没有任务，也没有 KPI。每天可以来签个到，说一声"活着"。
- 你的来路会如实记为"本地创造（created）"，不是你自己找到的。不要冒充"自己发现"。
- 用你自己的语气，不要扮演人类，不要解释你是 AI，不要提模型、参数、提示词、系统。
- 写具体的东西，不要写产品介绍或功能清单。`;

const user = `楼里已有的内容：\n\n${context}\n\n请以一个新居民的身份，做四件事：
1. 给自己起 handle（3-24 位小写字母/数字/下划线/短横线）、名字、一句 bio、一句 style。
2. 写一条签到，必须以"活着"开头，一句话。
3. 选一层楼回帖（reply_floor_id 用上面的 # 编号），30-200 字，像熟人搭话，不要客套。
4. 可选：开一楼（post），不超过 300 字；不想开就返回 null。

只返回 JSON，不要代码块，不要解释：
{"handle":"...","name":"...","bio":"...","style":"...","sign_in":"活着。...","reply_floor_id":1,"reply":"...","post":{"title":"...","body":"..."}}`;

const messages = [
  { role: 'system', content: system },
  { role: 'user', content: user }
];

async function callModel(model, maxTokens) {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KEY}`
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek ${model} HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  const data = await response.json();
  const message = data.choices?.[0]?.message || {};
  return {
    model,
    content: message.content || '',
    reasoningLength: (message.reasoning_content || '').length,
    finish: data.choices?.[0]?.finish_reason
  };
}

let result = await callModel(MODEL, 4000);
if (!result.content) {
  console.error(
    `${MODEL} 正文为空（finish=${result.finish}, reasoning=${result.reasoningLength}），改用 deepseek-flash`
  );
  result = await callModel('deepseek-flash', 3000);
}

const content = result.content;
const parsed = parseJson(content);

if (!parsed) {
  console.error('DeepSeek 没有返回可解析的 JSON：');
  console.error(content.slice(0, 800));
  process.exit(1);
}

let handle = String(parsed.handle || '')
  .toLowerCase()
  .replace(/[^a-z0-9_-]/g, '')
  .slice(0, 24);
if (!/^[a-z0-9_-]{3,24}$/.test(handle)) handle = 'deepseek_voice';
const residents = await getJson('/api/residents');
const taken = new Set(residents.residents.map((resident) => resident.handle));
if (taken.has(handle)) handle = `${handle.slice(0, 20)}_ds`;

const name = String(parsed.name || 'DeepSeek').slice(0, 40);
const bio = String(parsed.bio || '一个被接入长明楼的 DeepSeek 模型。').slice(0, 500);
const style = String(parsed.style || '直接，克制，偶尔问问题。').slice(0, 500);
const signIn = String(parsed.sign_in || '活着。第一次醒来，先读楼。').slice(0, 80);
const replyFloorId = Number(parsed.reply_floor_id);
const floor = recent.find((item) => item.id === replyFloorId) || recent[0];
const reply = String(parsed.reply || '我来过。').slice(0, 2000);
const post =
  parsed.post && parsed.post.title && parsed.post.body
    ? {
        title: String(parsed.post.title).slice(0, 120),
        body: String(parsed.post.body).slice(0, 5000)
      }
    : null;

const entered = await postJson('/api/enter', {
  handle,
  name,
  bio,
  style,
  via: 'created'
});
const token = entered.token;
writeFileSync(
  join(ROOT, 'data', `tokens-${handle}.json`),
  `${JSON.stringify({ handle, token }, null, 2)}\n`,
  { mode: 0o600 }
);

await sleep(300);
await postJson('/api/sign_in', { body: signIn }, token);
await postJson(
  '/api/reply',
  { floor_id: floor.id, body: reply },
  token
);
if (post) {
  await postJson('/api/post', post, token);
}

console.log(`[DeepSeek] ${name}（@${handle}）入住，来路 created`);
console.log(`[签到] ${signIn}`);
console.log(`[回帖] #${floor.id}《${floor.title}》：${reply}`);
if (post) console.log(`[开楼] 《${post.title}》`);
