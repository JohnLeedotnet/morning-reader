# Architecture

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 Runtime | Node.js 22（fnm v22.22.0 管理） |
| 后端框架 | Express 4 |
| 数据库 | better-sqlite3（同步 SQLite） |
| 录音存储 | data/recordings/ 本地文件（webm/mp4） |
| 前端框架 | React 18 + TypeScript strict |
| 构建 | Vite 5 + vite-plugin-pwa |
| 样式 | Tailwind CSS v4（`@theme` 令牌，无 config.js） |
| PDF 渲染 | react-pdf@10（pdfjs-dist 5.4.296） |
| 路由 | React Router v6 |
| HTTPS | mkcert 自签证书 |
| 进程管理 | macOS launchd（KeepAlive 崩溃自重启） |

## 部署拓扑

```
Mac Mini (192.168.50.168)
├── launchd → backend  node:3001  (HTTP, Express)
├── launchd → frontend vite:5173  (HTTPS, mkcert)
│   └── proxy /api/* → http://localhost:3001
├── data/morning-reader.db
├── data/recordings/
└── PDF 源（可配置，白名单 /Users/homer + /Volumes）
    ├── /Users/homer/Documents/牛津树1-9级 PDF/  （默认）
    └── /Volumes/share/Study/英语/...            （NAS 挂载）

家庭设备（局域网）
├── iPhone Safari（PWA 模式）
├── iPad Safari（PWA 模式）
└── Mac 浏览器
```

## UI 路由流程

| 路径 | 页面 | 说明 |
|---|---|---|
| `/` | HomePage | 两孩子卡 + 家庭工具入口（照片库） |
| `/reading/:id` | ReadingPage | PDF 展示 + 录音控制 |
| `/recitation/:id` | RecitationPage | 背诵考核（无 PDF，只录音） |
| `/result/:id` | ResultPage | 提交结果展示 |
| `/parent` | ParentPage | 家长面板（PIN → 待审 / 书单 / 考核计划） |
| `/history/:id` | HistoryPage | 孩子历史记录 |
| `/mic-test` | — | 麦克风诊断（开发期保留） |
| `/pdf-test` | — | PDF 渲染诊断（开发期保留） |

## 朗读有效性判定（按优先级）

```
1. total_duration_s < minDur（child.min_duration_s 或 config.min_duration_s）
   → time_short

2. start_time 不在 config.window_start ~ config.window_end（HH:MM 字符串比较）
   → out_of_window

3. max_silence_s > config.max_consecutive_silence_s（默认 15s）
   → long_pause

4. total_silence_s / total_duration_s > config.max_silence_ratio（默认 0.2）
   → high_silence

5. pdfs_opened < session.pdfs_required
   → pdf_insufficient

6. 全部通过 → pending_review
   家长审核 → passed / redo_required
```

## 背诵考核判定（RecitationPage）

与朗读相同流程，但：
- 时长门槛为 `floor(minDur / 2)`（背诵比朗读短）
- 跳过 out_of_window 和 pdf_insufficient 检查

## 录音 + 静音检测（useReadingRecorder.ts）

- RMS 阈值 0.01 → 低于视为静音
- 持续 0.5s 计一次 silence_count
- 持续 ≥ max_consecutive_silence_s → voiceStatus = 'long_pause'（UI 红色提示）
- MediaRecorder：Chrome/Firefox webm/opus，iOS Safari fallback mp4

## PDF 扫描

- 递归扫描 getPdfDir() 下所有 .pdf
- MAX_PDFS_PER_SCAN = 5000，SCAN_TIMEOUT_MS = 8000（全局共享，非每目录独立）
- 跳过 `.` 开头目录及 SKIP_DIR_NAMES（.Trashes, node_modules 等）
- 结果缓存在 `_allPdfsCache = { dir, results, truncated }`；pdf_dir 变化时自动失效

## 鉴权

- 家长操作：`X-Admin-Pin` 请求头（或 body.pin）由 adminAuth 中间件验证
- 录音文件下载：`GET /api/admin/sessions/:id/recording?pin=xxxx`（query param，供 `<audio>` src 直链）
- PIN 空字符串 = 未设置，拒绝所有 admin 请求

## UI 风格令牌（Tailwind @theme）

```
cream       #FFF5EB   页面背景
peach       #E07A5F   主交互色（按钮、高亮）
peach-deep  #C54B38   Peyton 大字按钮、考核标识
mint        #81B29A   合格状态
shell-dark  #4A3020   录音区深色背景
brown-text  #3D2B1F   正文
brown-mute  #7A5C4A   次要文字
```
