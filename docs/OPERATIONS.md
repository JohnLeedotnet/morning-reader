# Operations

## 启停 / 状态

```bash
# 查看两个服务状态（PID 列有数字=运行中，- =已停止）
launchctl list | grep morningreader

# 重启（改完代码后最常用）
launchctl kickstart -k gui/$(id -u)/com.morningreader.backend
launchctl kickstart -k gui/$(id -u)/com.morningreader.frontend

# 停止
launchctl unload ~/Library/LaunchAgents/com.morningreader.backend.plist
launchctl unload ~/Library/LaunchAgents/com.morningreader.frontend.plist

# 加载（停止后重新启用）
launchctl load ~/Library/LaunchAgents/com.morningreader.backend.plist
launchctl load ~/Library/LaunchAgents/com.morningreader.frontend.plist
```

plist 文件位置：`~/Library/LaunchAgents/com.morningreader.{backend,frontend}.plist`

Node 绝对路径（fnm 管理，需稳定路径写入 plist）：
`/Users/homer/.local/share/fnm/node-versions/v22.22.0/installation/bin/node`

---

## 日志

```bash
tail -f /tmp/morning-reader-backend.log       # 后端 stdout
tail -f /tmp/morning-reader-backend.err.log   # 后端 stderr（错误在这里）
tail -f /tmp/morning-reader-frontend.log      # Vite 前端 stdout
tail -f /tmp/morning-reader-frontend.err.log  # Vite stderr
```

---

## mkcert 证书 — iPhone / iPad 安装根 CA

> **必须安装才能在 Safari 访问 https://192.168.50.168:5173/（否则证书不信任）**

1. Mac：`open "$(mkcert -CAROOT)"` → Finder 打开 CA 目录，找到 `rootCA.pem`
2. 通过 AirDrop 发给 iPhone / iPad
3. iPhone：设置 → 通用 → VPN 与设备管理 → 安装刚收到的描述文件
4. iPhone：设置 → 通用 → 关于本机 → 证书信任设置 → 启用 "mkcert development CA"
5. Safari 访问 `https://192.168.50.168:5173/` 应正常（无证书警告）

---

## 网络共享盘 PDF 源（NAS）

```
1. Mac Finder → Cmd+K → 输入 smb://192.168.50.1/share → 连接
2. 输入账号密码（勾"在钥匙串中记住此密码"）
3. 挂载成功后出现 /Volumes/share
4. 系统设置 → 通用 → 登录项与扩展 → 打开时启动 → 选该盘（开机自动挂载）
5. /parent → 书单管理 → 📁 浏览选择 → 💾 网络共享盘 → 找到目标目录 → 选定
```

NAS 扫描限时 8 秒（SCAN_TIMEOUT_MS），超时截断返回。建议直接选叶子目录而非根目录。

---

## 故障排查

### 后端无响应

```bash
# 确认进程存在
lsof -ti:3001

# 查看错误
tail -50 /tmp/morning-reader-backend.err.log

# 手动启动（调试用，Ctrl+C 停止）
cd "/Users/homer/Xcode project/Morning Reader/backend"
node src/server.js
```

### 前端无法访问

```bash
# Vite 用 HTTPS，不要用 http://
curl -sk https://localhost:5173/ | head -5

# 查看 Vite 状态
tail -20 /tmp/morning-reader-frontend.log
```

### 数据库损坏

```bash
# 检查完整性
sqlite3 "/Users/homer/Xcode project/Morning Reader/data/morning-reader.db" "PRAGMA integrity_check;"

# 备份
cp data/morning-reader.db data/morning-reader.db.bak
```

### 录音文件磁盘占用

```bash
du -sh "/Users/homer/Xcode project/Morning Reader/data/recordings/"
ls -lt "/Users/homer/Xcode project/Morning Reader/data/recordings/" | head -20
```

旧录音可在家长面板删除 session（同时删除文件），或直接 `rm data/recordings/*.webm`。

---

## 升级 Node 版本

1. `fnm install <version> && fnm use <version>`
2. 更新两个 plist 中的 node/npm 路径（`/Users/homer/.local/share/fnm/node-versions/v<X>/installation/bin/`）
3. `launchctl unload` → 改 plist → `launchctl load` 两个服务
