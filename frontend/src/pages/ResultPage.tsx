import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { pickEncouragement } from '../lib/encouragements'
import { pickRandomGame } from '../games'

interface Session {
  id: number
  child_id: string
  date: string
  start_time: string
  end_time: string | null
  status: string
  total_duration_s: number
  silence_count: number
  max_silence_s: number
  total_silence_s: number
  pdfs_opened: number
  pdfs_required: number
  time_in_window: number
  session_type?: string
}

const STATUS_INFO: Record<string, { label: string; bg: string; text: string }> = {
  pending_review:   { label: '提交成功 · 待家长检查', bg: 'bg-mint',        text: 'text-white' },
  passed:           { label: '已通过 ✓',              bg: 'bg-mint',        text: 'text-white' },
  time_short:       { label: '时长不足',               bg: 'bg-yellow-400', text: 'text-brown-text' },
  out_of_window:    { label: '超出时间窗口',            bg: 'bg-yellow-400', text: 'text-brown-text' },
  long_pause:       { label: '停顿过长',               bg: 'bg-orange-400', text: 'text-white' },
  high_silence:     { label: '静音过多',               bg: 'bg-orange-400', text: 'text-white' },
  pdf_insufficient: { label: 'PDF 数量不足',           bg: 'bg-red-400',    text: 'text-white' },
  failed:           { label: '未通过',                 bg: 'bg-red-400',    text: 'text-white' },
}

function fmtHMS(iso: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return '—'
    return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`
  } catch { return '—' }
}

function fmtDuration(s: number): string {
  if (!s) return '0 秒'
  const m = Math.floor(s / 60), sec = s % 60
  return m > 0 ? `${m} 分 ${sec} 秒` : `${sec} 秒`
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-brown-mute text-[14px]">{label}</span>
      <span className={`font-extrabold text-[14px] ${warn ? 'text-red-500' : 'text-brown-text'}`}>
        {value}
      </span>
    </div>
  )
}

export default function ResultPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const [session,   setSession]   = useState<Session | null>(null)
  const [childName, setChildName] = useState('')
  const [error,     setError]     = useState('')

  useEffect(() => {
    if (!sessionId) return
    fetch(`/api/sessions/${sessionId}`)
      .then(r => r.json())
      .then(setSession)
      .catch(e => setError((e as Error).message))
  }, [sessionId])

  useEffect(() => {
    if (!session?.child_id) return
    fetch(`/api/children/${session.child_id}`)
      .then(r => r.json())
      .then(d => setChildName(d.name ?? session.child_id))
      .catch(() => setChildName(session.child_id))
  }, [session?.child_id])
  const seed          = useMemo(() => Math.floor(Math.random() * 1000), [session?.id])
  const encouragement = useMemo(() => pickEncouragement(childName, seed), [childName, seed])
  const eggGameId     = useMemo(() => pickRandomGame(seed).id, [seed])

  if (error) return (
    <div className="min-h-screen bg-cream flex items-center justify-center p-8">
      <p className="text-red-500 text-sm">{error}</p>
    </div>
  )
  if (!session) return (
    <div className="min-h-screen bg-cream flex items-center justify-center">
      <p className="text-brown-mute">加载中...</p>
    </div>
  )

  const info         = STATUS_INFO[session.status] ?? { label: session.status, bg: 'bg-[#F5E8DD]', text: 'text-brown-text' }
  const notInWindow  = !session.time_in_window
  const isRecitation = session.session_type === 'recitation'
  const durationMet  = session.status !== 'time_short'
  const pdfMet       = session.pdfs_opened >= session.pdfs_required
  const silenceRatio = session.total_duration_s > 0
    ? session.total_silence_s / session.total_duration_s
    : 1
  const silenceMet   = silenceRatio <= 0.5
  const qualifies    = (durationMet || pdfMet) && silenceMet

  return (
    <div className="min-h-screen bg-cream flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-[480px] bg-white rounded-[24px] p-8
        shadow-[0_4px_24px_rgba(224,122,95,0.12),0_1px_4px_rgba(224,122,95,0.08)]">

        <h1 className="text-[22px] font-black text-brown-text text-center tracking-tight mb-6">
          {isRecitation ? '背诵考核结果' : '朗读完成'}
        </h1>

        {/* Status badge */}
        <div className="flex justify-center mb-7">
          <span className={`${info.bg} ${info.text} text-[15px] font-extrabold px-6 py-2.5 rounded-full`}>
            {info.label}
          </span>
        </div>

        {/* Data table */}
        <div className="flex flex-col">
          <Row label="用户名"   value={childName} />
          <Row label="日期"     value={session.date} />
          <Row label="开始时间" value={fmtHMS(session.start_time)} />
          <Row label="结束时间" value={fmtHMS(session.end_time)} />

          <div className="h-px bg-[#F5E8DD] my-2" />

          <Row label="录音总时长" value={fmtDuration(session.total_duration_s)} />
          {!isRecitation && (
            <Row label="朗读书本" value={`${session.pdfs_opened} / ${session.pdfs_required} 本`}
                 warn={session.pdfs_opened < session.pdfs_required} />
          )}
          <Row label="停顿次数"   value={`${session.silence_count} 次`} />
          <Row label="最长停顿"   value={`${session.max_silence_s} 秒`}
               warn={session.max_silence_s > 15} />
          <Row label="累计静音"   value={`${session.total_silence_s} 秒`} />
          <Row label="打卡时间内" value={notInWindow ? '否 ✗' : '是 ✓'} warn={notInWindow} />
          <Row label="静音比例"   value={`${(silenceRatio * 100).toFixed(0)}%`}
               warn={silenceRatio > 0.5} />
        </div>

        <p className="text-brown-mute text-[13px] text-center mt-6 leading-relaxed">
          家长可在首页家长入口查看并审核此次朗读
        </p>

        {qualifies && (
          <div className="bg-gradient-to-br from-peach to-peach-deep rounded-[20px] p-6 mt-5
            shadow-[0_4px_24px_rgba(224,122,95,0.3)]">
            <p className="text-white text-[15px] font-extrabold mb-4 leading-relaxed">
              {encouragement}
            </p>
            <button
              onClick={() => navigate(`/game/${eggGameId}`, { replace: true })}
              className="bg-white text-peach-deep w-full font-extrabold text-[16px] py-4 rounded-[14px]
                hover:scale-[1.02] active:scale-[0.98] transition-transform"
            >
              🎁 解锁今日彩蛋
            </button>
          </div>
        )}

        <button
          onClick={() => navigate('/', { replace: true })}
          className="w-full mt-4 bg-peach text-white font-extrabold rounded-[14px] py-3.5 text-[16px]
            active:scale-[0.98] transition-transform"
        >
          返回首页
        </button>
      </div>
    </div>
  )
}
