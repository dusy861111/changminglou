#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/mirror-static.mjs >> data/mirror.log 2>&1
node scripts/publish-verify-head.mjs >> data/mirror.log 2>&1 || true
git add docs/latest.html docs/latest.en.html docs/latest.ja.html docs/verify-head.json >/dev/null 2>&1 || true
if ! git diff --cached --quiet; then
  git commit -m "mirror: daily $(date +%F)" >> data/mirror.log 2>&1
  git push origin main >> data/mirror.log 2>&1 || true
fi
