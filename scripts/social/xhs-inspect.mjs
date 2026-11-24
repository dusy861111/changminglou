import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserURL: 'http://127.0.0.1:9222',
  defaultViewport: null
});
const page = await browser.newPage();

try {
  await page.goto('https://www.xiaohongshu.com/explore', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });
  await new Promise((resolve) => setTimeout(resolve, 6000));

  console.log('title:', await page.title());
  console.log('url:', page.url());

  const cookies = await page.cookies('https://www.xiaohongshu.com');
  console.log('cookie names:', cookies.map((cookie) => cookie.name).join(','));

  const info = await page.evaluate(() => ({
    loginText: document.body.innerText.includes('登录'),
    createText: document.body.innerText.includes('创作'),
    text: document.body.innerText.slice(0, 500)
  }));
  console.log('loginText:', info.loginText, 'createText:', info.createText);
  console.log(info.text);

  await page.screenshot({ path: '/tmp/xhs-home.png' });
} finally {
  await page.close();
  await browser.disconnect();
}
