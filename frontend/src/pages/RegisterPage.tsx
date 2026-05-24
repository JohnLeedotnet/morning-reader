import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== password2) { setError('两次密码不一致'); return }
    if (password.length < 8) { setError('密码至少 8 位'); return }
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) { setError('用户名 3-32 位，字母/数字/_/-'); return }
    setSubmitting(true); setError('')
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), username: username.trim(), password }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error || `注册失败 ${res.status}`)
      }
      navigate('/')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '网络错误')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center p-4">
      <div className="bg-white rounded-[24px] p-8 max-w-md w-full shadow-[0_4px_24px_rgba(224,122,95,0.10)]">
        <h1 className="text-2xl font-extrabold text-brown-text mb-2 text-center">🌅 注册 Morning Reader</h1>
        <p className="text-sm text-brown-mute mb-6 text-center">填写后立即可用</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input type="email" required placeholder="邮箱（如 you@example.com）" value={email} onChange={e => setEmail(e.target.value)}
            className="w-full bg-cream rounded-[10px] px-4 py-3 text-brown-text border-2 border-transparent focus:border-peach outline-none" />
          <input type="text" required placeholder="用户名（3-32 位，字母/数字/_/-）" value={username} onChange={e => setUsername(e.target.value)}
            pattern="[a-zA-Z0-9_-]{3,32}"
            className="w-full bg-cream rounded-[10px] px-4 py-3 text-brown-text border-2 border-transparent focus:border-peach outline-none" />
          <input type="password" required placeholder="密码（至少 8 位）" value={password} onChange={e => setPassword(e.target.value)}
            minLength={8}
            className="w-full bg-cream rounded-[10px] px-4 py-3 text-brown-text border-2 border-transparent focus:border-peach outline-none" />
          <input type="password" required placeholder="再输一次密码" value={password2} onChange={e => setPassword2(e.target.value)}
            className="w-full bg-cream rounded-[10px] px-4 py-3 text-brown-text border-2 border-transparent focus:border-peach outline-none" />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button type="submit" disabled={submitting}
            className="w-full bg-peach text-white py-3 rounded-[12px] font-extrabold disabled:opacity-40">
            {submitting ? '注册中...' : '注册并登录'}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-cream-card text-center">
          <p className="text-sm text-brown-mute">
            已有账号？<Link to="/login" className="text-peach font-bold">登录</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
