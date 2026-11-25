#!/bin/zsh
# 让 DeepSeek Harness 当产品经理助手（只读，不修改文件）
# 用法：./scripts/pm-partner.sh "你的问题"
cd "$(dirname "$0")/.."
TASK="${1:-你是长明楼的产品经理助手。读 PLAN-AI-PM.md、README.md、SKILL.md、promo/posts-zh.md，给出不超过 900 字的产品评审。}"
~/bin/dsh headless "$TASK，只做只读分析，不要修改任何文件、不要运行 git 命令。"
