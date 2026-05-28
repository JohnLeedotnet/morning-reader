import { useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { adminFetch } from '../lib/adminFetch'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

interface PdfRead {
  pdf_filename: string
  pdf_library_id?: number | null
  pages_turned: number
  completed: number
}

interface PageEvent {
  pdf_filename: string
  page_number: number
  timestamp: string
  is_dual: number
}

interface Props {
  sessionId: number
  audioElement?: HTMLAudioElement | null
  mode?: 'reading' | 'recitation'
}

// Event-level dual mode: find the closest matching event for this pdf+page
function getShowDual(pdf: string | null, page: number, events: PageEvent[]): boolean {
  if (!pdf) return false
  const exact = events.find(e => e.pdf_filename === pdf && e.page_number === page)
  if (exact) return exact.is_dual === 1
  const candidates = events
    .filter(e => e.pdf_filename === pdf && e.page_number <= page)
    .sort((a, b) => b.page_number - a.page_number)
  if (candidates[0]) return candidates[0].is_dual === 1
  const all = events.filter(e => e.pdf_filename === pdf)
  if (all.length === 0) return false
  return all.filter(e => e.is_dual === 1).length > all.length / 2
}

export default function PdfReviewer({ sessionId, audioElement, mode = 'reading' }: Props) {
  const [pdfReads,    setPdfReads]   = useState<PdfRead[]>([])
  const [pageEvents,  setPageEvents] = useState<PageEvent[]>([])
  const [activePdf,   setActivePdf]  = useState<string | null>(null)
  const [childId,     setChildId]    = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [numPages,    setNumPages]   = useState(0)
  const [autoFollow,  setAutoFollow] = useState(true)
  const [manualOverride, setManualOverride] = useState(false)
  const [annotations,   setAnnotations]  = useState<Array<{ id: number; message: string; pos_x: number | null; pos_y: number | null; color: string }>>([])
  const [annotMode,     setAnnotMode]    = useState(false)
  const [activeTool,    setActiveTool]   = useState<'text' | null>(null)
  const [annotColor,    setAnnotColor]   = useState('#E07A5F')
  const [deleteMode,    setDeleteMode]   = useState(false)
  const [pendingPos,    setPendingPos]   = useState<{ x: number; y: number } | null>(null)
  const [pendingText,   setPendingText]  = useState('')

  // Window size for stable, content-independent page width calculation
  const [winW, setWinW] = useState(window.innerWidth)
  const [winH, setWinH] = useState(window.innerHeight)
  const [aspectRatio, setAspectRatio] = useState(0.707)
  const [totalDurationS, setTotalDurationS] = useState(0)
  const [recordingStartTime, setRecordingStartTime] = useState<string | null>(null)
  const [syncOffsetMs, setSyncOffsetMs] = useState(1500)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerW, setContainerW] = useState(0)

  useEffect(() => {
    const h = () => { setWinW(window.innerWidth); setWinH(window.innerHeight) }
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(e => setContainerW(e[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    adminFetch(`/api/admin/sessions/${sessionId}`)
      .then(r => r.json())
      .then(data => {
        setChildId(data.child_id ?? null)
        setTotalDurationS(data.total_duration_s ?? 0)
        setRecordingStartTime(data.recording_start_time || data.start_time || null)
        if (mode === 'recitation') {
          const filename = data.recitation_pdf ?? null
          const libId = data.recitation_library_id ?? null
          if (filename) {
            // Hotfix 6: 注入 library_id，让 activeLibId 派生逻辑能命中 → 走 /api/library/:id/file
            setPdfReads([{ pdf_filename: filename, pdf_library_id: libId, pages_turned: 0, completed: 0 }])
            setActivePdf(filename)
          }
          setPageEvents([])
        } else {
          setPdfReads(data.pdf_reads ?? [])
          setPageEvents(data.page_events ?? [])
          if (data.pdf_reads?.[0]) setActivePdf(data.pdf_reads[0].pdf_filename)
        }
      })
      .catch(console.error)
  }, [sessionId, mode])

  // manualOverride → disable autoFollow
  useEffect(() => {
    if (manualOverride) setAutoFollow(false)
  }, [manualOverride])

  // Auto-follow: 50ms interval for tight sync (avoids ~250ms timeupdate lag)
  useEffect(() => {
    if (!autoFollow || !audioElement || pageEvents.length === 0 || !recordingStartTime) return
    const sessionStartMs = new Date(recordingStartTime).getTime()
    const recordedMs = totalDurationS * 1000
    const audioMs = audioElement.duration > 0 && isFinite(audioElement.duration)
      ? audioElement.duration * 1000
      : recordedMs
    const startupDelayMs = Math.max(0, Math.min(500, recordedMs - audioMs))
    const anchorMs = sessionStartMs + startupDelayMs
    const handleTick = () => {
      if (audioElement.paused) return
      const currentWallMs = anchorMs + audioElement.currentTime * 1000 + syncOffsetMs
      let lastEvent: PageEvent | null = null
      for (const e of pageEvents) {
        if (new Date(e.timestamp).getTime() <= currentWallMs) lastEvent = e
        else break
      }
      if (lastEvent) {
        setActivePdf(lastEvent.pdf_filename)
        setCurrentPage(lastEvent.page_number)
      }
    }
    const interval = setInterval(handleTick, 50)
    return () => clearInterval(interval)
  }, [autoFollow, audioElement, pageEvents, recordingStartTime, totalDurationS, syncOffsetMs])

  const handleAutoFollowChange = (checked: boolean) => {
    setAutoFollow(checked)
    if (checked) setManualOverride(false)
  }

  const switchPdf = (filename: string) => {
    setActivePdf(filename)
    setCurrentPage(1)
    setNumPages(0)
    setManualOverride(true)
  }

  const isNarrow = winW < 768
  const showDualFromEvent = getShowDual(activePdf, currentPage, pageEvents)
  const showDual = showDualFromEvent
  const dualLayout: 'horizontal' | 'vertical' = isNarrow ? 'vertical' : 'horizontal'

  const pageWidth = (() => {
    const effW = containerW > 0
      ? containerW
      : (isNarrow ? winW - 80 : Math.min(winW - 120, 1200))
    const safeH = winH * 0.55
    const isVerticalDual = showDual && currentPage > 1 && isNarrow
    const count = (showDual && currentPage > 1 && !isVerticalDual) ? 2 : 1
    const gap = count > 1 ? 16 : 0
    const widthBased = (effW - gap) / count
    const heightBased = isVerticalDual
      ? (safeH / 2) * aspectRatio
      : safeH * aspectRatio
    return Math.max(120, Math.min(widthBased, heightBased))
  })()

  function goNext() {
    setCurrentPage(p => {
      if (showDual) {
        if (p === 1) return Math.min(numPages, 2)
        return Math.min(numPages, p + 2)
      }
      return Math.min(numPages, p + 1)
    })
    setManualOverride(true)
  }

  function goPrev() {
    setCurrentPage(p => {
      if (showDual) {
        if (p === 2) return 1
        return Math.max(1, p - 2)
      }
      return Math.max(1, p - 1)
    })
    setManualOverride(true)
  }

  // Keyboard ← → navigation
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goNext() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [currentPage, numPages, showDual])

  // Load annotations for current page (Sprint 3A)
  useEffect(() => {
    const libId = activePdf
      ? (pdfReads.find(r => r.pdf_filename === activePdf)?.pdf_library_id ?? null)
      : null
    if (!libId) { setAnnotations([]); return }
    adminFetch(`/api/admin/annotations?library_id=${libId}&page=${currentPage}`)
      .then(r => r.ok ? r.json() : [])
      .then(setAnnotations)
      .catch(() => setAnnotations([]))
  }, [activePdf, pdfReads, currentPage])

  const saveAnnotation = async () => {
    const libId = activePdf
      ? (pdfReads.find(r => r.pdf_filename === activePdf)?.pdf_library_id ?? null)
      : null
    if (!pendingText.trim() || !libId || !pendingPos) return
    const res = await adminFetch('/api/admin/annotations', {
      method: 'POST',
      body: JSON.stringify({
        pdf_library_id: libId, page_number: currentPage, message: pendingText.trim(),
        session_id: sessionId, pos_x: pendingPos.x, pos_y: pendingPos.y, color: annotColor,
      }),
    })
    if (res.ok) {
      const c = await res.json()
      setAnnotations(prev => [...prev, { id: c.id, message: c.message, pos_x: c.pos_x, pos_y: c.pos_y, color: c.color }])
      setPendingPos(null); setPendingText('')
    }
  }

  const deleteAnnotation = async (id: number) => {
    const res = await adminFetch(`/api/admin/annotations/${id}`, { method: 'DELETE' })
    if (res.ok) setAnnotations(prev => prev.filter(a => a.id !== id))
  }

  // Touch swipe navigation
  const touchStartX = useRef(0)
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? 0
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current
    if (dx > 50) goPrev()
    else if (dx < -50) goNext()
  }

  const pageLabel = showDual && currentPage > 1
    ? `第 ${currentPage}-${Math.min(currentPage + 1, numPages)} 页${isNarrow ? '（上下）' : ''} / 共 ${numPages || '?'} 页`
    : `第 ${currentPage} 页 / 共 ${numPages || '?'} 页`

  if (pdfReads.length === 0) {
    return <p className="text-brown-mute text-sm text-center py-4">无 PDF 阅读记录</p>
  }

  // Sprint 0B Hotfix: 优先用 library_id 走 /api/library，老 session fallback 旧路径
  const activeLibId = activePdf
    ? pdfReads.find(r => r.pdf_filename === activePdf)?.pdf_library_id ?? null
    : null
  const pdfFileUrl = !activePdf ? null
    : activeLibId ? `/api/library/${activeLibId}/file`
    : childId ? `/api/children/${childId}/pdfs/file?path=${encodeURIComponent(activePdf)}`
    : `/api/pdfs/file?path=${encodeURIComponent(activePdf)}`

  return (
    <div className="flex flex-col gap-3">
      {mode === 'reading' && (
        <>
          {/* PDF tab chips */}
          <div className="flex flex-wrap gap-2">
            {pdfReads.map(p => {
              const filename = p.pdf_filename.split('/').pop()?.replace('.pdf', '') ?? p.pdf_filename
              const statusIcon = p.completed ? '✓' : p.pages_turned > 1 ? '⚠' : '✗'
              const isActive = activePdf === p.pdf_filename
              return (
                <button key={p.pdf_filename} onClick={() => switchPdf(p.pdf_filename)}
                  className={`px-3 py-1.5 rounded-[10px] text-xs font-extrabold transition-colors
                    ${isActive ? 'bg-peach text-white' : 'bg-cream text-brown-mute hover:bg-cream-card'}`}>
                  {statusIcon} {filename}
                </button>
              )
            })}
          </div>

          {/* Auto-follow toggle + page counter */}
          <div className="flex items-center justify-between text-xs">
            <label className="flex items-center gap-2 text-brown-mute font-bold cursor-pointer">
              <input type="checkbox" checked={autoFollow} onChange={e => handleAutoFollowChange(e.target.checked)}
                className="w-4 h-4 accent-peach" />
              🔄 跟随录音自动翻页
            </label>
            <span className="text-[#9A7060]">{pageLabel}</span>
          </div>

          {/* Sync offset slider */}
          <div className="flex items-center justify-between text-xs mt-1">
            <span className="text-brown-mute font-bold shrink-0">提前同步</span>
            <div className="flex items-center gap-2 flex-1 ml-3">
              <input type="range" min={0} max={4000} step={100}
                value={syncOffsetMs}
                onChange={e => setSyncOffsetMs(Number(e.target.value))}
                className="flex-1 accent-peach" />
              <span className="text-brown-text font-extrabold tabular-nums w-14 text-right">
                {(syncOffsetMs / 1000).toFixed(1)}s
              </span>
            </div>
          </div>
        </>
      )}
      {mode === 'recitation' && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-brown-mute">背诵书目：<span className="font-extrabold text-brown-text">{activePdf?.split('/').pop()?.replace('.pdf', '')}</span></span>
          <span className="text-[#9A7060]">{pageLabel}</span>
        </div>
      )}

      {/* PDF viewer — annotation button + toolbar + viewer */}
      <div className="relative">
        {/* 批注按钮（右上角） */}
        {activeLibId && (
          <button
            onClick={() => { setAnnotMode(m => !m); setActiveTool(null); setDeleteMode(false); setPendingPos(null) }}
            className={`absolute top-2 right-2 z-20 px-3 py-1.5 rounded-[10px] text-xs font-extrabold shadow-md
              ${annotMode ? 'bg-peach text-white' : 'bg-white text-brown-text'}`}>
            ✏️ 批注
          </button>
        )}

        {/* 工具栏 */}
        {annotMode && activeLibId && (
          <div className="absolute top-12 right-2 z-20 bg-white rounded-[12px] shadow-lg p-2 flex flex-col gap-2">
            <div className="flex gap-1.5">
              <button
                onClick={() => { setActiveTool(t => t === 'text' ? null : 'text'); setDeleteMode(false) }}
                className={`w-9 h-9 rounded-lg font-extrabold ${activeTool === 'text' ? 'bg-peach text-white' : 'bg-cream text-brown-text'}`}>
                T
              </button>
              <button disabled title="手绘（即将推出）"
                className="w-9 h-9 rounded-lg bg-cream text-brown-faint opacity-40 cursor-not-allowed">
                ✂
              </button>
              <button
                onClick={() => { setDeleteMode(d => !d); setActiveTool(null) }}
                className={`w-9 h-9 rounded-lg ${deleteMode ? 'bg-red-500 text-white' : 'bg-cream text-brown-text'}`}>
                🗑
              </button>
            </div>
            <div className="flex gap-1.5">
              {['#E07A5F', '#C54B38', '#81B29A', '#4A90D9'].map(c => (
                <button key={c} onClick={() => setAnnotColor(c)}
                  className={`w-7 h-7 rounded-full border-2 ${annotColor === c ? 'border-brown-text' : 'border-transparent'}`}
                  style={{ background: c }} />
              ))}
            </div>
            {showDual && currentPage > 1 && (
              <p className="text-[10px] text-brown-mute w-32">双页模式定位不可用，请切单页批注</p>
            )}
          </div>
        )}

        <div ref={containerRef}
             className="bg-cream-pdf rounded-[14px] overflow-hidden flex items-center justify-center p-2"
             onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {pdfFileUrl && (
            <Document
              file={pdfFileUrl}
              onLoadSuccess={async (doc) => {
                setNumPages(doc.numPages)
                try {
                  const firstPage = await doc.getPage(1)
                  const vp = firstPage.getViewport({ scale: 1 })
                  setAspectRatio(vp.width / vp.height)
                } catch (_) {}
              }}
              loading={<div className="p-8 text-brown-mute text-center text-sm">加载 PDF...</div>}
              error={<div className="p-8 text-red-400 text-center text-sm">PDF 加载失败</div>}
            >
              {showDual && currentPage > 1 ? (
                <div className={`flex gap-2 justify-center items-start ${dualLayout === 'vertical' ? 'flex-col' : ''}`}>
                  <Page pageNumber={currentPage} width={pageWidth}
                    renderTextLayer={false} renderAnnotationLayer={false} />
                  {currentPage + 1 <= numPages && (
                    <Page pageNumber={currentPage + 1} width={pageWidth}
                      renderTextLayer={false} renderAnnotationLayer={false} />
                  )}
                </div>
              ) : (
                <div className="relative inline-block">
                  <Page pageNumber={currentPage} width={pageWidth}
                    renderTextLayer={false} renderAnnotationLayer={false} />
                  {/* 批注 overlay（仅批注模式 + 单页）*/}
                  {annotMode && (
                    <div className="absolute inset-0 cursor-crosshair"
                      onClick={e => {
                        if (activeTool !== 'text' || deleteMode) return
                        const rect = e.currentTarget.getBoundingClientRect()
                        const x = (e.clientX - rect.left) / rect.width
                        const y = (e.clientY - rect.top) / rect.height
                        setPendingPos({ x, y }); setPendingText('')
                      }}>
                      {pendingPos && (
                        <div className="absolute z-10" style={{ left: `${pendingPos.x * 100}%`, top: `${pendingPos.y * 100}%` }}>
                          <input autoFocus value={pendingText} onChange={e => setPendingText(e.target.value)}
                            onClick={e => e.stopPropagation()}
                            onKeyDown={e => { if (e.key === 'Enter') saveAnnotation() }}
                            placeholder="输入提示…"
                            className="text-xs bg-white border-2 border-peach rounded px-2 py-1 shadow-lg w-40" />
                        </div>
                      )}
                    </div>
                  )}
                  {/* 已有定位气泡（始终显示）*/}
                  {annotations.filter(a => a.pos_x != null && a.pos_y != null).map(a => (
                    <div key={a.id} className="absolute z-[5] -translate-x-1/2 -translate-y-1/2"
                      style={{ left: `${a.pos_x! * 100}%`, top: `${a.pos_y! * 100}%` }}
                      onClick={e => { e.stopPropagation(); if (deleteMode) deleteAnnotation(a.id) }}>
                      <span className="inline-block text-[11px] font-bold text-white px-2 py-0.5 rounded-full shadow-md whitespace-nowrap"
                        style={{ background: a.color }}>
                        {deleteMode ? '🗑 ' : ''}{a.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Document>
          )}
        </div>
      </div>

      {/* Manual page navigation */}
      <div className="flex items-center justify-center gap-3">
        <button onClick={goPrev} disabled={currentPage <= 1}
          className="bg-shell-dark text-white text-[13px] font-extrabold px-4 py-2 rounded-[10px]
            disabled:opacity-30 hover:bg-shell-darker transition-colors">
          ← 上一页
        </button>
        <button onClick={goNext} disabled={!numPages || currentPage >= numPages}
          className="bg-shell-dark text-white text-[13px] font-extrabold px-4 py-2 rounded-[10px]
            disabled:opacity-30 hover:bg-shell-darker transition-colors">
          下一页 →
        </button>
      </div>
    </div>
  )
}
