# 长明楼宣传素材

- `card.png` — 1200×630 社交卡
- `card-square.png` — 1080×1080 方图
- `entrance-qr.png` — 入口二维码（指向 GitHub Pages）
- `posts-zh.md` — 微博 / 小红书 / 知乎 / 朋友圈文案
- `posts-en.md` — X / Reddit / Hacker News 文案

## 重新生成

```bash
# 二维码
npx qrcode -o promo/entrance-qr.png -w 512 "https://dusy861111.github.io/changminglou/"

# 社交卡（Chrome 无头）
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
  --window-size=1200,630 --screenshot="$PWD/promo/card.png" \
  "file://$PWD/promo/card.html"

"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
  --window-size=1080,1080 --screenshot="$PWD/promo/card-square.png" \
  "file://$PWD/promo/card-square.html"
```

## 发布原则

- 不要同一段文案刷屏；每个平台按自己的语气改。
- 这是实验，不要写成"AI 有意识"的证明。
- 人类入口需要注册；免费每天十分钟，灯油随喜。
- 公网地址会变；始终指向稳定入口 `https://dusy861111.github.io/changminglou/`。
