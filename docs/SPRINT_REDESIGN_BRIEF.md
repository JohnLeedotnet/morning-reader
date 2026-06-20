# Morning Reader 重设计 Brief（给 Claude Design）

> **版本**：Sprint Claude-Design-Onboarding · 2026-06-20
> **作者**：Code_PM（Claude Code Terminal）
> **目标读者**：Claude Design

---

## 0. 项目背景 + Demo 账号凭证

### 产品简介
Morning Reader 是家庭儿童英文 PDF 朗读管理工具。
- **用户**：Mike（11 岁）/ Peyton（6 岁）+ 家长 Homer
- **场景**：每天 7:00–8:00，孩子朗读英文牛津阅读树 PDF，系统录音 + 检测有效性，家长审核
- **设备**：iPhone / iPad / Mac / Windows（4 端响应）
- **语言**：全网站**全中文**（按钮、标签、错误文案，包括英文 PDF 书名旁也不做英文 UI）

### Demo 账号（请用这个登录，**不要碰 Homer 真实账号数据**）

| 字段 | 值 |
|------|-----|
| URL | https://www.morningreader.org/ |
| Email | design-test@morningreader.local |
| Password | EL9De2VWCNl7nYKmAa1! |
| 家长 PIN | 2468 |
| Demo 孩子 | demo-child-1（11 岁，仿 Mike）/ demo-child-2（6 岁，仿 Peyton）|

**完成 review 后请告知 Homer 删除 demo 账号。**

> 如登录遇到问题（邮件 OTP 流程）：直接用 Email + Password 走"密码登录"路径。

---

## 1. 视觉总方向（已由 Homer 确认）

### 孩子端：Sports 风
- 纯黑底 `#000000` + 卡片 `#0E0E0E`
- 强调色：peach `#E07A5F` / mint `#81B29A` / yellow `#FFD60A` / orange `#FF9F0A`
- 字体：`"PingFang SC"` 中文 / `"SF Pro Rounded"` 数字
- 感觉：运动手环 / Nike Training App / 每日运动记录

### 家长端：Music 风（暖深棕）
- 背景 `#0A0708` / 卡片 `#1C1614`
- 同样的强调色（peach / mint / yellow）
- 感觉：Spotify 暗色 / Apple Music / 精致暖调

### 全局约束
- ❌ 禁 `text-transform: uppercase`（中文不能大写）
- ❌ 禁 `letter-spacing > 0.04em` 用于中文（数字 OTP 例外）
- ✅ 中文字号 11–18px，font-weight 600–700
- ✅ 数字：`font-variant-numeric: tabular-nums`，SF Pro Rounded
- ✅ 圆角：大卡片 16–20px / 按钮 12–14px / chip 20px

---

## 2. 11 页风格表

| 页 | 路径 | 用户 | 风格 | 状态 |
|----|------|------|------|------|
| 首页 | `/` | 孩子 | Sports | 待重设计 |
| 朗读页 | `/reading/:childId` | 孩子 | Sports | 待重设计 |
| 结果页 | `/result/:sessionId` | 孩子 | Sports | 待重设计 |
| 历史页 | `/history/:childId` | 孩子 | Sports | 待重设计 |
| 背诵页 | `/recitation/:childId` | 孩子 | Sports（沉浸式）| 待重设计 |
| 登录页 | `/login` | 公共 | Sports（卡片居中）| 待重设计 |
| 注册页 | `/register` | 公共 | Sports（卡片居中）| 待重设计 |
| 找回密码 | `/forgot-password` | 公共 | Sports（卡片居中）| 待重设计 |
| 家长面板 | `/parent` | 家长 | Music | 待重设计 |
| PDF 批注 | `/parent`（内嵌组件）| 家长 | Music | 待重设计 |
| 游戏页 | `/game/:gameId` | 孩子 | Sports（沉浸式）| 待重设计 |

---

## 3. Sports 风 Design Tokens

```css
/* 背景 */
--bg:        #000000;
--card:      #0E0E0E;
--border:    rgba(255,255,255,0.1);  /* 0.5px */

/* 强调色 */
--peach:     #E07A5F;
--peach-deep:#C4553A;
--mint:      #81B29A;
--yellow:    #FFD60A;
--orange:    #FF9F0A;
--red:       #FF453A;

/* 文字 */
--text:      #FFFFFF;
--muted:     rgba(255,255,255,0.5);
--caption:   rgba(255,255,255,0.35);

/* 字体 */
--font-cn:   "PingFang SC", -apple-system, sans-serif;
--font-num:  "SF Pro Rounded", system-ui;

/* 字号 */
--h1: 24px 700;
--h2: 20px 700;
--body: 16px 500;
--caption: 13px 600;
--kpi: 48–56px 800;

/* 间距 */
--radius-card: 16px;
--radius-btn:  14px;
--radius-chip: 20px;
```

---

## 4. Music 风 Design Tokens（家长端）

```css
--bg:    #0A0708;
--card:  #1C1614;
/* 强调色与 Sports 相同 */
/* 字体与 Sports 相同 */
/* 字号与 Sports 相同 */
```

---

## 5. 全局 UI 约束（D54）

以下规则来自 Homer 明确确认，**一律不能违反**：

1. **全中文**：所有 UI 文案中文，包括 Toast、错误提示、按钮、Tab 标签
2. **禁大写**：`text-transform: uppercase` 禁用
3. **禁宽字距**：中文 `letter-spacing` 不得 > 0.04em
4. **中文字体**：`PingFang SC` 首选
5. **数字字体**：`SF Pro Rounded` + `font-variant-numeric: tabular-nums`
6. **TabBar 高度**：孩子端 60px 纯黑；家长端 60px `#1C1614` 暖深棕
7. **沉浸式页面**（朗读页/背诵页/游戏页）：**无 TabBar**
8. **孩子端 TabBar 4 项**：🏠 首页 / 🕐 历史 / 👥 全家 / ⚙ 设置
9. **家长端 TabBar 5 项**：🏠 首页 / 📋 审核 / 🎓 考核 / 📚 书架 / 👥 全家
10. **响应式**：mobile 375 / iPad 768 / desktop 1280，同一代码适配

---

## 6. 关键功能决策（D1–D55，已由 Homer 确认，不能改变）

### 首页（孩子端）
- **D1** 每孩子一张大卡，显示今日状态（未开始 / 进行中 / 已完成 / 已通过）
- **D2** 进度环（SVG，r=82，circumference=515.2）显示毕业进度（read_count / advance_after_reads）
- **D3** 🔥 连续天数 streak badge
- **D4** 全家汇总模块（两孩子本周通过率/总次数）
- **D5** 点孩子卡 → 进入朗读或背诵（根据今日任务类型）

### 朗读页
- **D6** 6 KPI 磁贴横排（孩子姓名 / 朗读套装 / 已计时 / 本数进度 / 每日本数 / 设置入口）
- **D7** PDF 展示区（WebView 内嵌 PDF）
- **D8** ‹ › 翻页按钮（桌面端默认可见，D53）
- **D9** 80px 底部录音控制栏（录音波形 / 计时 / 停止按钮）
- **D10** 无 TabBar（沉浸式）
- **D11** ⚙ 菜单：跳过今日 / 调 PDF 起点 / 结束录音

### 结果页
- **D25** 8 种状态 badge（passed / pending_review / time_short / out_of_window / long_pause / high_silence / pdf_insufficient / redo_required）
- **D26** 毕业进度环（仅 passed/pending_review 显示）
- **D27** 与上次对比卡（时长/静音/已读 delta）
- **D28** 状态说明条（仅失败状态显示）
- **F3** 🎧 回听录音按钮（仅 passed/pending_review 显示）
- **F4** 🔥 连续天数 streak banner（仅 passed 显示）
- **彩蛋** 🎁 解锁彩蛋按钮（需 qualifies_for_egg=1，即 时长+时段+N本全读完 3条件 AND）

### 历史页
- **D29** 4 KPI 磁贴（本周朗读次数/通过率/待考核/累计）
- **D30** 日期分组列表（今天/昨天/本周/上周/更早）
- **D31** 双行筛选 chip（类型/状态）
- **D32** 展开详情（mini KPI + PDF 缩略 + 家长批注 + 回听）

### 背诵页
- **D22** 6 KPI 磁贴横排（同朗读页格式）
- **D23** 💡 求助 sheet（L1封面/L2关键词/L3首句，每用 -1 分）
- **D24** 30 秒静音检测 → 弹「看起来你背完了？」toast
- **D10** 无 TabBar（沉浸式）

### 家长面板
- **D33** 单一登录流（邮箱 → 智能分支：有密码/无密码OTP）
- **D34** 无密码 OTP 模式（6 位验证码）
- ~~D35~~ Apple Sign-In 留位 **已撤销**，不做
- **D36** 注册 2 步 Stepper（邮箱验证 → 设置账号）
- **D37** 注册按钮文案「注册并配置全家」
- **D38** 找回密码 2 步 Stepper
- **D39** Onboarding 4 步向导（欢迎+PIN / 添加孩子 / 选起点书 / 配置完成）
- **D40** 弱 PIN 检测
- **D41** 按年龄推荐起点书
- **D42** 游戏结算（奖杯累计 + 时间到全屏遮罩）
- **D43** 丢弃录音教育性提示（too_short / too_silent）
- **D44** 丢弃页 CTA（再试一次 / 返回首页）
- **D45** Debug 页 env-guard（不做 mockup）
- **D46** PDF 批注自动跟随 toggle
- **D47** 批量批注多选
- **D48** 测试同步按钮
- **D49** 孩子模式 TabBar 4 项
- **D50** 家长模式 TabBar 5 项（移除「消息」tab）
- **D51** 家长面板"更换起点"内嵌书架（不弹 modal）
- **D52** 全家 tab 只保留 F1 KPI grid + 「修改账户 →」链接
- **D53** 朗读页桌面默认显示 ‹ › 翻页键
- **D54** 中文字体规范（见第 5 节）
- **D55** 功能性模块不改，只调 UI/UX（Homer 最终约束）

---

## 7. 现有 6 处重复（家长端 UI 冗余，需在重设计时消除）

| # | 重复描述 | 当前位置 |
|---|---------|---------|
| 1 | 账号信息（邮箱/用户名）出现 2 次 | 首页 header + 全家 tab |
| 2 | 全家成员列表出现 2 次 | 首页 + 全家 tab |
| 3 | 总 KPI 数字出现 3 次 | 首页 header + 首页 KPI + 全家 tab |
| 4 | "更换起点"按钮出现 2 次 | 考核 tab + 书架 tab |
| 5 | 每日本数配置出现 2 次 | 考核 tab + 书架 tab |
| 6 | 待审核数字出现 2 次 | 首页 badge + 审核 tab 标题 |

---

## 8. 现有 4 处误删（重设计时必须保留）

根据 Homer D55 约束，以下功能原本存在，**重设计时不能删除**：

| # | 功能 | 当前是否存在 |
|---|------|------------|
| 1 | 录音 ‹ › 翻页控件 | ✅ 存在（ReadingPage，D53）|
| 2 | 家长批注 PDF 组件 | ✅ 存在（ParentPage 嵌入）|
| 3 | 全家 KPI 汇总模块 | ✅ 存在（首页/全家 tab）|
| 4 | 历史展开详情 | ✅ 存在（HistoryPage，D32）|

> 注意：Claude Design 不得删除、简化、或隐藏上述功能，即使"看起来 UI 更简洁"。

---

## 9. 4 端响应规格

| 端 | 宽度 | 首页 KPI | 列表 | 备注 |
|----|------|---------|------|------|
| iPhone（mobile）| 375–428px | 2×2 grid | 单列 | 底部 TabBar 60px |
| iPad | 768–1024px | 4 格一行 | 单列宽 | TabBar 可选 |
| Mac desktop | 1280px+ | 4 格一行 | max-width 800px 居中 | 可双栏 |
| Windows | 同 desktop | 同上 | 同上 | 无特殊处理 |

---

## 10. 推荐实施顺序

Claude Design 应按以下顺序提 PR：

1. **首页**（`/`）— 孩子每天最先看到，优先级最高
2. **朗读页**（`/reading/:childId`）— 孩子用时最长
3. **结果页**（`/result/:sessionId`）— 朗读后立刻看
4. **历史页**（`/history/:childId`）— 孩子查看记录
5. **背诵页**（`/recitation/:childId`）— 特殊任务
6. **登录/注册/找回密码**（公用入口）
7. **家长面板**（`/parent`）— 最复杂，最后做
8. **PdfReviewer / OnboardingWizard / GamePage / DiscardedPage**（次要，可最后）

每次 PR 只改 1 页（最多 2 页相关联的），方便 Homer review。

---

## 11. 绝不能改的事

```
❌  backend/          后端 Node.js 服务（Claude Code 维护）
❌  data/             数据库 + 录音文件
❌  frontend/certs/   本地证书
❌  docs/             架构文档（除非 Homer 要求）
❌  .env              环境变量
❌  launchd plist     服务管理
❌  cloudflared       公网隧道
```

**API 约束**：
- 不改 API 端点地址（`/api/...`）
- 不改 API 请求参数 / 响应字段名
- 不改业务逻辑（录音判定规则、背诵触发、cursor 前进、彩蛋 3 条件 AND）
- 不引入新的 npm 依赖（如需，先问 Homer）
- 不引入新业务字段或数据库 schema 改动

**提 PR 前必须确认**：
```bash
cd frontend && npm run build   # 必须通过，无 TS 错误
```

---

*本 BRIEF 由 Claude Code（Terminal）根据 Homer 历次确认的决策汇总生成。*
*如有疑问，通过 GitHub PR comment 联系 Homer，或查阅 `docs/ARCHITECTURE.md`。*
