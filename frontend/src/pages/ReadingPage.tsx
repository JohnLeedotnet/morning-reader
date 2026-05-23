import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Document, Page, pdfjs } from 'react-pdf'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { useReadingRecorder } from '../hooks/useReadingRecorder'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

interface PoolEntry { id: number; child_id: string; library_id: number; sha256?: string; pdf_filename: string; sort_order?: number }
interface Child    { id: string; name: string; age: number; font_scale: number; min_duration_s?: number | null }
interface Config   {
  window_start: string; window_end: string
  min_duration_s: string; max_consecutive_silence_s: string
}

function getCurrentHHMM() {
  const d = new Date()
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
}

function fmtTime(s: number) {
  return `${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}`
}

// ── Waveform canvas ───────────────────────────────────────────────────────────

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

  return <canvas ref={canvasRef} width={600} height={24} className="w-full h-6 rounded-[8px]" />
}

// ── Page indicator dots ───────────────────────────────────────────────────────

function PageDots({ numPages, page }: { numPages: number; page: number }) {
  if (numPages <= 1) return null
  const count = Math.min(numPages, 10)
  const offset = numPages <= 10 ? 0 : Math.max(0, Math.min(page - 5, numPages - 10))
  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 pointer-events-none">
      {Array.from({ length: count }, (_, i) => {
        const active = (offset + i) === page - 1
        return (
          <div key={i}
            className={`h-1.5 rounded-full transition-all duration-200
              ${active ? 'w-5 bg-peach' : 'w-1.5 bg-cream-card'}`} />
        )
      })}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ReadingPage() {
  const { childId } = useParams<{ childId: string }>()
  const navigate    = useNavigate()

  const [child,        setChild]        = useState<Child | null>(null)
  const [pool,         setPool]         = useState<PoolEntry[]>([])
  const [config,       setConfig]       = useState<Config | null>(null)
  const [sessionId,    setSessionId]    = useState<number | null>(null)
  const [pdfIdx,       setPdfIdx]       = useState(0)
  const [page,         setPage]         = useState(1)
  const [numPages,     setNumPages]     = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error,        setError]        = useState('')
  const [nowHHMM,      setNowHHMM]      = useState(getCurrentHHMM)
  const [aspectRatio,  setAspectRatio]  = useState(0.707)  // PDF page w/h, default A4 portrait

  // PDF zoom + layout preferences (persisted per child)
  const [pdfZoom, setPdfZoom] = useState(() => {
    const stored = localStorage.getItem(`pdfZoom:${childId ?? 'default'}`)
    return stored ? Math.max(0.5, Math.min(2.0, parseFloat(stored))) : 1.0
  })
  const [pdfLayout, setPdfLayout] = useState<'auto' | 'single'>(() => {
    return (localStorage.getItem(`pdfLayout:${childId ?? 'default'}`) as 'auto' | 'single') || 'auto'
  })
  const [eyeStripes, setEyeStripes] = useState<boolean>(() => {
    return localStorage.getItem(`eyeStripes:${childId ?? 'default'}`) === '1'
  })

  // ── Responsive window width ───────────────────────────────────────────────
  const [winWidth, setWinWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const h = () => setWinWidth(window.innerWidth)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])

  useEffect(() => {
    if (childId) localStorage.setItem(`pdfZoom:${childId}`, String(pdfZoom))
  }, [pdfZoom, childId])
  useEffect(() => {
    if (childId) localStorage.setItem(`pdfLayout:${childId}`, pdfLayout)
  }, [pdfLayout, childId])
  useEffect(() => {
    if (childId) localStorage.setItem(`eyeStripes:${childId}`, eyeStripes ? '1' : '0')
  }, [eyeStripes, childId])

  // ── PDF area ResizeObserver ───────────────────────────────────────────────
  const pdfAreaRef   = useRef<HTMLDivElement>(null)
  const [pdfAreaW,   setPdfAreaW] = useState(() => window.innerWidth - 64)
  const [pdfAreaH,   setPdfAreaH] = useState(() => Math.max(300, window.innerHeight - 300))
  useEffect(() => {
    const el = pdfAreaRef.current
    if (!el) return
    const ro = new ResizeObserver(e => {
      setPdfAreaW(e[0].contentRect.width)
      setPdfAreaH(e[0].contentRect.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [child, config, pool.length])

  // ── Derived layout ────────────────────────────────────────────────────────
  // Dual page: user didn't force single, not on cover, and screen wide enough
  const showDualPage = pdfLayout !== 'single' && page !== 1 && winWidth >= 768

  // Frame max-width class
  const frameMaxW =
      winWidth >= 1280 ? 'max-w-[min(95vw,2200px)]'
    : winWidth >= 768  ? 'max-w-[720px]'
    : 'max-w-[440px]'

  // Page width: always min(width-based, height-based) so pages are never clipped
  const pageWidth = (() => {
    if (pdfAreaW <= 0 || pdfAreaH <= 0) return showDualPage ? 600 : 400
    const count = showDualPage ? 2 : 1
    const gap   = showDualPage ? 24 : 0
    const widthBased  = (pdfAreaW - gap) / count
    const heightBased = (pdfAreaH - 24) * aspectRatio
    return Math.max(200, Math.min(widthBased, heightBased))
  })()
  const finalPageWidth = pageWidth * pdfZoom

  // Reset to page 1 when user toggles layout preference
  const prevLayout = useRef(pdfLayout)
  useEffect(() => {
    if (prevLayout.current !== pdfLayout) {
      setPage(1); prevLayout.current = pdfLayout
    }
  }, [pdfLayout])

  // ── Recorder ─────────────────────────────────────────────────────────────
  const maxSilenceS = config ? parseInt(config.max_consecutive_silence_s) : 15
  const recorder    = useReadingRecorder({ maxConsecutiveSilenceS: maxSilenceS })

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setNowHHMM(getCurrentHHMM()), 60_000)
    return () => clearInterval(t)
  }, [])

  const sessionStartedRef = useRef(false)

  // Load everything
  useEffect(() => {
    if (!childId || sessionStartedRef.current) return
    sessionStartedRef.current = true
    Promise.all([
      fetch(`/api/children/${childId}`).then(r => r.json()),
      fetch(`/api/children/${childId}/pool`).then(r => r.json()),
      fetch('/api/config').then(r => r.json()),
    ]).then(([childData, poolData, cfg]) => {
      setChild(childData)
      setPool(poolData)
      setConfig(cfg)
      return fetch('/api/sessions/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ child_id: childId }),
      }).then(r => r.json())
    }).then(({ session_id }) => {
      setSessionId(session_id)
    }).catch(e => setError((e as Error).message))
  }, [childId])

  // Report first PDF once session ready
  useEffect(() => {
    if (sessionId === null || pool.length === 0) return
    fetch(`/api/sessions/${sessionId}/pdf-opened`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdf_library_id: pool[0].library_id, pdf_filename: pool[0].pdf_filename, page_number: 1, is_dual: false, client_timestamp: new Date().toISOString() }),
    }).catch(console.error)
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stable nav callbacks ──────────────────────────────────────────────────
  const S = useRef({ pool, pdfIdx, page, numPages, sessionId })
  S.current = { pool, pdfIdx, page, numPages, sessionId }

  const reportPdf = (entry: PoolEntry | undefined, sid: number | null, reachedLast = false, currentPage = 1, isDual = false) => {
    if (!sid || !entry) return
    const client_timestamp = new Date().toISOString()
    fetch(`/api/sessions/${sid}/pdf-opened`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pdf_library_id: entry.library_id,
        pdf_filename: entry.pdf_filename,  // 兼容字段
        reached_last: reachedLast,
        page_number: currentPage,
        is_dual: isDual,
        client_timestamp,
      }),
    }).catch(console.error)
  }

  const goNext = useCallback(() => {
    const { pool, pdfIdx, page, numPages, sessionId } = S.current
    if (!pool[pdfIdx]) return
    const userSingle = pdfLayout === 'single'
    const currentlySingle = userSingle || page === 1 || winWidth < 768
    if (page + (currentlySingle ? 1 : 2) <= numPages) {
      const nextPage = page + (currentlySingle ? 1 : 2)
      setPage(nextPage)
      const nextSingle = userSingle || nextPage === 1 || winWidth < 768
      const lastShown = nextSingle ? nextPage : Math.min(nextPage + 1, numPages)
      reportPdf(pool[pdfIdx], sessionId, numPages > 0 && lastShown === numPages, nextPage, !nextSingle)
    } else if (pdfIdx < pool.length - 1) {
      const next = pdfIdx + 1
      setPdfIdx(next); setPage(1); setNumPages(0)
      reportPdf(pool[next], sessionId, false, 1, false)
    }
  }, [winWidth, childId, pdfLayout])

  const goPrev = useCallback(() => {
    const { pool, pdfIdx, page, sessionId } = S.current
    const userSingle = pdfLayout === 'single'
    const currentlySingle = userSingle || page === 1 || winWidth < 768
    const prevPage = Math.max(1, page - (currentlySingle ? 1 : 2))
    if (prevPage === page) return
    setPage(prevPage)
    const prevSingle = userSingle || prevPage === 1 || winWidth < 768
    reportPdf(pool[pdfIdx], sessionId, false, prevPage, !prevSingle)
  }, [winWidth, childId, pdfLayout])

  // Keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'ArrowRight') goNext(); if (e.key === 'ArrowLeft') goPrev() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [goNext, goPrev])

  // Touch swipe
  const touchX = useRef(0)
  const handleTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0].clientX }
  const handleTouchEnd   = (e: React.TouchEvent) => {
    const d = e.changedTouches[0].clientX - touchX.current
    if (d < -50) goNext(); else if (d > 50) goPrev()
  }

  // Click left/right half
  const handlePdfClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    if (e.clientX - r.left < r.width / 2) goPrev(); else goNext()
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  const handleGoHome = () => {
    if (recorder.isRecording) {
      if (!confirm('正在录音中，确定退出？录音不会保存。')) return
    }
    navigate('/')
  }

  // ── Recording ─────────────────────────────────────────────────────────────
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
      const res = await fetch(`/api/sessions/${sessionId}/complete`, { method: 'POST', body: fd })
      const data = await res.json()
      if (data.discarded) {
        navigate('/discarded', {
          state: {
            reason: data.reason,
            total_duration_s: data.total_duration_s,
            silence_ratio: data.silence_ratio,
            childName: child?.name ?? '',
            isRecitation: false,
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

  // ── Other derived values ──────────────────────────────────────────────────
  const currentPdf = pool[pdfIdx]
  const pdfUrl     = currentPdf ? `/api/library/${currentPdf.library_id}/file` : null
  const inWindow   = config ? (nowHHMM >= config.window_start && nowHHMM < config.window_end) : null
  const minDurS    = child?.min_duration_s != null ? child.min_duration_s : (config ? parseInt(config.min_duration_s) : 300)
  const remainingS = Math.max(0, minDurS - recorder.durationS)
  const pdfShort   = currentPdf?.pdf_filename.split('/').pop() ?? ''
  const fontScale  = child?.font_scale ?? 1.0
  const namePx     = Math.round(20 * fontScale)   // status bar name size
  const btnTextPx  = Math.round(13 * fontScale)   // recording button text

  const voiceColor =
    recorder.voiceStatus === 'long_pause' ? 'text-red-400' :
    recorder.voiceStatus === 'too_quiet'  ? 'text-yellow-400' : 'text-mint'
  const voiceLabel =
    recorder.voiceStatus === 'long_pause' ? '⚠ 停顿过长' :
    recorder.voiceStatus === 'too_quiet'  ? '声音太小' : '声音正常'

  // ── Early returns ─────────────────────────────────────────────────────────
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
  if (pool.length === 0) return (
    <div className="min-h-screen bg-cream flex flex-col items-center justify-center gap-4 p-8">
      <p className="text-brown-mute">今日没有安排朗读书目</p>
      <button onClick={() => navigate('/')} className="text-peach underline text-sm font-bold">返回首页</button>
    </div>
  )

  return (
    <div className="h-screen bg-cream flex flex-col items-center justify-center p-4 overflow-hidden">
      <div
        className={`w-full ${frameMaxW} rounded-[28px] overflow-hidden
          shadow-[0_24px_80px_rgba(61,43,31,0.22),0_4px_16px_rgba(61,43,31,0.10)]
          flex flex-col select-none`}
        style={{ height: 'calc(100vh - 2rem)' }}
      >

        {/* ── Status bar ── */}
        <div className="bg-shell-dark flex items-center justify-between px-3 py-1.5 shrink-0 gap-2">
          <button onClick={handleGoHome}
            className="text-[#F5E8DD]/70 hover:text-white text-xl shrink-0 px-1
              active:scale-95 transition-transform"
            aria-label="返回首页">
            ←
          </button>
          <span className="font-black text-[#F5E8DD] shrink-0 leading-tight truncate min-w-0"
                style={{ fontSize: namePx }}>
            {child.name}
          </span>

          <div className="flex-1 text-center min-w-0 px-2">
            <p className="text-[12px] text-[#C09A80] font-bold truncate">{pdfShort}</p>
            <p className="text-[11px] text-[#9A7060] mt-0.5">第 {pdfIdx + 1} 本 / 共 {pool.length} 本</p>
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

        {/* ── PDF zoom / layout toolbar ── */}
        <div className="bg-cream-pdf flex items-center justify-center gap-2 px-3 py-1.5 shrink-0 border-b border-black/5">
          <button
            onClick={() => setPdfZoom(z => Math.max(0.5, +(z - 0.1).toFixed(2)))}
            className="w-8 h-8 rounded-lg bg-shell-dark text-white font-extrabold text-sm
              active:scale-95 transition-transform">−</button>
          <span className="text-xs text-brown-text font-extrabold tabular-nums w-12 text-center">
            {Math.round(pdfZoom * 100)}%
          </span>
          <button
            onClick={() => setPdfZoom(z => Math.min(2.0, +(z + 0.1).toFixed(2)))}
            className="w-8 h-8 rounded-lg bg-shell-dark text-white font-extrabold text-sm
              active:scale-95 transition-transform">+</button>
          <button
            onClick={() => setPdfLayout(p => p === 'single' ? 'auto' : 'single')}
            className={`ml-2 px-3 h-8 rounded-lg text-xs font-extrabold
              ${pdfLayout === 'single' ? 'bg-peach text-white' : 'bg-shell-dark text-white'}
              active:scale-95 transition-transform`}>
            {pdfLayout === 'single' ? '单页' : '双页'}
          </button>
          <button
            onClick={() => setEyeStripes(v => !v)}
            className={`ml-1 px-3 h-8 rounded-lg text-xs font-extrabold
              ${eyeStripes ? 'bg-mint text-white' : 'bg-shell-dark text-white'}
              active:scale-95 transition-transform`}>
            护眼
          </button>
        </div>

        {/* ── PDF area ── */}
        <div
          ref={pdfAreaRef}
          className="bg-cream-pdf flex-1 min-h-[400px] overflow-auto flex items-start justify-center relative cursor-pointer"
          onClick={handlePdfClick}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {pdfUrl && (
            <div className="relative">
              <Document
                file={pdfUrl}
                onLoadError={(err) => console.error('[PDF onLoadError]', err)}
                onSourceError={(err) => console.error('[PDF onSourceError]', err)}
                onLoadSuccess={async (doc) => {
                  setNumPages(doc.numPages); setPage(1)
                  try {
                    const firstPage = await doc.getPage(1)
                    const vp = firstPage.getViewport({ scale: 1 })
                    setAspectRatio(vp.width / vp.height)
                  } catch (_) {}
                  if (doc.numPages === 1) {
                    const { pool: p, pdfIdx: pi, sessionId: sid } = S.current
                    reportPdf(p[pi], sid, true, 1, false)
                  }
                }}
                loading={<div className="text-brown-mute text-sm mt-20">加载 PDF...</div>}
                error={<div className="text-red-400 text-sm mt-20">PDF 加载失败</div>}
              >
                {showDualPage ? (
                  <div className="flex gap-6 justify-center">
                    <Page pageNumber={page}   width={finalPageWidth}
                      renderTextLayer={false} renderAnnotationLayer={false} />
                    {page + 1 <= numPages && (
                      <Page pageNumber={page+1} width={finalPageWidth}
                        renderTextLayer={false} renderAnnotationLayer={false} />
                    )}
                  </div>
                ) : (
                  <Page pageNumber={page} width={finalPageWidth}
                    renderTextLayer={false} renderAnnotationLayer={false} />
                )}
              </Document>
              {eyeStripes && (
                <div
                  className="absolute inset-0 pointer-events-none rounded-[4px]"
                  style={{
                    backgroundImage: 'repeating-linear-gradient(to bottom, rgba(168, 198, 134, 0) 0px, rgba(168, 198, 134, 0) 24px, rgba(168, 198, 134, 0.18) 24px, rgba(168, 198, 134, 0.18) 48px)'
                  }}
                />
              )}
            </div>
          )}

          <PageDots numPages={numPages} page={page} />
        </div>

        {/* ── Record button zone ── */}
        <div className="bg-shell-dark py-2 flex justify-center items-center shrink-0">
          <div className="relative flex items-center justify-center">
            {recorder.isRecording && (
              <div className="absolute w-20 h-20 rounded-full bg-peach/25 animate-ping" />
            )}
            {!recorder.isRecording ? (
              <button
                onClick={handleStart}
                disabled={isSubmitting || !sessionId}
                className="w-[56px] h-[56px] rounded-full
                  bg-gradient-to-br from-peach to-[#C05030]
                  shadow-[0_6px_24px_rgba(224,122,95,0.55)]
                  border-2 border-white/20
                  text-white font-extrabold
                  flex flex-col items-center justify-center
                  active:scale-95 transition-transform disabled:opacity-40"
                style={{ fontSize: btnTextPx }}
              >
                开始<br />朗读
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="w-[56px] h-[56px] rounded-full
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

        {/* ── Bottom bar ── */}
        <div className="bg-shell-darker px-4 pt-1.5 pb-2 shrink-0">
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
