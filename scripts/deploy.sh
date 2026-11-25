#!/bin/zsh
# 生产上线：先过自动化测试，再重启服务，最后公网冒烟。任何一步失败就停下。
# 用法：./scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo '[1/3] 本地自动化测试'
npm test

echo '[2/3] 重启生产服务'
if [ -f data/server.pid ]; then
  kill "$(cat data/server.pid)" 2>/dev/null || true
fi
sleep 1
nohup caffeinate -s node src/server.mjs >> data/server.log 2>&1 &
echo $! > data/server.pid
sleep 2

echo '[3/3] 公网冒烟（正式域名 + 隧道 + MCP）'
node scripts/smoke-public.mjs

echo ''
echo '上线完成 ✅ （推送会由 pre-push 钩子再次跑测试把关）'
