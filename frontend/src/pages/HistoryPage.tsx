import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

interface HistorySession {
  id: number
  date: string
  start_time: string
  end_time: string | null
  total_duration_s: number
  silence_count: number
  max_silence_s: number
  total_silence_s: number
  pdfs_opened: number
  pdfs_required: number
  status: string
  session_type: string | null
}

interface Child { id: string; name: string }

const STATUS_INFO: Record<string, { label: string; bg: string; text: string }> = {
  pending_review:   { label: '待检查', bg: 'bg-orange-300',  text: 'text-white' },
  passed:           { label: '合格',   bg: 'bg-mint',        text: 'text-white' },
  redo_required:    { label: '重读',   bg: 'bg-orange-500',  text: 'text-white' },
  time_short:       { label: '时长不足', bg: 'bg-yellow-400', text: 'text-brown-text' },
  out_of_window:    { label: '超时',   bg: 'bg-yellow-400',  text: 'text-brown-text' },
  long_pause:       { label: '停顿过长', bg: 'bg-orange-400', text: 'text-white' },
  high_silence:     { label: '静音过多', bg: 'bg-orange-400', text: 'text-white' },
  pdf_insufficient: { label: 'PDF 不足', bg: 'bg-red-400',   text: 'text-white' },
  failed:           { label: '未通过', bg: 'bg-red-400',     text: 'text-white' },
}

function fmtClockTime(iso: string) {
  const d = new Date(iso)
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
}

function fmtDuration(s: number) {
  if (!s) return '0秒'
  const m = Math.floor(s / 60), sec = Math.floor(s % 60)
  return m > 0 ? `${m}分${sec}秒` : `${sec}秒`
}

function StatusBadge({ status }: { status: string }) {
  const info = STATUS_INFO[status]
  if (!info) return (
    <span className="text-[11px] font-extrabold px-2.5 py-1 rounded-full bg-[#F5E8DD] text-brown-mute whitespace-nowrap">
      {status}
    </span>
  )
  return (
    <span className={`text-[11px] font-extrabold px-2.5 py-1 rounded-full whitespace-nowrap ${info.bg} ${info.text}`}>
      {info.label}
    </span>
  )
}

export default function HistoryPage() {
  const { childId } = useParams<{ childId: string }>()
  const [child,    setChild]    = useState<Child | null>(null)
  const [sessions, setSessions] = useState<HistorySession[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')

  useEffect(() => {
    if (!childId) return
    Promise.all([
      fetch(`/api/children/${childId}`).then(r => r.json()),
      fetch(`/api/children/${childId}/history?limit=30`).then(r => r.json()),
    ]).then(([childData, sessData]) => {
      setChild(childData)
      setSessions(Array.isArray(sessData) ? sessData : [])
    }).catch(e => setError((e as Error).message))
    .finally(() => setLoading(false))
  }, [childId])

  if (error) return (
    <div className="min-h-screen bg-cream flex items-center justify-center p-8">
      <p className="text-red-500 text-sm">{error}</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-cream">
      {/* Top bar */}
      <div className="bg-shell-dark px-6 py-4 flex items-center gap-4 sticky top-0 z-10">
        <Link to="/" className="text-[#C09A80] hover:text-white font-bold text-sm transition-colors">
          ← 返回
        </Link>
        <span className="text-white font-extrabold text-[18px] flex-1 text-center">
          {child ? `${child.name} 的朗读历史` : '朗读历史'}
        </span>
        <span className="w-12" />
      </div>

      <div className="max-w-2xl mx-auto p-6 space-y-3">
        {loading && (
          <div className="text-center py-12">
            <p className="text-brown-mute">加载中...</p>
          </div>
        )}

        {!loading && sessions.length === 0 && (
          <div className="bg-white rounded-[20px] p-10 text-center
            shadow-[0_4px_24px_rgba(224,122,95,0.08)]">
            <p className="text-brown-mute mb-4">还没有朗读记录，去首页开始今天的晨读吧</p>
            <Link to="/"
              className="inline-block bg-peach text-white font-extrabold rounded-[12px] px-6 py-2.5 text-sm
                hover:opacity-90 transition-opacity">
              回首页
            </Link>
          </div>
        )}

        {sessions.map(session => {
          const isRecitation = session.session_type === 'recitation'
          return (
            <div key={session.id}
              className="bg-white rounded-[16px] p-4 shadow-[0_2px_12px_rgba(224,122,95,0.06)]
                flex items-center gap-4">
              <div className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-xl
                ${isRecitation ? 'bg-peach/20' : 'bg-[#F5E8DD]'}`}>
                {isRecitation ? '📚' : '🎤'}
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-xs text-brown-mute font-bold">
                  {session.date} · {fmtClockTime(session.start_time)}
                </div>
                <div className="text-base text-brown-text font-extrabold">
                  {isRecitation ? '背诵考核' : '晨读'} · {fmtDuration(session.total_duration_s)}
                </div>
                <div className="text-xs text-brown-mute mt-1">
                  {!isRecitation && `读 ${session.pdfs_opened}/${session.pdfs_required} 本 · `}
                  停顿 {session.silence_count} 次
                </div>
              </div>

              <StatusBadge status={session.status} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
