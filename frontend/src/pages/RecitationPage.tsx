import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useReadingRecorder } from '../hooks/useReadingRecorder'

interface Child  { id: string; name: string; font_scale: number }
interface Plan   { id: number; pdf_filename: string; status: string }
interface Config { window_start: string; window_end: string; min_duration_s: string; max_consecutive_silence_s: string }

const CHUNK_SIZE = 1024 * 1024  // 1MB per chunk

function fmtTime(s: number) {
  return `${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}`
}

function WaveformCanvas({ analyserNode, className }: { analyserNode: AnalyserNode | null; className?: string }) {
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

  return <canvas ref={canvasRef} width={600} height={24} className={className ?? 'w-full h-6 rounded-[8px]'} />
}

export default function RecitationPage() {
  const { childId } = useParams<{ childId: string }>()
  const navigate    = useNavigate()

  const [child,        setChild]        = useState<Child | null>(null)
  const [plan,         setPlan]         = useState<Plan | null>(null)
  const [config,       setConfig]       = useState<Config | null>(null)
  const [sessionId,    setSessionId]    = useState<number | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error,        setError]        = useState('')
  const [submitError,  setSubmitError]  = useState('')
  const [noplan,       setNoplan]       = useState(false)
  const blobRef    = useRef<Blob | null>(null)
  const metricsRef = useRef<Record<string, unknown>>({})

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

  const handleGoHome = () => {
    if (recorder.isRecording) {
      if (!confirm('正在录音中，确定退出？录音不会保存。')) return
    }
    navigate('/')
  }

  const handleStart = async () => {
    try { await recorder.start() }
    catch (e) { setError(`麦克风错误：${(e as Error).message}`) }
  }

  const xhrPost = (url: string, fd: FormData, onProgress?: (loaded: number, total: number) => void) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', url)
      xhr.timeout = 90000
      if (onProgress) xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded, e.total) }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)) } catch { reject(new Error('响应解析失败')) }
        } else reject(new Error(`HTTP ${xhr.status}`))
      }
      xhr.onerror = () => reject(new Error('网络中断'))
      xhr.ontimeout = () => reject(new Error('上传超时'))
      xhr.send(fd)
    })

  const uploadRecording = async (blob: Blob, metrics: Record<string, unknown>, sid: number) => {
    setIsSubmitting(true)
    setUploadProgress(0)
    setSubmitError('')
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm'
    try {
      let data: Record<string, unknown>
      if (blob.size <= CHUNK_SIZE) {
        const fd = new FormData()
        fd.append('recording', blob, `rec.${ext}`)
        fd.append('metrics', JSON.stringify(metrics))
        data = await xhrPost(`/api/recitation/${sid}/complete`, fd, (loaded, total) => {
          setUploadProgress(Math.round((loaded / total) * 100))
        })
      } else {
        const totalChunks = Math.ceil(blob.size / CHUNK_SIZE)
        const uploadId = `${sid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        for (let i = 0; i < totalChunks; i++) {
          const chunk = blob.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, blob.size))
          const fd = new FormData()
          fd.append('upload_id', uploadId)
          fd.append('chunk_index', String(i))
          fd.append('total_chunks', String(totalChunks))
          fd.append('chunk', chunk, 'chunk.bin')
          let lastErr: Error | null = null
          for (let retry = 0; retry < 3; retry++) {
            try {
              await xhrPost(`/api/recitation/${sid}/upload-chunk`, fd, (loaded, total) => {
                setUploadProgress(Math.round(((i + (total > 0 ? loaded / total : 0)) / totalChunks) * 100))
              })
              lastErr = null
              break
            } catch (e) {
              lastErr = e as Error
              if (retry < 2) await new Promise(r => setTimeout(r, 1000 * (retry + 1)))
            }
          }
          if (lastErr) throw new Error(`第 ${i + 1}/${totalChunks} 段上传失败（已重试 3 次）：${lastErr.message}`)
        }
        setUploadProgress(99)
        const completeFd = new FormData()
        completeFd.append('upload_id', uploadId)
        completeFd.append('total_chunks', String(totalChunks))
        completeFd.append('ext', ext)
        completeFd.append('metrics', JSON.stringify(metrics))
        data = await xhrPost(`/api/recitation/${sid}/complete-chunked`, completeFd)
      }
      if (data.discarded) {
        blobRef.current = null
        navigate('/discarded', {
          state: { reason: data.reason, total_duration_s: data.total_duration_s, silence_ratio: data.silence_ratio, childName: child?.name ?? '', isRecitation: true },
          replace: true,
        })
        return
      }
      blobRef.current = null
      navigate(`/result/${data.id}`, { replace: true })
    } catch (e) {
      setSubmitError((e as Error).message)
      setUploadProgress(0)
      setIsSubmitting(false)
    }
  }

  const handleSubmit = async () => {
    if (!sessionId || isSubmitting) return
    setIsSubmitting(true)
    setSubmitError('')
    try {
      const { blob, metrics } = await recorder.stopAndGetResult()
      blobRef.current = blob
      metricsRef.current = metrics as unknown as Record<string, unknown>
      uploadRecording(blob, metrics as unknown as Record<string, unknown>, sessionId)
    } catch (e) {
      setSubmitError((e as Error).message)
      setUploadProgress(0)
      setIsSubmitting(false)
    }
  }

  const retryUpload = () => {
    if (!sessionId || !blobRef.current || isSubmitting) return
    uploadRecording(blobRef.current, metricsRef.current, sessionId)
  }

  const fontScale  = child?.font_scale ?? 1.0
  const namePx     = Math.round(20 * fontScale)
  const bookTitle  = plan?.pdf_filename.split('/').pop()?.replace('.pdf', '') ?? ''
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
        <div className="bg-shell-dark flex items-center justify-between px-3 py-1.5 shrink-0 gap-2">
          <button onClick={handleGoHome}
            className="text-[#F5E8DD]/70 hover:text-white text-xl shrink-0 px-1
              active:scale-95 transition-transform"
            aria-label="返回首页">
            ←
          </button>
          <span className="font-black text-[#F5E8DD] shrink-0 leading-tight truncate min-w-0" style={{ fontSize: namePx }}>
            {child.name}
          </span>
          <div className="flex-1 text-center min-w-0 px-2">
            <p className="text-[12px] text-[#C09A80] font-bold">背诵考核</p>
          </div>
          <div className="text-right shrink-0">
            <span className={`block text-[18px] font-black tabular-nums leading-none ${remainingS === 0 ? 'text-mint' : 'text-white'}`}>
              {remainingS === 0 ? '已达标' : fmtTime(remainingS)}
            </span>
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

        {/* ── 合并控制条（播放器风）：圆形按钮 + 横向波形 + 计时 ── */}
        <div className="bg-shell-dark px-3 py-2 flex items-center gap-3 shrink-0">
          <button
            onClick={recorder.isRecording ? handleSubmit : handleStart}
            disabled={isSubmitting || (!recorder.isRecording && !sessionId)}
            className={`w-10 h-10 rounded-full shrink-0 flex items-center justify-center
              ${recorder.isRecording
                ? 'bg-gradient-to-br from-[#C54B38] to-[#9A2F1C] ring-2 ring-white/40 animate-pulse'
                : 'bg-gradient-to-br from-peach to-[#C05030]'}
              shadow-[0_2px_10px_rgba(224,122,95,0.55)]
              border-2 border-white/30
              active:scale-95 transition-transform
              disabled:opacity-40`}
            aria-label={recorder.isRecording ? '停止并提交' : '开始背诵'}
          >
            {recorder.isRecording ? (
              <span className="block w-3 h-3 bg-white rounded-[2px]" />
            ) : (
              <span className="block w-3 h-3 bg-white rounded-full" />
            )}
          </button>

          <div className="flex-1 min-w-0 flex items-center">
            <WaveformCanvas
              analyserNode={recorder.analyserNode}
              className="w-full h-5 opacity-80"
            />
          </div>

          <div className="text-right shrink-0 leading-tight">
            <p className="text-[12px] text-[#F5E8DD] tabular-nums font-extrabold">
              {fmtTime(recorder.durationS)}
            </p>
            <p className={`text-[10px] font-bold ${voiceColor}`}>
              {recorder.isRecording ? voiceLabel : '未开始'}
            </p>
          </div>
        </div>

      {submitError ? (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 py-2 bg-black/80 text-white text-sm font-semibold">
          <span>{submitError}</span>
          <button onClick={retryUpload} className="bg-peach text-white px-3 py-1 rounded-[8px] text-xs font-extrabold active:scale-95">重试</button>
        </div>
      ) : isSubmitting ? (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center py-2 bg-black/60 text-white text-sm font-semibold">
          {uploadProgress > 0 && uploadProgress < 100 ? `上传中 ${uploadProgress}%` : '处理中...'}
        </div>
      ) : null}
      </div>
    </div>
  )
}
