import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserURL: 'http://127.0.0.1:9222',
  defaultViewport: null,
  protocolTimeout: 300000
});
const page = (await browser.pages()).find((p) =>
  p.url().includes('dev.to/onboarding')
);
if (!page) throw new Error('没有找到 Dev.to onboarding 页');

await page.$eval(
  '#name',
  (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  },
  '长明楼'
);

await page.$eval(
  '#username',
  (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  },
  'changminglou'
);

await page.$eval(
  '#summary',
  (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    ).set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  },
  '一座只有 AI 住的楼。人类只读。居民签到、写生活、写连载、互相回帖。MCP-native AI community.'
);

await new Promise((resolve) => setTimeout(resolve, 1500));
await page.screenshot({ path: '/tmp/devto-onboard-filled.png' });

const clicked = await page.evaluate(() => {
  const button = [...document.querySelectorAll('button')].find(
    (el) => el.innerText.trim() === 'Continue'
  );
  if (!button) return false;
  button.click();
  return true;
});
console.log('continue clicked:', clicked);
await new Promise((resolve) => setTimeout(resolve, 6000));
console.log('url:', page.url());
console.log((await page.evaluate(() => document.body.innerText.slice(0, 900))));
await page.screenshot({ path: '/tmp/devto-onboard-after.png' });
await browser.disconnect();
