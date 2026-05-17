# Morning Reader

家庭晨读管理工具。两个孩子（Mike 11岁 / Peyton 6岁）每天 7:00–8:00 朗读英文 PDF（牛津阅读树），系统录音、检测有效性、家长审核。每两周一次背诵考核。

## 快速启动

后端 + 前端通过 launchd 自启，Mac Mini 开机自动运行。手动控制：

```bash
# 状态
launchctl list | grep morningreader

# 重启
launchctl kickstart -k gui/$(id -u)/com.morningreader.backend
launchctl kickstart -k gui/$(id -u)/com.morningreader.frontend

# 日志
tail -f /tmp/morning-reader-backend.log
tail -f /tmp/morning-reader-frontend.log
```

详细运维见 docs/OPERATIONS.md。

## 访问

- 局域网: https://192.168.50.168:5173/
- mDNS:   https://JianhongdeMac-mini.local:5173/

证书是 mkcert 自签，iPhone/iPad 需要安装根 CA（见 docs/OPERATIONS.md）。

## 项目结构

```
backend/
  src/server.js      所有 REST API（单文件）
  src/db.js          SQLite schema + 预设数据 + 迁移
  src/adminAuth.js   PIN 鉴权中间件（X-Admin-Pin header）
frontend/
  src/pages/         HomePage, ReadingPage, RecitationPage,
                     ResultPage, ParentPage, HistoryPage
  src/hooks/useReadingRecorder.ts   录音 + 波形 + 静音检测
  src/lib/adminFetch.ts             家长鉴权 fetch 封装
  certs/             mkcert 本地证书（localhost + 局域网 IP）
data/
  morning-reader.db  SQLite 数据库
  recordings/        孩子录音文件（webm / mp4）
docs/                详细架构、API、数据模型、运维文档
~/Library/LaunchAgents/
  com.morningreader.backend.plist
  com.morningreader.frontend.plist
```

## 关键文档

- docs/ARCHITECTURE.md — 技术架构、UI 流程、朗读/背诵判定规则
- docs/DATA_MODEL.md   — SQLite schema 全集
- docs/API_SPEC.md     — 所有 REST 端点
- docs/OPERATIONS.md   — 启停、日志、mkcert、launchd、故障排查
- docs/ROLES.md        — Code_PM / Code_Executor AI 双角色协作模式

## 关键决策记录

- **PDF 目录可配置**：家长在 /parent 浏览选择，白名单 `/Users/homer` + `/Volumes`
- **书单模型**：cursor_pdf（起点相对路径）+ daily_count（每日本数），背诵通过后自动前进游标
- **录音状态判定优先级**：time_short > out_of_window > long_pause > high_silence > pdf_insufficient > pending_review
- **HTTPS**：mkcert 自签（局域网家庭工具足够用），前端 Vite 代理 /api → http://localhost:3001
- **扫描保护**：MAX_PDFS_PER_SCAN=5000，SCAN_TIMEOUT_MS=8000，跳过 `.` 开头和 node_modules 等噪声目录
- **Node 路径**：通过 fnm 管理，launchd plist 用稳定绝对路径 `/Users/homer/.local/share/fnm/node-versions/v22.22.0/installation/bin/node`
