const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const multer = require('multer');
const crypto = require('crypto');

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

const PDFS_DIR = path.join(__dirname, '../../data/pdfs');
const PDFS_TMP_DIR = path.join(PDFS_DIR, '_tmp');
if (!fs.existsSync(PDFS_DIR)) fs.mkdirSync(PDFS_DIR, { recursive: true });
if (!fs.existsSync(PDFS_TMP_DIR)) fs.mkdirSync(PDFS_TMP_DIR, { recursive: true });

const CHUNK_DIR = path.join(RECORDINGS_DIR, '_chunks');
if (!fs.existsSync(CHUNK_DIR)) fs.mkdirSync(CHUNK_DIR, { recursive: true });

// Sprint 2-Net-Final: 启动时清理 1h 前的孤儿 chunk 目录
try {
  const staleMs = Date.now() - 3600 * 1000;
  for (const d of fs.readdirSync(CHUNK_DIR)) {
    const full = path.join(CHUNK_DIR, d);
    if (fs.statSync(full).mtimeMs < staleMs) fs.rmSync(full, { recursive: true, force: true });
  }
} catch (_) {}

const AUTO_DISCARD_MIN_DURATION_S = 20
const AUTO_DISCARD_MAX_SILENCE_RATIO = 0.7

const upload = multer({
  storage: multer.diskStorage({
    destination: RECORDINGS_DIR,
    filename: (_req, file, cb) => {
      const ext = file.originalname?.endsWith('.mp4') ? 'mp4' : 'webm'
      cb(null, `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`)
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
});

// Sprint 2-Net-Final: complete-chunked 用（只解析 multipart fields，不处理文件）
const multerNone = multer().none()

// Sprint 2-Net-Final: 分块上传专用 multer（每块写到 _chunks/<upload_id>/chunk_<index>.bin）
const uploadChunk = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const uploadId = req.body.upload_id || req.query.upload_id
      if (!uploadId || !/^[a-zA-Z0-9_-]{1,64}$/.test(uploadId)) return cb(new Error('invalid upload_id'))
      const dir = path.join(CHUNK_DIR, uploadId)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      cb(null, dir)
    },
    filename: (req, _file, cb) => {
      const idx = parseInt(req.body.chunk_index || req.query.chunk_index || '-1', 10)
      if (idx < 0) return cb(new Error('invalid chunk_index'))
      cb(null, `chunk_${idx}.bin`)
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },  // 单 chunk 上限 2MB（客户端切 256KB，留余量）
})

// Sprint 2B: PDF 上传专用 multer（写到 PDFS_TMP_DIR，后续算 sha256 + rename 入正式桶）
const uploadPdf = multer({
  storage: multer.diskStorage({
    destination: PDFS_TMP_DIR,
    filename: (_req, _file, cb) => cb(null, `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`),
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname?.toLowerCase().endsWith('.pdf')) cb(null, true)
    else cb(new Error('仅支持 PDF 文件'))
  },
})

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

// ── Sprint 1A-4: 6 位验证码登录 + 用户名密码注册 ────

// 发 6 位验证码到邮箱
app.post('/api/auth/login/start', async (req, res) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ error: 'email required' })
    await auth.requestLoginCode(db, email)
    res.json({ ok: true })
  } catch (err) {
    console.warn('[login/start]', err.message)
    res.json({ ok: true })  // 静默成功防 enumeration
  }
})

// 验证 6 位码 → 设 cookie
app.post('/api/auth/login/verify-code', (req, res) => {
  try {
    const { email, code } = req.body
    if (!email || !code) return res.status(400).json({ error: 'email and code required' })
    const { sessionToken, sessionExpiresAt } = auth.verifyLoginCode(db, email, code, req.ip)
    res.cookie('auth_token', sessionToken, {
      httpOnly: true, sameSite: 'lax',
      secure: req.protocol === 'https',
      expires: new Date(sessionExpiresAt),
    })
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// 一步注册：email + username + password → 创建 account + 设 cookie
app.post('/api/auth/register', (req, res) => {
  try {
    const { email, username, password } = req.body
    if (!email || !username || !password) return res.status(400).json({ error: 'email, username, password required' })
    const { sessionToken, sessionExpiresAt } = auth.register(db, email, username, password, req.ip)
    res.cookie('auth_token', sessionToken, {
      httpOnly: true, sameSite: 'lax',
      secure: req.protocol === 'https',
      expires: new Date(sessionExpiresAt),
    })
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// 用户名/邮箱 + 密码登录 → 设 cookie
app.post('/api/auth/login/password', (req, res) => {
  try {
    const { username, password } = req.body
    if (!username || !password) return res.status(400).json({ error: 'username and password required' })
    const { sessionToken, sessionExpiresAt } = auth.loginWithPassword(db, username, password, req.ip)
    res.cookie('auth_token', sessionToken, {
      httpOnly: true, sameSite: 'lax',
      secure: req.protocol === 'https',
      expires: new Date(sessionExpiresAt),
    })
    res.json({ ok: true })
  } catch (err) {
    res.status(401).json({ error: err.message })
  }
})

// 当前 session
app.get('/api/auth/me', (req, res) => {
  const session = auth.getCurrentSession(db, req.cookies?.auth_token)
  if (!session) return res.status(401).json({ error: 'not authenticated' })
  // Sprint 1A-6: 加 username 字段
  const account = db.prepare('SELECT username FROM accounts WHERE id = ?').get(session.account_id)
  res.json({
    account_id: session.account_id,
    email: session.email,
    username: account?.username || null,
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

// Sprint 1A-5: 忘记密码 — 第一步：发验证码（复用 requestLoginCode）
app.post('/api/auth/forgot-password/start', async (req, res) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ error: 'email required' })
    await auth.requestLoginCode(db, email)
    res.json({ ok: true })
  } catch (err) {
    res.json({ ok: true })  // 静默成功防 enumeration
  }
})

// Sprint 1A-5: 忘记密码 — 第二步：验证码 + 新密码
app.post('/api/auth/forgot-password/reset', (req, res) => {
  try {
    const { email, code, newPassword } = req.body
    if (!email || !code || !newPassword) return res.status(400).json({ error: 'email, code, newPassword required' })
    auth.resetPasswordWithCode(db, email, code, newPassword)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// Sprint 1A-6: 改用户名（已登录）
app.post('/api/auth/set-username', (req, res) => {
  try {
    const session = auth.getCurrentSession(db, req.cookies?.auth_token)
    if (!session) return res.status(401).json({ error: 'not authenticated' })
    const { username } = req.body
    if (!username) return res.status(400).json({ error: 'username required' })
    auth.setUsername(db, session.account_id, username)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// Sprint 1A-5: 修改密码（已登录）
app.post('/api/auth/change-password', (req, res) => {
  const session = auth.getCurrentSession(db, req.cookies?.auth_token)
  if (!session) return res.status(401).json({ error: 'not authenticated' })
  try {
    const { oldPassword, newPassword } = req.body
    if (!newPassword) return res.status(400).json({ error: 'newPassword required' })
    auth.changePassword(db, session.account_id, oldPassword || null, newPassword)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// 老 magic-link/verify 端点（deprecate）
app.get('/api/auth/magic-link/verify', (req, res) => {
  res.status(410).send('Magic link login has been replaced by 6-digit code. Please request a new login code at /login.')
})
app.post('/api/auth/magic-link/request', async (req, res) => {
  try {
    await auth.requestLoginCode(db, req.body?.email)
    res.json({ ok: true })
  } catch (err) { res.json({ ok: true }) }
})

// ── Sprint 0 routes ───────────────────────────────────────────────────────────

app.get('/test', (req, res) => {
  res.json({ ok: true, timestamp: new Date() });
});

// ── Sprint 1 routes ───────────────────────────────────────────────────────────

app.get('/api/children', (req, res) => {
  try {
    // Sprint 1A-3: 必须登录 + 按 account_id 过滤
    const authSession = auth.getCurrentSession(db, req.cookies?.auth_token)
    if (!authSession) return res.status(401).json({ error: 'not authenticated' })
    const accountId = authSession.account_id

    const today = todayLocal();
    const children = db.prepare(`
      SELECT c.*, l.filename AS cursor_filename
      FROM children c
      LEFT JOIN pdf_library l ON l.id = c.cursor_library_id
      WHERE c.account_id = ?
    `).all(accountId);
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
// Sprint 2-Hotfix Bug1: 公共图书馆按 is_private/uploader/superadmin 过滤
app.get('/api/library/list', (req, res) => {
  try {
    const session = auth.getCurrentSession(db, req.cookies?.auth_token)
    if (!session) return res.status(401).json({ error: 'not authenticated' })
    const accountId = session.account_id
    const isSuperAdmin = session.is_superadmin === 1

    const q = (req.query.q || '').trim()
    const cat = (req.query.category || '').trim()
    const where = []
    const params = []

    if (!isSuperAdmin) {
      where.push('(is_private = 0 OR uploader_account_id = ?)')
      params.push(accountId)
    }
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

    const categories = isSuperAdmin
      ? db.prepare(`
          SELECT COALESCE(category_path, '(未分类)') AS path, COUNT(*) AS count
          FROM pdf_library
          GROUP BY COALESCE(category_path, '(未分类)')
          ORDER BY path
        `).all()
      : db.prepare(`
          SELECT COALESCE(category_path, '(未分类)') AS path, COUNT(*) AS count
          FROM pdf_library
          WHERE is_private = 0 OR uploader_account_id = ?
          GROUP BY COALESCE(category_path, '(未分类)')
          ORDER BY path
        `).all(accountId)

    res.json({ items, total: items.length, categories })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Sprint 2-Hotfix Bug1: PDF 文件下载加鉴权 + 权限校验
app.get('/api/library/:id/file', (req, res) => {
  try {
    const session = auth.getCurrentSession(db, req.cookies?.auth_token)
    if (!session) return res.status(401).json({ error: 'not authenticated' })
    const accountId = session.account_id
    const isSuperAdmin = session.is_superadmin === 1

    const lib = db.prepare(
      'SELECT id, sha256, filename, is_private, uploader_account_id FROM pdf_library WHERE id = ?'
    ).get(req.params.id);
    if (!lib) return res.status(404).json({ error: 'not found' });

    const canAccess = isSuperAdmin
      || lib.is_private === 0
      || lib.uploader_account_id === accountId
    if (!canAccess) {
      return res.status(403).json({ error: 'forbidden: PDF is private and not yours' })
    }

    const filePath = path.join(__dirname, '../../data/pdfs', lib.sha256.slice(0, 2), lib.sha256 + '.pdf');
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'file missing on disk', sha256: lib.sha256 });
    }
    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sprint 2B: 用户上传 PDF ─────────────────────────────────────────────────

// POST 上传 PDF（登录用户）
app.post('/api/library/upload', uploadPdf.single('pdf'), (req, res) => {
  let tmpPath = req.file?.path
  try {
    const session = auth.getCurrentSession(db, req.cookies?.auth_token)
    if (!session) { if (tmpPath) try { fs.unlinkSync(tmpPath) } catch(_){} ; return res.status(401).json({ error: 'not authenticated' }) }
    if (!req.file) return res.status(400).json({ error: 'PDF file required' })
    const accountId = session.account_id
    const isSuperAdmin = session.is_superadmin === 1

    // 算 sha256
    const buf = fs.readFileSync(tmpPath)
    const sha = crypto.createHash('sha256').update(buf).digest('hex')
    const sizeBytes = buf.length
    const sizeMb = Math.ceil(sizeBytes / 1024 / 1024)
    const origFilename = req.file.originalname || 'untitled.pdf'

    // 去重：sha256 已存在
    const existing = db.prepare('SELECT id, filename, uploader_account_id, is_private FROM pdf_library WHERE sha256 = ?').get(sha)
    if (existing) {
      try { fs.unlinkSync(tmpPath) } catch(_) {}
      const canSee = isSuperAdmin || existing.is_private === 0 || existing.uploader_account_id === accountId
      return res.json({
        duplicate: true,
        library_id: canSee ? existing.id : null,
        filename: existing.filename,
        message: canSee ? '图书馆已有此书，已为你复用' : '图书馆已有此书（私有，无权访问）',
      })
    }

    // 配额检查（superadmin 跳过）
    if (!isSuperAdmin) {
      const acct = db.prepare('SELECT storage_used_mb, storage_quota_mb FROM accounts WHERE id = ?').get(accountId)
      if ((acct.storage_used_mb + sizeMb) > acct.storage_quota_mb) {
        try { fs.unlinkSync(tmpPath) } catch(_) {}
        return res.status(413).json({
          error: 'quota exceeded',
          used_mb: acct.storage_used_mb, quota_mb: acct.storage_quota_mb, file_mb: sizeMb,
        })
      }
    }

    // mv tmp → 正式桶
    const bucket = path.join(PDFS_DIR, sha.slice(0, 2))
    if (!fs.existsSync(bucket)) fs.mkdirSync(bucket, { recursive: true })
    const destPath = path.join(bucket, sha + '.pdf')
    fs.renameSync(tmpPath, destPath)
    tmpPath = null

    // 插库 + 更新配额
    const result = db.prepare(`
      INSERT INTO pdf_library (sha256, filename, title, size_bytes, uploader_account_id, is_private, is_builtin, category_path)
      VALUES (?, ?, ?, ?, ?, 1, 0, '我的上传')
    `).run(sha, origFilename, origFilename.replace(/\.pdf$/i, ''), sizeBytes, accountId)
    if (!isSuperAdmin) {
      db.prepare('UPDATE accounts SET storage_used_mb = storage_used_mb + ? WHERE id = ?').run(sizeMb, accountId)
    }

    res.json({
      duplicate: false,
      library_id: result.lastInsertRowid,
      filename: origFilename,
      size_mb: sizeMb,
    })
  } catch (err) {
    if (tmpPath) try { fs.unlinkSync(tmpPath) } catch(_) {}
    res.status(500).json({ error: err.message })
  }
})

// GET 当前账号上传列表 + 配额信息
app.get('/api/library/mine', (req, res) => {
  try {
    const session = auth.getCurrentSession(db, req.cookies?.auth_token)
    if (!session) return res.status(401).json({ error: 'not authenticated' })
    const accountId = session.account_id
    const isSuperAdmin = session.is_superadmin === 1
    const items = db.prepare(`
      SELECT id, sha256, filename, title, size_bytes, is_private, created_at
      FROM pdf_library WHERE uploader_account_id = ?
      ORDER BY created_at DESC
    `).all(accountId)
    const acct = db.prepare('SELECT storage_used_mb, storage_quota_mb FROM accounts WHERE id = ?').get(accountId)
    res.json({
      items,
      used_mb: acct.storage_used_mb,
      quota_mb: acct.storage_quota_mb,
      unlimited: isSuperAdmin,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET superadmin 查看所有账号上传列表
app.get('/api/admin/library/all-uploads', (req, res) => {
  try {
    const session = auth.getCurrentSession(db, req.cookies?.auth_token)
    if (!session) return res.status(401).json({ error: 'not authenticated' })
    if (session.is_superadmin !== 1) return res.status(403).json({ error: 'forbidden' })
    const items = db.prepare(`
      SELECT pl.id, pl.filename, pl.size_bytes, pl.is_private, pl.created_at,
             a.username AS uploader_username, a.id AS uploader_account_id
      FROM pdf_library pl
      JOIN accounts a ON a.id = pl.uploader_account_id
      WHERE pl.is_builtin = 0
      ORDER BY pl.created_at DESC
      LIMIT 1000
    `).all()
    res.json({ items })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH 切换 is_private（仅自家上传或 superadmin）
app.patch('/api/library/:id/visibility', (req, res) => {
  try {
    const session = auth.getCurrentSession(db, req.cookies?.auth_token)
    if (!session) return res.status(401).json({ error: 'not authenticated' })
    const lib = db.prepare('SELECT id, uploader_account_id FROM pdf_library WHERE id = ?').get(req.params.id)
    if (!lib) return res.status(404).json({ error: 'not found' })
    if (lib.uploader_account_id !== session.account_id && session.is_superadmin !== 1) {
      return res.status(403).json({ error: 'forbidden' })
    }
    const { is_private } = req.body
    db.prepare('UPDATE pdf_library SET is_private = ? WHERE id = ?').run(is_private ? 1 : 0, req.params.id)
    res.json({ ok: true, is_private: is_private ? 1 : 0 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE 自家上传的 PDF（superadmin 任意）
app.delete('/api/library/:id', (req, res) => {
  try {
    const session = auth.getCurrentSession(db, req.cookies?.auth_token)
    if (!session) return res.status(401).json({ error: 'not authenticated' })
    const lib = db.prepare('SELECT id, sha256, size_bytes, uploader_account_id, is_builtin FROM pdf_library WHERE id = ?').get(req.params.id)
    if (!lib) return res.status(404).json({ error: 'not found' })
    if (lib.is_builtin) return res.status(403).json({ error: 'cannot delete builtin' })
    if (lib.uploader_account_id !== session.account_id && session.is_superadmin !== 1) {
      return res.status(403).json({ error: 'forbidden' })
    }
    // 删物理文件
    const filePath = path.join(PDFS_DIR, lib.sha256.slice(0, 2), lib.sha256 + '.pdf')
    try { fs.unlinkSync(filePath) } catch(_) {}
    // 删库
    db.prepare('DELETE FROM pdf_library WHERE id = ?').run(req.params.id)
    // 减回配额（仅当 uploader 是当前账号且非 superadmin）
    if (lib.uploader_account_id === session.account_id && session.is_superadmin !== 1 && lib.size_bytes) {
      const sizeMb = Math.ceil(lib.size_bytes / 1024 / 1024)
      db.prepare('UPDATE accounts SET storage_used_mb = MAX(0, storage_used_mb - ?) WHERE id = ?').run(sizeMb, lib.uploader_account_id)
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/config', (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value FROM config').all();
    const config = {};
    for (const { key, value } of rows) {
      if (key === 'parent_pin') config.hasParentPin = value !== '';
      else config[key] = value;
    }
    // Sprint 1C: override window with account-specific value if logged in
    const userSession = auth.getCurrentSession(db, req.cookies?.auth_token)
    if (userSession) {
      const w = auth.getAccountWindow(db, userSession.account_id)
      config.window_start = w.window_start
      config.window_end = w.window_end
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
    // Sprint 2-Hotfix Bug2: 通过 child 反查 account_id 写入 session
    const child = db.prepare('SELECT account_id FROM children WHERE id = ?').get(child_id);
    if (!child) return res.status(404).json({ error: 'child not found' });
    const today = todayLocal();
    const now = new Date().toISOString();
    const pdfsRequired = getTodayPool(child_id).length;
    const result = db.prepare(
      "INSERT INTO reading_sessions (child_id, account_id, date, start_time, pdfs_required, status) VALUES (?, ?, ?, ?, ?, 'started')"
    ).run(child_id, child.account_id, today, now, pdfsRequired);
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

// Sprint 2-Net-Final: helper — 判定 + 持久化（复用给 /complete 和 /complete-chunked）
function finishSessionWithRecording(req, res, session, recordingPath, metrics) {
  const sessionId = session.id
  const { total_duration_s = 0, silence_count = 0, max_silence_s = 0, total_silence_s = 0, recording_start_ts } = metrics
  const pdfsOpened = db.prepare('SELECT COUNT(*) as c FROM pdf_reads WHERE session_id = ? AND completed = 1').get(sessionId).c
  const config = getConfig()
  const childAcctRow = db.prepare('SELECT account_id FROM children WHERE id = ?').get(session.child_id)
  const w = auth.getAccountWindow(db, childAcctRow?.account_id)
  const startDate = new Date(session.start_time)
  const startHHMM = `${startDate.getHours().toString().padStart(2,'0')}:${startDate.getMinutes().toString().padStart(2,'0')}`
  const timeInWindow = (startHHMM >= w.window_start && startHHMM < w.window_end) ? 1 : 0
  const childRow = db.prepare('SELECT min_duration_s FROM children WHERE id = ?').get(session.child_id)
  const minDur = (childRow?.min_duration_s != null) ? childRow.min_duration_s : parseInt(config.min_duration_s)
  let status = 'pending_review'
  if (total_duration_s < minDur) status = 'time_short'
  else if (!timeInWindow) status = 'out_of_window'
  else if (max_silence_s > parseInt(config.max_consecutive_silence_s)) status = 'long_pause'
  else if (total_duration_s > 0 && total_silence_s / total_duration_s > parseFloat(config.max_silence_ratio)) status = 'high_silence'
  else if (pdfsOpened < session.pdfs_required) status = 'pdf_insufficient'
  const silenceRatio = total_duration_s > 0 ? total_silence_s / total_duration_s : 1
  const tooShort = total_duration_s < AUTO_DISCARD_MIN_DURATION_S
  const tooSilent = silenceRatio > AUTO_DISCARD_MAX_SILENCE_RATIO
  if (tooShort || tooSilent) {
    if (recordingPath) { try { fs.unlinkSync(path.join(RECORDINGS_DIR, recordingPath)) } catch(_){} }
    db.prepare('DELETE FROM pdf_reads WHERE session_id = ?').run(sessionId)
    db.prepare('DELETE FROM reading_sessions WHERE id = ?').run(sessionId)
    return res.json({ discarded: true, reason: tooShort ? 'too_short' : 'too_silent', total_duration_s, silence_ratio: Math.round(silenceRatio * 100) / 100 })
  }
  const endTime = new Date().toISOString()
  db.prepare(`
    UPDATE reading_sessions SET
      end_time = ?, recording_path = ?, total_duration_s = ?, silence_count = ?,
      max_silence_s = ?, total_silence_s = ?, pdfs_opened = ?, time_in_window = ?, status = ?,
      recording_start_time = ?
    WHERE id = ?
  `).run(endTime, recordingPath, total_duration_s, silence_count, max_silence_s, total_silence_s, pdfsOpened, timeInWindow, status, recording_start_ts ?? null, sessionId)
  res.json(db.prepare('SELECT * FROM reading_sessions WHERE id = ?').get(sessionId))
}

app.post('/api/sessions/:id/complete', upload.single('recording'), (req, res) => {
  req.setTimeout(300000);
  try {
    const sessionId = parseInt(req.params.id);
    const session = db.prepare('SELECT * FROM reading_sessions WHERE id = ?').get(sessionId);
    if (!session) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'session not found' });
    }
    let recordingPath = null;
    if (req.file) {
      const ext = req.file.originalname?.endsWith('.mp4') ? 'mp4' : 'webm';
      const filename = `${session.child_id}_${sessionId}_${Date.now()}.${ext}`;
      fs.renameSync(req.file.path, path.join(RECORDINGS_DIR, filename));
      recordingPath = filename;
    }
    const metrics = JSON.parse(req.body.metrics ?? '{}');
    finishSessionWithRecording(req, res, session, recordingPath, metrics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sprint 2-Net-Final: 分块上传端点（朗读）
app.post('/api/sessions/:id/upload-chunk', uploadChunk.single('chunk'), (req, res) => {
  req.setTimeout(90000)
  try {
    const sessionId = parseInt(req.params.id)
    const session = db.prepare('SELECT id FROM reading_sessions WHERE id = ?').get(sessionId)
    if (!session) {
      if (req.file) try { fs.unlinkSync(req.file.path) } catch(_){}
      return res.status(404).json({ error: 'session not found' })
    }
    if (!req.file) return res.status(400).json({ error: 'chunk required' })
    const chunkIndex = parseInt(req.body.chunk_index, 10)
    const totalChunks = parseInt(req.body.total_chunks, 10)
    if (isNaN(chunkIndex) || isNaN(totalChunks) || chunkIndex < 0 || totalChunks <= 0) {
      return res.status(400).json({ error: 'chunk_index/total_chunks invalid' })
    }
    res.json({ ok: true, chunk_index: chunkIndex, total_chunks: totalChunks })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Sprint 2-Net-Final: 分块完成 + 组装（朗读）
app.post('/api/sessions/:id/complete-chunked', multerNone, (req, res) => {
  req.setTimeout(120000)
  try {
    const sessionId = parseInt(req.params.id)
    const session = db.prepare('SELECT * FROM reading_sessions WHERE id = ?').get(sessionId)
    if (!session) return res.status(404).json({ error: 'session not found' })
    const uploadId = req.body.upload_id
    const totalChunks = parseInt(req.body.total_chunks, 10)
    const ext = req.body.ext === 'mp4' ? 'mp4' : 'webm'
    if (!uploadId || !/^[a-zA-Z0-9_-]{1,64}$/.test(uploadId) || isNaN(totalChunks) || totalChunks <= 0) {
      return res.status(400).json({ error: 'upload_id/total_chunks invalid' })
    }
    let metrics = {}
    try { metrics = JSON.parse(req.body.metrics ?? '{}') } catch (_) {}
    const chunkDir = path.join(CHUNK_DIR, uploadId)
    if (!fs.existsSync(chunkDir)) return res.status(400).json({ error: 'no chunks found' })
    for (let i = 0; i < totalChunks; i++) {
      if (!fs.existsSync(path.join(chunkDir, `chunk_${i}.bin`))) return res.status(400).json({ error: `chunk ${i} missing` })
    }
    const finalName = `${session.child_id}_${sessionId}_${Date.now()}.${ext}`
    const finalPath = path.join(RECORDINGS_DIR, finalName)
    const out = fs.createWriteStream(finalPath)
    for (let i = 0; i < totalChunks; i++) {
      out.write(fs.readFileSync(path.join(chunkDir, `chunk_${i}.bin`)))
    }
    out.end(() => {
      for (let i = 0; i < totalChunks; i++) { try { fs.unlinkSync(path.join(chunkDir, `chunk_${i}.bin`)) } catch(_){} }
      try { fs.rmdirSync(chunkDir) } catch(_){}
      finishSessionWithRecording(req, res, session, finalName, metrics)
    })
    out.on('error', (e) => { try { fs.unlinkSync(finalPath) } catch(_){} res.status(500).json({ error: e.message }) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/sessions/:id', (req, res) => {
  try {
    const session = db.prepare('SELECT * FROM reading_sessions WHERE id = ?').get(parseInt(req.params.id));
    if (!session) return res.status(404).json({ error: 'not found' });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sprint 1B: 家长会话端点 ───────────────────────────────────────────────────

// 输 PIN 解锁家长 → 发 parent_session cookie
app.post('/api/auth/parent-unlock', (req, res) => {
  try {
    const userSession = auth.getCurrentSession(db, req.cookies?.auth_token)
    if (!userSession) return res.status(401).json({ error: 'login required first' })
    const { pin } = req.body
    if (!pin) return res.status(400).json({ error: 'pin required' })
    if (!auth.verifyParentPin(db, userSession.account_id, pin)) {
      return res.status(401).json({ error: 'invalid pin' })
    }
    const { token, expiresAt } = auth.createParentSession(db, userSession.account_id)
    res.cookie('parent_token', token, {
      httpOnly: true, sameSite: 'lax',
      secure: req.protocol === 'https',
      expires: new Date(expiresAt),
    })
    res.json({ ok: true, expiresAt })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 查询当前家长解锁状态
app.get('/api/auth/parent-status', (req, res) => {
  const userSession = auth.getCurrentSession(db, req.cookies?.auth_token)
  if (!userSession) return res.json({ logged_in: false, parent_unlocked: false, has_pin: false })
  const parentSession = auth.getCurrentParentSession(db, req.cookies?.parent_token)
  const unlocked = !!(parentSession && parentSession.account_id === userSession.account_id)
  const acct = db.prepare('SELECT parent_pin_hash FROM accounts WHERE id = ?').get(userSession.account_id)
  res.json({
    logged_in: true,
    parent_unlocked: unlocked,
    has_pin: !!(acct?.parent_pin_hash),
    parent_expires_at: unlocked ? parentSession.expires_at : null,
  })
})

// 家长锁屏（清 parent_session）
app.post('/api/auth/parent-lock', (req, res) => {
  auth.deleteParentSession(db, req.cookies?.parent_token)
  res.clearCookie('parent_token')
  res.json({ ok: true })
})

// 设置/修改 PIN（需要已登录；首次设置不要求旧 PIN）
app.post('/api/auth/set-pin', (req, res) => {
  try {
    const userSession = auth.getCurrentSession(db, req.cookies?.auth_token)
    if (!userSession) return res.status(401).json({ error: 'login required' })
    const { newPin, oldPin } = req.body
    if (!newPin) return res.status(400).json({ error: 'newPin required' })
    const acct = db.prepare('SELECT parent_pin_hash FROM accounts WHERE id = ?').get(userSession.account_id)
    if (acct?.parent_pin_hash) {
      if (!oldPin || !auth.verifyParentPin(db, userSession.account_id, oldPin)) {
        return res.status(401).json({ error: 'old PIN incorrect' })
      }
    }
    auth.setParentPin(db, userSession.account_id, newPin)
    // Sprint 1C: 设完 PIN 后自动解锁家长（向导无缝流程）
    const { token, expiresAt } = auth.createParentSession(db, userSession.account_id)
    res.cookie('parent_token', token, {
      httpOnly: true, sameSite: 'lax',
      secure: req.protocol === 'https',
      expires: new Date(expiresAt),
    })
    res.json({ ok: true, parent_unlocked: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// Sprint 1C: 设置时间窗口（需要家长解锁）
app.post('/api/auth/set-window', requireParent, (req, res) => {
  try {
    const { window_start, window_end } = req.body
    if (!window_start || !window_end) return res.status(400).json({ error: 'window_start and window_end required' })
    auth.setWindow(db, req.accountId, window_start, window_end)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// Sprint 1B: 家长解锁中间件（cookie 优先，X-Admin-Pin fallback 兼容期）
function requireParent(req, res, next) {
  const userSession = auth.getCurrentSession(db, req.cookies?.auth_token)
  const parentSession = auth.getCurrentParentSession(db, req.cookies?.parent_token)
  if (parentSession && userSession && parentSession.account_id === userSession.account_id) {
    req.accountId = userSession.account_id
    req.parentUnlocked = true
    return next()
  }
  // Fallback: 老 X-Admin-Pin header（兼容期）
  const pin = req.headers['x-admin-pin'] || req.body?.pin || req.query?.pin
  if (pin) {
    if (auth.verifyParentPin(db, 1, pin)) {
      req.accountId = 1; req.parentUnlocked = true; return next()
    }
    const cfg = db.prepare("SELECT value FROM config WHERE key = 'parent_pin'").get()
    if (cfg && cfg.value && cfg.value === String(pin)) {
      req.accountId = 1; req.parentUnlocked = true; return next()
    }
  }
  return res.status(401).json({ error: 'parent unlock required' })
}

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

app.post('/api/admin/verify-pin', requireParent, (req, res) => {
  res.json({ ok: true })
})

app.get('/api/admin/sessions', requireParent, (req, res) => {
  try {
    const accountId = req.accountId
    const { child_id, limit = 50, offset = 0 } = req.query
    let sessions
    if (child_id) {
      sessions = db.prepare(`
        SELECT rs.*, c.name as child_name FROM reading_sessions rs
        JOIN children c ON c.id = rs.child_id
        WHERE rs.account_id = ? AND rs.child_id = ? AND rs.status != 'started'
        ORDER BY rs.date DESC, rs.start_time DESC
        LIMIT ? OFFSET ?
      `).all(accountId, child_id, parseInt(limit), parseInt(offset))
    } else {
      sessions = db.prepare(`
        SELECT rs.*, c.name as child_name FROM reading_sessions rs
        JOIN children c ON c.id = rs.child_id
        WHERE rs.account_id = ? AND rs.status != 'started'
        ORDER BY rs.date DESC, rs.start_time DESC
        LIMIT ? OFFSET ?
      `).all(accountId, parseInt(limit), parseInt(offset))
    }
    res.json(sessions)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/admin/sessions/:id', requireParent, (req, res) => {
  try {
    const sessionId = parseInt(req.params.id)
    const session = db.prepare(`
      SELECT rs.*, c.name as child_name FROM reading_sessions rs
      JOIN children c ON c.id = rs.child_id
      WHERE rs.id = ? AND rs.account_id = ?
    `).get(sessionId, req.accountId)
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

app.post('/api/admin/sessions/bulk-delete', requireParent, (req, res) => {
  try {
    const { ids } = req.body
    const accountId = req.accountId
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' })
    let deleted = 0
    const missing = []
    const doDelete = db.transaction(() => {
      for (const id of ids) {
        const session = db.prepare('SELECT recording_path FROM reading_sessions WHERE id = ? AND account_id = ?').get(id, accountId)
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

app.delete('/api/admin/sessions/:id', requireParent, (req, res) => {
  try {
    const sessionId = parseInt(req.params.id)
    const session = db.prepare('SELECT recording_path FROM reading_sessions WHERE id = ? AND account_id = ?').get(sessionId, req.accountId)
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

app.get('/api/admin/sessions/:id/recording', requireParent, (req, res) => {
  try {
    const sessionId = parseInt(req.params.id)
    const session = db.prepare('SELECT * FROM reading_sessions WHERE id = ? AND account_id = ?').get(sessionId, req.accountId)
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

app.post('/api/admin/sessions/:id/review', requireParent, (req, res) => {
  try {
    const sessionId = parseInt(req.params.id)
    const { decision } = req.body
    if (!['passed', 'redo'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be passed|redo' })
    }
    const sessionBefore = db.prepare('SELECT * FROM reading_sessions WHERE id = ? AND account_id = ?').get(sessionId, req.accountId)
    if (!sessionBefore) return res.status(404).json({ error: 'not found' })
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
    // Sprint 2-Hotfix Bug2: 通过 child 反查 account_id 写入 session
    const child = db.prepare('SELECT account_id FROM children WHERE id = ?').get(child_id)
    if (!child) return res.status(404).json({ error: 'child not found' })
    const today = todayLocal()
    const plan = db.prepare(
      "SELECT * FROM recitation_plans WHERE child_id = ? AND scheduled_date = ? AND status IN ('scheduled', 'retry') ORDER BY id ASC LIMIT 1"
    ).get(child_id, today)
    if (!plan) return res.status(404).json({ error: 'no recitation plan for today' })
    const now = new Date().toISOString()
    const result = db.prepare(
      "INSERT INTO reading_sessions (child_id, account_id, date, start_time, session_type, plan_id, status) VALUES (?, ?, ?, ?, 'recitation', ?, 'started')"
    ).run(child_id, child.account_id, today, now, plan.id)
    res.json({ session_id: result.lastInsertRowid, plan })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Sprint 2-Net-Final: helper — 判定 + 持久化（复用给背诵 /complete 和 /complete-chunked）
function finishRecitationWithRecording(req, res, session, recordingPath, metrics) {
  const sessionId = session.id
  const { total_duration_s = 0, silence_count = 0, max_silence_s = 0, total_silence_s = 0, recording_start_ts } = metrics
  const config = getConfig()
  const recChildAcctRow = db.prepare('SELECT account_id FROM children WHERE id = ?').get(session.child_id)
  const wRec = auth.getAccountWindow(db, recChildAcctRow?.account_id)
  const startDate = new Date(session.start_time)
  const startHHMM = `${startDate.getHours().toString().padStart(2,'0')}:${startDate.getMinutes().toString().padStart(2,'0')}`
  const timeInWindow = (startHHMM >= wRec.window_start && startHHMM < wRec.window_end) ? 1 : 0
  const childRowRec = db.prepare('SELECT min_duration_s FROM children WHERE id = ?').get(session.child_id)
  const minDurRec = (childRowRec?.min_duration_s != null) ? childRowRec.min_duration_s : parseInt(config.min_duration_s)
  const halfMin = Math.floor(minDurRec / 2)
  let status = 'pending_review'
  if (total_duration_s < halfMin) status = 'time_short'
  else if (max_silence_s > parseInt(config.max_consecutive_silence_s)) status = 'long_pause'
  else if (total_duration_s > 0 && total_silence_s / total_duration_s > parseFloat(config.max_silence_ratio)) status = 'high_silence'
  const silenceRatio = total_duration_s > 0 ? total_silence_s / total_duration_s : 1
  const tooShort = total_duration_s < AUTO_DISCARD_MIN_DURATION_S
  const tooSilent = silenceRatio > AUTO_DISCARD_MAX_SILENCE_RATIO
  if (tooShort || tooSilent) {
    if (recordingPath) { try { fs.unlinkSync(path.join(RECORDINGS_DIR, recordingPath)) } catch(_){} }
    db.prepare('DELETE FROM pdf_reads WHERE session_id = ?').run(sessionId)
    db.prepare('DELETE FROM reading_sessions WHERE id = ?').run(sessionId)
    return res.json({ discarded: true, reason: tooShort ? 'too_short' : 'too_silent', total_duration_s, silence_ratio: Math.round(silenceRatio * 100) / 100 })
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
    db.prepare("UPDATE recitation_plans SET status = 'submitted' WHERE id = ? AND status IN ('scheduled', 'retry')").run(session.plan_id)
  }
  res.json(db.prepare('SELECT * FROM reading_sessions WHERE id = ?').get(sessionId))
}

app.post('/api/recitation/:id/complete', upload.single('recording'), (req, res) => {
  req.setTimeout(300000)
  try {
    const sessionId = parseInt(req.params.id)
    const session = db.prepare('SELECT * FROM reading_sessions WHERE id = ?').get(sessionId)
    if (!session) {
      if (req.file) fs.unlink(req.file.path, () => {})
      return res.status(404).json({ error: 'session not found' })
    }
    let recordingPath = null
    if (req.file) {
      const ext = req.file.originalname?.endsWith('.mp4') ? 'mp4' : 'webm'
      const filename = `${session.child_id}_${sessionId}_${Date.now()}.${ext}`
      fs.renameSync(req.file.path, path.join(RECORDINGS_DIR, filename))
      recordingPath = filename
    }
    const metrics = JSON.parse(req.body.metrics ?? '{}')
    finishRecitationWithRecording(req, res, session, recordingPath, metrics)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Sprint 2-Net-Final: 分块上传端点（背诵）
app.post('/api/recitation/:id/upload-chunk', uploadChunk.single('chunk'), (req, res) => {
  req.setTimeout(90000)
  try {
    const sessionId = parseInt(req.params.id)
    const session = db.prepare('SELECT id FROM reading_sessions WHERE id = ?').get(sessionId)
    if (!session) {
      if (req.file) try { fs.unlinkSync(req.file.path) } catch(_){}
      return res.status(404).json({ error: 'session not found' })
    }
    if (!req.file) return res.status(400).json({ error: 'chunk required' })
    const chunkIndex = parseInt(req.body.chunk_index, 10)
    const totalChunks = parseInt(req.body.total_chunks, 10)
    if (isNaN(chunkIndex) || isNaN(totalChunks) || chunkIndex < 0 || totalChunks <= 0) {
      return res.status(400).json({ error: 'chunk_index/total_chunks invalid' })
    }
    res.json({ ok: true, chunk_index: chunkIndex, total_chunks: totalChunks })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Sprint 2-Net-Final: 分块完成 + 组装（背诵）
app.post('/api/recitation/:id/complete-chunked', multerNone, (req, res) => {
  req.setTimeout(120000)
  try {
    const sessionId = parseInt(req.params.id)
    const session = db.prepare('SELECT * FROM reading_sessions WHERE id = ?').get(sessionId)
    if (!session) return res.status(404).json({ error: 'session not found' })
    const uploadId = req.body.upload_id
    const totalChunks = parseInt(req.body.total_chunks, 10)
    const ext = req.body.ext === 'mp4' ? 'mp4' : 'webm'
    if (!uploadId || !/^[a-zA-Z0-9_-]{1,64}$/.test(uploadId) || isNaN(totalChunks) || totalChunks <= 0) {
      return res.status(400).json({ error: 'upload_id/total_chunks invalid' })
    }
    let metrics = {}
    try { metrics = JSON.parse(req.body.metrics ?? '{}') } catch (_) {}
    const chunkDir = path.join(CHUNK_DIR, uploadId)
    if (!fs.existsSync(chunkDir)) return res.status(400).json({ error: 'no chunks found' })
    for (let i = 0; i < totalChunks; i++) {
      if (!fs.existsSync(path.join(chunkDir, `chunk_${i}.bin`))) return res.status(400).json({ error: `chunk ${i} missing` })
    }
    const finalName = `${session.child_id}_${sessionId}_${Date.now()}.${ext}`
    const finalPath = path.join(RECORDINGS_DIR, finalName)
    const out = fs.createWriteStream(finalPath)
    for (let i = 0; i < totalChunks; i++) {
      out.write(fs.readFileSync(path.join(chunkDir, `chunk_${i}.bin`)))
    }
    out.end(() => {
      for (let i = 0; i < totalChunks; i++) { try { fs.unlinkSync(path.join(chunkDir, `chunk_${i}.bin`)) } catch(_){} }
      try { fs.rmdirSync(chunkDir) } catch(_){}
      finishRecitationWithRecording(req, res, session, finalName, metrics)
    })
    out.on('error', (e) => { try { fs.unlinkSync(finalPath) } catch(_){} res.status(500).json({ error: e.message }) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/admin/recitation/schedule', requireParent, (req, res) => {
  try {
    const { child_id, pdf_filename, scheduled_date } = req.body
    if (!child_id || !pdf_filename || !scheduled_date) {
      return res.status(400).json({ error: 'child_id, pdf_filename, scheduled_date required' })
    }
    if (!db.prepare('SELECT 1 FROM children WHERE id = ? AND account_id = ?').get(child_id, req.accountId)) {
      return res.status(404).json({ error: 'child not found' })
    }
    const result = db.prepare(
      "INSERT INTO recitation_plans (child_id, pdf_filename, scheduled_date, status, account_id) VALUES (?, ?, ?, 'scheduled', ?)"
    ).run(child_id, pdf_filename, scheduled_date, req.accountId)
    const plan = db.prepare('SELECT * FROM recitation_plans WHERE id = ?').get(result.lastInsertRowid)
    res.json(plan)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/admin/recitation', requireParent, (req, res) => {
  try {
    const { upcoming } = req.query
    let plans
    if (upcoming === '1') {
      const today = todayLocal()
      plans = db.prepare(`
        SELECT rp.*, c.name as child_name FROM recitation_plans rp
        JOIN children c ON c.id = rp.child_id
        WHERE rp.account_id = ? AND rp.scheduled_date >= ?
        ORDER BY rp.scheduled_date ASC
      `).all(req.accountId, today)
    } else {
      plans = db.prepare(`
        SELECT rp.*, c.name as child_name FROM recitation_plans rp
        JOIN children c ON c.id = rp.child_id
        WHERE rp.account_id = ?
        ORDER BY rp.scheduled_date ASC
      `).all(req.accountId)
    }
    res.json(plans)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/admin/recitation/:id', requireParent, (req, res) => {
  try {
    const result = db.prepare('DELETE FROM recitation_plans WHERE id = ? AND account_id = ?').run(parseInt(req.params.id), req.accountId)
    if (result.changes === 0) return res.status(404).json({ error: 'not found' })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Admin children CRUD ───────────────────────────────────────────────────────

app.post('/api/admin/children', requireParent, (req, res) => {
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
      'INSERT INTO children (id, name, age, font_scale, pdf_dir, daily_count, account_id) VALUES (?, ?, ?, ?, ?, 3, ?)'
    ).run(id, name.trim(), ageNum, scale, defaultDir, req.accountId)
    res.json(db.prepare('SELECT * FROM children WHERE id = ?').get(id))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/admin/children/:id', requireParent, (req, res) => {
  try {
    const id = req.params.id
    if (!db.prepare('SELECT 1 FROM children WHERE id = ? AND account_id = ?').get(id, req.accountId)) {
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

app.post('/api/admin/pool/configure', requireParent, (req, res) => {
  try {
    const { child_id, cursor_library_id, daily_count, min_duration_s } = req.body
    if (!child_id) return res.status(400).json({ error: 'child_id required' })
    if (cursor_library_id === undefined && daily_count === undefined && min_duration_s === undefined) {
      return res.status(400).json({ error: 'at least one field required' })
    }
    if (!db.prepare('SELECT 1 FROM children WHERE id = ? AND account_id = ?').get(child_id, req.accountId)) {
      return res.status(404).json({ error: 'child not found' })
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
      WHERE id = ? AND account_id = ?
    `).run(cursorLibId, cursorLibId, cursorFilename, cursorFilename, countVal, countVal, child_id, req.accountId)

    if (min_duration_s !== undefined) {
      const durVal = min_duration_s === null ? null : parseInt(min_duration_s)
      if (durVal !== null && (isNaN(durVal) || durVal < 60 || durVal > 3600)) {
        return res.status(400).json({ error: 'min_duration_s must be 60-3600' })
      }
      db.prepare('UPDATE children SET min_duration_s = ? WHERE id = ? AND account_id = ?').run(durVal, child_id, req.accountId)
    }

    res.json(db.prepare('SELECT * FROM children WHERE id = ?').get(child_id))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/admin/pool/preview/:childId', requireParent, (req, res) => {
  try {
    if (!db.prepare('SELECT 1 FROM children WHERE id = ? AND account_id = ?').get(req.params.childId, req.accountId)) {
      return res.status(404).json({ error: 'child not found' })
    }
    const pool = getTodayPool(req.params.childId).map(p => ({
      library_id: p.library_id,
      filename: p.filename,
    }))
    res.json(pool)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── PDF 批注（Sprint 3A）─────────────────────────────────────────────────────

// 家长保存批注（PIN 解锁）
app.post('/api/admin/annotations', requireParent, (req, res) => {
  try {
    const { pdf_library_id, page_number, message, session_id, pos_x, pos_y, color, drawing_svg, font_scale } = req.body
    const hasDrawing = drawing_svg != null && drawing_svg !== ''
    // 文字批注需 message；手绘批注需 drawing_svg
    if (!pdf_library_id || !page_number || (!message?.trim() && !hasDrawing)) {
      return res.status(400).json({ error: 'pdf_library_id, page_number, and (message or drawing_svg) required' })
    }
    const kind = hasDrawing ? 'drawing' : 'text'
    const fs = (typeof font_scale === 'number' && font_scale >= 0.3 && font_scale <= 3.0) ? font_scale : 1.0
    const result = db.prepare(`
      INSERT INTO pdf_annotations
        (account_id, pdf_library_id, page_number, message, created_by_session, pos_x, pos_y, color, kind, drawing_svg, font_scale)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.accountId, pdf_library_id, page_number, (message ?? '').trim(), session_id ?? null,
           pos_x ?? null, pos_y ?? null, color ?? '#E07A5F', kind, hasDrawing ? drawing_svg : null, fs)
    res.json(db.prepare('SELECT * FROM pdf_annotations WHERE id = ?').get(result.lastInsertRowid))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 家长查看某页批注（审核时回显，PIN 解锁）
app.get('/api/admin/annotations', requireParent, (req, res) => {
  try {
    const { library_id, page } = req.query
    if (!library_id) return res.status(400).json({ error: 'library_id required' })
    const rows = page
      ? db.prepare(`SELECT * FROM pdf_annotations WHERE account_id = ? AND pdf_library_id = ? AND page_number = ? ORDER BY created_at`).all(req.accountId, library_id, page)
      : db.prepare(`SELECT * FROM pdf_annotations WHERE account_id = ? AND pdf_library_id = ? ORDER BY page_number, created_at`).all(req.accountId, library_id)
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 孩子端读取批注（仅需 account 登录，不需 PIN）
// page 可选：不传则返回整本所有批注（含 page_number），前端翻页不 refetch
app.get('/api/annotations', (req, res) => {
  try {
    const session = auth.getCurrentSession(db, req.cookies?.auth_token)
    if (!session) return res.status(401).json({ error: 'not authenticated' })
    const { library_id, page } = req.query
    if (!library_id) return res.status(400).json({ error: 'library_id required' })
    const rows = page
      ? db.prepare(`SELECT id, page_number, message, drawing_svg, pos_x, pos_y, color FROM pdf_annotations
           WHERE account_id = ? AND pdf_library_id = ? AND page_number = ? ORDER BY created_at ASC`
        ).all(session.account_id, library_id, page)
      : db.prepare(`SELECT id, page_number, message, drawing_svg, pos_x, pos_y, color FROM pdf_annotations
           WHERE account_id = ? AND pdf_library_id = ? ORDER BY page_number, created_at ASC`
        ).all(session.account_id, library_id)
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Sprint 3-Annot-Edit/Drag: 编辑 + 拖动批注
app.patch('/api/admin/annotations/:id', requireParent, (req, res) => {
  try {
    const lib = db.prepare('SELECT id, account_id, kind, drawing_svg FROM pdf_annotations WHERE id = ?').get(req.params.id)
    if (!lib) return res.status(404).json({ error: 'not found' })
    if (lib.account_id !== req.accountId) return res.status(403).json({ error: 'forbidden' })
    const isDrawing = lib.kind === 'drawing' || !!lib.drawing_svg
    const { message, color, pos_x, pos_y, drawing_svg, font_scale } = req.body
    const fields = []
    const params = []
    if (!isDrawing) {
      if (typeof message === 'string') { fields.push('message = ?'); params.push(message.trim()) }
      if (typeof color === 'string')   { fields.push('color = ?');   params.push(color) }
      if (typeof font_scale === 'number' && font_scale >= 0.3 && font_scale <= 3.0) {
        fields.push('font_scale = ?'); params.push(font_scale)
      }
    }
    if (typeof pos_x === 'number')   { fields.push('pos_x = ?');   params.push(pos_x) }
    if (typeof pos_y === 'number')   { fields.push('pos_y = ?');   params.push(pos_y) }
    if (typeof drawing_svg === 'string' && isDrawing) {
      fields.push('drawing_svg = ?'); params.push(drawing_svg)
    }
    if (fields.length === 0) return res.status(400).json({ error: 'no fields to update' })
    params.push(req.params.id)
    db.prepare(`UPDATE pdf_annotations SET ${fields.join(', ')} WHERE id = ?`).run(...params)
    res.json(db.prepare('SELECT * FROM pdf_annotations WHERE id = ?').get(req.params.id))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 删除批注（家长，account 隔离）
app.delete('/api/admin/annotations/:id', requireParent, (req, res) => {
  try {
    const result = db.prepare('DELETE FROM pdf_annotations WHERE id = ? AND account_id = ?')
      .run(parseInt(req.params.id), req.accountId)
    if (result.changes === 0) return res.status(404).json({ error: 'not found' })
    res.json({ ok: true })
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

// Backend 只跑 HTTP:3001（Cloudflare Tunnel + Vite proxy /api → localhost:3001）
// HTTPS 由 Vite dev server 负责，不在 backend 开 HTTPS 避免抢占 5173
const HTTP_PORT = parseInt(process.env.PORT || '3001', 10)
http.createServer(app).listen(HTTP_PORT, () => {
  console.log(`Morning Reader backend HTTP listening :${HTTP_PORT}`)
})
