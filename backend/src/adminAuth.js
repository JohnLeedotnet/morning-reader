const db = require('./db')

const attempts = new Map() // key=ip, value={count, lockedUntil}

function adminAuth(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress
  const now = Date.now()
  const rec = attempts.get(ip)
  if (rec && rec.lockedUntil > now) {
    return res.status(429).json({ error: 'locked', retryAfter: Math.ceil((rec.lockedUntil - now) / 1000) })
  }
  // Accept pin from header OR body (body used by verify-pin endpoint)
  const pin = req.header('X-Admin-Pin') || req.body?.pin || ''
  const stored = db.prepare("SELECT value FROM config WHERE key='parent_pin'").get()
  if (!stored || stored.value === '' || pin !== stored.value) {
    const r = rec ?? { count: 0, lockedUntil: 0 }
    r.count++
    if (r.count >= 3) { r.lockedUntil = now + 60_000; r.count = 0 }
    attempts.set(ip, r)
    return res.status(401).json({ error: 'unauthorized' })
  }
  attempts.delete(ip)
  next()
}

module.exports = adminAuth
