import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import OnboardingWizard from './OnboardingWizard'

interface Child {
  id: string
  name: string
  age: number
  font_scale: number
  daily_count?: number
  min_duration_s: number | null
  todayStatus: string | null
  pdfsRequired: number | null
  recitation_mode?: string | null
  recitation_weekday?: number | null
  requires_recitation?: number | null
}

interface RecPlan { id: number; pdf_filename: string; status: string; pdf_library_id?: number | null }

interface PoolEntry {
  library_id: number
  pdf_filename: string
  read_count?: number
  advance_after_reads?: number
}

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

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const FAMILY_TOOLS = [
  { name: '照片库', icon: '📷', url: 'http://192.168.50.167:8765' },
] as const

function ChildCard({ child, recitationPlan, config, poolEntries }: {
  child: Child
  recitationPlan: RecPlan | null
  config: Config | null
  poolEntries: PoolEntry[]
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

  const activeRecPlan = (recitationPlan?.status === 'scheduled' || recitationPlan?.status === 'retry')
    ? recitationPlan : null
  const weekday = child.recitation_weekday ?? 5
  const isAuto  = (child.recitation_mode ?? 'auto') === 'auto'

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

      {activeRecPlan && (
        <Link to={`/recitation/${child.id}`}
          className={`block rounded-[14px] p-3 hover:brightness-110 transition-[filter] ${
            activeRecPlan.status === 'retry'
              ? 'bg-orange-500 text-white'
              : 'bg-peach-deep text-white'
          }`}>
          <div className="text-xs font-bold opacity-80">
            {activeRecPlan.status === 'retry' ? '🔁 需要重新背诵' : '📚 今日特殊任务'}
          </div>
          <div className="font-extrabold" style={{ fontSize: btnSize }}>
            背诵考核 · {activeRecPlan.pdf_filename?.split('/').pop()?.replace('.pdf', '') ?? '未知 PDF'}
          </div>
        </Link>
      )}

      {/* 今日书单进度 */}
      {poolEntries.length === 0 ? (
        <div className="bg-orange-50 rounded-[12px] px-3 py-2.5 text-[13px] text-orange-700 font-bold">
          📚 全部 PDF 已读完，请家长在考核计划页补充
        </div>
      ) : (
        <div className="bg-cream/60 rounded-[12px] px-3 py-2 space-y-1.5">
          {poolEntries.map(entry => {
            const n = entry.read_count ?? 0
            const m = entry.advance_after_reads ?? 5
            const isActiveRec = activeRecPlan?.pdf_library_id != null
              ? activeRecPlan.pdf_library_id === entry.library_id
              : activeRecPlan?.pdf_filename?.split('/').pop() === entry.pdf_filename?.split('/').pop()
            const graduated = n >= m
            const shortName = entry.pdf_filename?.replace(/\.pdf$/i, '') ?? ''

            return (
              <div key={entry.library_id} className="flex items-center justify-between gap-2 min-w-0">
                <span className="text-[12px] text-brown-text truncate flex-1">{shortName}</span>
                {isActiveRec ? (
                  <span className="text-[11px] font-extrabold text-peach-deep shrink-0">📚 今日背诵</span>
                ) : graduated && isAuto ? (
                  <span className="text-[11px] font-extrabold text-mint shrink-0">
                    ✓ 已可毕业，等{WEEKDAY_NAMES[weekday]}考核
                  </span>
                ) : graduated ? (
                  <span className="text-[11px] font-extrabold text-mint shrink-0">✓ 已达标</span>
                ) : (
                  <span className="text-[11px] font-bold text-brown-mute shrink-0 tabular-nums">
                    {n}/{m} 次
                  </span>
                )}
              </div>
            )
          })}
        </div>
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

function AccountDropdown({ authMe, onLogout }: {
  authMe: { email: string; username: string | null; is_superadmin: boolean }
  onLogout: () => void
}) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-account-dropdown]')) setOpen(false)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])

  const displayName = authMe.username || authMe.email.split('@')[0]
  const avatarLetter = (authMe.username || authMe.email)[0].toUpperCase()

  return (
    <div data-account-dropdown className="absolute top-6 right-6 z-50">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-2 bg-white hover:bg-cream-card rounded-full pl-1 pr-3 py-1
          shadow-[0_2px_8px_rgba(224,122,95,0.10)] border border-cream-card text-sm font-bold
          active:scale-95 transition-transform">
        <span className="w-7 h-7 rounded-full bg-peach text-white flex items-center justify-center text-xs font-extrabold shrink-0">
          {avatarLetter}
        </span>
        <span className="text-brown-text truncate max-w-[120px]">{displayName}</span>
        {authMe.is_superadmin && <span className="text-[11px] shrink-0">👑</span>}
        <span className="text-brown-faint text-xs shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-64 bg-white rounded-[14px]
          shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-cream-card overflow-hidden">
          <div className="px-4 py-3 bg-cream/40 border-b border-cream-card">
            <p className="text-[11px] text-brown-mute font-bold">已登录账户</p>
            <p className="text-sm font-extrabold text-brown-text break-all mt-0.5">{authMe.email}</p>
            {authMe.username && (
              <p className="text-[11px] text-brown-mute mt-0.5">用户名：<span className="font-bold text-brown-text">{authMe.username}</span></p>
            )}
            {authMe.is_superadmin && (
              <p className="text-[11px] text-peach-deep font-bold mt-1">👑 超级管理员</p>
            )}
          </div>
          <button onClick={() => { setOpen(false); navigate('/parent') }}
            className="w-full text-left px-4 py-3 text-sm hover:bg-cream font-bold text-brown-text
              flex items-center gap-2 transition-colors">
            <span className="text-base">⚙️</span> 用户设置
          </button>
          <button onClick={() => { setOpen(false); onLogout() }}
            className="w-full text-left px-4 py-3 text-sm hover:bg-cream font-bold text-brown-text
              border-t border-cream-card flex items-center gap-2 transition-colors">
            <span className="text-base">↪️</span> 退出登录
          </button>
        </div>
      )}
    </div>
  )
}

export default function HomePage() {
  const [children,        setChildren]        = useState<Child[]>([])
  const [childrenLoaded,  setChildrenLoaded]  = useState(false)
  const [recitationPlans, setRecitationPlans] = useState<Record<string, RecPlan | null>>({})
  const [poolMap,         setPoolMap]         = useState<Record<string, PoolEntry[]>>({})
  const [config,          setConfig]          = useState<Config | null>(null)
  const [error,           setError]           = useState('')
  // Sprint 1A-3: 三态 — undefined=加载中 / null=未登录 / object=已登录
  const [authMe,          setAuthMe]          = useState<{ email: string; username: string | null; is_superadmin: boolean } | null | undefined>(undefined)

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
      const pools: Record<string, PoolEntry[]>    = {}
      await Promise.all(
        childrenData.map((c: Child) =>
          Promise.all([
            fetch(`/api/children/${c.id}/today-recitation`)
              .then(r => r.json())
              .then(data => { plans[c.id] = data })
              .catch(() => { plans[c.id] = null }),
            fetch(`/api/children/${c.id}/pool`)
              .then(r => r.json())
              .then((data: PoolEntry[]) => { pools[c.id] = Array.isArray(data) ? data : [] })
              .catch(() => { pools[c.id] = [] }),
          ])
        )
      )
      setChildren(childrenData)
      setRecitationPlans(plans)
      setPoolMap(pools)
      setChildrenLoaded(true)
    }).catch(e => { setError((e as Error).message); setChildrenLoaded(true) })
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
      <div className="min-h-screen bg-cream flex items-center justify-center p-4">
        <div className="bg-white rounded-[24px] p-8 sm:p-10 max-w-2xl w-full shadow-[0_4px_24px_rgba(224,122,95,0.10)]">
          <div className="text-center mb-8">
            <h1 className="text-3xl sm:text-4xl font-black text-brown-text mb-3">🌅 Morning Reader</h1>
            <p className="text-brown-mute text-base">家庭晨读管理工具</p>
          </div>

          <div className="space-y-5 mb-8 text-sm text-brown-text leading-relaxed">
            <div className="bg-cream/60 rounded-[12px] p-4">
              <h3 className="font-extrabold text-base mb-2">📖 它能做什么</h3>
              <ul className="space-y-1 ml-4 list-disc">
                <li>系统自动录音并检测有效性（时长、停顿、静音占比）</li>
                <li>家长在管理面板审核、判断录音是否合格</li>
                <li>每两周一次背诵考核，通过后自动前进到下一本书</li>
                <li>支持牛津阅读树、ESL Podcast 等公共图书馆 PDF</li>
              </ul>
            </div>

            <div className="bg-cream/60 rounded-[12px] p-4">
              <h3 className="font-extrabold text-base mb-2">👨‍👩‍👧 怎么用</h3>
              <ol className="space-y-1 ml-4 list-decimal">
                <li><strong>一个家庭一个账号</strong>，邮箱注册即可</li>
                <li>家长完成首次设置：添加孩子角色 + 选 PDF + 配置朗读要求</li>
                <li><strong>孩子使用朗读页</strong>，只看到自己的卡片，无需登录</li>
                <li><strong>家长用 PIN 解锁</strong>用户设置，管理朗读要求、审核录音、修改密码等</li>
                <li>多个孩子共享同一账号，每个孩子独立配置</li>
              </ol>
            </div>

            <div className="bg-cream/60 rounded-[12px] p-4">
              <h3 className="font-extrabold text-base mb-2">🔒 隐私</h3>
              <p>每个家庭账号的角色、录音、配置完全隔离，其他账号无法访问。</p>
            </div>
          </div>

          <div className="flex gap-3 justify-center">
            <Link to="/login" className="inline-block bg-peach text-white font-extrabold px-8 py-3 rounded-[14px] hover:opacity-90 transition-opacity">登录</Link>
            <Link to="/register" className="inline-block bg-shell-dark text-white font-extrabold px-8 py-3 rounded-[14px] hover:opacity-90 transition-opacity">注册新家庭</Link>
          </div>
          <p className="text-xs text-brown-faint mt-6 text-center">邮箱注册，无需手机号，亲友间使用</p>
        </div>
      </div>
    )
  }

  // Sprint 1C: 新用户无角色 → 显示引导向导
  if (childrenLoaded && children.length === 0 && !error) {
    return (
      <OnboardingWizard authMe={authMe!} onDone={() => {
        setChildrenLoaded(false)
        fetch('/api/children')
          .then(r => r.ok ? r.json() : [])
          .then((d: Child[]) => { setChildren(d); setChildrenLoaded(true) })
          .catch(() => setChildrenLoaded(true))
      }} />
    )
  }

  // authMe 已登录，往下走正常 HomePage 渲染
  return (
    <div className="relative min-h-screen bg-cream flex flex-col items-center px-6 pt-10 pb-16">
      <AccountDropdown authMe={authMe!} onLogout={handleLogout} />
      <h1 className="text-[30px] font-extrabold text-brown-text tracking-tight mb-8">
        Morning Reader
      </h1>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
      {!childrenLoaded && !error && (
        <p className="text-brown-mute text-sm">加载中...</p>
      )}
      {childrenLoaded && children.length === 0 && !error && (
        <p className="text-brown-mute text-sm">未设置朗读要求</p>
      )}

      <div className="w-full max-w-3xl flex flex-wrap justify-center gap-5">
        {children.map(child => (
          <div key={child.id} className="w-full sm:w-[calc(50%-10px)] max-w-md">
            <ChildCard child={child} recitationPlan={recitationPlans[child.id] ?? null} config={config} poolEntries={poolMap[child.id] ?? []} />
          </div>
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
