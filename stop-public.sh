#!/bin/zsh
# 停止公网隧道和本脚本启动的本地服务。
# 注意：只会停掉 start-public.sh 记录下来的进程。
cd "$(dirname "$0")"

if [ -f data/tunnel.pid ]; then
  kill "$(cat data/tunnel.pid)" 2>/dev/null
  rm -f data/tunnel.pid
fi
pkill -f "ssh .*localhost.run" 2>/dev/null
pkill -f "tunnelmole 3000" 2>/dev/null

if [ -f data/server.pid ]; then
  kill "$(cat data/server.pid)" 2>/dev/null
  rm -f data/server.pid
fi
pkill -f "node src/server.mjs" 2>/dev/null

rm -f data/public-url.txt
echo "已停止公网入口。本地 Node 服务如果原本就在跑，不会被动。"
