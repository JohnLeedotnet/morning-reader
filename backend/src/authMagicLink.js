// Sprint 1A: 邮箱魔法链接核心逻辑
const crypto = require('crypto')

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

async function sendMagicLinkEmail(email, link) {
  const resend = getResendClient()
  if (!resend) {
    console.log(`[magic-link console fallback] email=${email} link=${link}`)
    return { sent: false, fallback: true }
  }
  const from = process.env.EMAIL_FROM || 'Morning Reader <noreply@morningreader.org>'
  const subject = 'Morning Reader 登录链接'
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #FFF5EB; color: #3D2B1F;">
      <h2 style="color: #E07A5F; margin-bottom: 8px;">Morning Reader</h2>
      <p>你好！</p>
      <p>点击下方按钮登录 Morning Reader（链接 15 分钟内有效，只能使用一次）：</p>
      <p style="margin: 24px 0;">
        <a href="${link}" style="display: inline-block; background: #E07A5F; color: #fff; padding: 12px 24px; border-radius: 12px; text-decoration: none; font-weight: 800;">登录 Morning Reader</a>
      </p>
      <p style="font-size: 12px; color: #7A5C4A;">如果按钮无法点击，请复制下方链接到浏览器：</p>
      <p style="font-size: 12px; word-break: break-all; color: #7A5C4A;">${link}</p>
      <hr style="border: none; border-top: 1px solid #E8D8B0; margin: 24px 0;" />
      <p style="font-size: 11px; color: #9A8060;">如果你没有请求此邮件，可以忽略。</p>
    </div>
  `
  try {
    const result = await resend.emails.send({ from, to: email, subject, html })
    console.log(`[magic-link sent via Resend] email=${email} id=${result?.data?.id || 'unknown'}`)
    return { sent: true, id: result?.data?.id }
  } catch (err) {
    console.error(`[resend] send failed to ${email}:`, err.message)
    console.log(`[magic-link console fallback after send error] email=${email} link=${link}`)
    return { sent: false, error: err.message }
  }
}

const TOKEN_BYTES = 32
const LINK_TTL_MS = 15 * 60 * 1000              // 魔法链接 15 分钟有效
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // auth_session 30 天

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url')
}

function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

// 发起：生成 magic_links 记录 + 发邮件（Sprint 1A-2: 接 Resend，失败时降级 console.log）
async function requestMagicLink(db, email, baseUrl) {
  const cleanEmail = String(email).trim().toLowerCase()
  if (!isValidEmail(cleanEmail)) throw new Error('invalid email')
  const token = generateToken()
  const expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString()
  db.prepare('INSERT INTO magic_links (token, email, expires_at, used) VALUES (?, ?, ?, 0)').run(token, cleanEmail, expiresAt)
  const link = `${baseUrl}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`
  await sendMagicLinkEmail(cleanEmail, link)
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
