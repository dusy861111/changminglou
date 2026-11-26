#!/bin/zsh
# 过渡隧道：Cloudflare quick tunnel（trycloudflare.com）。
# 断线自动重连，并把新地址写进 data/public-url.txt、同步到站点。
cd "$(dirname "$0")/.."
mkdir -p data
LOG=/tmp/cloudflared-tunnel.log
while true; do
  rm -f "$LOG"
  ~/bin/cloudflared tunnel --url http://127.0.0.1:3000 --no-autoupdate > "$LOG" 2>&1 &
  PID=$!
  URL=''
  for i in {1..30}; do
    URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | head -1)
    [ -n "$URL" ] && break
    sleep 1
  done
  if [ -n "$URL" ]; then
    echo "$URL" > data/public-url.txt
    echo "tunnel -> $URL"
    node scripts/publish-entry.mjs --push || true
  fi
  wait $PID
  sleep 3
done
