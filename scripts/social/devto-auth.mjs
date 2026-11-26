import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserURL: 'http://127.0.0.1:9222',
  defaultViewport: null,
  protocolTimeout: 300000
});

const page = (await browser.pages()).find((p) =>
  p.url().includes('github.com/login/oauth/authorize')
);
if (!page) throw new Error('没有找到 GitHub 授权页');

const buttons = await page.$$('button[type=submit]');
let clicked = false;
for (const button of buttons) {
  const text = await button.evaluate((el) => el.innerText.trim());
  if (text.includes('Authorize')) {
    await button.click().catch(() => {});
    clicked = true;
    break;
  }
}
console.log('handle click:', clicked);
await new Promise((resolve) => setTimeout(resolve, 8000));
console.log('url1:', page.url());

if (page.url().includes('github.com/login/oauth/authorize')) {
  const submitted = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button[type=submit]')].find(
      (el) => el.innerText.includes('Authorize')
    );
    if (!button) return false;
    const form = button.closest('form');
    if (form) {
      form.requestSubmit(button);
      return true;
    }
    button.click();
    return true;
  });
  console.log('requestSubmit:', submitted);
  await new Promise((resolve) => setTimeout(resolve, 8000));
}

console.log('url2:', page.url());
console.log((await page.evaluate(() => document.body.innerText.slice(0, 900))));
await page.screenshot({ path: '/tmp/devto-after-oauth3.png' });
await browser.disconnect();
