#!/usr/bin/env node
// 一次性运维脚本：给指定账号设置（或重置）用户名 + 密码
// 用法：node scripts/set-account-password.js <email> <username> <password>
// 例：node scripts/set-account-password.js lijhm@protonmail.com homer MyPassword123
const path = require('path')
const crypto = require('crypto')

const [email, username, password] = process.argv.slice(2)

if (!email || !username || !password) {
  console.error('用法：node scripts/set-account-password.js <email> <username> <password>')
  process.exit(1)
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('邮箱格式不对')
  process.exit(1)
}
if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
  console.error('用户名 3-32 位，只允许字母/数字/_/-')
  process.exit(1)
}
if (password.length < 8) {
  console.error('密码至少 8 位')
  process.exit(1)
}

const Database = require('better-sqlite3')
const dbPath = path.join(__dirname, '../data/morning-reader.db')
const db = new Database(dbPath)

const account = db.prepare('SELECT id, email, username FROM accounts WHERE email = ?').get(email.trim().toLowerCase())
if (!account) {
  console.error(`找不到邮箱为 ${email} 的账号。请先注册。`)
  process.exit(1)
}

// 检查用户名是否被别的账号占用
const conflict = db.prepare('SELECT id FROM accounts WHERE username = ? AND id != ?').get(username, account.id)
if (conflict) {
  console.error(`用户名 "${username}" 已被其他账号使用。`)
  process.exit(1)
}

const salt = crypto.randomBytes(32)
const hash = crypto.pbkdf2Sync(password, salt, 100_000, 32, 'sha256')
const passwordHash = `${salt.toString('hex')}:${hash.toString('hex')}`

db.prepare('UPDATE accounts SET username = ?, password_hash = ? WHERE id = ?').run(username, passwordHash, account.id)
console.log(`✅ 账号 ${email} 已更新 username="${username}"，密码已设置。`)
console.log(`   现在可以用 username="${username}" + 密码登录。`)
