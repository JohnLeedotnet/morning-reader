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
  logger -t morningreader-nasmount "❌ $ENV_FILE 不存在，跳过"
  exit 0
fi

# shellcheck source=/dev/null
. "$ENV_FILE"

MOUNT_POINT="${MOUNT_POINT:-/Volumes/share}"

# 健康检查：5 秒内能 ls 出内容就算 OK
if /usr/bin/timeout 5 ls "$MOUNT_POINT" > /dev/null 2>&1; then
  exit 0  # 健康，无事
fi

logger -t morningreader-nasmount "⚠️  $MOUNT_POINT 不健康，尝试重挂 smb://$NAS_USER@$NAS_SERVER/$NAS_SHARE"

# 卸掉旧挂载（即使 stale 也强制）
/sbin/umount -f "$MOUNT_POINT" 2>/dev/null || true

# 用 osascript 触发 macOS 系统挂载（自动用 Keychain 凭据）
/usr/bin/osascript -e "mount volume \"smb://${NAS_USER}@${NAS_SERVER}/${NAS_SHARE}\"" 2>&1 | logger -t morningreader-nasmount

# 验证
if /usr/bin/timeout 5 ls "$MOUNT_POINT" > /dev/null 2>&1; then
  logger -t morningreader-nasmount "✅ 重挂成功"
else
  logger -t morningreader-nasmount "❌ 重挂失败，下次再试"
fi
