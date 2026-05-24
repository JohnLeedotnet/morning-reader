import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

interface Me { email: string; is_superadmin: boolean }

export default function ProfilePage() {
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(setMe)
      .catch(() => setMe(null))
  }, [])

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== newPassword2) { setError('两次密码不一致'); return }
    if (newPassword.length < 8) { setError('密码至少 8 位'); return }
    setSubmitting(true); setError(''); setSuccess('')
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword: oldPassword || undefined, newPassword }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error || '修改失败')
      }
      setSuccess('密码已修改成功')
      setOldPassword(''); setNewPassword(''); setNewPassword2('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '网络错误')
    } finally {
      setSubmitting(false)
    }
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    navigate('/')
  }

  if (me === undefined) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <p className="text-brown-mute">加载中...</p>
      </div>
    )
  }

  if (me === null) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center p-4">
        <div className="bg-white rounded-[24px] p-8 max-w-md w-full shadow-[0_4px_24px_rgba(224,122,95,0.10)] text-center">
          <p className="text-brown-mute mb-4">请先登录</p>
          <Link to="/login" className="bg-peach text-white font-extrabold px-6 py-3 rounded-[14px] inline-block">登录</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-cream flex flex-col items-center px-6 pt-10 pb-16">
      <div className="w-full max-w-md">
        <Link to="/" className="text-sm text-brown-mute hover:text-peach mb-6 inline-block">← 返回首页</Link>

        <div className="bg-white rounded-[24px] p-8 shadow-[0_4px_24px_rgba(224,122,95,0.10)] mb-5">
          <h1 className="text-xl font-extrabold text-brown-text mb-4">👤 我的账号</h1>
          <div className="text-sm text-brown-mute space-y-2">
            <div className="flex justify-between">
              <span>邮箱</span>
              <span className="font-extrabold text-brown-text">{me.email}</span>
            </div>
            {me.is_superadmin && (
              <div className="flex justify-between">
                <span>角色</span>
                <span className="font-extrabold text-brown-text">👑 超级管理员</span>
              </div>
            )}
          </div>
          <button onClick={handleLogout}
            className="mt-5 w-full border border-peach text-peach font-extrabold py-2.5 rounded-[12px] hover:bg-peach hover:text-white transition-colors text-sm">
            退出登录
          </button>
        </div>

        <div className="bg-white rounded-[24px] p-8 shadow-[0_4px_24px_rgba(224,122,95,0.10)]">
          <h2 className="text-lg font-extrabold text-brown-text mb-5">🔒 修改密码</h2>
          <form onSubmit={handleChangePassword} className="space-y-3">
            <input type="password" placeholder="当前密码（首次设置可不填）" value={oldPassword}
              onChange={e => setOldPassword(e.target.value)}
              className="w-full bg-cream rounded-[10px] px-4 py-3 text-brown-text border-2 border-transparent focus:border-peach outline-none" />
            <input type="password" required placeholder="新密码（至少 8 位）" value={newPassword}
              onChange={e => setNewPassword(e.target.value)} minLength={8}
              className="w-full bg-cream rounded-[10px] px-4 py-3 text-brown-text border-2 border-transparent focus:border-peach outline-none" />
            <input type="password" required placeholder="再输一次新密码" value={newPassword2}
              onChange={e => setNewPassword2(e.target.value)}
              className="w-full bg-cream rounded-[10px] px-4 py-3 text-brown-text border-2 border-transparent focus:border-peach outline-none" />
            {error && <p className="text-red-500 text-sm">{error}</p>}
            {success && <p className="text-mint text-sm font-bold">{success}</p>}
            <button type="submit" disabled={submitting}
              className="w-full bg-peach text-white py-3 rounded-[12px] font-extrabold disabled:opacity-40">
              {submitting ? '修改中...' : '修改密码'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
