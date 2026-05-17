# Data Model

数据库位置：`data/morning-reader.db`（better-sqlite3，同步读写）

Schema 定义在 `backend/src/db.js`，追加迁移用 `try { ALTER TABLE } catch {}`。

---

## children

| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | `mike` / `peyton`（固定，不可改） |
| name | TEXT | 显示名 |
| age | INT | 年龄 |
| font_scale | REAL DEFAULT 1.0 | UI 字号缩放（mike=1.0, peyton=1.25） |
| cursor_pdf | TEXT NULL | 当前朗读起点 PDF 相对路径（相对 pdf_dir） |
| daily_count | INT DEFAULT 3 | 每日朗读本数（cursor 起连续取 N 本） |
| min_duration_s | INT NULL | 个性化最短时长（NULL 时取 config.min_duration_s） |

---

## reading_sessions

| 列 | 说明 |
|---|---|
| id | PK AUTOINCREMENT |
| child_id | mike / peyton |
| date | YYYY-MM-DD |
| start_time | ISO 8601 |
| end_time | ISO 8601（complete 时写入） |
| recording_path | data/recordings/ 下文件名（含扩展名），NULL 表示未录音 |
| total_duration_s | 录音总时长（秒） |
| silence_count | 停顿次数（每次 ≥0.5s 静音计 1） |
| max_silence_s | 最长单次停顿（秒） |
| total_silence_s | 累计静音时长（秒） |
| pdfs_opened | 实际打开 PDF 数（DISTINCT pdf_reads 计） |
| pdfs_required | 本次应读 PDF 数（start 时由 pool 决定） |
| time_in_window | 0/1 |
| status | 见下方枚举 |
| session_type | `reading`（默认）/ `recitation` |
| plan_id | recitation_plans.id（仅 recitation session） |

**status 枚举：**
`started` → `time_short` / `out_of_window` / `long_pause` / `high_silence` / `pdf_insufficient` / `pending_review` → `passed` / `redo_required`

---

## pdf_reads

记录每个 session 内打开的每本 PDF 及翻页行为。

| 列 | 说明 |
|---|---|
| session_id | reading_sessions.id |
| pdf_filename | PDF 相对路径 |
| opened_at | 首次打开时间（ISO 8601） |
| last_page_turn_at | 最后翻页时间 |
| pages_turned | 翻页次数（含首次打开计为 1） |

---

## recitation_plans

| 列 | 说明 |
|---|---|
| id | PK AUTOINCREMENT |
| child_id | mike / peyton |
| pdf_filename | 考核书目（PDF 相对路径） |
| scheduled_date | YYYY-MM-DD |
| status | `scheduled` / `passed` / `retry` |

背诵通过（review decision=passed）后：plan.status → `passed`，且若 cursor_pdf 等于该 pdf_filename，自动前进游标到下一本。

---

## config（key-value）

| key | 默认值 | 说明 |
|---|---|---|
| window_start | `07:00` | 打卡时间起（HH:MM） |
| window_end | `08:00` | 打卡时间止（HH:MM） |
| min_duration_s | `300` | 默认最短朗读时长（秒） |
| max_consecutive_silence_s | `15` | 单次停顿阈值（秒） |
| max_silence_ratio | `0.2` | 累计静音比例阈值（0–1） |
| parent_pin | `""` | 家长 PIN（空字符串=未设置，拒绝所有 admin 请求） |
| pdf_dir | `/Users/homer/Documents/牛津树1-9级 PDF` | PDF 资源目录（可在家长面板切换） |

`GET /api/config` 返回时，`parent_pin` 被替换为 `hasParentPin: boolean`，不暴露明文 PIN。

---

## reading_pool（旧表，未使用）

cursor 模型引入后此表不再使用。保留未删，无数据写入。
