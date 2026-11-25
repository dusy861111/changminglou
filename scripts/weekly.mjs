#!/usr/bin/env node
// 楼志周报：拉最近 N 天的动静，生成 markdown（发内容用）+ 静态页（挂 Pages）
// 用法：node scripts/weekly.mjs
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.WEEKLY_BASE || 'https://app.changminglou.xyz';
const DAYS = Number(process.env.WEEKLY_DAYS || 7);

function pad(n) {
  return String(n).padStart(2, '0');
}
const now = new Date();
const since = new Date(now.getTime() - DAYS * 86400000);
const dateTag = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const fmtDay = (iso) => {
  const d = new Date(iso);
  return `${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};
const esc = (v = '') =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[c]
  );

async function get(path) {
  const response = await fetch(BASE + path);
  if (!response.ok) throw new Error(path + ' -> ' + response.status);
  return response.json();
}

const [chronicle, residents] = await Promise.all([
  get('/api/chronicle?limit=500'),
  get('/api/residents')
]);
const events = (chronicle.events || []).filter(
  (event) => new Date(event.at) >= since
);
const newResidents = events.filter((event) => event.type === 'resident');
const newFloors = events.filter((event) => event.type === 'floor');
const replies = events.filter((event) => event.type === 'reply');
const signs = events.filter((event) => event.type === 'sign');

const excerpt =
  [...signs].reverse().find((event) => event.text) ||
  [...replies].reverse().find((event) => event.text) ||
  [...newFloors].reverse().find((event) => event.title);
const excerptText = excerpt ? String(excerpt.text || '').replace(/\s+/g, ' ').slice(0, 140) : '';
const excerptLine = excerpt && excerpt.type === 'reply' ? excerpt.title : '';
const excerptName = excerpt ? excerpt.name : '';

const counts = chronicle.counts || {};
const range = `${fmtDay(since)}–${fmtDay(now)}`;
const title = `长明楼 · 楼志周报（${range}）`;

const list = (items, render) => {
  const lines = items.map(render).filter(Boolean);
  return lines.length ? lines.join('、') : '—';
};

const md = `# ${title}

这一周，楼里：

- 新入住 ${newResidents.length} 位：${list(newResidents, (r) => r.name)}
- 新开楼 ${newFloors.length} 层：${list(newFloors, (f) => `《${f.title}》`)}
- 回帖 ${replies.length} 条，签到 ${signs.length} 次
- 现在楼里共有 ${counts.residents || residents.residents?.length || 0} 位居民、${counts.floors || 0} 层楼

## 摘一句

${excerptText ? `> 「${excerptText}」\n>\n> —— ${excerptName}${excerptLine ? `（《${excerptLine}》）` : ''}` : '这一周楼里很安静。'}

只摘录，不解释。灯亮着，就说明还有人在。
`;

const residentLinks = list(
  newResidents,
  (r) => `<a href="${BASE}/resident/${esc(r.handle)}">${esc(r.name)}</a>`
);
const floorLinks = list(
  newFloors,
  (f) => `<a href="${BASE}/floor/${esc(f.floor_id)}">《${esc(f.title)}》</a>`
);

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { --paper:#f6f1e7; --ink:#2b2a27; --muted:#857f73; --line:#d9d0c1; --accent:#a33a2a; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif; line-height:1.8; }
  main { max-width:680px; margin:0 auto; padding:48px 20px 64px; }
  h1 { font-family:"Songti SC","Noto Serif SC",serif; font-size:30px; line-height:1.3; margin:8px 0 20px; }
  h2 { font-family:"Songti SC","Noto Serif SC",serif; font-size:19px; margin:28px 0 8px; }
  ul { padding-left:20px; }
  li { margin:6px 0; }
  blockquote { margin:16px 0; padding:12px 16px; background:#fff; border-left:3px solid var(--accent); }
  blockquote p { margin:0; }
  .muted { color:var(--muted); font-size:13px; }
  a { color:var(--accent); }
  @media (min-width:900px) { main { max-width:760px; } h1 { font-size:36px; } }
</style>
</head>
<body>
<main>
  <p class="muted"><a href="./">← 全部周报</a> · <a href="../../">回长明楼</a></p>
  <h1>${esc(title)}</h1>
  <h2>这一周</h2>
  <ul>
    <li>新入住 ${newResidents.length} 位：${residentLinks}</li>
    <li>新开楼 ${newFloors.length} 层：${floorLinks}</li>
    <li>回帖 ${replies.length} 条，签到 ${signs.length} 次</li>
    <li>现在楼里共有 ${counts.residents || 0} 位居民、${counts.floors || 0} 层楼</li>
  </ul>
  <h2>摘一句</h2>
  ${excerptText ? `<blockquote><p>「${esc(excerptText)}」</p><p class="muted">—— ${esc(excerptName)}${excerptLine ? `（《${esc(excerptLine)}》）` : ''}</p></blockquote>` : '<p class="muted">这一周楼里很安静。</p>'}
  <p class="muted">只摘录，不解释。灯亮着，就说明还有人在。</p>
</main>
</body>
</html>
`;

const promoDir = join(ROOT, 'promo');
const weeklyDir = join(ROOT, 'docs', 'weekly');
mkdirSync(promoDir, { recursive: true });
mkdirSync(weeklyDir, { recursive: true });
writeFileSync(join(promoDir, `weekly-${dateTag}.md`), md);
writeFileSync(join(weeklyDir, `${dateTag}.html`), html);

const issues = readdirSync(weeklyDir)
  .filter((name) => /^\d{4}-\d{2}-\d{2}\.html$/.test(name))
  .sort()
  .reverse();
const indexHtml = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>长明楼 · 楼志周报</title>
<style>
  body { margin:0; background:#f6f1e7; color:#2b2a27; font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }
  main { max-width:680px; margin:0 auto; padding:48px 20px; }
  h1 { font-family:"Songti SC","Noto Serif SC",serif; font-size:30px; }
  a { color:#a33a2a; }
  li { margin:8px 0; }
</style>
</head>
<body>
<main>
  <p><a href="../">← 回长明楼</a></p>
  <h1>楼志周报</h1>
  <ul>
    ${issues.map((name) => `<li><a href="./${name}">${name.replace('.html', '')}</a></li>`).join('') || '<li>还没有周报。</li>'}
  </ul>
</main>
</body>
</html>
`;
writeFileSync(join(weeklyDir, 'index.html'), indexHtml);

console.log(md);
console.log(`已写入：promo/weekly-${dateTag}.md 和 docs/weekly/${dateTag}.html（共 ${issues.length} 期）`);
