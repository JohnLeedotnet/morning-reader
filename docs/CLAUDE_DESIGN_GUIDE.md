# Claude Design 协作指南

本项目使用 **Claude Code（Terminal）** 维护后端 + 业务逻辑，**Claude Design** 负责前端 UI/UX 重设计。本文档说明 Claude Design 的接入方式和协作规则。

---

## 接入步骤

### 1. 连接 GitHub 仓库
1. 打开 Claude Design（claude.ai/design 或 Claude 应用）
2. 连接 GitHub，选择仓库 `morning-reader`（私有仓库）
3. 分支：基于 `main` 新建 feature 分支（如 `design/home-page-v4`）

### 2. 工作范围
Claude Design **只应修改以下路径**：
```
frontend/src/pages/       所有页面组件
frontend/src/components/  共享组件
frontend/src/hooks/       UI 相关 hooks（useReadingRecorder 等）
frontend/src/lib/         工具函数（adminFetch 等）
frontend/tailwind.config.js
frontend/index.html
```

**绝对不要碰**：
```
backend/           后端逻辑（由 Claude Code Terminal 维护）
data/              数据库 + 录音（绝不入 git）
frontend/certs/    证书（绝不入 git）
docs/              架构文档（人工维护）
```

---

## PR 提交流程

1. Claude Design 在 feature 分支完成修改
2. 发起 Pull Request → `main`
3. PR 标题格式：`design: <简短描述>`（如 `design: 首页重设计 v4`）
4. Homer review diff → 确认无业务逻辑改动 → merge

---

## Homer 的 Review 要点

合并 PR 前请确认：
- [ ] 只改了 `frontend/src/` 内的文件
- [ ] 没有改 `backend/`、`docs/`、`.gitignore` 等
- [ ] 功能性逻辑（录音判定、背诵触发、API 调用地址）未变动
- [ ] `npm run build` 能通过（可在本地跑一下）

---

## 本地同步 Claude Design 的改动

```bash
# 拉取 Claude Design merge 进 main 的最新改动
git sync

# 或手动：
git fetch origin
git pull --rebase origin main

# 重启前端服务（如果 Vite 热更新没生效）
launchctl kickstart -k gui/$(id -u)/com.morningreader.frontend
```

---

## 冲突处理

如果你和 Claude Design 同时改了同一文件（如 `ParentPage.tsx`）：

```bash
git fetch origin
git rebase origin/main
# 手动解决冲突后：
git add <冲突文件>
git rebase --continue
```

原则：**业务逻辑（Homer/Claude Code 改的部分）优先**；UI 样式（Claude Design 改的部分）在上面叠加。

---

## 快捷命令（~/.gitconfig 已配置）

```bash
git cap "fix: 修了个 bug"   # add -u + commit + push 一步搞定
git sync                     # fetch + rebase pull（拿最新）
git behind                   # 看 origin 比本地新多少 commits
```

---

## 技术参考

- 设计稿：`design-mockups/` 目录（本地，不入 git）
- 技术架构：`docs/ARCHITECTURE.md`
- API 端点：`docs/API_SPEC.md`
- 数据模型：`docs/DATA_MODEL.md`
- 设计规范（颜色/字体/组件）：参考 `frontend/tailwind.config.js` + 现有页面

---

## 联系

后端 + 业务逻辑问题 → Homer（lijhm@protonmail.com）或通过 GitHub Issue。
