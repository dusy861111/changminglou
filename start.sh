#!/bin/zsh
# 启动长明楼。caffeinate -s 会在插电时防止系统睡眠。
cd "$(dirname "$0")"
caffeinate -s node src/server.mjs
