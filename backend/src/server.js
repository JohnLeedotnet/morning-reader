const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const db = require('./db');
const adminAuth = require('./adminAuth');

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

// ── PDF helpers ──────────────────────────────────────────────────────────────

const SKIP_DIR_NAMES = new Set([
  '.Trashes', '.Spotlight-V100', '.DocumentRevisions-V100',
  '.fseventsd', '.TemporaryItems', '.HFS+ Private Directory Data',
  'node_modules', '.git',
])
const MAX_PDFS_PER_SCAN = 5000
const SCAN_TIMEOUT_MS   = 8000

function getPdfDir() {
  return db.prepare("SELECT value FROM config WHERE key='pdf_dir'").get()?.value || '';
}

function collectPdfsAt(rootDir, currentDir, results, deadline) {
  if (results.length >= MAX_PDFS_PER_SCAN || Date.now() > deadline) return
  let entries
  try { entries = fs.readdirSync(currentDir, { withFileTypes: true }) } catch (_) { return }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (results.length >= MAX_PDFS_PER_SCAN || Date.now() > deadline) return
    if (entry.name.startsWith('.') || SKIP_DIR_NAMES.has(entry.name)) continue
    const fullPath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) collectPdfsAt(rootDir, fullPath, results, deadline)
    else if (entry.name.toLowerCase().endsWith('.pdf'))
      results.push({ filename: entry.name, relativePath: path.relative(rootDir, fullPath) })
  }
}

function listPdfsByLevelAt(dir) {
  const levels = []
  const deadline = Date.now() + SCAN_TIMEOUT_MS
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)) } catch (_) { return levels }
  // 根目录散落的 PDF 作为一个虚拟 level，排在最前
  const rootFiles = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIR_NAMES.has(entry.name)) continue
    if (!entry.isDirectory() && entry.name.toLowerCase().endsWith('.pdf')) {
      rootFiles.push({ filename: entry.name, relativePath: entry.name })
    }
  }
  if (rootFiles.length > 0) levels.push({ level: '(根目录)', files: rootFiles })
  // 一级子目录递归扫描
  for (const entry of entries) {
    if (Date.now() > deadline) break
    if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP_DIR_NAMES.has(entry.name)) continue
    const files = []
    collectPdfsAt(dir, path.join(dir, entry.name), files, deadline)
    if (files.length > 0) levels.push({ level: entry.name, files })
  }
  return levels
}

function findFirstPdf(dir) {
  const results = []
  collectPdfsAt(dir, dir, results, Date.now() + SCAN_TIMEOUT_MS)
  return results[0] ?? null
}

function probePdfCount(rootDir, deadline, max = 1) {
  let found = 0
  function walk(dir) {
    if (found >= max || Date.now() > deadline) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return }
    for (const e of entries) {
      if (found >= max || Date.now() > deadline) return
      if (e.name.startsWith('.') || SKIP_DIR_NAMES.has(e.name)) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.toLowerCase().endsWith('.pdf')) found++
    }
  }
  walk(rootDir)
  return found
}

const _pdfCacheByDir = new Map() // dir → { results, truncated }
function findPdfsFlatFor(dir) {
  if (!dir) return []
  if (_pdfCacheByDir.has(dir)) return _pdfCacheByDir.get(dir).results
  const deadline = Date.now() + SCAN_TIMEOUT_MS
  const results = []
  collectPdfsAt(dir, dir, results, deadline)
  _pdfCacheByDir.set(dir, { results, truncated: results.length >= MAX_PDFS_PER_SCAN })
  return results
}
function findPdfsFlat() { return findPdfsFlatFor(getPdfDir()) }

function getTodayPool(childId) {
  const child = db.prepare('SELECT cursor_pdf, daily_count, pdf_dir FROM children WHERE id = ?').get(childId);
  if (!child || !child.cursor_pdf) return [];
  const dir = child.pdf_dir || getPdfDir();
  const allPdfs = findPdfsFlatFor(dir);
  const cursorIdx = allPdfs.findIndex(p => p.relativePath === child.cursor_pdf);
  if (cursorIdx === -1) return [];
  return allPdfs.slice(cursorIdx, cursorIdx + (child.daily_count || 3));
}

function getConfig() {
  return db.prepare('SELECT key, value FROM config').all().reduce((acc, r) => {
    acc[r.key] = r.value;
    return acc;
  }, {});
}

// ── Sprint 0 routes ───────────────────────────────────────────────────────────

app.get('/test', (req, res) => {
  res.json({ ok: true, timestamp: new Date() });
});

app.get('/api/pdfs/sample', (req, res) => {
  try {
    const pdfDir = getPdfDir();
    const first = findFirstPdf(pdfDir);
    if (!first) return res.status(404).json({ error: 'No PDF files found' });
    res.sendFile(path.join(pdfDir, first.relativePath));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sprint 1 routes ───────────────────────────────────────────────────────────

app.get('/api/children', (req, res) => {
  try {
    const today = todayLocal();
    const children = db.prepare('SELECT * FROM children').all();
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
      pdf_filename: p.relativePath,
    }));
    res.json(pool);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pdfs/list', (req, res) => {
  req.setTimeout(15000, () => {
    if (!res.headersSent) res.status(504).json({ error: 'scan_timeout' })
  })
  const t0 = Date.now()
  try {
    const dir = getPdfDir()
    const result = listPdfsByLevelAt(dir)
    const ms = Date.now() - t0
    if (ms > 2000) console.warn(`[pdfs/list] slow scan ${ms}ms dir=${dir} levels=${result.length}`)
    res.json(result)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/children/:id/pdfs/list', (req, res) => {
  req.setTimeout(15000, () => {
    if (!res.headersSent) res.status(504).json({ error: 'scan_timeout' })
  })
  const t0 = Date.now()
  try {
    const child = db.prepare('SELECT pdf_dir FROM children WHERE id = ?').get(req.params.id)
    if (!child) return res.status(404).json({ error: 'not found' })
    const dir = child.pdf_dir || getPdfDir()
    const result = listPdfsByLevelAt(dir)
    const ms = Date.now() - t0
    if (ms > 2000) console.warn(`[pdfs/list child=${req.params.id}] slow scan ${ms}ms dir=${dir} levels=${result.length}`)
    res.json(result)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/children/:id/pdfs/file', (req, res) => {
  try {
    const child = db.prepare('SELECT pdf_dir FROM children WHERE id = ?').get(req.params.id)
    if (!child) return res.status(404).json({ error: 'not found' })
    const pdfDir = child.pdf_dir || getPdfDir()
    const rel = req.query.path
    if (!rel) return res.status(400).json({ error: 'path query param required' })
    const normalized = path.normalize(rel)
    if (normalized.startsWith('..')) return res.status(403).json({ error: 'forbidden' })
    const fullPath = path.join(pdfDir, normalized)
    if (!fullPath.startsWith(pdfDir)) return res.status(403).json({ error: 'forbidden' })
    res.sendFile(fullPath)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/pdfs/file', (req, res) => {
  try {
    const pdfDir = getPdfDir();
    const rel = req.query.path;
    if (!rel) return res.status(400).json({ error: 'path query param required' });
    const normalized = path.normalize(rel);
    if (normalized.startsWith('..')) return res.status(403).json({ error: 'forbidden' });
    const fullPath = path.join(pdfDir, normalized);
    if (!fullPath.startsWith(pdfDir)) return res.status(403).json({ error: 'forbidden' });
    res.sendFile(fullPath);
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

const FS_ROOTS = ['/Users/homer', '/Volumes']
const VIRTUAL_ROOT = '__roots__'

app.get('/api/admin/fs/browse', adminAuth, (req, res) => {
  try {
    const reqPath = req.query.path

    if (!reqPath || reqPath === VIRTUAL_ROOT) {
      return res.json({
        path: VIRTUAL_ROOT,
        parent: null,
        dirs: [
          { name: '📁 个人目录 (Users/homer)', fullPath: '/Users/homer' },
          { name: '💾 网络共享盘 (Volumes)',     fullPath: '/Volumes' },
        ],
      })
    }

    const target = path.normalize(reqPath)
    const allowed = FS_ROOTS.some(root => target === root || target.startsWith(root + '/'))
    if (!allowed) return res.status(403).json({ error: '超出允许范围' })

    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
      return res.status(404).json({ error: '目录不存在' })
    }

    const dirs = fs.readdirSync(target, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, fullPath: path.join(target, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const parent = FS_ROOTS.includes(target) ? VIRTUAL_ROOT : path.dirname(target)
    res.json({ path: target, parent, dirs })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/admin/config', adminAuth, (req, res) => {
  try {
    const { pdf_dir } = req.body;
    if (!pdf_dir) return res.status(400).json({ error: 'pdf_dir required' });
    const inAllowedRoot = FS_ROOTS.some(root => pdf_dir === root || pdf_dir.startsWith(root + '/'))
    if (!inAllowedRoot) return res.status(400).json({ error: 'PDF 目录必须在 /Users/homer 或 /Volumes 下' });
    if (!fs.existsSync(pdf_dir) || !fs.statSync(pdf_dir).isDirectory()) {
      return res.status(400).json({ error: '路径不存在或不是目录' });
    }
    const found = probePdfCount(pdf_dir, Date.now() + 3000, 1)
    if (found === 0) return res.status(400).json({ error: '目录下未找到 PDF 文件（或扫描超时），请选择正确的 PDF 目录' })
    db.prepare("UPDATE config SET value = ? WHERE key = 'pdf_dir'").run(pdf_dir);
    _pdfCacheByDir.clear()
    res.json({ ok: true, pdf_dir });
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
    const { pdf_filename, reached_last, page_number, is_dual, client_timestamp } = req.body;
    if (!pdf_filename) return res.status(400).json({ error: 'pdf_filename required' });
    const eventTimestamp = client_timestamp || new Date().toISOString();
    const existing = db.prepare(
      'SELECT 1 FROM pdf_reads WHERE session_id = ? AND pdf_filename = ?'
    ).get(sessionId, pdf_filename);
    if (existing) {
      db.prepare(
        'UPDATE pdf_reads SET last_page_turn_at = ?, pages_turned = pages_turned + 1 WHERE session_id = ? AND pdf_filename = ?'
      ).run(eventTimestamp, sessionId, pdf_filename);
    } else {
      db.prepare(
        'INSERT INTO pdf_reads (session_id, pdf_filename, opened_at, last_page_turn_at, pages_turned) VALUES (?, ?, ?, ?, 1)'
      ).run(sessionId, pdf_filename, eventTimestamp, eventTimestamp);
    }
    if (reached_last === true) {
      db.prepare(
        'UPDATE pdf_reads SET completed = 1 WHERE session_id = ? AND pdf_filename = ?'
      ).run(sessionId, pdf_filename);
    }
    if (typeof page_number === 'number') {
      db.prepare(
        'INSERT INTO pdf_page_events (session_id, pdf_filename, page_number, timestamp, is_dual) VALUES (?, ?, ?, ?, ?)'
      ).run(sessionId, pdf_filename, page_number, eventTimestamp, is_dual ? 1 : 0);
    }
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
    if (session.session_type === 'recitation' && session.plan_id) {
      const plan = db.prepare('SELECT pdf_filename FROM recitation_plans WHERE id = ?').get(session.plan_id)
      recitation_pdf = plan?.pdf_filename ?? null
    }
    res.json({ ...session, pdf_reads: pdfReads, page_events: pageEvents, recitation_pdf })
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
          const child = db.prepare('SELECT cursor_pdf, pdf_dir FROM children WHERE id = ?').get(session.child_id)
          if (child && child.cursor_pdf === plan.pdf_filename) {
            const dir = child.pdf_dir || getPdfDir()
            const allPdfs = findPdfsFlatFor(dir)
            const idx = allPdfs.findIndex(p => p.relativePath === plan.pdf_filename)
            if (idx >= 0 && idx + 1 < allPdfs.length) {
              db.prepare('UPDATE children SET cursor_pdf = ? WHERE id = ?')
                .run(allPdfs[idx + 1].relativePath, session.child_id)
              _pdfCacheByDir.clear()
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
    const { child_id, cursor_pdf, daily_count, min_duration_s, pdf_dir } = req.body
    if (!child_id) return res.status(400).json({ error: 'child_id required' })
    if (cursor_pdf === undefined && daily_count === undefined && min_duration_s === undefined && pdf_dir === undefined) {
      return res.status(400).json({ error: 'at least one field required' })
    }
    const cursorVal = cursor_pdf !== undefined ? cursor_pdf : null
    const countVal = daily_count !== undefined ? parseInt(daily_count) : null
    if (countVal !== null && (isNaN(countVal) || countVal < 1 || countVal > 10)) {
      return res.status(400).json({ error: 'daily_count must be 1-10' })
    }
    db.prepare(`
      UPDATE children SET
        cursor_pdf  = CASE WHEN ? IS NOT NULL THEN ? ELSE cursor_pdf END,
        daily_count = CASE WHEN ? IS NOT NULL THEN ? ELSE daily_count END
      WHERE id = ?
    `).run(cursorVal, cursorVal, countVal, countVal, child_id)
    if (min_duration_s !== undefined) {
      const durVal = min_duration_s === null ? null : parseInt(min_duration_s)
      if (durVal !== null && (isNaN(durVal) || durVal < 60 || durVal > 3600)) {
        return res.status(400).json({ error: 'min_duration_s must be 60-3600 or null' })
      }
      db.prepare('UPDATE children SET min_duration_s = ? WHERE id = ?').run(durVal, child_id)
    }
    if (pdf_dir !== undefined) {
      const trimmed = (pdf_dir ?? '').trim()
      if (trimmed && !FS_ROOTS.some(r => trimmed.startsWith(r))) {
        return res.status(403).json({ error: 'pdf_dir outside allowed roots' })
      }
      db.prepare('UPDATE children SET pdf_dir = ? WHERE id = ?').run(trimmed || null, child_id)
    }
    _pdfCacheByDir.clear()
    const child = db.prepare('SELECT * FROM children WHERE id = ?').get(child_id)
    res.json(child)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/admin/pool/preview/:childId', adminAuth, (req, res) => {
  try {
    const pool = getTodayPool(req.params.childId).map(p => ({
      relativePath: p.relativePath,
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

// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Morning Reader backend running`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${require('os').hostname()}:${PORT}`);
});
