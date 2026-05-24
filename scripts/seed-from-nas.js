// Sprint 0A — 把 Homer 自家 NAS / 旧 pdf_dir 上的所有 PDF
// 迁入新的 data/pdfs/<hash>/ 公共图书馆存储，并 backfill children.cursor_library_id
//
// 安全：基于 sha256 去重，多次运行幂等；仅"拷贝"NAS 原文件不删除
// 用法：node scripts/seed-from-nas.js [--dry-run]

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const Database = require('better-sqlite3')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const DB_PATH = path.join(PROJECT_ROOT, 'data', 'morning-reader.db')
const PDFS_DIR = path.join(PROJECT_ROOT, 'data', 'pdfs')
const DRY_RUN = process.argv.includes('--dry-run')

const SKIP_DIRS = new Set([
  '.Trashes', '.Spotlight-V100', '.DocumentRevisions-V100',
  '.fseventsd', '.TemporaryItems', '.HFS+ Private Directory Data',
  'node_modules', '.git'
])

if (!fs.existsSync(DB_PATH)) {
  console.error('❌ DB not found at', DB_PATH); process.exit(1)
}
const db = new Database(DB_PATH)
db.pragma('foreign_keys = ON')

if (!DRY_RUN) fs.mkdirSync(PDFS_DIR, { recursive: true })

// 收集所有需要扫描的根目录（去重）
function collectRootDirs() {
  const dirs = new Set()
  const globalDir = db.prepare("SELECT value FROM config WHERE key='pdf_dir'").get()?.value
  if (globalDir && fs.existsSync(globalDir)) dirs.add(globalDir)
  const childRows = db.prepare("SELECT DISTINCT pdf_dir FROM children WHERE pdf_dir IS NOT NULL AND pdf_dir != ''").all()
  for (const r of childRows) if (fs.existsSync(r.pdf_dir)) dirs.add(r.pdf_dir)
  return Array.from(dirs)
}

// 递归收集目录下所有 PDF 绝对路径
function walkPdfs(rootDir) {
  const out = []
  function walk(dir) {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.toLowerCase().endsWith('.pdf')) out.push(full)
    }
  }
  walk(rootDir)
  return out
}

function sha256OfFile(filePath) {
  const buf = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(buf).digest('hex')
}

const stats = { scanned: 0, alreadyInLibrary: 0, copied: 0, errors: 0, cursorsMigrated: 0, pdfReadsMigrated: 0 }

console.log(`[seed-from-nas] DRY_RUN=${DRY_RUN}`)
const rootDirs = collectRootDirs()
console.log(`[seed-from-nas] 扫描 ${rootDirs.length} 个根目录:`, rootDirs)

// Phase 1: 扫描 + 拷贝 + 插入 pdf_library
const fileHashCache = new Map()  // absPath → sha256，给后面 cursor migration 用

for (const root of rootDirs) {
  const rootName = path.basename(root)
  const pdfs = walkPdfs(root)
  console.log(`  ${root} → ${pdfs.length} 个 PDF`)
  for (const absPath of pdfs) {
    stats.scanned++
    try {
      const sha = sha256OfFile(absPath)
      fileHashCache.set(absPath, sha)

      // 计算 category_path
      const relDir = path.relative(root, path.dirname(absPath))
      const categoryPath = (relDir && relDir !== '.') ? `${rootName}/${relDir}` : rootName

      const existing = db.prepare('SELECT id, category_path FROM pdf_library WHERE sha256=?').get(sha)
      if (existing) {
        if (!existing.category_path && !DRY_RUN) {
          db.prepare('UPDATE pdf_library SET category_path = ? WHERE id = ?').run(categoryPath, existing.id)
        }
        stats.alreadyInLibrary++
        continue
      }

      const stat = fs.statSync(absPath)
      const filename = path.basename(absPath)
      const subDir = path.join(PDFS_DIR, sha.slice(0, 2))
      const destPath = path.join(subDir, sha + '.pdf')
      if (!DRY_RUN) {
        fs.mkdirSync(subDir, { recursive: true })
        if (!fs.existsSync(destPath)) fs.copyFileSync(absPath, destPath)
        db.prepare(`
          INSERT INTO pdf_library (sha256, filename, title, size_bytes, uploader_account_id, is_private, is_builtin, category_path)
          VALUES (?, ?, ?, ?, 1, 1, 0, ?)
        `).run(sha, filename, filename.replace(/\.pdf$/i, ''), stat.size, categoryPath)
      }
      stats.copied++
    } catch (e) {
      console.error(`  ❌ ${absPath}: ${e.message}`)
      stats.errors++
    }
  }
}

// Phase 2: 把 children.cursor_pdf 映射到 cursor_library_id
const children = db.prepare("SELECT id, pdf_dir, cursor_pdf FROM children WHERE cursor_pdf IS NOT NULL AND cursor_pdf != ''").all()
for (const c of children) {
  const pdfDir = c.pdf_dir || (db.prepare("SELECT value FROM config WHERE key='pdf_dir'").get()?.value)
  if (!pdfDir) continue
  const absPath = path.join(pdfDir, c.cursor_pdf)
  if (!fs.existsSync(absPath)) {
    console.warn(`  child ${c.id} cursor_pdf 文件不存在: ${absPath}（保留旧字段，cursor_library_id 留空）`)
    continue
  }
  const sha = fileHashCache.get(absPath) || sha256OfFile(absPath)
  const lib = db.prepare('SELECT id FROM pdf_library WHERE sha256=?').get(sha)
  if (lib && !DRY_RUN) {
    db.prepare('UPDATE children SET cursor_library_id=? WHERE id=?').run(lib.id, c.id)
    stats.cursorsMigrated++
  }
}

// Phase 3: 把 pdf_reads.pdf_filename 映射到 pdf_library_id（pdf_reads 无 id 列，用 rowid）
const reads = db.prepare("SELECT pr.rowid, pr.pdf_filename, c.pdf_dir FROM pdf_reads pr JOIN reading_sessions rs ON rs.id=pr.session_id JOIN children c ON c.id=rs.child_id WHERE pr.pdf_library_id IS NULL").all()
for (const r of reads) {
  const pdfDir = r.pdf_dir || (db.prepare("SELECT value FROM config WHERE key='pdf_dir'").get()?.value)
  if (!pdfDir) continue
  const absPath = path.join(pdfDir, r.pdf_filename)
  if (!fs.existsSync(absPath)) continue
  const sha = fileHashCache.get(absPath) || sha256OfFile(absPath)
  const lib = db.prepare('SELECT id FROM pdf_library WHERE sha256=?').get(sha)
  if (lib && !DRY_RUN) {
    db.prepare('UPDATE pdf_reads SET pdf_library_id=? WHERE rowid=?').run(lib.id, r.rowid)
    stats.pdfReadsMigrated++
  }
}

console.log(`\n[seed-from-nas] 完成`)
console.log(`  扫描 PDF: ${stats.scanned}`)
console.log(`  已在库（跳过）: ${stats.alreadyInLibrary}`)
console.log(`  本次新拷贝: ${stats.copied}`)
console.log(`  错误: ${stats.errors}`)
console.log(`  cursor 迁移: ${stats.cursorsMigrated}/${children.length}`)
console.log(`  pdf_reads 迁移: ${stats.pdfReadsMigrated}/${reads.length}`)
console.log(`  pdf_library 总数: ${db.prepare('SELECT COUNT(*) c FROM pdf_library').get().c}`)
console.log(`  category_path 覆盖率: ${db.prepare('SELECT COUNT(*) c FROM pdf_library WHERE category_path IS NOT NULL').get().c} / ${db.prepare('SELECT COUNT(*) c FROM pdf_library').get().c}`)
console.log(`  data/pdfs/ 体积: 见 du -sh data/pdfs`)

db.close()
