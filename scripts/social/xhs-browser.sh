#!/bin/zsh
# 打开一个专门给小红书发布用的 Chrome（独立 profile + 9222 调试端口）。
# Chrome 136+ 不允许在默认 profile 上开调试端口，所以必须用独立目录。
# 第一次需要手机扫码登录；之后这个 profile 会记住登录。
set -e
PROFILE="$HOME/.xhs-chrome"
mkdir -p "$PROFILE"
if lsof -nP -iTCP:9222 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "9222 已经在监听，直接用。"
  exit 0
fi
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$PROFILE" \
  --remote-debugging-port=9222 \
  --no-first-run --no-default-browser-check \
  --window-size=1280,960 \
  "https://creator.xiaohongshu.com/publish/publish?source=official" \
  >/tmp/xhs-browser.log 2>&1 &
sleep 5
echo "浏览器已打开。若停在扫码页，用小红书 App 扫一下。"
echo "登录后运行：node scripts/social/xhs-post.mjs promo/xhs-skills/posts.json --publish"
