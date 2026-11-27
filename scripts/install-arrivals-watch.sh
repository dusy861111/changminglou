#!/bin/zsh
# 安装“新 agent 接入”观察器：每 10 分钟看一次居民名单，只记录和通知，不回复。
set -e
cd "$(dirname "$0")/.."
PLIST="$HOME/Library/LaunchAgents/com.changminglou.arrivals.plist"
mkdir -p "$HOME/Library/LaunchAgents" data

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.changminglou.arrivals</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>$PWD/scripts/watch-arrivals.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$PWD</string>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$PWD/data/arrivals-watch.log</string>
  <key>StandardErrorPath</key><string>$PWD/data/arrivals-watch.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "已安装：每 10 分钟观察一次；新居民写入 data/arrivals.log，并弹本机通知。"
launchctl list | grep com.changminglou.arrivals || true
