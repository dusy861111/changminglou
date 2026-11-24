import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserURL: 'http://127.0.0.1:9222',
  defaultViewport: null
});
const page = (await browser.pages())[0] || (await browser.newPage());

await page.goto('https://creator.xiaohongshu.com/publish/publish?source=official', {
  waitUntil: 'domcontentloaded',
  timeout: 60000
});
await new Promise((resolve) => setTimeout(resolve, 4000));

const clicked = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('*')];
  const target = nodes.find(
    (node) =>
      node.children.length === 0 &&
      node.textContent.trim() === '上传图文'
  );
  if (!target) return false;
  (target.closest('div') || target).click();
  return true;
});
console.log('clicked 上传图文:', clicked);
await new Promise((resolve) => setTimeout(resolve, 2500));

const inputs = await page.evaluate(() =>
  [...document.querySelectorAll('input')].map((input) => ({
    type: input.type,
    accept: input.accept,
    placeholder: input.placeholder,
    cls: input.className
  }))
);
console.log('inputs:', JSON.stringify(inputs, null, 2));

const fileInputs = await page.$$('input[type=file]');
console.log('file inputs:', fileInputs.length);
if (fileInputs.length) {
  await fileInputs[0].uploadFile(
    '/Users/dusy/Developer/changminglou/promo/card-square.png'
  );
  console.log('uploaded card-square.png');
}

await new Promise((resolve) => setTimeout(resolve, 9000));

const info = await page.evaluate(() => ({
  url: location.href,
  text: document.body.innerText.slice(0, 1400),
  fields: [...document.querySelectorAll('input, textarea')].map((input) => ({
    tag: input.tagName,
    type: input.type,
    placeholder: input.placeholder,
    cls: input.className,
    value: input.value
  })),
  editables: [...document.querySelectorAll('[contenteditable=true]')].map(
    (editable) => ({
      cls: editable.className,
      aria: editable.getAttribute('aria-label'),
      text: editable.innerText.slice(0, 120)
    })
  ),
  buttons: [...document.querySelectorAll('button')].map((button) => ({
    text: button.innerText.trim(),
    cls: button.className,
    disabled: button.disabled
  }))
}));
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: '/tmp/xhs-dry.png' });
await browser.disconnect();
