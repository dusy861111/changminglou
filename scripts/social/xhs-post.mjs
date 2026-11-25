#!/usr/bin/env node
// 小红书图文发布：读 posts.json，逐篇上传/填写/截图；带 --publish 才真的发。
// 先跑 scripts/social/xhs-browser.sh，并在弹出的浏览器里扫码登录。
//
// 用法：
//   node scripts/social/xhs-post.mjs promo/xhs-skills/posts.json            # 演练：只填不发
//   node scripts/social/xhs-post.mjs promo/xhs-skills/posts.json --publish  # 真的发
//   XHS_DELAY_SEC=300 ... --publish                                         # 篇间隔，默认 180 秒
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = process.argv[2];
if (!file) {
  console.error('用法：node scripts/social/xhs-post.mjs <posts.json> [--publish]');
  process.exit(1);
}
const shouldPublish = process.argv.includes('--publish');
const delaySec = Number(process.env.XHS_DELAY_SEC || 180);
const posts = JSON.parse(readFileSync(resolve(file), 'utf8'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.connect({
  browserURL: 'http://127.0.0.1:9222',
  defaultViewport: null,
  protocolTimeout: 300000
});

for (const [index, post] of posts.entries()) {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  page.on('dialog', (dialog) => dialog.accept().catch(() => {}));

  await page.goto(
    'https://creator.xiaohongshu.com/publish/publish?source=official',
    { waitUntil: 'domcontentloaded', timeout: 60000 }
  );
  await sleep(5000);

  if (page.url().includes('/login')) {
    console.error(`第 ${index + 1} 篇：创作平台的登录已失效，请先扫码登录再重跑。`);
    await page.close();
    break;
  }

  await page.evaluate(() => {
    const labels = ['离开', '放弃', '取消'];
    const target = [...document.querySelectorAll('button, div, span')].find(
      (element) =>
        element.children.length === 0 &&
        labels.includes(element.textContent.trim())
    );
    if (target) (target.closest('button, div') || target).click();
  });
  await sleep(2000);

  await page.evaluate(() => {
    const target = [...document.querySelectorAll('*')].find(
      (node) =>
        node.children.length === 0 && node.textContent.trim() === '上传图文'
    );
    if (target) (target.closest('div') || target).click();
  });
  await sleep(2500);

  const fileInputs = await page.$$('input[type=file]');
  if (!fileInputs.length) throw new Error('没有找到图片上传框');
  await fileInputs[0].uploadFile(resolve(post.image));
  await sleep(15000);

  const titleSelector = 'input[placeholder="填写标题会有更多赞哦"]';
  await page.waitForSelector(titleSelector, { timeout: 60000, visible: true });
  await page.$eval(
    titleSelector,
    (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      ).set;
      setter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    },
    post.title
  );

  const editor = await page.$('[contenteditable="true"]');
  if (!editor) throw new Error('没有找到正文编辑器');
  await editor.click();
  await page.evaluate((text) => {
    const element = document.querySelector('[contenteditable="true"]');
    element.focus();
    document.execCommand('insertText', false, text);
  }, post.body);
  await sleep(2500);

  const state = await page.evaluate((titleSelector) => ({
    title: document.querySelector(titleSelector)?.value,
    bodyLength:
      document.querySelector('[contenteditable="true"]')?.innerText.length || 0,
    buttons: [...document.querySelectorAll('button')]
      .map((button) => button.innerText.trim())
      .filter(Boolean)
  }), titleSelector);
  console.log(`第 ${index + 1} 篇已填好：`, JSON.stringify(state));

  const shot = `/tmp/xhs-filled-${index + 1}.png`;
  await page.screenshot({ path: shot });
  console.log('截图：', shot);

  if (shouldPublish) {
    const invoked = await page.evaluate(() => {
      const element = document.querySelector('xhs-publish-btn');
      if (!element || typeof element._onPublish !== 'function') return false;
      element._onPublish.call(element);
      return true;
    });
    console.log('触发发布：', invoked);
    await sleep(9000);
    const after = await page.evaluate(() => ({
      url: location.href,
      text: document.body.innerText.slice(0, 500)
    }));
    console.log('发布后：', JSON.stringify(after));
    await page.screenshot({ path: `/tmp/xhs-published-${index + 1}.png` });
  }

  await page.close();
  if (index < posts.length - 1 && delaySec > 0) {
    console.log(`等 ${delaySec} 秒再发下一篇……`);
    await sleep(delaySec * 1000);
  }
}

await browser.disconnect();
console.log(shouldPublish ? '完成。' : '演练完成，没有发布。加 --publish 才会真的发。');
