# AI 双角色开发模式

本项目使用 Claude AI 以"Code_PM + Code_Executor"双角色完成从 0 到 1 的开发。

## 角色定义

| 角色 | 执行者 | 职责 |
|---|---|---|
| Homer_PM | 人类（Homer） | 产品决策、优先级、验收 |
| Code_PM | Claude（规划模式） | 把 Homer_PM 决策翻译为精确技术指令，写入通信信道 |
| Code_Executor | Claude（执行模式） | 读取指令、写代码、运行验证、写执行报告 |

## 通信信道

单一文件：`/Users/homer/.claude/plans/agile-puzzling-scott.md`

```
Homer_PM 口头决策
  ↓
Code_PM 写「🟦 Code_PM 指令」（任务拆分 + 代码片段 + 验证脚本）
  ↓
Code_Executor 执行 → 写「🟩 Code_Executor 报告」（diff + curl 输出 + 意外）
  ↓
Homer_PM 评审 → 下一轮
```

每轮覆盖上一轮内容，历史归档到项目根的 `STATUS.md`。

## 指令格式规范

Code_PM 指令模板：
- **任务编号**：A / B / C 顺序，有依赖的要说明顺序
- **代码片段**：直接可用的代码块（不用再思考，直接替换）
- **验证脚本**：curl 命令 + 期望输出，可机械执行
- **不做的事**：明确排除，防止过度实现

## Sprint 历史摘要

| Sprint | 内容 |
|---|---|
| Sprint 1 | 基础架构：Express + SQLite + React + 录音 hook |
| Sprint 2 | 朗读流程打通：PDF 渲染、session 状态判定、家长审核 |
| Sprint 3 Round 1-2 | 背诵考核、个性化时长、Admin 筛选+批量删除 |
| Sprint 3 Round 3-4 | PDF 目录可配置、文件系统浏览器 Modal |
| Sprint 4 Round 1 | PWA 安装支持、历史记录页、双 session bug 修复 |
| Sprint 4 Round 2 | FS_ROOTS 白名单 + 虚拟根（/Volumes NAS 支持） |
| Sprint 4 Round 3 | PDF 扫描性能修复（超时保护、跳过系统目录） |
| Sprint 4 Round 4 | launchd 开机自启动（KeepAlive 崩溃自重启） |
| Sprint 4 Round 5 | 首页家庭工具区（照片库入口） |
| Sprint 4 Round 6 | 项目文档收尾（本文件） |

## 经验

- **单文件信道**比多文件 PR 注释更高效：Executor 看一个文件就能全局理解上下文
- **可复制代码片段 > 自然语言描述**：直接给出最终代码减少 Executor 的设计决策
- **curl 验证脚本**让 Executor 能机械地自测，不依赖人工判断
- **「不做的事」清单**防止 Executor 过度实现或修改无关代码
