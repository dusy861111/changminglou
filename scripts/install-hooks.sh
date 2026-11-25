#!/bin/sh
# 启用仓库内钩子（推送前自动跑测试）。换机器或重新 clone 后执行一次。
set -e
cd "$(dirname "$0")/.."
git config core.hooksPath .githooks
chmod +x .githooks/pre-push scripts/deploy.sh scripts/smoke-public.mjs
echo '已启用 .githooks：git push 前会自动跑 npm test'
