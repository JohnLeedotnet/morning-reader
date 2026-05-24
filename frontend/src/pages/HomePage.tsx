import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

interface Child {
  id: string
  name: string
  age: number
  font_scale: number
  daily_count?: number
  min_duration_s: number | null
  todayStatus: string | null
  pdfsRequired: number | null
}

interface RecPlan { id: number; pdf_filename: string; status: string }

interface Config {
  window_start: string
  window_end: string
  min_duration_s: string
}

const STATUS_INFO: Record<string, { label: string; cls: string }> = {
  started:          { label: '朗读中',     cls: 'bg-blue-100 text-blue-700' },
  submitted:        { label: '已提交',     cls: 'bg-yellow-100 text-yellow-700' },
  pending_review:   { label: '待家长检查', cls: 'bg-orange-100 text-orange-700' },
  passed:           { label: '合格 ✓',     cls: 'bg-[#D6EAE0] text-mint' },
  failed:           { label: '不合格',     cls: 'bg-red-100 text-red-600' },
  time_short:       { label: '时长不足',   cls: 'bg-yellow-100 text-yellow-700' },
  out_of_window:    { label: '超出时段',   cls: 'bg-yellow-100 text-yellow-700' },
  long_pause:       { label: '停顿过长',   cls: 'bg-orange-100 text-orange-600' },
  high_silence:     { label: '静音过多',   cls: 'bg-orange-100 text-orange-600' },
  pdf_insufficient: { label: 'PDF 不足',   cls: 'bg-red-100 text-red-600' },
}

function StatusBadge({ status }: { status: string | null }) {
  const info = status ? STATUS_INFO[status] : null
  return (
    <span className={`text-[11px] font-extrabold px-2.5 py-1 rounded-full whitespace-nowrap
      ${info ? info.cls : 'bg-[#F5E8DD] text-brown-faint'}`}>
      {info ? info.label : '未开始'}
    </span>
  )
}

const FAMILY_TOOLS = [
  { name: '照片库', icon: '📷', url: 'http://192.168.50.167:8765' },
] as const

function ChildCard({ child, recitationPlan, config }: {
  child: Child
  recitationPlan: RecPlan | null
  config: Config | null
}) {
  const scale    = child.font_scale ?? 1.0
  const nameSize = Math.round(22 * scale)
  const infoSize = 14 * scale
  const btnSize  = 15 * scale
  const btnPadY  = Math.round(14 * scale)
  const isLarge  = scale >= 1.2

  const childMinS   = child.min_duration_s ?? parseInt(config?.min_duration_s ?? '300')
  const childMinMin = Math.round(childMinS / 60)
  const windowText  = config ? `${config.window_start} - ${config.window_end}` : '7:00 - 8:00'

  return (
    <div className="flex-1 min-w-0 bg-white rounded-[20px] p-6
      shadow-[0_4px_24px_rgba(224,122,95,0.10),0_1px_4px_rgba(224,122,95,0.08)]
      flex flex-col gap-3.5">

      <div className="flex items-start justify-between gap-2">
        <span className="font-black text-brown-text leading-tight"
              style={{ fontSize: nameSize }}>
          {child.name}
        </span>
        <StatusBadge status={child.todayStatus} />
      </div>

      {recitationPlan && (recitationPlan.status === 'scheduled' || recitationPlan.status === 'retry') && (
        <Link to={`/recitation/${child.id}`}
          className={`block rounded-[14px] p-3 hover:brightness-110 transition-[filter] ${
            recitationPlan.status === 'retry'
              ? 'bg-orange-500 text-white'
              : 'bg-peach-deep text-white'
          }`}>
          <div className="text-xs font-bold opacity-80">
            {recitationPlan.status === 'retry' ? '🔁 需要重新背诵' : '📚 今日特殊任务'}
          </div>
          <div className="font-extrabold" style={{ fontSize: btnSize }}>
            背诵考核 · {recitationPlan.pdf_filename.split('/').pop()?.replace('.pdf', '')}
          </div>
        </Link>
      )}

      <div className="flex flex-col gap-2">
        {([
          ['要求朗读', `${child.daily_count ?? '—'} 本`],
          ['打卡时间', windowText],
          ['时长要求', `至少 ${childMinMin} 分钟`],
        ] as const).map(([label, value]) => (
          <div key={label} className="flex items-center gap-2 text-brown-mute"
               style={{ fontSize: infoSize }}>
            <span className="w-1.5 h-1.5 rounded-full bg-mint flex-shrink-0" />
            <span>{label}</span>
            <span className="font-extrabold text-brown-text ml-auto">{value}</span>
          </div>
        ))}
      </div>

      <Link
        to={`/reading/${child.id}`}
        className="mt-auto block text-center text-white font-extrabold rounded-[14px] leading-tight"
        style={{
          fontSize:        btnSize,
          paddingTop:      btnPadY,
          paddingBottom:   btnPadY,
          backgroundColor: isLarge ? 'var(--color-peach-deep)' : 'var(--color-peach)',
        }}
      >
        开始朗读英文
      </Link>

      <Link to={`/history/${child.id}`}
        className="text-center text-xs text-brown-mute hover:text-peach mt-2 underline transition-colors">
        📊 查看历史记录
      </Link>
    </div>
  )
}

export default function HomePage() {
  const [children,        setChildren]        = useState<Child[]>([])
  const [recitationPlans, setRecitationPlans] = useState<Record<string, RecPlan | null>>({})
  const [config,          setConfig]          = useState<Config | null>(null)
  const [error,           setError]           = useState('')
  // Sprint 1A-3: 三态 — undefined=加载中 / null=未登录 / object=已登录
  const [authMe,          setAuthMe]          = useState<{ email: string; is_superadmin: boolean } | null | undefined>(undefined)

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(setAuthMe)
      .catch(() => setAuthMe(null))
  }, [])

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setAuthMe(null)
  }

  useEffect(() => {
    // Sprint 1A-3: 仅已登录时拉 children/config
    if (!authMe) return
    Promise.all([
      fetch('/api/children').then(r => r.json()),
      fetch('/api/config').then(r => r.json()),
    ]).then(async ([childrenData, cfg]: [Child[], Config]) => {
      setConfig(cfg)
      const plans: Record<string, RecPlan | null> = {}
      await Promise.all(
        childrenData.map((c: Child) =>
          fetch(`/api/children/${c.id}/today-recitation`)
            .then(r => r.json())
            .then(data => { plans[c.id] = data })
            .catch(() => { plans[c.id] = null })
        )
      )
      setChildren(childrenData)
      setRecitationPlans(plans)
    }).catch(e => setError((e as Error).message))
  }, [authMe])

  // Sprint 1A-3: 鉴权状态分支
  if (authMe === undefined) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <p className="text-brown-mute">加载中...</p>
      </div>
    )
  }

  if (authMe === null) {
    return (
      <div className="min-h-screen bg-cream flex flex-col items-center justify-center p-8">
        <div className="bg-white rounded-[24px] p-10 max-w-md w-full shadow-[0_4px_24px_rgba(224,122,95,0.10)] text-center">
          <h1 className="text-3xl font-black text-brown-text mb-3">🌅 Morning Reader</h1>
          <p className="text-brown-mute text-sm mb-6 leading-relaxed">
            家庭晨读管理工具<br />
            家长监督孩子英文朗读 + 录音 + 审核
          </p>
          <Link to="/login"
            className="inline-block bg-peach text-white font-extrabold px-8 py-3 rounded-[14px]
              hover:opacity-90 transition-opacity">
            登录 / 注册
          </Link>
          <p className="text-[11px] text-brown-faint mt-6">
            输入邮箱即可，无需密码
          </p>
        </div>
      </div>
    )
  }

  // authMe 已登录，往下走正常 HomePage 渲染
  return (
    <div className="relative min-h-screen bg-cream flex flex-col items-center px-6 pt-10 pb-16">
      <Link to="/parent" className="absolute top-6 right-6 text-brown-faint text-sm font-extrabold hover:text-peach">
        👨‍👩‍👧 家长
      </Link>
      <h1 className="text-[30px] font-extrabold text-brown-text tracking-tight mb-8">
        Morning Reader
      </h1>

      {/* 账户区 */}
      <div className="w-full max-w-3xl mb-4 flex justify-end items-center gap-3 text-sm">
        {authMe ? (
          <>
            <span className="text-brown-mute">已登录 <span className="font-extrabold text-brown-text">{authMe.email}</span>{authMe.is_superadmin ? ' 👑' : ''}</span>
            <button onClick={handleLogout} className="text-peach hover:text-peach-deep font-bold">退出</button>
          </>
        ) : (
          <Link to="/login" className="text-peach hover:text-peach-deep font-bold">登录</Link>
        )}
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
      {children.length === 0 && !error && (
        <p className="text-brown-mute text-sm">加载中...</p>
      )}

      <div className="w-full max-w-3xl grid grid-cols-1 sm:grid-cols-2 gap-5">
        {children.map(child => (
          <ChildCard key={child.id} child={child} recitationPlan={recitationPlans[child.id] ?? null} config={config} />
        ))}
      </div>

      {/* 家庭工具区 */}
      <div className="w-full max-w-3xl mt-8">
        <div className="flex items-center gap-3 mb-4 text-brown-faint text-xs font-extrabold tracking-[0.2em]">
          <div className="flex-1 h-px bg-brown-faint/25"></div>
          <span>家庭工具</span>
          <div className="flex-1 h-px bg-brown-faint/25"></div>
        </div>
        <div className="flex flex-wrap gap-3 justify-center">
          {FAMILY_TOOLS.map(tool => (
            <a key={tool.url} href={tool.url}
               className="inline-flex items-center gap-3 bg-white text-brown-text font-extrabold
                 px-5 py-3 rounded-[14px] shadow-[0_2px_12px_rgba(224,122,95,0.08)]
                 hover:shadow-[0_4px_24px_rgba(224,122,95,0.18)] hover:bg-cream/30 transition-all">
              <span className="text-2xl">{tool.icon}</span>
              <span>{tool.name}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
