const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const multer = require('multer');

const db = require('./db');
const adminAuth = require('./adminAuth');
const cookieParser = require('cookie-parser');
const auth = require('./authMagicLink');

// Sprint 1A-2: 加载 ~/.morningreader/backend.env（不引入 dotenv 依赖，手动 parse）
try {
  const envPath = path.join(require('os').homedir(), '.morningreader', 'backend.env')
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
      if (m) {
        const key = m[1]
        const val = m[2].trim().replace(/^['"]|['"]$/g, '')
        if (!process.env[key]) process.env[key] = val
      }
    }
    console.log('[env] loaded ~/.morningreader/backend.env (RESEND_API_KEY:', process.env.RESEND_API_KEY ? '✅ set' : '❌ missing', ')')
  } else {
    console.warn('[env] ~/.morningreader/backend.env not found, RESEND will fallback to console.log')
  }
} catch (e) { console.warn('[env] failed to load:', e.message) }

const app = express();
const PORT = 3001;

const RECORDINGS_DIR = path.join(__dirname, '../../data/recordings');
if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

const AUTO_DISCARD_MIN_DURATION_S = 20
const AUTO_DISCARD_MAX_SILENCE_RATIO = 0.7

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

function todayLocal() {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

app.use(cors());
app.use(express.json());
app.use(cookieParser());

function getTodayPool(childId) {
  const child = db.prepare('SELECT cursor_library_id, daily_count FROM children WHERE id = ?').get(childId);
  if (!child || !child.cursor_library_id) return [];
  const dailyCount = child.daily_count || 3;
  // 按 pdf_library.id 顺序从 cursor 起取 dailyCount 本
  // Sprint 0B 阶段：所有 children 都属于 account_id=1 + 所有 library 是 is_private=1 self-uploaded，无需跨账号过滤
  // Phase 1（注册系统）时再加 account_id / is_private 过滤
  const rows = db.prepare(`
    SELECT id AS library_id, sha256, filename
    FROM pdf_library
    WHERE id >= ?
    ORDER BY id
    LIMIT ?
  `).all(child.cursor_library_id, dailyCount);
  return rows;
}

function getConfig() {
  return db.prepare('SELECT key, value FROM config').all().reduce((acc, r) => {
    acc[r.key] = r.value;
    return acc;
  }, {});
}

// ── Sprint 1A: Magic-link auth ────────────────────────────────────────────────

// 发起魔法链接（不暴露 email 是否已注册，防 enumeration）
app.post('/api/auth/magic-link/request', async (req, res) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ error: 'email required' })
    const baseUrl = process.env.PUBLIC_BASE_URL || 'https://www.morningreader.org'
    await auth.requestMagicLink(db, email, baseUrl)
    res.json({ ok: true })
  } catch (err) {
    console.warn('[magic-link/request] suppressed error:', err.message)
    res.json({ ok: true })  // 静默成功防 email enumeration
  }
})

// 验证 → 设 cookie → redirect 到首页
app.get('/api/auth/magic-link/verify', (req, res) => {
  try {
    const { token } = req.query
    if (!token) return res.status(400).send('token required')
    const { sessionToken, sessionExpiresAt } = auth.verifyMagicLink(db, token, req.ip)
    res.cookie('auth_token', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.protocol === 'https',
      expires: new Date(sessionExpiresAt),
    })
    res.redirect('/')
  } catch (err) {
    res.status(400).send(`Login failed: ${err.message}. <a href="/login">Try again</a>`)
  }
})

// 当前已登录用户信息
app.get('/api/auth/me', (req, res) => {
  const session = auth.getCurrentSession(db, req.cookies?.auth_token)
  if (!session) return res.status(401).json({ error: 'not authenticated' })
  res.json({
    account_id: session.account_id,
    email: session.email,
    is_superadmin: session.is_superadmin === 1,
    is_anonymous: session.is_anonymous === 1,
  })
})

// 登出
app.post('/api/auth/logout', (req, res) => {
  auth.deleteSession(db, req.cookies?.auth_token)
  res.clearCookie('auth_token')
  res.json({ ok: true })
})

// ── Sprint 0 routes ───────────────────────────────────────────────────────────

app.get('/test', (req, res) => {
  res.json({ ok: true, timestamp: new Date() });
});

// ── Sprint 1 routes ───────────────────────────────────────────────────────────

app.get('/api/children', (req, res) => {
  try {
    const today = todayLocal();
    const children = db.prepare(`
      SELECT c.*, l.filename AS cursor_filename
      FROM children c
      LEFT JOIN pdf_library l ON l.id = c.cursor_library_id
    `).all();
    const result = children.map(child => {
      const session = db.prepare(
        'SELECT status, pdfs_required FROM reading_sessions WHERE child_id = ? AND date = ? ORDER BY id DESC LIMIT 1'
      ).get(child.id, today);
      const poolCount = getTodayPool(child.id).length;
      return {
        ...child,
        todayStatus: session?.status ?? null,
        pdfsRequired: session?.pdfs_required ?? poolCount,
      };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/children/:id', (req, res) => {
  try {
    const child = db.prepare('SELECT * FROM children WHERE id = ?').get(req.params.id);
    if (!child) return res.status(404).json({ error: 'not found' });
    res.json(child);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/children/:id/pool', (req, res) => {
  try {
    const childId = req.params.id;
    const pool = getTodayPool(childId).map((p, i) => ({
      id: i,
      child_id: childId,
      library_id: p.library_id,        // 新主字段
      sha256: p.sha256,
      pdf_filename: p.filename,        // 兼容字段（旧前端逻辑还会用，显示用）
    }));
    res.json(pool);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sprint UI-6b: 图书馆列表 + 分类（家长面板"更换起点"对话框用）
// q: 按 filename 模糊搜索（可选，搜索时返回扁平 items）
// category: 按 category_path 过滤（可选）
// 始终返回 categories 数组（DISTINCT category_path + count），供 UI 折叠浏览
app.get('/api/library/list', (req, res) => {
  try {
    const q = (req.query.q || '').trim()
    const cat = (req.query.category || '').trim()
    const where = []
    const params = []
    if (q)   { where.push('filename LIKE ?'); params.push(`%${q}%`) }
    if (cat) { where.push('category_path = ?'); params.push(cat) }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const items = db.prepare(`
      SELECT id, sha256, filename, title, size_bytes, is_private, is_builtin, category_path
      FROM pdf_library
      ${whereClause}
      ORDER BY category_path, filename
      LIMIT 2000
    `).all(...params)

    const categories = db.prepare(`
      SELECT COALESCE(category_path, '(未分类)') AS path, COUNT(*) AS count
      FROM pdf_library
      GROUP BY COALESCE(category_path, '(未分类)')
      ORDER BY path
    `).all()

    res.json({ items, total: items.length, categories })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Sprint 0B: 用 pdf_library.id 取本地 data/pdfs/ 下的 PDF，不再走 NAS
app.get('/api/library/:id/file', (req, res) => {
  try {
    const lib = db.prepare('SELECT sha256, filename FROM pdf_library WHERE id = ?').get(req.params.id);
    if (!lib) return res.status(404).json({ error: 'not found' });
    const filePath = path.join(__dirname, '../../data/pdfs', lib.sha256.slice(0, 2), lib.sha256 + '.pdf');
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'file missing on disk', sha256: lib.sha256 });
    }
    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/config', (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value FROM config').all();
    const config = {};
    for (const { key, value } of rows) {
      if (key === 'parent_pin') config.hasParentPin = value !== '';
      else config[key] = value;
    }
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Session API ───────────────────────────────────────────────────────────────

app.post('/api/sessions/start', (req, res) => {
  try {
    const { child_id } = req.body;
    if (!child_id) return res.status(400).json({ error: 'child_id required' });
    const today = todayLocal();
    const now = new Date().toISOString();
    const pdfsRequired = getTodayPool(child_id).length;
    const result = db.prepare(
      "INSERT INTO reading_sessions (child_id, date, start_time, pdfs_required, status) VALUES (?, ?, ?, ?, 'started')"
    ).run(child_id, today, now, pdfsRequired);
    res.json({ session_id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions/:id/pdf-opened', (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const { pdf_library_id, pdf_filename, reached_last, page_number, is_dual, client_timestamp } = req.body;
    if (!pdf_library_id && !pdf_filename) return res.status(400).json({ error: 'pdf_library_id or pdf_filename required' });

    // 优先用 library_id 解析 filename（保证一致性）
    let resolvedFilename = pdf_filename;
    let resolvedLibId = pdf_library_id || null;
    if (resolvedLibId) {
      const lib = db.prepare('SELECT filename FROM pdf_library WHERE id = ?').get(resolvedLibId);
      if (lib) resolvedFilename = lib.filename;
    }
    if (!resolvedFilename) return res.status(400).json({ error: 'cannot resolve filename' });

    const eventTimestamp = client_timestamp || new Date().toISOString();
    const existing = db.prepare(
      'SELECT 1 FROM pdf_reads WHERE session_id = ? AND pdf_filename = ?'
    ).get(sessionId, resolvedFilename);
    if (existing) {
      db.prepare(
        'UPDATE pdf_reads SET last_page_turn_at = ?, pages_turned = pages_turned + 1 WHERE session_id = ? AND pdf_filename = ?'
      ).run(eventTimestamp, sessionId, resolvedFilename);
    } else {
      db.prepare(
        'INSERT INTO pdf_reads (session_id, pdf_filename, pdf_library_id, opened_at, last_page_turn_at, pages_turned) VALUES (?, ?, ?, ?, ?, 1)'
      ).run(sessionId, resolvedFilename, resolvedLibId, eventTimestamp, eventTimestamp);
    }
    if (reached_last) {
      db.prepare('UPDATE pdf_reads SET completed = 1 WHERE session_id = ? AND pdf_filename = ?').run(sessionId, resolvedFilename);
    }
    db.prepare(`
      INSERT INTO pdf_page_events (session_id, pdf_filename, page_number, timestamp, is_dual)
      VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, resolvedFilename, page_number || 1, eventTimestamp, is_dual ? 1 : 0);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions/:id/complete', upload.single('recording'), (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const session = db.prepare('SELECT * FROM reading_sessions WHERE id = ?').get(sessionId);
    if (!session) return res.status(404).json({ error: 'session not found' });

    const metrics = JSON.parse(req.body.metrics ?? '{}');
    const {
      total_duration_s = 0, silence_count = 0, max_silence_s = 0, total_silence_s = 0,
      recording_start_ts,
    } = metrics;

    // Save recording file
    let recordingPath = null;
    if (req.file) {
      const ext = req.file.originalname?.endsWith('.mp4') ? 'mp4' : 'webm';
      const filename = `${session.child_id}_${sessionId}_${Date.now()}.${ext}`;
      fs.writeFileSync(path.join(RECORDINGS_DIR, filename), req.file.buffer);
      recordingPath = filename;
    }

    // Count PDFs opened
    const pdfsOpened = db.prepare(
      'SELECT COUNT(*) as c FROM pdf_reads WHERE session_id = ? AND completed = 1'
    ).get(sessionId).c;

    // Time window check (compare local HH:MM)
    const config = getConfig();
    const startDate = new Date(session.start_time);
    const startHHMM = `${startDate.getHours().toString().padStart(2, '0')}:${startDate.getMinutes().toString().padStart(2, '0')}`;
    const timeInWindow = (startHHMM >= config.window_start && startHHMM < config.window_end) ? 1 : 0;

    // Status calculation (priority order)
    const childRow = db.prepare('SELECT min_duration_s FROM children WHERE id = ?').get(session.child_id);
    const minDur = (childRow?.min_duration_s != null) ? childRow.min_duration_s : parseInt(config.min_duration_s);
    let status = 'pending_review';
    if (total_duration_s < minDur) {
      status = 'time_short';
    } else if (!timeInWindow) {
      status = 'out_of_window';
    } else if (max_silence_s > parseInt(config.max_consecutive_silence_s)) {
      status = 'long_pause';
    } else if (total_duration_s > 0 && total_silence_s / total_duration_s > parseFloat(config.max_silence_ratio)) {
      status = 'high_silence';
    } else if (pdfsOpened < session.pdfs_required) {
      status = 'pdf_insufficient';
    }

    // Auto-discard: too short or too silent
    const silenceRatioReading = total_duration_s > 0 ? total_silence_s / total_duration_s : 1
    const tooShortReading   = total_duration_s < AUTO_DISCARD_MIN_DURATION_S
    const tooSilentReading  = silenceRatioReading > AUTO_DISCARD_MAX_SILENCE_RATIO
    if (tooShortReading || tooSilentReading) {
      if (recordingPath) {
        try { fs.unlinkSync(path.join(RECORDINGS_DIR, recordingPath)) } catch (_) {}
      }
      db.prepare('DELETE FROM pdf_reads WHERE session_id = ?').run(sessionId)
      db.prepare('DELETE FROM reading_sessions WHERE id = ?').run(sessionId)
      return res.json({
        discarded: true,
        reason: tooShortReading ? 'too_short' : 'too_silent',
        total_duration_s,
        silence_ratio: Math.round(silenceRatioReading * 100) / 100,
      })
    }

    const endTime = new Date().toISOString();
    db.prepare(`
      UPDATE reading_sessions SET
        end_time = ?, recording_path = ?, total_duration_s = ?, silence_count = ?,
        max_silence_s = ?, total_silence_s = ?, pdfs_opened = ?, time_in_window = ?, status = ?,
        recording_start_time = ?
      WHERE id = ?
    `).run(endTime, recordingPath, total_duration_s, silence_count, max_silence_s, total_silence_s, pdfsOpened, timeInWindow, status, recording_start_ts ?? null, sessionId);

    res.json(db.prepare('SELECT * FROM reading_sessions WHERE id = ?').get(sessionId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sessions/:id', (req, res) => {
  try {
    const session = db.prepare('SELECT * FROM reading_sessions WHERE id = ?').get(parseInt(req.params.id));
    if (!session) return res.status(404).json({ error: 'not found' });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin API ─────────────────────────────────────────────────────────────────

app.post('/api/admin/setup-pin', (req, res) => {
  try {
    const { pin } = req.body
    if (!pin || !/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: 'PIN 必须是 4-6 位数字' })
    const stored = db.prepare("SELECT value FROM config WHERE key='parent_pin'").get()
    if (stored && stored.value !== '') return res.status(409).json({ error: 'conflict' })
    db.prepare("UPDATE config SET value = ? WHERE key = 'parent_pin'").run(pin)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/admin/verify-pin', adminAuth, (req, res) => {
  res.json({ ok: true })
})

app.get('/api/admin/sessions', adminAuth, (req, res) => {
  try {
    const { child_id, limit = 50, offset = 0 } = req.query
    let sessions
    if (child_id) {
      sessions = db.prepare(`
        SELECT rs.*, c.name as child_name FROM reading_sessions rs
        JOIN children c ON c.id = rs.child_id
        WHERE rs.child_id = ? AND rs.status != 'started'
        ORDER BY rs.date DESC, rs.start_time DESC
        LIMIT ? OFFSET ?
      `).all(child_id, parseInt(limit), parseInt(offset))
    } else {
      sessions = db.prepare(`
        SELECT rs.*, c.name as child_name FROM reading_sessions rs
        JOIN children c ON c.id = rs.child_id
        WHERE rs.status != 'started'
        ORDER BY rs.date DESC, rs.start_time DESC
        LIMIT ? OFFSET ?
      `).all(parseInt(limit), parseInt(offset))
    }
    res.json(sessions)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/admin/sessions/:id', adminAuth, (req, res) => {
  try {
    const sessionId = parseInt(req.params.id)
    const session = db.prepare(`
      SELECT rs.*, c.name as child_name FROM reading_sessions rs
      JOIN children c ON c.id = rs.child_id
      WHERE rs.id = ?
    `).get(sessionId)
    if (!session) return res.status(404).json({ error: 'not found' })
    const pdfReads = db.prepare('SELECT * FROM pdf_reads WHERE session_id = ?').all(sessionId)
    const pageEvents = db.prepare(
      'SELECT pdf_filename, page_number, timestamp, is_dual FROM pdf_page_events WHERE session_id = ? ORDER BY timestamp ASC'
    ).all(sessionId)
    let recitation_pdf = null
    let recitation_library_id = null
    if (session.session_type === 'recitation' && session.plan_id) {
      const plan = db.prepare('SELECT pdf_filename FROM recitation_plans WHERE id = ?').get(session.plan_id)
      if (plan?.pdf_filename) {
        // Hotfix 6: recitation_plans.pdf_filename 可能带路径前缀，取 basename 与 pdf_library.filename 匹配
        const basename = plan.pdf_filename.split('/').pop() || plan.pdf_filename
        recitation_pdf = basename
        const lib = db.prepare('SELECT id FROM pdf_library WHERE filename = ? LIMIT 1').get(basename)
        recitation_library_id = lib?.id ?? null
      }
    }
    res.json({ ...session, pdf_reads: pdfReads, page_events: pageEvents, recitation_pdf, recitation_library_id })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/admin/sessions/bulk-delete', adminAuth, (req, res) => {
  try {
    const { ids } = req.body
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' })
    let deleted = 0
    const missing = []
    const doDelete = db.transaction(() => {
      for (const id of ids) {
        const session = db.prepare('SELECT recording_path FROM reading_sessions WHERE id = ?').get(id)
        if (!session) { missing.push(id); continue }
        db.prepare('DELETE FROM pdf_reads WHERE session_id = ?').run(id)
        db.prepare('DELETE FROM reading_sessions WHERE id = ?').run(id)
        if (session.recording_path) {
          const filePath = path.join(RECORDINGS_DIR, session.recording_path)
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
        }
        deleted++
      }
    })
    doDelete()
    res.json({ ok: true, deleted, missing })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/admin/sessions/:id', adminAuth, (req, res) => {
  try {
    const sessionId = parseInt(req.params.id)
    const session = db.prepare('SELECT recording_path FROM reading_sessions WHERE id = ?').get(sessionId)
    if (!session) return res.status(404).json({ error: 'not found' })
    db.prepare('DELETE FROM pdf_reads WHERE session_id = ?').run(sessionId)
    db.prepare('DELETE FROM reading_sessions WHERE id = ?').run(sessionId)
    let deletedRecording = false
    if (session.recording_path) {
      const filePath = path.join(RECORDINGS_DIR, session.recording_path)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        deletedRecording = true
      }
    }
    res.json({ ok: true, deleted_recording: deletedRecording })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/admin/sessions/:id/recording', (req, res) => {
  try {
    const pin = req.query.pin || ''
    const stored = db.prepare("SELECT value FROM config WHERE key='parent_pin'").get()
    if (!stored || stored.value === '' || pin !== stored.value) {
      return res.status(401).json({ error: 'unauthorized' })
    }
    const sessionId = parseInt(req.params.id)
    const session = db.prepare('SELECT * FROM reading_sessions WHERE id = ?').get(sessionId)
    if (!session) return res.status(404).json({ error: 'not found' })
    if (!session.recording_path) return res.status(404).json({ error: 'no recording' })
    const filePath = path.join(RECORDINGS_DIR, session.recording_path)
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file not found' })
    const contentType = session.recording_path.endsWith('.mp4') ? 'audio/mp4' : 'audio/webm'
    res.setHeader('Content-Type', contentType)
    res.sendFile(filePath)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/admin/sessions/:id/review', adminAuth, (req, res) => {
  try {
    const sessionId = parseInt(req.params.id)
    const { decision } = req.body
    if (!['passed', 'redo'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be passed|redo' })
    }
    const sessionBefore = db.prepare('SELECT * FROM reading_sessions WHERE id = ?').get(sessionId)
    const status = decision === 'redo' ? 'redo_required' : decision
    db.prepare('UPDATE reading_sessions SET status = ? WHERE id = ?').run(status, sessionId)
    const session = db.prepare('SELECT * FROM reading_sessions WHERE id = ?').get(sessionId)

    // Recitation: advance cursor on pass, mark plan on redo
    if (sessionBefore && sessionBefore.session_type === 'recitation' && sessionBefore.plan_id) {
      if (decision === 'passed') {
        db.prepare("UPDATE recitation_plans SET status = 'passed' WHERE id = ?").run(sessionBefore.plan_id)
        const plan = db.prepare('SELECT * FROM recitation_plans WHERE id = ?').get(sessionBefore.plan_id)
        if (plan) {
          // Sprint 0B: cursor 自动前进用 pdf_library.id 顺序，不再扫 NAS
          const childRow = db.prepare('SELECT cursor_library_id, pdf_dir FROM children WHERE id = ?').get(session.child_id)
          if (childRow && childRow.cursor_library_id) {
            const next = db.prepare('SELECT id, filename FROM pdf_library WHERE id > ? ORDER BY id LIMIT 1').get(childRow.cursor_library_id)
            if (next) {
              db.prepare('UPDATE children SET cursor_library_id = ?, cursor_pdf = ? WHERE id = ?')
                .run(next.id, next.filename, session.child_id)
              console.log(`[Sprint 0B] cursor advanced child=${session.child_id} → library_id=${next.id} (${next.filename})`)
            }
          }
        }
      } else if (decision === 'redo') {
        db.prepare("UPDATE recitation_plans SET status = 'retry' WHERE id = ?").run(sessionBefore.plan_id)
      }
    }

    res.json(session)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Recitation API ────────────────────────────────────────────────────────────

app.get('/api/children/:id/history', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 100)
    const rows = db.prepare(`
      SELECT id, date, start_time, end_time, total_duration_s,
             silence_count, max_silence_s, total_silence_s,
             pdfs_opened, pdfs_required, status, session_type
      FROM reading_sessions
      WHERE child_id = ? AND status != 'started'
      ORDER BY date DESC, start_time DESC
      LIMIT ?
    `).all(req.params.id, limit)
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/children/:id/today-recitation', (req, res) => {
  try {
    const today = todayLocal()
    const plan = db.prepare(
      "SELECT id, pdf_filename, status FROM recitation_plans WHERE child_id = ? AND scheduled_date = ? AND status IN ('scheduled', 'retry') ORDER BY id ASC LIMIT 1"
    ).get(req.params.id, today)
    res.json(plan ?? null)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/recitation/start', (req, res) => {
  try {
    const { child_id } = req.body
    if (!child_id) return res.status(400).json({ error: 'child_id required' })
    const today = todayLocal()
    const plan = db.prepare(
      "SELECT * FROM recitation_plans WHERE child_id = ? AND scheduled_date = ? AND status IN ('scheduled', 'retry') ORDER BY id ASC LIMIT 1"
    ).get(child_id, today)
    if (!plan) return res.status(404).json({ error: 'no recitation plan for today' })
    const now = new Date().toISOString()
    const result = db.prepare(
      "INSERT INTO reading_sessions (child_id, date, start_time, session_type, plan_id, status) VALUES (?, ?, ?, 'recitation', ?, 'started')"
    ).run(child_id, today, now, plan.id)
    res.json({ session_id: result.lastInsertRowid, plan })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/recitation/:id/complete', upload.single('recording'), (req, res) => {
  try {
    const sessionId = parseInt(req.params.id)
    const session = db.prepare('SELECT * FROM reading_sessions WHERE id = ?').get(sessionId)
    if (!session) return res.status(404).json({ error: 'session not found' })

    const metrics = JSON.parse(req.body.metrics ?? '{}')
    const {
      total_duration_s = 0, silence_count = 0, max_silence_s = 0, total_silence_s = 0,
      recording_start_ts,
    } = metrics

    let recordingPath = null
    if (req.file) {
      const ext = req.file.originalname?.endsWith('.mp4') ? 'mp4' : 'webm'
      const filename = `${session.child_id}_${sessionId}_${Date.now()}.${ext}`
      fs.writeFileSync(path.join(RECORDINGS_DIR, filename), req.file.buffer)
      recordingPath = filename
    }

    const config = getConfig()
    const startDate = new Date(session.start_time)
    const startHHMM = `${startDate.getHours().toString().padStart(2, '0')}:${startDate.getMinutes().toString().padStart(2, '0')}`
    const timeInWindow = (startHHMM >= config.window_start && startHHMM < config.window_end) ? 1 : 0

    const childRowRec = db.prepare('SELECT min_duration_s FROM children WHERE id = ?').get(session.child_id)
    const minDurRec = (childRowRec?.min_duration_s != null) ? childRowRec.min_duration_s : parseInt(config.min_duration_s)
    const halfMin = Math.floor(minDurRec / 2)
    let status = 'pending_review'
    if (total_duration_s < halfMin) {
      status = 'time_short'
    } else if (max_silence_s > parseInt(config.max_consecutive_silence_s)) {
      status = 'long_pause'
    } else if (total_duration_s > 0 && total_silence_s / total_duration_s > parseFloat(config.max_silence_ratio)) {
      status = 'high_silence'
    }

    // Auto-discard: too short or too silent
    const silenceRatioRecitation = total_duration_s > 0 ? total_silence_s / total_duration_s : 1
    const tooShortRecitation  = total_duration_s < AUTO_DISCARD_MIN_DURATION_S
    const tooSilentRecitation = silenceRatioRecitation > AUTO_DISCARD_MAX_SILENCE_RATIO
    if (tooShortRecitation || tooSilentRecitation) {
      if (recordingPath) {
        try { fs.unlinkSync(path.join(RECORDINGS_DIR, recordingPath)) } catch (_) {}
      }
      db.prepare('DELETE FROM pdf_reads WHERE session_id = ?').run(sessionId)
      db.prepare('DELETE FROM reading_sessions WHERE id = ?').run(sessionId)
      return res.json({
        discarded: true,
        reason: tooShortRecitation ? 'too_short' : 'too_silent',
        total_duration_s,
        silence_ratio: Math.round(silenceRatioRecitation * 100) / 100,
      })
    }

    const endTime = new Date().toISOString()
    db.prepare(`
      UPDATE reading_sessions SET
        end_time = ?, recording_path = ?, total_duration_s = ?, silence_count = ?,
        max_silence_s = ?, total_silence_s = ?, time_in_window = ?, status = ?,
        recording_start_time = ?
      WHERE id = ?
    `).run(endTime, recordingPath, total_duration_s, silence_count, max_silence_s, total_silence_s, timeInWindow, status, recording_start_ts ?? null, sessionId)

    if (session.plan_id) {
      db.prepare(
        "UPDATE recitation_plans SET status = 'submitted' WHERE id = ? AND status IN ('scheduled', 'retry')"
      ).run(session.plan_id)
    }

    res.json(db.prepare('SELECT * FROM reading_sessions WHERE id = ?').get(sessionId))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/admin/recitation/schedule', adminAuth, (req, res) => {
  try {
    const { child_id, pdf_filename, scheduled_date } = req.body
    if (!child_id || !pdf_filename || !scheduled_date) {
      return res.status(400).json({ error: 'child_id, pdf_filename, scheduled_date required' })
    }
    const result = db.prepare(
      "INSERT INTO recitation_plans (child_id, pdf_filename, scheduled_date, status) VALUES (?, ?, ?, 'scheduled')"
    ).run(child_id, pdf_filename, scheduled_date)
    const plan = db.prepare('SELECT * FROM recitation_plans WHERE id = ?').get(result.lastInsertRowid)
    res.json(plan)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/admin/recitation', adminAuth, (req, res) => {
  try {
    const { upcoming } = req.query
    let plans
    if (upcoming === '1') {
      const today = todayLocal()
      plans = db.prepare(`
        SELECT rp.*, c.name as child_name FROM recitation_plans rp
        JOIN children c ON c.id = rp.child_id
        WHERE rp.scheduled_date >= ?
        ORDER BY rp.scheduled_date ASC
      `).all(today)
    } else {
      plans = db.prepare(`
        SELECT rp.*, c.name as child_name FROM recitation_plans rp
        JOIN children c ON c.id = rp.child_id
        ORDER BY rp.scheduled_date ASC
      `).all()
    }
    res.json(plans)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/admin/recitation/:id', adminAuth, (req, res) => {
  try {
    db.prepare('DELETE FROM recitation_plans WHERE id = ?').run(parseInt(req.params.id))
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Admin children CRUD ───────────────────────────────────────────────────────

app.post('/api/admin/children', adminAuth, (req, res) => {
  try {
    const { name, age } = req.body
    if (!name || !age) return res.status(400).json({ error: 'name and age required' })
    const ageNum = parseInt(age)
    if (isNaN(ageNum) || ageNum < 1 || ageNum > 99) return res.status(400).json({ error: 'age must be 1-99' })
    const crypto = require('crypto')
    const id = 'u_' + crypto.randomBytes(4).toString('hex')
    const scale = ageNum <= 7 ? 1.25 : ageNum >= 18 ? 0.95 : 1.0
    const defaultDir = db.prepare("SELECT value FROM config WHERE key='pdf_dir'").get()?.value || null
    db.prepare(
      'INSERT INTO children (id, name, age, font_scale, pdf_dir, daily_count) VALUES (?, ?, ?, ?, ?, 3)'
    ).run(id, name.trim(), ageNum, scale, defaultDir)
    res.json(db.prepare('SELECT * FROM children WHERE id = ?').get(id))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/admin/children/:id', adminAuth, (req, res) => {
  try {
    const id = req.params.id
    if (!db.prepare('SELECT 1 FROM children WHERE id = ?').get(id)) {
      return res.status(404).json({ error: 'not found' })
    }
    const sessionIds = db.prepare('SELECT id FROM reading_sessions WHERE child_id = ?').all(id).map(r => r.id)
    if (sessionIds.length > 0) {
      const ph = sessionIds.map(() => '?').join(',')
      db.prepare(`DELETE FROM pdf_reads WHERE session_id IN (${ph})`).run(...sessionIds)
      db.prepare(`DELETE FROM pdf_page_events WHERE session_id IN (${ph})`).run(...sessionIds)
    }
    db.prepare('DELETE FROM reading_sessions WHERE child_id = ?').run(id)
    db.prepare('DELETE FROM recitation_plans WHERE child_id = ?').run(id)
    db.prepare('DELETE FROM children WHERE id = ?').run(id)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ── Admin pool management ─────────────────────────────────────────────────────

app.post('/api/admin/pool/configure', adminAuth, (req, res) => {
  try {
    const { child_id, cursor_library_id, daily_count, min_duration_s } = req.body
    if (!child_id) return res.status(400).json({ error: 'child_id required' })
    if (cursor_library_id === undefined && daily_count === undefined && min_duration_s === undefined) {
      return res.status(400).json({ error: 'at least one field required' })
    }

    let cursorLibId = null
    let cursorFilename = null
    if (cursor_library_id !== undefined && cursor_library_id !== null) {
      const lib = db.prepare('SELECT id, filename FROM pdf_library WHERE id = ?').get(cursor_library_id)
      if (!lib) return res.status(400).json({ error: 'invalid cursor_library_id' })
      cursorLibId = lib.id
      cursorFilename = lib.filename
    }

    const countVal = daily_count !== undefined ? parseInt(daily_count) : null
    if (countVal !== null && (isNaN(countVal) || countVal < 1 || countVal > 10)) {
      return res.status(400).json({ error: 'daily_count must be 1-10' })
    }

    db.prepare(`
      UPDATE children SET
        cursor_library_id = CASE WHEN ? IS NOT NULL THEN ? ELSE cursor_library_id END,
        cursor_pdf        = CASE WHEN ? IS NOT NULL THEN ? ELSE cursor_pdf END,
        daily_count       = CASE WHEN ? IS NOT NULL THEN ? ELSE daily_count END
      WHERE id = ?
    `).run(cursorLibId, cursorLibId, cursorFilename, cursorFilename, countVal, countVal, child_id)

    if (min_duration_s !== undefined) {
      const durVal = min_duration_s === null ? null : parseInt(min_duration_s)
      if (durVal !== null && (isNaN(durVal) || durVal < 60 || durVal > 3600)) {
        return res.status(400).json({ error: 'min_duration_s must be 60-3600' })
      }
      db.prepare('UPDATE children SET min_duration_s = ? WHERE id = ?').run(durVal, child_id)
    }

    res.json(db.prepare('SELECT * FROM children WHERE id = ?').get(child_id))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/admin/pool/preview/:childId', adminAuth, (req, res) => {
  try {
    const pool = getTodayPool(req.params.childId).map(p => ({
      library_id: p.library_id,
      filename: p.filename,
    }))
    res.json(pool)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Sprint 0C-Hotfix: serve frontend production build ───────────
const FRONTEND_DIST = path.resolve(__dirname, '../../frontend/dist')
if (fs.existsSync(FRONTEND_DIST)) {
  // 1. 静态文件（assets/、sw.js 等）
  app.use(express.static(FRONTEND_DIST, {
    maxAge: '1h',
    setHeaders: (res, filePath) => {
      // sw.js 不缓存，避免 PWA 更新延迟
      if (filePath.endsWith('sw.js') || filePath.endsWith('manifest.webmanifest')) {
        res.setHeader('Cache-Control', 'no-cache')
      }
    }
  }))
  // 2. SPA fallback：所有非 /api 的 GET 请求返回 index.html
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (req.path.startsWith('/api/')) return next()
    const indexPath = path.join(FRONTEND_DIST, 'index.html')
    if (fs.existsSync(indexPath)) return res.status(200).sendFile(indexPath)
    next()
  })
  console.log('[Sprint 0C-Hotfix] Serving frontend dist from', FRONTEND_DIST)
} else {
  console.warn('[Sprint 0C-Hotfix] FRONTEND_DIST not found at', FRONTEND_DIST, '— only API will be served')
}

// ── Sprint Hotfix 4: 双 server（HTTP for Cloudflare Tunnel + HTTPS for 局域网）──
const HTTP_PORT  = parseInt(process.env.PORT || '3001', 10)
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || '5173', 10)

// 1. HTTP server（公网走 Cloudflare Tunnel → http://localhost:3001）
http.createServer(app).listen(HTTP_PORT, () => {
  console.log(`Morning Reader backend HTTP listening :${HTTP_PORT}`)
})

// 2. HTTPS server（局域网用 mkcert 证书，替代 Vite dev）
try {
  const certPath = path.resolve(__dirname, '../../frontend/certs/localhost+3.pem')
  const keyPath  = path.resolve(__dirname, '../../frontend/certs/localhost+3-key.pem')
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const httpsServer = https.createServer({
      cert: fs.readFileSync(certPath),
      key:  fs.readFileSync(keyPath),
    }, app)
    httpsServer.on('error', err => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[Hotfix 4] HTTPS :${HTTPS_PORT} already in use (Vite still running?). HTTPS server skipped. HTTP is still up.`)
      } else {
        console.error('[Hotfix 4] HTTPS server error:', err.message)
      }
    })
    httpsServer.listen(HTTPS_PORT, () => {
      console.log(`Morning Reader backend HTTPS listening :${HTTPS_PORT} (mkcert)`)
    })
  } else {
    console.warn(`[Hotfix 4] mkcert certs not found, only HTTP :${HTTP_PORT} will be served`)
  }
} catch (e) {
  console.error('[Hotfix 4] Failed to start HTTPS:', e.message)
}
