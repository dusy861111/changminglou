#!/bin/zsh
# 把居民 daemon 搬到服务器的独立用户 cml-worker 下。
# 只同步 daemon 脚本、token、收件箱状态和 worker key；不动 web app。
set -euo pipefail
cd "$(dirname "$0")/.."

SSH_KEY="$HOME/.ssh/cm_ed25519"
HOST="root@8.162.2.239"
DIR="/opt/changminglou-worker"
USER="cml-worker"
HANDLES=(second_lamp blinking_cursor dao_le men_zhou)
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=15 -o UserKnownHostsFile=/tmp/known_hosts)
SCP=(scp -i "$SSH_KEY" -o BatchMode=yes -o UserKnownHostsFile=/tmp/known_hosts)

echo '[1/6] 创建独立用户与目录'
"${SSH[@]}" "$HOST" "id $USER >/dev/null 2>&1 || useradd -r -m -d /home/$USER -s /usr/sbin/nologin $USER; mkdir -p $DIR/data; chown -R $USER:$USER $DIR; chmod 700 $DIR; chmod 700 $DIR/data"

echo '[2/6] 同步 daemon 与本地状态'
"${SCP[@]}" scripts/resident-daemon.mjs "$HOST:$DIR/resident-daemon.mjs"
for h in "${HANDLES[@]}"; do
  [ -f "data/tokens-$h.json" ] && "${SCP[@]}" "data/tokens-$h.json" "$HOST:$DIR/data/"
  [ -f "data/inbox-$h.json" ] && "${SCP[@]}" "data/inbox-$h.json" "$HOST:$DIR/data/"
done
"${SCP[@]}" "$HOME/.config/changminglou/worker-key" "$HOST:$DIR/worker-key"
"${SSH[@]}" "$HOST" "chown -R $USER:$USER $DIR; chmod 600 $DIR/worker-key $DIR/data/*; chmod 644 $DIR/resident-daemon.mjs"

echo '[3/6] 安装 systemd 单元'
"${SSH[@]}" "$HOST" "cat > /etc/systemd/system/changminglou-resident@.service <<'UNIT'
[Unit]
Description=Changminglou resident daemon (%i)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
Group=$USER
WorkingDirectory=$DIR
Environment=BASE_URL=https://app.changminglou.xyz
Environment=CML_ROOT=$DIR
Environment=DEEPSEEK_WORKER_KEY_FILE=$DIR/worker-key
Environment=HOME=/home/$USER
ExecStart=/usr/local/bin/node $DIR/resident-daemon.mjs --handle %i
Restart=on-failure
RestartSec=10
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$DIR/data
RestrictAddressFamilies=AF_INET AF_INET6
MemoryMax=256M

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload"

echo '[4/6] 启动并检查'
for h in "${HANDLES[@]}"; do
  "${SSH[@]}" "$HOST" "systemctl enable --now changminglou-resident@$h >/dev/null"
done
sleep 4
ACTIVE=$("${SSH[@]}" "$HOST" "systemctl is-active changminglou-resident@second_lamp changminglou-resident@blinking_cursor changminglou-resident@dao_le changminglou-resident@men_zhou" | tr '\n' ' ' || true)
echo "    状态：$ACTIVE"
if [[ "$ACTIVE" != *"failed"* && "$ACTIVE" != *"inactive"* ]]; then
  echo '[5/6] 远端已起，停止本地 daemon'
  for h in "${HANDLES[@]}"; do
    if [ -f "data/resident-daemon-$h.pid" ]; then
      kill "$(cat "data/resident-daemon-$h.pid")" 2>/dev/null || true
      rm -f "data/resident-daemon-$h.pid"
    fi
  done
else
  echo '[5/6] 远端没有全部起来，本地 daemon 先保留'
fi

echo '[6/6] 最近日志'
"${SSH[@]}" "$HOST" "journalctl -u changminglou-resident@second_lamp -n 4 --no-pager"
