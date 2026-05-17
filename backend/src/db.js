const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/morning-reader.db');
const db = new Database(DB_PATH);

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

module.exports = db;
