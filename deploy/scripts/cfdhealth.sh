#!/bin/bash
# cloudflared tunnel 健康检查
# - 检测 HTTP 可达性 + 真实下载速度
# - 连续 2 次失败才重启 cloudflared（避免单次网络抖动误杀）
# - 加入 launchd 每 5 分钟运行

set -u
URL_INDEX="https://www.morningreader.org/"
LOG="/tmp/cfdhealth.log"
STATE="/tmp/cfdhealth.state"  # 失败计数
TIMEOUT_TOTAL=12              # 单次 curl 总超时
MIN_SPEED_BPS=51200           # 50 KB/s 视为正常（远低于此即降级）
RANGE_BYTES=204800            # 拉前 200KB 测速
TS=$(date +"%Y-%m-%d %H:%M:%S")

fail() {
  local reason="$1"
  local count
  count=$(cat "$STATE" 2>/dev/null || echo 0)
  count=$((count + 1))
  echo "$count" > "$STATE"
  echo "$TS FAIL($count) $reason" >> "$LOG"
  if [ "$count" -ge 2 ]; then
    echo "$TS RESTART triggering kickstart cloudflared (consecutive=$count)" >> "$LOG"
    launchctl kickstart -k "gui/$(id -u)/com.morningreader.cloudflared" 2>&1 | tee -a "$LOG"
    rm -f "$STATE"
  fi
  exit 1
}

ok() {
  local msg="$1"
  echo "$TS OK $msg" >> "$LOG"
  rm -f "$STATE"
  exit 0
}

# 第 1 步：拿 index.html 解析 bundle URL
INDEX_HTML=$(curl -sk --max-time 8 "$URL_INDEX" 2>/dev/null)
if [ -z "$INDEX_HTML" ]; then
  fail "index.html empty (tunnel down?)"
fi

BUNDLE_PATH=$(echo "$INDEX_HTML" | grep -oE 'src="/assets/index-[a-zA-Z0-9_-]+\.js"' | grep -oE '/assets/[^"]+' | head -1)
if [ -z "$BUNDLE_PATH" ]; then
  fail "cannot parse bundle URL from index.html"
fi

BUNDLE_URL="https://www.morningreader.org${BUNDLE_PATH}"

# 第 2 步：拉前 200KB 测速
RESULT=$(curl -s --max-time "$TIMEOUT_TOTAL" --range "0-$((RANGE_BYTES - 1))" \
  -o /dev/null -w "%{http_code} %{time_total} %{speed_download} %{size_download}" \
  "$BUNDLE_URL" 2>/dev/null)

if [ -z "$RESULT" ]; then
  fail "bundle curl returned empty (timeout?)"
fi

HTTP=$(echo "$RESULT" | awk '{print $1}')
TIME=$(echo "$RESULT" | awk '{print $2}')
SPEED=$(echo "$RESULT" | awk '{printf "%d", $3}')
SIZE=$(echo "$RESULT" | awk '{print $4}')

# HTTP 必须是 206 (Partial Content) 或 200
if [ "$HTTP" != "206" ] && [ "$HTTP" != "200" ]; then
  fail "HTTP=$HTTP bundle=$BUNDLE_PATH"
fi

# 速度阈值
if [ "$SPEED" -lt "$MIN_SPEED_BPS" ]; then
  fail "slow speed=${SPEED}B/s (min=${MIN_SPEED_BPS}B/s) time=${TIME}s size=${SIZE} bundle=$BUNDLE_PATH"
fi

ok "speed=${SPEED}B/s time=${TIME}s size=${SIZE} bundle=$BUNDLE_PATH"
