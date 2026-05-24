// Sprint 1A-4: 6 位验证码登录 + 用户名/密码注册
const crypto = require('crypto')

const TOKEN_BYTES = 32
const LINK_TTL_MS = 15 * 60 * 1000              // 验证码 15 分钟有效
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // auth_session 30 天

const PBKDF2_ITERATIONS = 100_000
const PBKDF2_KEY_LEN = 32

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url')
}

function generateCode() {
  // 6 位数字验证码（100000-999999）
  return String(Math.floor(100000 + crypto.randomBytes(4).readUInt32BE(0) % 900000))
}

function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

function isValidUsername(s) {
  return typeof s === 'string' && /^[a-zA-Z0-9_-]{3,32}$/.test(s)
}

function hashPassword(plain) {
  const salt = crypto.randomBytes(32)
  const hash = crypto.pbkdf2Sync(plain, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LEN, 'sha256')
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

function verifyPassword(plain, stored) {
  if (!stored) return false
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const actual = crypto.pbkdf2Sync(plain, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LEN, 'sha256')
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
}

// Resend 客户端懒加载
let _resendClient = null
function getResendClient() {
  if (_resendClient) return _resendClient
  if (!process.env.RESEND_API_KEY) return null
  try {
    const { Resend } = require('resend')
    _resendClient = new Resend(process.env.RESEND_API_KEY)
    return _resendClient
  } catch (e) {
    console.warn('[resend] init failed:', e.message)
    return null
  }
}

async function sendLoginCodeEmail(email, code) {
  const resend = getResendClient()
  if (!resend) {
    console.log(`[login-code console fallback] email=${email} code=${code}`)
    return { sent: false, fallback: true }
  }
  const from = process.env.EMAIL_FROM || 'Morning Reader <noreply@morningreader.org>'
  const subject = `Morning Reader 登录验证码：${code}`
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #FFF5EB; color: #3D2B1F;">
      <h2 style="color: #E07A5F; margin-bottom: 8px;">Morning Reader</h2>
      <p>你好！这是你的登录验证码：</p>
      <p style="text-align: center; margin: 32px 0;">
        <span style="display: inline-block; background: #fff; border: 2px solid #E07A5F; border-radius: 12px; padding: 16px 32px; font-size: 36px; font-weight: 900; letter-spacing: 12px; color: #C05030; font-family: monospace;">${code}</span>
      </p>
      <p style="font-size: 13px; color: #7A5C4A;">在登录页面输入这 6 位数字即可登录。验证码 15 分钟内有效，只能使用一次。</p>
      <hr style="border: none; border-top: 1px solid #E8D8B0; margin: 24px 0;" />
      <p style="font-size: 11px; color: #9A8060;">如果你没有请求此邮件，可以忽略。</p>
    </div>
  `
  try {
    const result = await resend.emails.send({ from, to: email, subject, html })
    console.log(`[login-code sent via Resend] email=${email} id=${result?.data?.id || 'unknown'}`)
    return { sent: true, id: result?.data?.id }
  } catch (err) {
    console.error(`[resend] send code failed to ${email}:`, err.message)
    console.log(`[login-code console fallback after error] email=${email} code=${code}`)
    return { sent: false, error: err.message }
  }
}

// 发 6 位验证码到邮箱（未注册 email 静默返回成功防 enumeration）
async function requestLoginCode(db, email) {
  const cleanEmail = String(email).trim().toLowerCase()
  if (!isValidEmail(cleanEmail)) throw new Error('invalid email')
  const account = db.prepare('SELECT id FROM accounts WHERE email = ?').get(cleanEmail)
  if (!account) {
    console.log(`[login-code] email not registered: ${cleanEmail}（silently treated as success）`)
    return { ok: true }
  }
  const token = generateToken()
  const code = generateCode()
  const expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString()
  db.prepare('INSERT INTO magic_links (token, email, code, expires_at, used) VALUES (?, ?, ?, ?, 0)').run(token, cleanEmail, code, expiresAt)
  await sendLoginCodeEmail(cleanEmail, code)
  return { ok: true }
}

// 验证 6 位码 → 创建 session
function verifyLoginCode(db, email, code, ip) {
  const cleanEmail = String(email).trim().toLowerCase()
  const now = new Date().toISOString()
  const link = db.prepare(
    'SELECT token, email, code, expires_at, used FROM magic_links WHERE email = ? AND code = ?'
  ).get(cleanEmail, String(code).trim())
  if (!link) throw new Error('invalid code')
  if (link.used) throw new Error('code already used')
  if (link.expires_at < now) throw new Error('code expired')
  db.prepare('UPDATE magic_links SET used = 1 WHERE token = ?').run(link.token)
  const account = db.prepare('SELECT id, email, is_superadmin FROM accounts WHERE email = ?').get(link.email)
  if (!account) throw new Error('account not found')
  const sessionToken = generateToken()
  const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  db.prepare(
    'INSERT INTO auth_sessions (token, account_id, expires_at, created_ip) VALUES (?, ?, ?, ?)'
  ).run(sessionToken, account.id, sessionExpiresAt, ip || null)
  return { account, sessionToken, sessionExpiresAt }
}

// 一步注册（邮箱 + 用户名 + 密码）→ 直接发 session
function register(db, email, username, password, ip) {
  const cleanEmail = String(email).trim().toLowerCase()
  if (!isValidEmail(cleanEmail)) throw new Error('invalid email')
  if (!isValidUsername(username)) throw new Error('invalid username (3-32 chars: a-z, A-Z, 0-9, _, -)')
  if (typeof password !== 'string' || password.length < 8) throw new Error('password too short (min 8 chars)')

  if (db.prepare('SELECT 1 FROM accounts WHERE email = ?').get(cleanEmail)) {
    throw new Error('email already registered')
  }
  if (db.prepare('SELECT 1 FROM accounts WHERE username = ?').get(username)) {
    throw new Error('username already taken')
  }

  const passwordHash = hashPassword(password)
  const result = db.prepare(
    'INSERT INTO accounts (email, username, password_hash, is_anonymous, is_superadmin) VALUES (?, ?, ?, 0, 0)'
  ).run(cleanEmail, username, passwordHash)
  const account = { id: result.lastInsertRowid, email: cleanEmail, is_superadmin: 0 }
  console.log(`[register] new account id=${account.id} email=${cleanEmail} username=${username}`)

  const sessionToken = generateToken()
  const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  db.prepare(
    'INSERT INTO auth_sessions (token, account_id, expires_at, created_ip) VALUES (?, ?, ?, ?)'
  ).run(sessionToken, account.id, sessionExpiresAt, ip || null)
  return { account, sessionToken, sessionExpiresAt }
}

// 用户名（或邮箱）+ 密码登录
function loginWithPassword(db, usernameOrEmail, password, ip) {
  const input = String(usernameOrEmail).trim()
  const account = db.prepare(`
    SELECT id, email, username, password_hash, is_superadmin
    FROM accounts
    WHERE (username = ? OR email = ?) AND password_hash IS NOT NULL
  `).get(input, input.toLowerCase())
  if (!account) throw new Error('invalid username or password')
  if (!verifyPassword(password, account.password_hash)) {
    throw new Error('invalid username or password')
  }
  const sessionToken = generateToken()
  const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  db.prepare(
    'INSERT INTO auth_sessions (token, account_id, expires_at, created_ip) VALUES (?, ?, ?, ?)'
  ).run(sessionToken, account.id, sessionExpiresAt, ip || null)
  return { account: { id: account.id, email: account.email, is_superadmin: account.is_superadmin }, sessionToken, sessionExpiresAt }
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

// Sprint 1A-5: 忘记密码 — 用验证码重置密码
function resetPasswordWithCode(db, email, code, newPassword) {
  if (typeof newPassword !== 'string' || newPassword.length < 8) throw new Error('password too short (min 8 chars)')
  const cleanEmail = String(email).trim().toLowerCase()
  const now = new Date().toISOString()
  const link = db.prepare(
    'SELECT token, expires_at, used FROM magic_links WHERE email = ? AND code = ?'
  ).get(cleanEmail, String(code).trim())
  if (!link) throw new Error('invalid code')
  if (link.used) throw new Error('code already used')
  if (link.expires_at < now) throw new Error('code expired')
  db.prepare('UPDATE magic_links SET used = 1 WHERE token = ?').run(link.token)
  const passwordHash = hashPassword(newPassword)
  const result = db.prepare('UPDATE accounts SET password_hash = ? WHERE email = ?').run(passwordHash, cleanEmail)
  if (result.changes === 0) throw new Error('account not found')
  console.log(`[reset-password] password updated for ${cleanEmail}`)
}

// Sprint 1A-5: 修改密码（已登录，可选验证旧密码）
function changePassword(db, accountId, oldPassword, newPassword) {
  if (typeof newPassword !== 'string' || newPassword.length < 8) throw new Error('password too short (min 8 chars)')
  const account = db.prepare('SELECT id, password_hash FROM accounts WHERE id = ?').get(accountId)
  if (!account) throw new Error('account not found')
  if (account.password_hash && oldPassword) {
    if (!verifyPassword(oldPassword, account.password_hash)) throw new Error('old password incorrect')
  }
  const passwordHash = hashPassword(newPassword)
  db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(passwordHash, accountId)
  console.log(`[change-password] password changed for account_id=${accountId}`)
}

module.exports = {
  // 保留老 API 名（向后兼容）
  requestMagicLink: requestLoginCode,
  verifyMagicLink: (_db, _token, _ip) => { throw new Error('use verifyLoginCode instead') },
  // 新 API
  requestLoginCode,
  verifyLoginCode,
  register,
  loginWithPassword,
  getCurrentSession,
  deleteSession,
  resetPasswordWithCode,
  changePassword,
}
