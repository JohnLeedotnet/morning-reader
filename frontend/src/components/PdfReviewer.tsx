import { useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { adminFetch } from '../lib/adminFetch'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const IconT = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={className} fill="currentColor">
    <path d="M2 2 H14 V5 H9.5 V14 H6.5 V5 H2 Z" />
  </svg>
)
const IconPencil = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11.5 2 L14 4.5 L5.5 13 L2 13.5 L2.5 10 Z" />
    <path d="M10 3.5 L12.5 6" />
  </svg>
)
const IconTrash = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 5 L13 5 L12 14 H4 Z" />
    <path d="M6 5 V3 H10 V5" />
    <path d="M6.5 8 V12 M9.5 8 V12" />
    <path d="M2 5 H14" />
  </svg>
)

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
  const [annotations,   setAnnotations]  = useState<Array<{ id: number; message: string; pos_x: number | null; pos_y: number | null; color: string; drawing_svg?: string | null; page_number: number }>>([])
  const [activeTool,    setActiveTool]   = useState<'text' | 'draw' | null>(null)
  const annotColor = '#E07A5F'
  const [deleteMode,    setDeleteMode]   = useState(false)
  const [pendingPos,    setPendingPos]   = useState<{ x: number; y: number } | null>(null)
  const [pendingText,   setPendingText]  = useState('')
  const [currentStroke, setCurrentStroke] = useState<Array<[number, number]>>([])
  const isDrawingRef = useRef(false)
  const [editingId,     setEditingId]    = useState<number | null>(null)
  const [editMessage,   setEditMessage]  = useState('')
  const [editColor,     setEditColor]    = useState('#E07A5F')

  // Drag state (Task C)
  const draggingRef = useRef<{ id: number; startX: number; startY: number; movedPx: number } | null>(null)
  const [, forceRerender] = useState(0)
  const dragVisualRef = useRef<{ id: number; x: number; y: number } | null>(null)

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

  // Load annotations for whole library once; filter by page in render (Task 0)
  useEffect(() => {
    const libId = activePdf
      ? (pdfReads.find(r => r.pdf_filename === activePdf)?.pdf_library_id ?? null)
      : null
    if (!libId) { setAnnotations([]); return }
    adminFetch(`/api/admin/annotations?library_id=${libId}`)
      .then(r => r.ok ? r.json() : [])
      .then(setAnnotations)
      .catch(() => setAnnotations([]))
  }, [activePdf, pdfReads])

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
      setAnnotations(prev => [...prev, { id: c.id, message: c.message, pos_x: c.pos_x, pos_y: c.pos_y, color: c.color, drawing_svg: null, page_number: c.page_number }])
      setPendingPos(null); setPendingText('')
    }
  }

  const deleteAnnotation = async (id: number) => {
    const res = await adminFetch(`/api/admin/annotations/${id}`, { method: 'DELETE' })
    if (res.ok) setAnnotations(prev => prev.filter(a => a.id !== id))
  }

  const patchAnnotation = async (id: number, fields: { message?: string; color?: string; pos_x?: number; pos_y?: number }) => {
    const res = await adminFetch(`/api/admin/annotations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    })
    if (res.ok) {
      const updated = await res.json()
      setAnnotations(prev => prev.map(a => a.id === id ? {
        ...a,
        message: updated.message ?? a.message,
        color: updated.color ?? a.color,
        pos_x: updated.pos_x ?? a.pos_x,
        pos_y: updated.pos_y ?? a.pos_y,
      } : a))
    }
  }

  const saveDrawing = async (stroke: Array<[number, number]>) => {
    const libId = activePdf ? (pdfReads.find(r => r.pdf_filename === activePdf)?.pdf_library_id ?? null) : null
    if (!libId || stroke.length < 2) return
    const res = await adminFetch('/api/admin/annotations', {
      method: 'POST',
      body: JSON.stringify({
        pdf_library_id: libId, page_number: currentPage, message: '',
        session_id: sessionId, pos_x: stroke[0][0], pos_y: stroke[0][1],
        color: annotColor, drawing_svg: JSON.stringify(stroke),
      }),
    })
    if (res.ok) {
      const c = await res.json()
      setAnnotations(prev => [...prev, { id: c.id, message: c.message, pos_x: c.pos_x, pos_y: c.pos_y, color: c.color, drawing_svg: c.drawing_svg, page_number: c.page_number }])
    }
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

      {/* PDF viewer — 常态工具栏 + 容器 */}
      <div className="relative">
        {/* 常态工具栏（右上角 3 个图标）*/}
        {activeLibId && (
          <div className="absolute top-2 right-2 z-20 bg-white/95 rounded-[10px] shadow-md p-1 flex gap-1">
            <button title="文字" aria-label="文字"
              onClick={() => { setActiveTool(t => t === 'text' ? null : 'text'); setDeleteMode(false); setEditingId(null) }}
              className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors
                ${activeTool === 'text' ? 'bg-peach text-white' : 'text-brown-text hover:bg-cream'}`}>
              <IconT />
            </button>
            <button title="手绘" aria-label="手绘"
              onClick={() => { setActiveTool(t => t === 'draw' ? null : 'draw'); setDeleteMode(false); setEditingId(null) }}
              className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors
                ${activeTool === 'draw' ? 'bg-peach text-white' : 'text-brown-text hover:bg-cream'}`}>
              <IconPencil />
            </button>
            <button title="删除" aria-label="删除"
              onClick={() => { setDeleteMode(d => !d); setActiveTool(null); setEditingId(null) }}
              className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors
                ${deleteMode ? 'bg-red-500 text-white' : 'text-brown-text hover:bg-cream'}`}>
              <IconTrash />
            </button>
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
                  {/* overlay 总是渲染；activeTool=null 时 pointer-events-none 不挡 */}
                  <div className={`absolute inset-0 touch-none ${activeTool ? 'cursor-crosshair' : 'pointer-events-none'}`}
                    onClick={e => {
                      if (activeTool !== 'text' || deleteMode) return
                      const rect = e.currentTarget.getBoundingClientRect()
                      const x = (e.clientX - rect.left) / rect.width
                      const y = (e.clientY - rect.top) / rect.height
                      setPendingPos({ x, y }); setPendingText('')
                    }}
                    onPointerDown={e => {
                      if (activeTool !== 'draw' || deleteMode) return
                      const rect = e.currentTarget.getBoundingClientRect()
                      isDrawingRef.current = true
                      setCurrentStroke([[(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height]])
                      ;(e.target as Element).setPointerCapture(e.pointerId)
                    }}
                    onPointerMove={e => {
                      if (!isDrawingRef.current || activeTool !== 'draw') return
                      const rect = e.currentTarget.getBoundingClientRect()
                      const nx = (e.clientX - rect.left) / rect.width
                      const ny = (e.clientY - rect.top) / rect.height
                      setCurrentStroke(prev => {
                        const last = prev[prev.length - 1]
                        if (last && Math.hypot(nx - last[0], ny - last[1]) < 0.005) return prev
                        return [...prev, [nx, ny]]
                      })
                    }}
                    onPointerUp={() => {
                      if (!isDrawingRef.current) return
                      isDrawingRef.current = false
                      if (currentStroke.length >= 2) saveDrawing(currentStroke)
                      setCurrentStroke([])
                    }}>
                    {/* 待输入文字定位框 */}
                    {pendingPos && (
                      <div className="absolute z-10" style={{ left: `${pendingPos.x * 100}%`, top: `${pendingPos.y * 100}%` }}>
                        <input autoFocus value={pendingText} onChange={e => setPendingText(e.target.value)}
                          onClick={e => e.stopPropagation()}
                          onKeyDown={e => { if (e.key === 'Enter') saveAnnotation() }}
                          placeholder="输入提示…"
                          className="text-xs bg-white border-2 border-peach rounded px-2 py-1 shadow-lg w-40" />
                      </div>
                    )}
                    {/* 正在绘制的笔画实时预览 */}
                    {currentStroke.length > 0 && (
                      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1 1" preserveAspectRatio="none">
                        <polyline points={currentStroke.map(p => `${p[0]},${p[1]}`).join(' ')}
                          fill="none" stroke={annotColor} strokeWidth="2.5"
                          vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  {/* 已有定位气泡（文字批注，filter by currentPage）*/}
                  {annotations.filter(a => a.page_number === currentPage && a.pos_x != null && a.pos_y != null && !a.drawing_svg).map(a => {
                    const visual = dragVisualRef.current?.id === a.id ? dragVisualRef.current : null
                    const displayX = visual ? visual.x : a.pos_x!
                    const displayY = visual ? visual.y : a.pos_y!
                    return (
                      <div key={a.id}
                        className="absolute z-[5] -translate-x-1/2 -translate-y-1/2 pointer-events-auto select-none"
                        style={{ left: `${displayX * 100}%`, top: `${displayY * 100}%`, touchAction: 'none', cursor: (!deleteMode && !activeTool) ? 'grab' : 'pointer' }}
                        onClick={e => {
                          e.stopPropagation()
                          if (deleteMode) deleteAnnotation(a.id)
                        }}
                        onDoubleClick={e => {
                          e.stopPropagation()
                          if (deleteMode) return
                          setEditingId(a.id)
                          setEditMessage(a.message)
                          setEditColor(a.color)
                        }}
                        onPointerDown={e => {
                          if (deleteMode || activeTool) return
                          e.stopPropagation()
                          ;(e.target as Element).setPointerCapture?.(e.pointerId)
                          draggingRef.current = { id: a.id, startX: e.clientX, startY: e.clientY, movedPx: 0 }
                        }}
                        onPointerMove={e => {
                          const drag = draggingRef.current
                          if (!drag || drag.id !== a.id) return
                          const dx = e.clientX - drag.startX
                          const dy = e.clientY - drag.startY
                          drag.movedPx = Math.max(drag.movedPx, Math.hypot(dx, dy))
                          if (drag.movedPx > 5) {
                            const container = (e.currentTarget as HTMLElement).parentElement
                            if (container) {
                              const rect = container.getBoundingClientRect()
                              dragVisualRef.current = {
                                id: a.id,
                                x: (e.clientX - rect.left) / rect.width,
                                y: (e.clientY - rect.top) / rect.height,
                              }
                              forceRerender(n => n + 1)
                            }
                          }
                        }}
                        onPointerUp={e => {
                          const drag = draggingRef.current
                          if (!drag || drag.id !== a.id) { draggingRef.current = null; return }
                          if (drag.movedPx > 5 && dragVisualRef.current) {
                            const { x, y } = dragVisualRef.current
                            patchAnnotation(a.id, { pos_x: x, pos_y: y })
                          }
                          draggingRef.current = null
                          dragVisualRef.current = null
                          e.stopPropagation()
                        }}>
                        <span className="inline-block text-[11px] font-bold text-white px-2 py-0.5 rounded-full shadow-md whitespace-nowrap"
                          style={{ background: a.color }}>
                          {deleteMode ? '🗑 ' : ''}{a.message}
                        </span>
                      </div>
                    )
                  })}
                  {/* 已有手绘批注（SVG，filter by currentPage）*/}
                  {annotations.filter(a => a.page_number === currentPage && a.drawing_svg).map(a => {
                    let pts: Array<[number, number]> = []
                    try { pts = JSON.parse(a.drawing_svg!) } catch (_) { return null }
                    if (pts.length < 2) return null
                    return (
                      <svg key={a.id} className={`absolute inset-0 w-full h-full ${deleteMode ? 'cursor-pointer pointer-events-auto' : 'pointer-events-none'}`}
                        viewBox="0 0 1 1" preserveAspectRatio="none"
                        onClick={deleteMode ? (e => { e.stopPropagation(); deleteAnnotation(a.id) }) : undefined}>
                        <polyline points={pts.map(p => `${p[0]},${p[1]}`).join(' ')}
                          fill="none" stroke={a.color} strokeWidth={deleteMode ? '4' : '2.5'}
                          vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round"
                          opacity={deleteMode ? 0.6 : 1} />
                      </svg>
                    )
                  })}
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

      {/* 编辑面板 modal（双击气泡触发）*/}
      {editingId != null && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setEditingId(null)}>
          <div className="bg-white rounded-[16px] p-5 w-full max-w-sm shadow-xl"
            onClick={e => e.stopPropagation()}>
            <h3 className="font-extrabold text-brown-text text-base mb-3">编辑批注</h3>

            <label className="text-xs font-bold text-brown-mute mb-1 block">文字内容</label>
            <input type="text" value={editMessage} onChange={e => setEditMessage(e.target.value)}
              autoFocus
              className="w-full bg-cream rounded-[10px] px-3 py-2 text-sm text-brown-text
                border-2 border-transparent focus:border-peach outline-none mb-3" />

            <label className="text-xs font-bold text-brown-mute mb-1 block">颜色</label>
            <div className="flex gap-2 mb-4">
              {['#E07A5F', '#C54B38', '#81B29A', '#4A90D9'].map(c => (
                <button key={c} onClick={() => setEditColor(c)}
                  className={`w-8 h-8 rounded-full border-2 ${editColor === c ? 'border-brown-text' : 'border-transparent'}`}
                  style={{ background: c }} />
              ))}
            </div>

            <div className="flex gap-2">
              <button onClick={() => setEditingId(null)}
                className="flex-1 bg-cream text-brown-text font-extrabold py-2 rounded-[10px] hover:bg-cream-card">
                取消
              </button>
              <button
                onClick={async () => {
                  await patchAnnotation(editingId, { message: editMessage, color: editColor })
                  setEditingId(null)
                }}
                className="flex-1 bg-peach text-white font-extrabold py-2 rounded-[10px] hover:opacity-90">
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
