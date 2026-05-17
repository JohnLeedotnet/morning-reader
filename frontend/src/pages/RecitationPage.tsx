import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useReadingRecorder } from '../hooks/useReadingRecorder'

interface Child  { id: string; name: string; font_scale: number }
interface Plan   { id: number; pdf_filename: string; status: string }
interface Config { window_start: string; window_end: string; min_duration_s: string; max_consecutive_silence_s: string }

function getCurrentHHMM() {
  const d = new Date()
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
}

function fmtTime(s: number) {
  return `${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}`
}

function WaveformCanvas({ analyserNode }: { analyserNode: AnalyserNode | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef    = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const W = canvas.width, H = canvas.height

    if (!analyserNode) {
      ctx.fillStyle = '#4A3020'
      ctx.fillRect(0, 0, W, H)
      ctx.strokeStyle = '#7A5030'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke()
      return
    }

    const dataArray = new Uint8Array(analyserNode.frequencyBinCount)
    const BARS = 60
    const step  = Math.max(1, Math.floor(dataArray.length / BARS))
    const barW  = W / BARS

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      analyserNode.getByteTimeDomainData(dataArray)
      ctx.fillStyle = '#4A3020'
      ctx.fillRect(0, 0, W, H)
      for (let i = 0; i < BARS; i++) {
        const amp = Math.abs((dataArray[i * step] - 128) / 128)
        const barH = Math.max(2, amp * H * 0.9)
        ctx.globalAlpha = 0.85
        ctx.fillStyle = '#E07A5F'
        ctx.fillRect(i * barW, (H - barH) / 2, barW - 1, barH)
      }
      ctx.globalAlpha = 1
    }
    draw()
    return () => cancelAnimationFrame(rafRef.current)
  }, [analyserNode])

  return <canvas ref={canvasRef} width={600} height={48} className="w-full h-12 rounded-[10px]" />
}

export default function RecitationPage() {
  const { childId } = useParams<{ childId: string }>()
  const navigate    = useNavigate()

  const [child,        setChild]        = useState<Child | null>(null)
  const [plan,         setPlan]         = useState<Plan | null>(null)
  const [config,       setConfig]       = useState<Config | null>(null)
  const [sessionId,    setSessionId]    = useState<number | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error,        setError]        = useState('')
  const [noplan,       setNoplan]       = useState(false)
  const [nowHHMM,      setNowHHMM]      = useState(getCurrentHHMM)

  useEffect(() => {
    const t = setInterval(() => setNowHHMM(getCurrentHHMM()), 60_000)
    return () => clearInterval(t)
  }, [])

  const sessionStartedRef = useRef(false)

  useEffect(() => {
    if (!childId || sessionStartedRef.current) return
    sessionStartedRef.current = true
    Promise.all([
      fetch(`/api/children/${childId}`).then(r => r.json()),
      fetch(`/api/children/${childId}/today-recitation`).then(r => r.json()),
      fetch('/api/config').then(r => r.json()),
    ]).then(([childData, planData, cfg]) => {
      setChild(childData)
      setConfig(cfg)
      if (!planData || planData.status !== 'scheduled') {
        setNoplan(true)
        return Promise.resolve(null)
      }
      setPlan(planData)
      return fetch('/api/recitation/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ child_id: childId }),
      }).then(r => r.json())
    }).then(data => {
      if (data?.session_id) setSessionId(data.session_id)
    }).catch(e => setError((e as Error).message))
  }, [childId])

  const maxSilenceS = config ? parseInt(config.max_consecutive_silence_s) : 15
  const recorder    = useReadingRecorder({ maxConsecutiveSilenceS: maxSilenceS })

  const handleStart = async () => {
    try { await recorder.start() }
    catch (e) { setError(`麦克风错误：${(e as Error).message}`) }
  }

  const handleSubmit = async () => {
    if (!sessionId || isSubmitting) return
    setIsSubmitting(true)
    try {
      const { blob, metrics } = await recorder.stopAndGetResult()
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm'
      const fd = new FormData()
      fd.append('recording', blob, `rec.${ext}`)
      fd.append('metrics', JSON.stringify(metrics))
      const res = await fetch(`/api/recitation/${sessionId}/complete`, { method: 'POST', body: fd })
      const data = await res.json()
      if (data.discarded) {
        navigate('/discarded', {
          state: {
            reason: data.reason,
            total_duration_s: data.total_duration_s,
            silence_ratio: data.silence_ratio,
            childName: child?.name ?? '',
            isRecitation: true,
          },
          replace: true,
        })
        return
      }
      navigate(`/result/${data.id}`, { replace: true })
    } catch (e) {
      setError((e as Error).message)
      setIsSubmitting(false)
    }
  }

  const fontScale  = child?.font_scale ?? 1.0
  const namePx     = Math.round(20 * fontScale)
  const btnTextPx  = Math.round(13 * fontScale)
  const bookTitle  = plan?.pdf_filename.split('/').pop()?.replace('.pdf', '') ?? ''
  const inWindow   = config ? (nowHHMM >= config.window_start && nowHHMM < config.window_end) : null
  const halfMin    = config ? Math.floor(parseInt(config.min_duration_s) / 2) : 150
  const remainingS = Math.max(0, halfMin - recorder.durationS)

  const voiceColor = recorder.voiceStatus === 'long_pause' ? 'text-red-400' : recorder.voiceStatus === 'too_quiet' ? 'text-yellow-400' : 'text-mint'
  const voiceLabel = recorder.voiceStatus === 'long_pause' ? '⚠ 停顿过长' : recorder.voiceStatus === 'too_quiet' ? '声音太小' : '声音正常'

  if (error) return (
    <div className="min-h-screen bg-cream flex items-center justify-center p-8">
      <p className="text-red-500 text-sm">{error}</p>
    </div>
  )
  if (!child || !config) return (
    <div className="min-h-screen bg-cream flex items-center justify-center">
      <p className="text-brown-mute">加载中...</p>
    </div>
  )
  if (noplan) return (
    <div className="min-h-screen bg-cream flex flex-col items-center justify-center gap-4 p-8">
      <p className="text-brown-mute">今日没有安排背诵考核</p>
      <button onClick={() => navigate('/')} className="text-peach underline text-sm font-bold">返回首页</button>
    </div>
  )

  return (
    <div className="h-screen bg-cream flex flex-col items-center justify-center p-4 overflow-hidden">
      <div
        className="w-full max-w-[720px] rounded-[28px] overflow-hidden
          shadow-[0_24px_80px_rgba(61,43,31,0.22),0_4px_16px_rgba(61,43,31,0.10)]
          flex flex-col select-none"
        style={{ height: 'calc(100vh - 2rem)' }}
      >
        {/* Status bar */}
        <div className="bg-shell-dark flex items-center justify-between px-4 py-3 shrink-0 gap-2">
          <span className="font-black text-[#F5E8DD] shrink-0 leading-tight" style={{ fontSize: namePx }}>
            {child.name}
          </span>
          <div className="flex-1 text-center min-w-0 px-2">
            <p className="text-[12px] text-[#C09A80] font-bold">背诵考核</p>
          </div>
          <div className="text-right shrink-0">
            <span className={`block text-[20px] font-black tabular-nums ${remainingS === 0 ? 'text-mint' : 'text-white'}`}>
              {remainingS === 0 ? '已达标' : fmtTime(remainingS)}
            </span>
            {inWindow !== null && (
              <span className={`text-[11px] font-bold ${inWindow ? 'text-mint' : 'text-yellow-400'}`}>
                {inWindow ? '✓ 打卡时间' : '⚠ 时间窗外'}
              </span>
            )}
          </div>
        </div>

        {/* Main content */}
        <div className="bg-cream-pdf flex-1 flex flex-col items-center justify-center gap-6 p-8">
          <div className="text-[56px] leading-none">📚</div>
          <div className="text-center">
            <p className="text-brown-mute text-base font-bold mb-3">背诵考核</p>
            <h2 className="text-3xl font-extrabold text-brown-text mb-4">《{bookTitle}》</h2>
            <p className="text-brown-mute text-sm">请按封面背诵全文</p>
          </div>
        </div>

        {/* Record button zone */}
        <div className="bg-shell-dark py-5 flex justify-center items-center shrink-0">
          <div className="relative flex items-center justify-center">
            {recorder.isRecording && (
              <div className="absolute w-28 h-28 rounded-full bg-peach/25 animate-ping" />
            )}
            {!recorder.isRecording ? (
              <button
                onClick={handleStart}
                disabled={isSubmitting || !sessionId}
                className="w-[84px] h-[84px] rounded-full
                  bg-gradient-to-br from-peach to-[#C05030]
                  shadow-[0_6px_24px_rgba(224,122,95,0.55)]
                  border-2 border-white/20
                  text-white font-extrabold
                  flex flex-col items-center justify-center
                  active:scale-95 transition-transform disabled:opacity-40"
                style={{ fontSize: btnTextPx }}
              >
                开始<br />背诵
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="w-[84px] h-[84px] rounded-full
                  bg-gradient-to-br from-peach to-[#C05030]
                  shadow-[0_6px_24px_rgba(224,122,95,0.55)]
                  border-2 border-white/20
                  text-white font-extrabold
                  flex flex-col items-center justify-center
                  active:scale-95 transition-transform disabled:opacity-60
                  relative z-10"
                style={{ fontSize: btnTextPx }}
              >
                停止并<br />提交
              </button>
            )}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="bg-shell-darker px-4 pt-3 pb-4 shrink-0">
          <WaveformCanvas analyserNode={recorder.analyserNode} />
          <div className="flex justify-between items-center mt-2">
            <span className="text-[11px] text-[#9A7060] font-bold tabular-nums">
              {fmtTime(recorder.durationS)}
            </span>
            <span className={`text-[11px] font-bold ${voiceColor}`}>{voiceLabel}</span>
            <span className="text-[11px] text-[#9A7060] font-bold">
              停顿 {recorder.silenceCount} 次 · {Math.round(recorder.totalSilenceS)}s
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
