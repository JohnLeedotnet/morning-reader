import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')
  const [step, setStep] = useState<'email' | 'reset'>('email')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true); setError('')
    try {
      await fetch('/api/auth/forgot-password/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      setStep('reset')
    } catch {
      setError('网络错误，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== newPassword2) { setError('两次密码不一致'); return }
    if (newPassword.length < 8) { setError('密码至少 8 位'); return }
    setSubmitting(true); setError('')
    try {
      const res = await fetch('/api/auth/forgot-password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim(), newPassword }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error || '重置失败')
      }
      navigate('/login')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '网络错误')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center p-4">
      <div className="bg-white rounded-[24px] p-8 max-w-md w-full shadow-[0_4px_24px_rgba(224,122,95,0.10)]">
        <h1 className="text-2xl font-extrabold text-brown-text mb-2 text-center">🔑 忘记密码</h1>
        <p className="text-sm text-brown-mute mb-6 text-center">
          {step === 'email' ? '输入注册邮箱，我们会发送重置验证码' : `验证码已发送到 ${email}`}
        </p>

        {step === 'email' && (
          <form onSubmit={handleSendCode} className="space-y-3">
            <input type="email" required placeholder="你的注册邮箱" value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-cream rounded-[10px] px-4 py-3 text-brown-text border-2 border-transparent focus:border-peach outline-none" />
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button type="submit" disabled={submitting}
              className="w-full bg-peach text-white py-3 rounded-[12px] font-extrabold disabled:opacity-40">
              {submitting ? '发送中...' : '发送重置验证码'}
            </button>
          </form>
        )}

        {step === 'reset' && (
          <form onSubmit={handleReset} className="space-y-3">
            <div className="bg-mint/20 text-sm text-brown-text p-3 rounded-[10px]">
              已发送验证码到 <strong>{email}</strong>（15 分钟内有效）
            </div>
            <input type="text" required placeholder="6 位验证码" value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric" maxLength={6} pattern="\d{6}"
              className="w-full bg-cream rounded-[10px] px-4 py-3 text-brown-text text-center text-2xl font-extrabold tracking-[8px] tabular-nums border-2 border-transparent focus:border-peach outline-none" />
            <input type="password" required placeholder="新密码（至少 8 位）" value={newPassword}
              onChange={e => setNewPassword(e.target.value)} minLength={8}
              className="w-full bg-cream rounded-[10px] px-4 py-3 text-brown-text border-2 border-transparent focus:border-peach outline-none" />
            <input type="password" required placeholder="再输一次新密码" value={newPassword2}
              onChange={e => setNewPassword2(e.target.value)}
              className="w-full bg-cream rounded-[10px] px-4 py-3 text-brown-text border-2 border-transparent focus:border-peach outline-none" />
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button type="submit" disabled={submitting || code.length !== 6}
              className="w-full bg-peach text-white py-3 rounded-[12px] font-extrabold disabled:opacity-40">
              {submitting ? '重置中...' : '重置密码'}
            </button>
            <button type="button" onClick={() => { setStep('email'); setCode(''); setError('') }}
              className="w-full text-brown-mute text-sm font-bold py-2">
              重新发送
            </button>
          </form>
        )}

        <div className="mt-6 pt-4 border-t border-cream-card text-center">
          <Link to="/login" className="text-sm text-peach font-bold">返回登录</Link>
        </div>
      </div>
    </div>
  )
}
