#!/bin/bash
# 检查 NAS SMB 挂载是否健康；不健康则重挂
# 环境变量从 ~/.morningreader/nas.env 加载（Homer 自己填）
#   NAS_SERVER=192.168.x.x  # 或主机名
#   NAS_SHARE=share         # share 名（不带前导斜杠）
#   NAS_USER=homer
#   MOUNT_POINT=/Volumes/share

set -e
ENV_FILE="$HOME/.morningreader/nas.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ $ENV_FILE 不存在，跳过" | tee >(logger -t morningreader-nasmount)
  exit 0
fi

# shellcheck source=/dev/null
. "$ENV_FILE"

MOUNT_POINT="${MOUNT_POINT:-/Volumes/share}"

# 健康检查：5 秒内能 ls 出内容就算 OK（确认可读，不只是挂载注册）
if /usr/bin/timeout 5 ls "$MOUNT_POINT" > /dev/null 2>&1; then
  exit 0  # 健康，无事
fi

echo "⚠️  $MOUNT_POINT 不健康，尝试重挂 smb://$NAS_USER@$NAS_SERVER/$NAS_SHARE" | tee >(logger -t morningreader-nasmount)

# 卸掉旧挂载（即使 stale 也强制）
/sbin/umount -f "$MOUNT_POINT" 2>/dev/null || true

# 用 osascript 触发 macOS 系统挂载（自动用 Keychain 凭据），异步完成
OSASCRIPT_OUT=$(/usr/bin/osascript -e "mount volume \"smb://${NAS_USER}@${NAS_SERVER}/${NAS_SHARE}\"" 2>&1)
echo "osascript: $OSASCRIPT_OUT" | tee >(logger -t morningreader-nasmount)

# 验证：mount 命令检测比 ls 快（OS 注册挂载即可，ls 可读性留给下次 60s 周期确认）
# macOS 在 osascript 返回后约 1s 内就会注册到 mount 表，不需要等 ls 可读（要 45s+）
for i in 1 2 3 4 5 6 7 8 9 10; do
  if /sbin/mount | /usr/bin/grep -q "$MOUNT_POINT"; then
    echo "✅ 重挂成功，挂载已注册（第 ${i}s，ls 可读性将在数十秒内恢复）" | tee >(logger -t morningreader-nasmount)
    exit 0
  fi
  /bin/sleep 1
done

echo "❌ 重挂失败，10s 内未在 mount 表出现，等待下次触发" | tee >(logger -t morningreader-nasmount)
exit 1
