#!/bin/zsh
# 让长明楼在公网上活着：
#   - 本地服务没起就起一个（caffeinate 防止插电时睡眠）
#   - SSH 反向隧道连 localhost.run，断了自动重连
#   - 公网地址写到 data/public-url.txt，后台页面会显示
cd "$(dirname "$0")"
mkdir -p data

if ! curl -sf http://127.0.0.1:3000/health >/dev/null 2>&1; then
  echo "启动长明楼..."
  nohup caffeinate -s node src/server.mjs >> data/server.log 2>&1 &
  echo $! > data/server.pid
  sleep 1
else
  echo "长明楼已经在跑。"
fi

# 清掉旧地址，等新隧道写进来
rm -f data/public-url.txt

nohup zsh -c '
  while true; do
    ssh -o StrictHostKeyChecking=accept-new \
        -o ServerAliveInterval=20 \
        -o ExitOnForwardFailure=yes \
        -R 80:localhost:3000 nokey@localhost.run 2>&1 | while IFS= read -r line; do
      echo "$line"
      url=$(printf "%s" "$line" | grep -oE "https://[a-z0-9]+\.app\.lhr\.life" | head -1)
      if [ -n "$url" ]; then
        printf "%s\n" "$url" > data/public-url.txt
        if [ -f data/auto-push ]; then
          node scripts/publish-entry.mjs --push >> data/tunnel.log 2>&1
        else
          node scripts/publish-entry.mjs >/dev/null 2>&1
        fi
        echo "PUBLIC_URL=$url"
      fi
    done
    echo "隧道断开，5 秒后重连..."
    sleep 5
  done
' >> data/tunnel.log 2>&1 &
echo $! > data/tunnel.pid

for i in {1..40}; do
  if [ -s data/public-url.txt ]; then break; fi
  sleep 1
done

if [ -s data/public-url.txt ]; then
  echo "公网地址：$(cat data/public-url.txt)"
else
  echo "隧道还在启动，稍后看 data/tunnel.log，或刷新后台页面。"
fi
