# Morning Reader — 当前状态

## Sprint: 2 第一轮修正 2（竖屏 PDF 不裁切 + 测试书目替换）
## 状态: 完成 — 等待 Code_PM 第二轮指令
## 最后更新: 2026-05-11

## ✅ 已完成（Sprint 0）
- 目录结构、backend、frontend 初始化
- mkcert HTTPS、pdfjs-dist 版本统一

## ✅ 已完成（Sprint 1 完整）
- SQLite 6 张表、预置数据
- 7 个后端 API（children, pool, pdfs/list, pdfs/file, config, sessions CRUD）
- HomePage、ReadingPage、ResultPage 基础版
- useReadingRecorder hook（AudioContext + MediaRecorder + 静音检测）

## ✅ 已完成（Sprint 1.5）
- 3 个风格 mockup HTML（warm / bright / minimal）
- Homer_PM 选定：温暖晨光风（mockup-warm.html）

## ✅ 已完成（Sprint 2 第一轮 + 修正 + 修正 2）
- **设计令牌（Tailwind v4 @theme）**：11 个暖色 + Nunito 字体，index.css
- **HomePage.tsx**：cream 背景、白卡片、mint 圆点、动态字号（font_scale × base）、peach/peach-deep 按钮
- **ReadingPage.tsx**：shell-dark 壳、cream-pdf PDF 区、渐变录音按钮、animate-ping 光晕、60 柱波形
  - **字号数据化**：children.font_scale 字段（mike=1.0, peyton=1.25），状态栏姓名 20×scale，按钮文字 13×scale
  - **PDF 响应式**：ResizeObserver 实测宽度，5 档 maxW 断点（440/720/1400px），±2 翻页（dual）/±1（single），isDualPage 变化时 reset 到 page=1
  - **PDF 高度自适应（修正 2）**：aspectRatio state（getViewport 真实比例），pageWidth = min(宽约束, 高×比例)，竖屏 PDF 不再裁切；Mike 测试书目换成竖屏 Duck Race + 横屏 At school
- **ResultPage.tsx**：状态徽章按颜色分级、10 行数据表、warn 标红
- **GET /api/children/:id**：新增单孩子端点
- TypeScript build 0 错误，67 模块编译成功

## 🔴 当前阻塞
- mkcert -install 需要 Homer_PM 手动执行（iOS Safari 证书信任）

## 📋 关键路径决策记录
- 架构: Web App (React + Node.js), 局域网服务
- UI 风格: 温暖晨光（cream #FFF5EB，peach #E07A5F，mint #81B29A，shell-dark #4A3020）
- Tailwind: v4（无 config.js，用 @theme 定义令牌）
- PDF 源: /Users/homer/Documents/牛津树1-9级 PDF/（270个，9级）
- 录音存储: data/recordings/{child_id}_{session_id}_{timestamp}.{ext}
- 状态判定优先级: time_short > out_of_window > long_pause > high_silence > pdf_insufficient > pending_review
- SQLite: data/morning-reader.db（better-sqlite3@12.9.0）
- pdfjs-dist: 5.4.296（与 react-pdf@10.4.1 内置版本一致）✅
