# API Spec

后端：`http://localhost:3001`（局域网用 `http://192.168.50.168:3001`，但客户端经 Vite 代理，统一用 `/api/...`）

`[admin]` = 需要 `X-Admin-Pin: <pin>` 请求头（或 body.pin）。

---

## 公共端点

### 系统

| Method | Path | 说明 |
|---|---|---|
| GET | `/test` | 健康检查，返回 `{ ok, timestamp }` |

### 孩子

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/children` | 所有孩子列表，含 `todayStatus`、`pdfsRequired` |
| GET | `/api/children/:id` | 单个孩子（id=mike/peyton） |
| GET | `/api/children/:id/pool` | 今日书单（cursor 起 daily_count 本），返回 `[{id, child_id, pdf_filename}]` |
| GET | `/api/children/:id/today-recitation` | 今日背诵计划（status=scheduled），无则返回 null |
| GET | `/api/children/:id/history?limit=30` | 历史 sessions（排除 started，max 100） |

### PDF

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/pdfs/list` | 按一级子目录分组返回 PDF，`[{level, files:[{filename,relativePath}]}]` |
| GET | `/api/pdfs/file?path=<rel>` | 直接返回 PDF 文件流（Content-Type: application/pdf） |
| GET | `/api/pdfs/sample` | 返回第一个找到的 PDF（供 pdf-test 页） |

### 配置

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/config` | 返回所有 config，parent_pin 替换为 `hasParentPin: boolean` |

### 朗读 Session

| Method | Path | Body | 返回 |
|---|---|---|---|
| POST | `/api/sessions/start` | `{child_id}` | `{session_id}` |
| POST | `/api/sessions/:id/pdf-opened` | `{pdf_filename}` | `{ok}` |
| POST | `/api/sessions/:id/complete` | multipart: `recording` (file) + `metrics` (JSON string) | 完整 session 对象 |
| GET | `/api/sessions/:id` | — | session 对象 |

**metrics JSON 字段：** `total_duration_s, silence_count, max_silence_s, total_silence_s`

### 背诵 Session

| Method | Path | Body | 返回 |
|---|---|---|---|
| POST | `/api/recitation/start` | `{child_id}` | `{session_id, plan}` |
| POST | `/api/recitation/:id/complete` | 同 sessions complete | session 对象 |

---

## Admin 端点（`[admin]` 均需 X-Admin-Pin）

### PIN 管理

| Method | Path | Body | 说明 |
|---|---|---|---|
| POST | `/api/admin/setup-pin` | `{pin}` | 首次设置 PIN（已设置则 409） |
| POST | `/api/admin/verify-pin` | — | 验证 PIN 有效性，成功返回 `{ok}` |

### Session 管理

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/admin/sessions?child_id=&limit=50&offset=0` | 会话列表（含 child_name，排除 started） |
| GET | `/api/admin/sessions/:id` | 单个会话 + `pdf_reads` 数组 |
| DELETE | `/api/admin/sessions/:id` | 删除会话 + 录音文件，返回 `{ok, deleted_recording}` |
| POST | `/api/admin/sessions/bulk-delete` | `{ids:[]}` 批量删除，返回 `{ok, deleted, missing}` |
| GET | `/api/admin/sessions/:id/recording?pin=<pin>` | 录音文件流（query param 鉴权，供 `<audio src>` 直链） |
| POST | `/api/admin/sessions/:id/review` | `{decision: "passed"\|"redo"}` 审核；背诵 passed 自动前进游标 |

### 书单管理

| Method | Path | Body | 说明 |
|---|---|---|---|
| POST | `/api/admin/pool/configure` | `{child_id, cursor_pdf?, daily_count?, min_duration_s?}` | 更新起点/本数/时长；min_duration_s 可传 null 清除 |
| GET | `/api/admin/pool/preview/:childId` | — | 预览当前 pool（不写 DB） |

### 背诵计划

| Method | Path | Body | 说明 |
|---|---|---|---|
| POST | `/api/admin/recitation/schedule` | `{child_id, pdf_filename, scheduled_date}` | 新建考核计划 |
| GET | `/api/admin/recitation?upcoming=1` | — | 计划列表（upcoming=1 只返回今日起） |
| DELETE | `/api/admin/recitation/:id` | — | 删除计划 |

### 配置 & 文件系统

| Method | Path | Body | 说明 |
|---|---|---|---|
| POST | `/api/admin/config` | `{pdf_dir}` | 更新 PDF 目录（白名单校验 + 预扫描验证） |
| GET | `/api/admin/fs/browse?path=<dir>` | — | 目录浏览；无 path 返回虚拟根（`__roots__`） |

**fs/browse 返回格式：**
```json
{
  "path": "/Users/homer/Documents",
  "parent": "/Users/homer",
  "dirs": [{"name":"...", "fullPath":"..."}]
}
```
虚拟根时 `path="__roots__"`，`parent=null`，dirs 为两个根入口。
