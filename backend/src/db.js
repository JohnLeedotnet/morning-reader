const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/morning-reader.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL')
db.pragma('busy_timeout = 5000')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS children (
    id TEXT PRIMARY KEY,
    name TEXT,
    age INT
  );

  CREATE TABLE IF NOT EXISTS reading_pool (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id TEXT,
    pdf_filename TEXT,
    sort_order INT,
    added_at TEXT
  );

  CREATE TABLE IF NOT EXISTS reading_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id TEXT,
    date TEXT,
    start_time TEXT,
    end_time TEXT,
    recording_path TEXT,
    total_duration_s INT,
    silence_count INT,
    max_silence_s INT,
    total_silence_s INT,
    pdfs_opened INT,
    pdfs_required INT,
    time_in_window INT,
    status TEXT
  );

  CREATE TABLE IF NOT EXISTS pdf_reads (
    session_id INT,
    pdf_filename TEXT,
    opened_at TEXT,
    last_page_turn_at TEXT,
    pages_turned INT
  );

  CREATE TABLE IF NOT EXISTS recitation_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id TEXT,
    pdf_filename TEXT,
    scheduled_date TEXT,
    status TEXT
  );

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

const insertChild = db.prepare('INSERT OR IGNORE INTO children (id, name, age) VALUES (?, ?, ?)');
insertChild.run('mike', 'Mike', 11);
insertChild.run('peyton', 'Peyton', 6);

// Migrations (idempotent)
try { db.exec('ALTER TABLE children ADD COLUMN font_scale REAL DEFAULT 1.0'); } catch (e) { /* exists */ }
try { db.exec('ALTER TABLE children ADD COLUMN cursor_pdf TEXT DEFAULT NULL'); } catch (e) { /* exists */ }
try { db.exec('ALTER TABLE children ADD COLUMN daily_count INTEGER DEFAULT 3'); } catch (e) { /* exists */ }
try { db.exec("ALTER TABLE reading_sessions ADD COLUMN session_type TEXT DEFAULT 'reading'"); } catch (e) { /* exists */ }
try { db.exec('ALTER TABLE reading_sessions ADD COLUMN plan_id INTEGER'); } catch (e) { /* exists */ }
try { db.exec('ALTER TABLE children ADD COLUMN min_duration_s INTEGER DEFAULT NULL'); } catch (e) { /* exists */ }
try { db.exec('ALTER TABLE pdf_reads ADD COLUMN completed INTEGER DEFAULT 0'); } catch (e) { /* exists */ }
try { db.exec('ALTER TABLE pdf_page_events ADD COLUMN is_dual INTEGER DEFAULT 0'); } catch(_) {}
try { db.exec('ALTER TABLE children ADD COLUMN pdf_dir TEXT'); } catch(_) {}
try { db.exec("ALTER TABLE reading_sessions ADD COLUMN recording_start_time TEXT"); } catch(_) {}
db.exec(`
  CREATE TABLE IF NOT EXISTS pdf_page_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    pdf_filename TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    timestamp TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pdf_page_events_session ON pdf_page_events(session_id);
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS pdf_annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    pdf_library_id INTEGER NOT NULL,
    page_number INTEGER NOT NULL,
    message TEXT NOT NULL,
    drawing_svg TEXT DEFAULT NULL,
    created_by_session INTEGER DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_annotations_lib_page
    ON pdf_annotations(account_id, pdf_library_id, page_number);
`);
try { db.exec("ALTER TABLE pdf_annotations ADD COLUMN pos_x REAL DEFAULT NULL"); } catch(_) {}
try { db.exec("ALTER TABLE pdf_annotations ADD COLUMN pos_y REAL DEFAULT NULL"); } catch(_) {}
try { db.exec("ALTER TABLE pdf_annotations ADD COLUMN color TEXT DEFAULT '#E07A5F'"); } catch(_) {}
try { db.exec("ALTER TABLE pdf_annotations ADD COLUMN kind TEXT DEFAULT 'text'"); } catch(_) {}
try { db.exec("ALTER TABLE pdf_annotations ADD COLUMN font_scale REAL DEFAULT 1.0"); } catch(_) {}

db.prepare("UPDATE children SET font_scale = 1.0  WHERE id = 'mike'").run();
db.prepare("UPDATE children SET font_scale = 1.25 WHERE id = 'peyton'").run();

const insertConfig = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
for (const [key, value] of [
  ['window_start', '07:00'],
  ['window_end', '08:00'],
  ['min_duration_s', '300'],
  ['max_consecutive_silence_s', '15'],
  ['max_silence_ratio', '0.2'],
  ['parent_pin', ''],
  ['pdf_dir', '/Users/homer/Documents/牛津树1-9级 PDF'],
]) {
  insertConfig.run(key, value);
}

db.prepare("UPDATE children SET pdf_dir = (SELECT value FROM config WHERE key='pdf_dir') WHERE pdf_dir IS NULL").run()

// ── Sprint 0A: 多租户底座 + 公共图书馆 ──────────────

// 账户表（家庭单元）
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      email             TEXT UNIQUE,
      parent_pin_hash   TEXT,
      is_anonymous      INTEGER DEFAULT 0,
      is_superadmin     INTEGER DEFAULT 0,
      storage_used_mb   INTEGER DEFAULT 0,
      storage_quota_mb  INTEGER DEFAULT 200,
      created_at        TEXT DEFAULT (datetime('now')),
      last_active_at    TEXT DEFAULT (datetime('now'))
    )
  `)
} catch (e) { console.error('create accounts:', e.message) }

// 公共 PDF 图书馆
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pdf_library (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      sha256                TEXT UNIQUE NOT NULL,
      filename              TEXT NOT NULL,
      title                 TEXT,
      size_bytes            INTEGER,
      uploader_account_id   INTEGER REFERENCES accounts(id),
      is_private            INTEGER DEFAULT 0,
      is_builtin            INTEGER DEFAULT 0,
      read_count            INTEGER DEFAULT 0,
      created_at            TEXT DEFAULT (datetime('now'))
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pdf_library_public ON pdf_library(is_private, created_at DESC)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pdf_library_uploader ON pdf_library(uploader_account_id)`)
} catch (e) { console.error('create pdf_library:', e.message) }

// 登录会话
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token       TEXT PRIMARY KEY,
      account_id  INTEGER NOT NULL REFERENCES accounts(id),
      expires_at  TEXT NOT NULL,
      created_at  TEXT DEFAULT (datetime('now')),
      created_ip  TEXT
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_sessions_account ON auth_sessions(account_id)`)
} catch (e) { console.error('create auth_sessions:', e.message) }

// 家长解锁会话
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS parent_sessions (
      token       TEXT PRIMARY KEY,
      account_id  INTEGER NOT NULL REFERENCES accounts(id),
      expires_at  TEXT NOT NULL,
      created_at  TEXT DEFAULT (datetime('now'))
    )
  `)
} catch (e) { console.error('create parent_sessions:', e.message) }

// 邮箱魔法链接
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS magic_links (
      token       TEXT PRIMARY KEY,
      email       TEXT NOT NULL,
      expires_at  TEXT NOT NULL,
      used        INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now'))
    )
  `)
} catch (e) { console.error('create magic_links:', e.message) }

// 匿名 token 追踪
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS anonymous_tokens (
      token       TEXT PRIMARY KEY,
      first_seen  TEXT DEFAULT (datetime('now')),
      last_seen   TEXT DEFAULT (datetime('now'))
    )
  `)
} catch (e) { console.error('create anonymous_tokens:', e.message) }

// 既有表加 account_id（保留旧字段不删）
try { db.exec('ALTER TABLE children ADD COLUMN account_id INTEGER REFERENCES accounts(id)') } catch (e) {}
try { db.exec('ALTER TABLE children ADD COLUMN cursor_library_id INTEGER REFERENCES pdf_library(id)') } catch (e) {}
try { db.exec('ALTER TABLE reading_sessions ADD COLUMN account_id INTEGER REFERENCES accounts(id)') } catch (e) {}
try { db.exec('ALTER TABLE reading_sessions ADD COLUMN created_by_token TEXT') } catch (e) {}
try { db.exec('ALTER TABLE recitation_plans ADD COLUMN account_id INTEGER REFERENCES accounts(id)') } catch (e) {}
try { db.exec('ALTER TABLE pdf_reads ADD COLUMN account_id INTEGER REFERENCES accounts(id)') } catch (e) {}
try { db.exec('ALTER TABLE pdf_reads ADD COLUMN pdf_library_id INTEGER REFERENCES pdf_library(id)') } catch (e) {}

// 索引（加速 account 范围查询）
try { db.exec('CREATE INDEX IF NOT EXISTS idx_children_account ON children(account_id)') } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_account_date ON reading_sessions(account_id, date)') } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_created_by ON reading_sessions(created_by_token)') } catch (e) {}

// 初始数据：Homer 自家 account_id=1（is_superadmin），并 backfill 所有 children/sessions 到此 account
try {
  const existing = db.prepare("SELECT id FROM accounts WHERE id=1").get()
  if (!existing) {
    db.prepare(`
      INSERT INTO accounts (id, email, is_superadmin, storage_quota_mb)
      VALUES (1, NULL, 1, 100000)
    `).run()
    db.exec('UPDATE children SET account_id=1 WHERE account_id IS NULL')
    db.exec('UPDATE reading_sessions SET account_id=1 WHERE account_id IS NULL')
    db.exec('UPDATE recitation_plans SET account_id=1 WHERE account_id IS NULL')
    db.exec('UPDATE pdf_reads SET account_id=1 WHERE account_id IS NULL')
    console.log('[Sprint 0A] Created Homer family account id=1 and backfilled existing data')
  }
} catch (e) { console.error('seed homer account:', e.message) }

// 匿名 account（独立 id，记到 config 表）
try {
  const cfg = db.prepare("SELECT value FROM config WHERE key='anonymous_account_id'").get()
  if (!cfg) {
    const result = db.prepare(`
      INSERT INTO accounts (email, is_anonymous, storage_quota_mb)
      VALUES (NULL, 1, 0)
    `).run()
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('anonymous_account_id', ?)")
      .run(String(result.lastInsertRowid))
    console.log('[Sprint 0A] Created anonymous account id=' + result.lastInsertRowid)
  }
} catch (e) { console.error('seed anonymous account:', e.message) }

// Sprint 1A: accounts.email 唯一索引（幂等）
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email) WHERE email IS NOT NULL') } catch (e) {}

// Sprint 1A: Homer 自家 account_id=1 设 email（如已设则不变）
try {
  const row = db.prepare('SELECT email FROM accounts WHERE id = 1').get()
  if (row && !row.email) {
    db.prepare("UPDATE accounts SET email = 'lijhm@protonmail.com' WHERE id = 1").run()
    console.log('[Sprint 1A] Set Homer account_id=1 email')
  }
} catch (e) { console.error('Sprint 1A email seed:', e.message) }

// Sprint UI-6b: 恢复 PDF 分类层级
try { db.exec('ALTER TABLE pdf_library ADD COLUMN category_path TEXT') } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_pdf_library_category ON pdf_library(category_path)') } catch (e) {}

// Sprint 1A-4: 用户名 + 密码
try { db.exec('ALTER TABLE accounts ADD COLUMN username TEXT') } catch (e) {}
try { db.exec('ALTER TABLE accounts ADD COLUMN password_hash TEXT') } catch (e) {}
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username) WHERE username IS NOT NULL') } catch (e) {}

// Sprint 1A-4: magic_links 加 6 位验证码字段
try { db.exec('ALTER TABLE magic_links ADD COLUMN code TEXT') } catch (e) {}

// Sprint 1C: 时间窗口改 per account（之前在全局 config 表）
try { db.exec("ALTER TABLE accounts ADD COLUMN window_start TEXT DEFAULT '07:00'") } catch (e) {}
try { db.exec("ALTER TABLE accounts ADD COLUMN window_end TEXT DEFAULT '08:00'") } catch (e) {}

// 迁移：把 config.window_start/end 迁到 Homer 自家 account_id=1
try {
  const acct = db.prepare("SELECT window_start, window_end FROM accounts WHERE id = 1").get()
  if (acct && (!acct.window_start || !acct.window_end)) {
    const ws = db.prepare("SELECT value FROM config WHERE key = 'window_start'").get()?.value || '07:00'
    const we = db.prepare("SELECT value FROM config WHERE key = 'window_end'").get()?.value || '08:00'
    db.prepare("UPDATE accounts SET window_start = ?, window_end = ? WHERE id = 1").run(ws, we)
    console.log(`[Sprint 1C] Migrated time window account_id=1 → ${ws}-${we}`)
  }
} catch (e) { console.error('window migration:', e.message) }

// Sprint 1B: 迁移老 PIN 从 config 表（明文）到 accounts.parent_pin_hash（PBKDF2）
try {
  const cfg = db.prepare("SELECT value FROM config WHERE key = 'parent_pin'").get()
  if (cfg && cfg.value && cfg.value.length > 0) {
    const acct = db.prepare('SELECT id, parent_pin_hash FROM accounts WHERE id = 1').get()
    if (acct && !acct.parent_pin_hash) {
      const crypto = require('crypto')
      const salt = crypto.randomBytes(32)
      const hash = crypto.pbkdf2Sync(cfg.value, salt, 100_000, 32, 'sha256')
      const stored = `${salt.toString('hex')}:${hash.toString('hex')}`
      db.prepare('UPDATE accounts SET parent_pin_hash = ? WHERE id = 1').run(stored)
      db.prepare("UPDATE config SET value = '' WHERE key = 'parent_pin'").run()
      console.log('[Sprint 1B] Migrated PIN from config(plain) to accounts.parent_pin_hash(PBKDF2) for account_id=1')
    }
  }
} catch (e) { console.error('PIN migration:', e.message) }

module.exports = db;
