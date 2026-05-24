import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

type Tab = 'password' | 'code'

export default function LoginPage() {
  const [tab, setTab] = useState<Tab>('password')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeRequested, setCodeRequested] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true); setError('')
    try {
      const res = await fetch('/api/auth/login/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error || `登录失败 ${res.status}`)
      }
      navigate('/')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '网络错误')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true); setError('')
    try {
      const res = await fetch('/api/auth/login/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      if (!res.ok) throw new Error(`发送失败 ${res.status}`)
      setCodeRequested(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '网络错误')
    } finally {
      setSubmitting(false)
    }
  }

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true); setError('')
    try {
      const res = await fetch('/api/auth/login/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error || '验证码错误')
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
        <h1 className="text-2xl font-extrabold text-brown-text mb-6 text-center">🌅 Morning Reader 登录</h1>

        {/* Tab 切换 */}
        <div className="flex gap-2 mb-6 bg-cream rounded-[12px] p-1">
          {([
            ['password', '用户名密码'],
            ['code', '邮箱验证码'],
          ] as const).map(([key, label]) => (
            <button key={key} onClick={() => { setTab(key); setError(''); setCodeRequested(false) }}
              className={`flex-1 py-2 rounded-[10px] text-sm font-extrabold transition-colors
                ${tab === key ? 'bg-white text-brown-text shadow-sm' : 'text-brown-mute'}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'password' && (
          <form onSubmit={handlePasswordLogin} className="space-y-3">
            <input type="text" required placeholder="用户名或邮箱" value={username} onChange={e => setUsername(e.target.value)}
              className="w-full bg-cream rounded-[10px] px-4 py-3 text-brown-text border-2 border-transparent focus:border-peach outline-none" />
            <input type="password" required placeholder="密码" value={password} onChange={e => setPassword(e.target.value)}
              className="w-full bg-cream rounded-[10px] px-4 py-3 text-brown-text border-2 border-transparent focus:border-peach outline-none" />
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button type="submit" disabled={submitting}
              className="w-full bg-peach text-white py-3 rounded-[12px] font-extrabold disabled:opacity-40">
              {submitting ? '登录中...' : '登录'}
            </button>
            <div className="text-center">
              <Link to="/forgot-password" className="text-xs text-brown-mute hover:text-peach">忘记密码？</Link>
            </div>
          </form>
        )}

        {tab === 'code' && !codeRequested && (
          <form onSubmit={handleRequestCode} className="space-y-3">
            <input type="email" required placeholder="your@email.com" value={email} onChange={e => setEmail(e.target.value)}
              className="w-full bg-cream rounded-[10px] px-4 py-3 text-brown-text border-2 border-transparent focus:border-peach outline-none" />
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button type="submit" disabled={submitting}
              className="w-full bg-peach text-white py-3 rounded-[12px] font-extrabold disabled:opacity-40">
              {submitting ? '发送中...' : '发送 6 位验证码'}
            </button>
          </form>
        )}

        {tab === 'code' && codeRequested && (
          <form onSubmit={handleVerifyCode} className="space-y-3">
            <div className="bg-mint/20 text-sm text-brown-text p-3 rounded-[10px]">
              已发送验证码到 <strong>{email}</strong>，请检查邮箱（15 分钟内有效）
            </div>
            <input type="text" required placeholder="6 位验证码" value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric" maxLength={6} pattern="\d{6}"
              className="w-full bg-cream rounded-[10px] px-4 py-3 text-brown-text text-center text-2xl font-extrabold tracking-[8px] tabular-nums border-2 border-transparent focus:border-peach outline-none" />
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button type="submit" disabled={submitting || code.length !== 6}
              className="w-full bg-peach text-white py-3 rounded-[12px] font-extrabold disabled:opacity-40">
              {submitting ? '验证中...' : '验证并登录'}
            </button>
            <button type="button" onClick={() => { setCodeRequested(false); setCode(''); setError('') }}
              className="w-full text-brown-mute text-sm font-bold py-2">
              重新发送
            </button>
          </form>
        )}

        <div className="mt-6 pt-4 border-t border-cream-card text-center space-y-2">
          <p className="text-sm text-brown-mute">
            还没账号？<Link to="/register" className="text-peach font-bold">注册</Link>
          </p>
          <p className="text-xs text-brown-faint">
            <Link to="/" className="hover:text-peach">返回首页</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
