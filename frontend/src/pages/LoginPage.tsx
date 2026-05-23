import { useState } from 'react'
import { Link } from 'react-router-dom'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setSubmitting(true); setError('')
    try {
      const res = await fetch('/api/auth/magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSent(true)
    } catch (err: any) {
      setError(err.message || '网络错误')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center p-4">
      <div className="bg-white rounded-[24px] p-8 max-w-md w-full shadow-[0_4px_24px_rgba(224,122,95,0.10)]">
        <h1 className="text-2xl font-extrabold text-brown-text mb-2">登录 Morning Reader</h1>
        <p className="text-sm text-brown-mute mb-6">输入邮箱，我们会发一个登录链接给你</p>
        {sent ? (
          <div className="bg-mint/20 rounded-[10px] p-4 text-sm text-brown-text">
            登录链接已发送到 <strong>{email}</strong>，请检查邮箱（15 分钟内有效）。
            <p className="text-xs text-brown-mute mt-2">开发期：链接也会输出到 backend 日志</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="email"
              required
              autoFocus
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-cream rounded-[10px] px-4 py-3 text-brown-text
                border-2 border-transparent focus:border-peach outline-none transition-colors"
            />
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-peach text-white py-3 rounded-[12px] font-extrabold
                hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {submitting ? '发送中...' : '发送登录链接'}
            </button>
          </form>
        )}
        <p className="text-xs text-brown-faint mt-6 text-center">
          <Link to="/" className="hover:text-peach">返回首页</Link>
        </p>
      </div>
    </div>
  )
}
