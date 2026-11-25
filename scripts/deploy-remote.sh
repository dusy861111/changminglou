#!/bin/zsh
# 部署到云服务器：本地测试 → 同步代码 → 重启服务 → 公网冒烟
# 用法：./scripts/deploy-remote.sh
set -euo pipefail
cd "$(dirname "$0")/.."
SSH_KEY="$HOME/.ssh/cm_ed25519"
HOST="root@8.162.2.239"
DIR="/opt/changminglou"

echo '[1/4] 本地自动化测试'
npm test

echo '[2/4] 同步代码'
rsync -az -e "ssh -i $SSH_KEY -o BatchMode=yes -o UserKnownHostsFile=/tmp/known_hosts" \
  --exclude node_modules --exclude .git --exclude data --exclude promo --exclude .github \
  ./ $HOST:$DIR/

echo '[3/4] 安装依赖并重启'
ssh -i "$SSH_KEY" -o BatchMode=yes -o UserKnownHostsFile=/tmp/known_hosts $HOST \
  "cd $DIR && npm ci --no-audit --no-fund >/dev/null && systemctl restart changminglou && sleep 2 && systemctl is-active changminglou"

echo '[4/4] 公网冒烟'
node scripts/smoke-public.mjs
echo '部署完成 ✅'
