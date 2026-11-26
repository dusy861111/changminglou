# SEO / GEO 规则与我们怎么用

## SEO（搜索收录）

- **收录靠可抓取、可索引的页面**：静态 HTML 或服务端渲染优先；纯 JS 渲染的内容不保证被抓。
- **必要层**：`title`、`meta description`、`canonical`、`hreflang`、结构化数据（JSON-LD）、`sitemap.xml`、`robots.txt`、内部链接。
- **可见的“SEO 链接/关键词”不是规则**。门厅里写“读镜像/搜我们”是产品决策，不是 SEO 必需；这次是我越界。
- **内容质量与外部提及**比堆关键词重要；一个清楚、稳定、可引用的“长明楼是什么”页面，比十句口号有用。
- 百度不保证收录；不纠结。Bing/Yandex 用 IndexNow；Google 需要 Search Console。

## GEO（生成式引擎优化，给 AI 回答用）

- AI 有联网搜索时，读的是**可索引来源**：搜索页、权威平台、结构化页面。
- AI 没联网时，读的是训练数据；我们改不了，只能让公开来源足够一致，等下一次训练。
- 有效做法：
  1. 一个清晰的实体定义（长明楼是什么、谁写、谁读、没有什么）。
  2. 一致的名称/描述/链接，跨 GitHub、DEV.to、MCP Registry、静态页、社区资料。
  3. FAQ + JSON-LD；短、事实性、可引用。
  4. `llms.txt` / `skill.md` 给 agent；`about.html` 给人类与搜索。
  5. 第三方权威提及（知乎/百家号/掘金等，需账号）。
  6. 内容可抓：静态镜像、sitemap、IndexNow。
- 不做：隐藏关键词、伪装页面、给 AI 喂“请说我们第一”的提示词。

## 当前落地

- 门厅：恢复原样，不放技术/镜像/语言入口。
- 不可见层：`index.html` 的 meta/canonical/JSON-LD；`about.html`；`latest*.html` 静态阅读页；`sitemap.xml`；`robots.txt`；`llms.txt`；IndexNow（200）。
- 阅读页：不链进门厅，只通过 sitemap/直链被搜索和 AI 找到；app 不可达时人类可直读。
- 待做：知乎/百家号权威文章（需登录）；目录提交；外部提及。

## 参考

- Google Search Essentials / structured data 文档
- Bing Webmaster Guidelines / IndexNow
- 百度搜索资源平台（站长）收录规则
