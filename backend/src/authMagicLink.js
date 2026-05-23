// Sprint 1A: 邮箱魔法链接核心逻辑（不接邮件 SaaS，邮件先 console.log）
const crypto = require('crypto')

const TOKEN_BYTES = 32
const LINK_TTL_MS = 15 * 60 * 1000              // 魔法链接 15 分钟有效
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // auth_session 30 天

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url')
}

function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

// 发起：生成 magic_links 记录 + 输出 link（暂时 console.log，Sprint 1A-2 接 Resend）
function requestMagicLink(db, email, baseUrl) {
  const cleanEmail = String(email).trim().toLowerCase()
  if (!isValidEmail(cleanEmail)) throw new Error('invalid email')
  const token = generateToken()
  const expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString()
  db.prepare('INSERT INTO magic_links (token, email, expires_at, used) VALUES (?, ?, ?, 0)').run(token, cleanEmail, expiresAt)
  const link = `${baseUrl}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`
  // Sprint 1A-2 之前：用 console.log；之后接 Resend
  console.log(`[Sprint 1A magic-link] email=${cleanEmail} link=${link} (expires in 15min)`)
  return { ok: true }
}

// 验证：消费 magic_link → 创建/找 account → 发 auth_session
function verifyMagicLink(db, token, ip) {
  const now = new Date().toISOString()
  const link = db.prepare(
    'SELECT token, email, expires_at, used FROM magic_links WHERE token = ?'
  ).get(token)
  if (!link) throw new Error('invalid token')
  if (link.used) throw new Error('token already used')
  if (link.expires_at < now) throw new Error('token expired')
  // 标记使用
  db.prepare('UPDATE magic_links SET used = 1 WHERE token = ?').run(token)
  // 找/创建 account
  let account = db.prepare('SELECT id, email, is_superadmin FROM accounts WHERE email = ?').get(link.email)
  if (!account) {
    const result = db.prepare(
      "INSERT INTO accounts (email, is_anonymous, is_superadmin) VALUES (?, 0, 0)"
    ).run(link.email)
    account = { id: result.lastInsertRowid, email: link.email, is_superadmin: 0 }
    console.log(`[Sprint 1A] Created new account_id=${account.id} email=${link.email}`)
  }
  // 发 auth_session token
  const sessionToken = generateToken()
  const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  db.prepare(
    'INSERT INTO auth_sessions (token, account_id, expires_at, created_ip) VALUES (?, ?, ?, ?)'
  ).run(sessionToken, account.id, sessionExpiresAt, ip || null)
  return { account, sessionToken, sessionExpiresAt }
}

// 当前 session（从 cookie 解析）
function getCurrentSession(db, authToken) {
  if (!authToken) return null
  const now = new Date().toISOString()
  const row = db.prepare(`
    SELECT s.account_id, s.expires_at, a.email, a.is_superadmin, a.is_anonymous
    FROM auth_sessions s
    JOIN accounts a ON a.id = s.account_id
    WHERE s.token = ? AND s.expires_at > ?
  `).get(authToken, now)
  return row || null
}

// 登出
function deleteSession(db, authToken) {
  if (!authToken) return
  db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(authToken)
}

module.exports = { requestMagicLink, verifyMagicLink, getCurrentSession, deleteSession }
