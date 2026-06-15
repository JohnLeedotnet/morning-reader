import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { adminFetch, adminRecordingUrl } from '../lib/adminFetch'
import PdfReviewer, { PdfErrorBoundary } from '../components/PdfReviewer'
import { Document, Page, pdfjs } from 'react-pdf'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

type View = 'loading' | 'setup' | 'login' | 'dashboard'

interface Session {
  id: number
  child_id: string
  child_name: string
  date: string
  start_time: string
  end_time: string | null
  total_duration_s: number
  silence_count: number
  max_silence_s: number
  total_silence_s: number
  pdfs_opened: number
  pdfs_required: number
  time_in_window: number
  status: string
  recording_path: string | null
  session_type?: string
}

interface RecPlan {
  id: number
  child_id: string
  child_name: string
  pdf_filename: string
  scheduled_date: string
  status: string
  auto: number
}

interface LibraryItem {
  id: number
  filename: string
  category_path: string | null
  sha256?: string
  title?: string | null
  size_bytes?: number
  is_private?: number
  is_builtin?: number
}

interface Category { path: string; count: number }

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const REC_STATUS: Record<string, { label: string; cls: string }> = {
  scheduled: { label: '已安排',       cls: 'bg-blue-100 text-blue-700' },
  submitted: { label: '已提交·待审核', cls: 'bg-orange-200 text-orange-800' },
  passed:    { label: '通过',         cls: 'bg-[#D6EAE0] text-[#81B29A]' },
  retry:     { label: '需重读',       cls: 'bg-orange-100 text-orange-600' },
}

const STATUS_INFO: Record<string, { label: string; cls: string }> = {
  started:          { label: '朗读中',   cls: 'bg-blue-100 text-blue-700' },
  submitted:        { label: '已提交',   cls: 'bg-yellow-100 text-yellow-700' },
  pending_review:   { label: '待审核',   cls: 'bg-orange-100 text-orange-700' },
  passed:           { label: '合格 ✓',   cls: 'bg-[#D6EAE0] text-[#81B29A]' },
  failed:           { label: '不合格',   cls: 'bg-red-100 text-red-600' },
  redo_required:    { label: '要求重读', cls: 'bg-orange-100 text-orange-600' },
  time_short:       { label: '时长不足', cls: 'bg-yellow-100 text-yellow-700' },
  out_of_window:    { label: '超出时段', cls: 'bg-yellow-100 text-yellow-700' },
  long_pause:       { label: '停顿过长', cls: 'bg-orange-100 text-orange-600' },
  high_silence:     { label: '静音过多', cls: 'bg-orange-100 text-orange-600' },
  pdf_insufficient: { label: 'PDF 不足', cls: 'bg-red-100 text-red-600' },
}

function fmtLocalHHMM(iso: string) {
  const d = new Date(iso)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function fmtDuration(s: number) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60)
  return m > 0 ? `${m}分${sec}秒` : `${sec}秒`
}

// ── PIN input ─────────────────────────────────────────────────────────────────

function PinInput({ value, onChange, placeholder = '请输入 PIN' }: {
  value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <input
      type="password" inputMode="numeric" maxLength={6} value={value}
      onChange={e => onChange(e.target.value.replace(/\D/g, ''))}
      placeholder={placeholder}
      className="w-full text-center text-2xl tabular-nums tracking-[0.5em] font-extrabold
        bg-cream text-brown-text rounded-[12px] p-4 border-2 border-transparent
        focus:border-peach outline-none transition-colors"
    />
  )
}

// ── Session card ──────────────────────────────────────────────────────────────

function SessionCard({ session, expandedAudio, onToggleAudio, onReview, onDelete, checked, onToggleCheck, selectMode }: {
  session: Session
  expandedAudio: number | null
  onToggleAudio: (id: number) => void
  onReview: (id: number, decision: string) => void
  onDelete: (id: number) => void
  checked: boolean
  onToggleCheck: (id: number) => void
  selectMode: boolean
}) {
  const info = STATUS_INFO[session.status]
  const showAudio = expandedAudio === session.id
  const isRecitation = session.session_type === 'recitation'
  const [expanded, setExpanded] = useState(false)
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null)
  const audioCallbackRef = useCallback((el: HTMLAudioElement | null) => setAudioEl(el), [])

  return (
    <div
      onClick={() => { if (selectMode) onToggleCheck(session.id) }}
      className={`rounded-[20px] p-5 transition-all
        ${selectMode ? 'cursor-pointer' : 'cursor-default'}
        ${checked
          ? 'bg-peach/10 border-2 border-peach shadow-[0_4px_24px_rgba(224,122,95,0.25)]'
          : 'bg-white border-2 border-transparent shadow-[0_4px_24px_rgba(224,122,95,0.08)]' + (selectMode ? ' hover:border-[#F0D8C8]' : '')}
        ${isRecitation ? 'border-l-4 border-l-peach-deep' : ''}`}
    >

      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {isRecitation ? (
            <span className="text-peach-deep text-xs font-extrabold bg-peach/20 px-2 py-1 rounded-full">
              📚 背诵考核
            </span>
          ) : (
            <span className="text-brown-mute text-xs font-extrabold bg-[#F5E8DD] px-2 py-1 rounded-full">
              🎤 朗读
            </span>
          )}
          <h3 className="text-lg font-extrabold text-brown-text">{session.child_name}</h3>
          <span className="text-brown-mute text-[13px]">· {session.date}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[11px] font-extrabold px-2.5 py-1 rounded-full whitespace-nowrap
            ${info ? info.cls : 'bg-[#F5E8DD] text-brown-faint'}`}>
            {info ? info.label : session.status}
          </span>
          <button onClick={(e) => { e.stopPropagation(); onDelete(session.id) }}
            className="bg-red-100 hover:bg-red-200 text-red-700 text-xs font-extrabold px-3 py-1.5 rounded-[10px]">
            🗑 删除
          </button>
        </div>
      </div>

      {session.end_time && session.start_time && (
        <p className="text-[13px] text-brown-mute mb-1">
          {isRecitation ? '背诵' : '朗读'} {fmtLocalHHMM(session.start_time)} — {fmtLocalHHMM(session.end_time)}
          （{fmtDuration(session.total_duration_s)}）{!isRecitation && `· ${session.pdfs_opened}/${session.pdfs_required} 本`}
        </p>
      )}
      <p className="text-[12px] text-[#9A7060] mb-3">
        停顿 {session.silence_count} 次 · 累计 {Math.round(session.total_silence_s)}s · 最长 {Math.round(session.max_silence_s)}s
        {session.time_in_window === 0 && <span className="text-yellow-600 ml-2">· 时间窗外</span>}
      </p>

      {session.recording_path && (
        <div className="mb-3">
          <button onClick={(e) => { e.stopPropagation(); onToggleAudio(session.id) }}
            className="bg-shell-dark text-white text-[13px] font-extrabold px-4 py-2 rounded-[10px]
              hover:bg-shell-darker transition-colors">
            {showAudio ? '▼ 收起录音' : '▶ 回听录音'}
          </button>
          {showAudio && (
            <audio ref={audioCallbackRef} controls src={adminRecordingUrl(session.id)}
              className="w-full mt-2 rounded-[8px]" />
          )}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <button onClick={(e) => { e.stopPropagation(); onReview(session.id, 'passed') }}
          className="bg-mint text-white text-[13px] font-extrabold px-4 py-2 rounded-[10px]
            hover:opacity-90 transition-opacity">
          ✓ 通过
        </button>
        <button onClick={(e) => { e.stopPropagation(); onReview(session.id, 'redo') }}
          className="bg-orange-500 text-white text-[13px] font-extrabold px-4 py-2 rounded-[10px]
            hover:opacity-90 transition-opacity">
          ↻ 要求重读
        </button>
        <button onClick={(e) => { e.stopPropagation(); setExpanded(v => !v) }}
          className="bg-shell-dark text-white text-[13px] font-extrabold px-4 py-2 rounded-[10px]
            hover:bg-shell-darker transition-colors">
          {isRecitation ? '📚' : '📖'} {expanded ? '收起' : '查看朗读内容'}
        </button>
      </div>

      {expanded && (
        <div className="mt-5 border-t border-cream-card pt-5">
          <PdfErrorBoundary>
            <PdfReviewer
              sessionId={session.id}
              mode={isRecitation ? 'recitation' : 'reading'}
              audioElement={isRecitation ? null : audioEl}
            />
          </PdfErrorBoundary>
        </div>
      )}
    </div>
  )
}

// ── PDF 预览 Modal（含"选用此 PDF"按钮）─────────────────────────────────────────

function PdfModal({ item, onClose, onPick }: {
  item: LibraryItem
  onClose: () => void
  onPick: () => void
}) {
  const [numPages, setNumPages] = useState(0)
  const [page, setPage] = useState(1)
  const pageWidth = Math.min(window.innerWidth * 0.9, 800)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  setPage(p => Math.max(1, p - 1))
      else if (e.key === 'ArrowRight') setPage(p => Math.min(numPages || 1, p + 1))
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [numPages, onClose])

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex flex-col items-center justify-start overflow-auto py-6 px-2"
         onClick={onClose}>
      <div className="bg-white rounded-[20px] overflow-hidden w-full max-w-[860px]"
           onClick={e => e.stopPropagation()}>
        {/* 顶部 */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-cream-card">
          <div className="flex-1 min-w-0">
            <p className="font-extrabold text-brown-text text-sm truncate">{item.filename}</p>
            <p className="text-xs text-brown-mute mt-0.5">
              {numPages > 0 ? `第 ${page} / ${numPages} 页` : '加载中...'}
            </p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full
              bg-cream hover:bg-cream-card text-brown-text font-bold text-lg shrink-0">
            ×
          </button>
        </div>

        {/* PDF */}
        <div className="flex flex-col items-center bg-[#3a2010] py-4 px-2 min-h-[300px] justify-center">
          <Document
            file={`/api/library/${item.id}/file`}
            onLoadSuccess={({ numPages: n }) => { setNumPages(n); setPage(1) }}
            loading={<p className="text-cream py-16 text-sm">加载中...</p>}
            error={<p className="text-red-300 py-16 text-sm">加载失败，请检查网络或权限</p>}
          >
            <Page pageNumber={page} width={pageWidth}
              loading={<div style={{ width: pageWidth, height: 400, background: '#2a1808' }} />}
            />
          </Document>
        </div>

        {/* 翻页 + 选用 */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-cream-card">
          <div className="flex items-center gap-3">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-cream
                text-brown-text font-extrabold disabled:opacity-30 hover:bg-cream-card transition-colors">
              ←
            </button>
            <span className="text-sm font-bold text-brown-text min-w-[64px] text-center">
              {numPages > 0 ? `${page} / ${numPages}` : '—'}
            </span>
            <button onClick={() => setPage(p => Math.min(numPages, p + 1))}
              disabled={page >= numPages || numPages === 0}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-cream
                text-brown-text font-extrabold disabled:opacity-30 hover:bg-cream-card transition-colors">
              →
            </button>
          </div>
          <button onClick={onPick}
            className="bg-peach text-white font-extrabold px-5 py-2 rounded-[12px]
              hover:opacity-90 transition-opacity">
            选用此 PDF
          </button>
        </div>
      </div>
    </div>
  )
}

// ── AddPdfModal ───────────────────────────────────────────────────────────────

function AddPdfModal({ childName, onAdd, onClose }: {
  childName: string
  onAdd: (libraryId: number, filename: string) => void
  onClose: () => void
}) {
  const [items, setItems] = useState<LibraryItem[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [queryInput, setQueryInput] = useState('')
  const [previewItem, setPreviewItem] = useState<LibraryItem | null>(null)
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set())
  const [expandedLevels, setExpandedLevels] = useState<Set<string>>(new Set())

  // 输入即时反馈 + 500ms debounce 才触发 API
  useEffect(() => {
    const t = setTimeout(() => setQuery(queryInput), 500)
    return () => clearTimeout(t)
  }, [queryInput])

  useEffect(() => {
    setLoading(true); setError('')
    const url = query.trim()
      ? `/api/library/list?q=${encodeURIComponent(query.trim())}`
      : `/api/library/list`
    fetch(url)
      .then(async r => {
        if (!r.ok) throw new Error(`加载失败 ${r.status}`)
        return r.json()
      })
      .then((data: { items: LibraryItem[]; categories: Category[] }) => {
        setItems(data.items)
        setCategories(data.categories || [])
      })
      .catch(e => setError(e.message || '网络错误'))
      .finally(() => setLoading(false))
  }, [query])

  const isSearching = query.trim().length > 0

  const itemsByCategory = (() => {
    const map = new Map<string, LibraryItem[]>()
    for (const item of items) {
      const cat = item.category_path || '(未分类)'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(item)
    }
    return map
  })()

  const seriesMap = (() => {
    const map = new Map<string, Array<{ level: string; count: number; fullPath: string }>>()
    for (const cat of categories) {
      const slashIdx = cat.path.indexOf('/')
      const series = slashIdx > 0 ? cat.path.slice(0, slashIdx) : cat.path
      const level  = slashIdx > 0 ? cat.path.slice(slashIdx + 1) : '(根目录)'
      if (!map.has(series)) map.set(series, [])
      map.get(series)!.push({ level, count: cat.count, fullPath: cat.path })
    }
    return map
  })()

  const toggleSeries = (s: string) => {
    setExpandedSeries(prev => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s); else next.add(s)
      return next
    })
  }
  const toggleLevel = (lvl: string) => {
    setExpandedLevels(prev => {
      const next = new Set(prev)
      if (next.has(lvl)) next.delete(lvl); else next.add(lvl)
      return next
    })
  }

  const seriesTotal = (s: string) => (seriesMap.get(s) ?? []).reduce((sum, l) => sum + l.count, 0)

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-[24px] max-w-2xl w-full max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-cream-card flex items-center justify-between shrink-0">
          <h3 className="font-extrabold text-brown-text">为 {childName} 选择起点 PDF</h3>
          <button onClick={onClose} className="text-brown-mute text-xl hover:text-brown-text leading-none">×</button>
        </div>

        <div className="px-6 py-3 shrink-0">
          <input
            type="text" placeholder="搜索文件名..." value={queryInput} onChange={e => setQueryInput(e.target.value)}
            className="w-full bg-cream rounded-[10px] px-3 py-2 text-sm text-brown-text
              border-2 border-transparent focus:border-peach outline-none transition-colors"
          />
          <p className="text-[11px] text-brown-mute mt-1">
            {isSearching
              ? `搜索结果 ${items.length} 本`
              : `共 ${categories.reduce((s, c) => s + c.count, 0)} 本 · ${seriesMap.size} 个作品 · ${categories.length} 个分级`}
          </p>
        </div>

        <div className="flex-1 overflow-auto px-3 pb-3">
          {loading && <p className="text-brown-mute text-sm text-center py-8">加载中...</p>}
          {!loading && error && <p className="text-red-500 text-sm text-center py-8">{error}</p>}
          {!loading && !error && items.length === 0 && (
            <p className="text-brown-mute text-sm text-center py-8">没有匹配的 PDF</p>
          )}

          {/* 搜索模式：扁平列表，按 category_path 显示来源 */}
          {!loading && !error && isSearching && items.map(item => (
            <button key={item.id} onClick={() => setPreviewItem(item)}
              className="w-full text-left text-sm text-brown-text hover:bg-cream rounded-[8px] px-3 py-2 flex items-center gap-2">
              <span className="shrink-0 text-brown-faint text-[11px] w-12 tabular-nums">#{item.id}</span>
              <span className="truncate flex-1">{item.filename}</span>
              {item.category_path && (
                <span className="shrink-0 text-[10px] text-brown-faint truncate max-w-[180px]">
                  {item.category_path}
                </span>
              )}
            </button>
          ))}

          {/* 非搜索模式：两级嵌套树 */}
          {!loading && !error && !isSearching && Array.from(seriesMap.entries()).map(([series, levels]) => (
            <div key={series} className="mb-2">
              {/* 一级：作品 */}
              <button onClick={() => toggleSeries(series)}
                className="w-full text-left bg-cream/80 hover:bg-cream rounded-[10px] px-3 py-2.5
                  flex items-center justify-between font-extrabold text-brown-text">
                <span className="flex items-center gap-2">
                  <span className="text-brown-faint w-3">{expandedSeries.has(series) ? '▼' : '▶'}</span>
                  <span className="text-[15px]">{series}</span>
                </span>
                <span className="text-[11px] text-brown-mute font-bold">
                  {seriesTotal(series)} 本 · {levels.length} 级
                </span>
              </button>

              {/* 二级：级别（仅当作品展开时显示） */}
              {expandedSeries.has(series) && (
                <div className="ml-4 mt-1 space-y-0.5">
                  {levels.map(({ level, count, fullPath }) => (
                    <div key={fullPath}>
                      <button onClick={() => toggleLevel(fullPath)}
                        className="w-full text-left bg-cream/40 hover:bg-cream/70 rounded-[8px] px-3 py-1.5
                          flex items-center justify-between text-sm font-bold text-brown-text">
                        <span className="flex items-center gap-2">
                          <span className="text-brown-faint w-3 text-[10px]">{expandedLevels.has(fullPath) ? '▼' : '▶'}</span>
                          <span>{level}</span>
                        </span>
                        <span className="text-[11px] text-brown-mute">{count} 本</span>
                      </button>

                      {/* 三级：PDF 文件（仅当级别展开时显示） */}
                      {expandedLevels.has(fullPath) && (
                        <ul className="ml-6 mt-1 mb-1 space-y-0.5">
                          {(itemsByCategory.get(fullPath) ?? []).map(item => (
                            <li key={item.id}>
                              <button onClick={() => setPreviewItem(item)}
                                className="w-full text-left text-sm text-brown-text hover:bg-cream rounded-[6px] px-3 py-1">
                                {item.filename}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {previewItem && (
        <PdfModal
          item={previewItem}
          onClose={() => setPreviewItem(null)}
          onPick={() => {
            onAdd(previewItem.id, previewItem.filename)
          }}
        />
      )}
    </div>
  )
}

// ── Exam config card（考核计划 tab 顶部）──────────────────────────────────────

interface ExamLocalData {
  cursorId: number | null
  cursorFilename: string | null
  count: number
  minDurationMin: string
  timeWindowStart: string
  timeWindowEnd: string
  advanceAfterReads: number
  requiresRecitation: boolean
  recitationMode: 'auto' | 'manual'
  recitationWeekday: number
}

function ChildExamConfigCard({ child, localData, onChangeCursor, onChange, onSave, saving }: {
  child: { id: string; name: string }
  localData: ExamLocalData
  onChangeCursor: () => void
  onChange: (field: keyof ExamLocalData, value: ExamLocalData[keyof ExamLocalData]) => void
  onSave: () => void
  saving: boolean
}) {
  const [showResetModal, setShowResetModal] = useState(false)
  const [resetPin, setResetPin] = useState('')
  const [resetState, setResetState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [resetError, setResetError] = useState('')

  const handleReset = async () => {
    if (!resetPin) return
    setResetState('loading')
    setResetError('')
    try {
      // 先 verify-pin 确认家长 cookie 有效（Sprint 1B 后 PIN 为纯 cookie 鉴权）
      const verify = await adminFetch('/api/admin/verify-pin', { method: 'POST' })
      if (!verify.ok) throw new Error('鉴权失败，请重新登录')
      const res = await adminFetch(`/api/admin/children/${child.id}/reset-exam`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      setResetState('done')
      setTimeout(() => { setShowResetModal(false); setResetState('idle'); setResetPin('') }, 1500)
    } catch (e: unknown) {
      setResetState('error')
      setResetError(e instanceof Error ? e.message : '重置失败')
    }
  }

  return (
    <div className="bg-white rounded-[20px] p-5 shadow-[0_4px_24px_rgba(224,122,95,0.08)]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-extrabold text-brown-text">{child.name}</h3>
        <button
          onClick={() => { setShowResetModal(true); setResetState('idle'); setResetPin(''); setResetError('') }}
          className="text-xs font-extrabold text-red-500 border border-red-400 px-2.5 py-1 rounded-[8px]
            hover:bg-red-50 transition-colors">
          ⚠ 重置考核
        </button>
      </div>

      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-[20px] p-6 w-full max-w-[360px] mx-4 shadow-xl">
            <h4 className="text-lg font-extrabold text-brown-text mb-3">重置 {child.name} 考核状态</h4>
            <div className="bg-[#FFF5F5] border border-red-200 rounded-[12px] p-3 mb-4 text-sm text-red-700 space-y-1">
              <p className="font-bold">以下内容将被清除：</p>
              <p>• 待背诵 / 已提交背诵任务</p>
              <p>• 历史朗读次数（pdf_read_counts）</p>
              <p className="text-brown-mute font-bold">起点 PDF 不动（换起点请用"更换起点"）</p>
            </div>
            <input
              type="password"
              inputMode="numeric"
              placeholder="输入家长 PIN 确认"
              value={resetPin}
              onChange={e => setResetPin(e.target.value)}
              className="w-full bg-cream rounded-[10px] px-3 py-2.5 text-center text-lg font-extrabold
                tracking-widest text-brown-text border-2 border-transparent focus:border-red-400 outline-none mb-4"
            />
            {resetState === 'error' && (
              <p className="text-red-500 text-sm text-center mb-3">{resetError}</p>
            )}
            {resetState === 'done' && (
              <p className="text-green-600 text-sm text-center mb-3">✓ 重置成功</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setShowResetModal(false)}
                className="flex-1 py-2.5 rounded-[12px] font-extrabold text-brown-mute bg-cream hover:bg-[#EDE0D4] transition-colors">
                取消
              </button>
              <button
                onClick={handleReset}
                disabled={!resetPin || resetState === 'loading' || resetState === 'done'}
                className="flex-1 py-2.5 rounded-[12px] font-extrabold text-white bg-red-500
                  hover:bg-red-600 transition-colors disabled:opacity-40">
                {resetState === 'loading' ? '重置中...' : '确认重置'}
              </button>
            </div>
          </div>
        </div>
      )}


      <p className="text-sm font-extrabold text-brown-text mb-1.5">起点 PDF</p>
      <div className="bg-cream rounded-[10px] p-3 mb-2">
        {localData.cursorId && localData.cursorFilename ? (
          <>
            <p className="font-extrabold text-brown-text text-sm truncate">{localData.cursorFilename}</p>
            <p className="text-xs text-brown-mute mt-0.5">library_id={localData.cursorId}</p>
          </>
        ) : (
          <p className="text-brown-mute text-sm">未配置</p>
        )}
      </div>
      <button onClick={onChangeCursor}
        className="bg-peach text-white text-sm font-extrabold px-3 py-1.5 rounded-[10px] mb-4
          hover:opacity-90 transition-opacity">
        更换起点
      </button>

      <div className="flex items-center gap-3 mb-3">
        <p className="text-sm font-extrabold text-brown-text w-32 shrink-0">每日朗读本数</p>
        <input type="number" min={1} max={10} value={localData.count}
          onChange={e => onChange('count', Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
          className="w-16 text-center text-lg font-extrabold bg-cream rounded-[10px] p-2
            border-2 border-transparent focus:border-peach outline-none transition-colors text-brown-text" />
      </div>

      <div className="flex items-center gap-3 mb-3">
        <p className="text-sm font-extrabold text-brown-text w-32 shrink-0">每次朗读时长</p>
        <input type="number" min={1} max={60} value={localData.minDurationMin}
          onChange={e => onChange('minDurationMin', e.target.value)}
          placeholder="默认 5"
          className="w-16 text-center text-lg font-extrabold bg-cream rounded-[10px] p-2
            border-2 border-transparent focus:border-peach outline-none transition-colors text-brown-text" />
        <p className="text-sm text-brown-mute">分钟</p>
      </div>

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <p className="text-sm font-extrabold text-brown-text w-32 shrink-0">考核时间窗</p>
        <input type="time" value={localData.timeWindowStart}
          onChange={e => onChange('timeWindowStart', e.target.value)}
          className="bg-cream rounded-[10px] px-3 py-2 text-sm font-extrabold text-brown-text
            border-2 border-transparent focus:border-peach outline-none" />
        <span className="text-brown-mute text-sm">—</span>
        <input type="time" value={localData.timeWindowEnd}
          onChange={e => onChange('timeWindowEnd', e.target.value)}
          className="bg-cream rounded-[10px] px-3 py-2 text-sm font-extrabold text-brown-text
            border-2 border-transparent focus:border-peach outline-none" />
      </div>

      <div className="flex items-center gap-3 mb-3">
        <p className="text-sm font-extrabold text-brown-text w-32 shrink-0">自动毕业次数</p>
        <input type="number" min={1} max={99} value={localData.advanceAfterReads}
          onChange={e => onChange('advanceAfterReads', Math.max(1, parseInt(e.target.value) || 1))}
          className="w-16 text-center text-lg font-extrabold bg-cream rounded-[10px] p-2
            border-2 border-transparent focus:border-peach outline-none transition-colors text-brown-text" />
        <p className="text-sm text-brown-mute">次后进入背诵</p>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <p className="text-sm font-extrabold text-brown-text w-32 shrink-0">需要背诵</p>
        <button
          onClick={() => onChange('requiresRecitation', !localData.requiresRecitation)}
          className={`relative w-11 h-6 rounded-full transition-colors shrink-0
            ${localData.requiresRecitation ? 'bg-mint' : 'bg-[#C8B4A0]'}`}>
          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform
            ${localData.requiresRecitation ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {localData.requiresRecitation && (
        <div className="flex items-center gap-4 mb-3 ml-36">
          {(['auto', 'manual'] as const).map(m => (
            <label key={m} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name={`recMode-${child.id}`} value={m}
                checked={localData.recitationMode === m}
                onChange={() => onChange('recitationMode', m)}
                className="accent-[#E07A5F]" />
              <span className="text-sm text-brown-text font-bold">{m === 'auto' ? '自动安排' : '手动安排'}</span>
            </label>
          ))}
        </div>
      )}

      {localData.requiresRecitation && localData.recitationMode === 'auto' && (
        <div className="flex items-center gap-3 mb-3">
          <p className="text-sm font-extrabold text-brown-text w-32 shrink-0">背诵日</p>
          <select value={localData.recitationWeekday}
            onChange={e => onChange('recitationWeekday', parseInt(e.target.value))}
            className="bg-cream rounded-[10px] px-3 py-2 text-sm font-extrabold text-brown-text
              border-2 border-transparent focus:border-peach outline-none">
            {WEEKDAY_NAMES.map((name, i) => (
              <option key={i} value={i}>{name}</option>
            ))}
          </select>
        </div>
      )}

      <button onClick={onSave} disabled={saving}
        className="bg-peach text-white py-2.5 px-5 rounded-[12px] font-extrabold w-full mt-2
          hover:opacity-90 transition-opacity disabled:opacity-40">
        {saving ? '保存中...' : '保存配置'}
      </button>
    </div>
  )
}

// ── Sprint 1A-7: 账户设置（合并进 users tab）────────────────────────────────────

interface MeData {
  account_id: number
  email: string
  username: string | null
  is_superadmin: boolean
}

function UploadsTab() {
  const [items, setItems] = useState<Array<{ id: number; filename: string; size_bytes: number; is_private: number; created_at: string }>>([])
  const [allItems, setAllItems] = useState<Array<{ id: number; filename: string; size_bytes: number; is_private: number; created_at: string; uploader_username: string; uploader_account_id: number }>>([])
  const [usedMb, setUsedMb] = useState(0)
  const [quotaMb, setQuotaMb] = useState(200)
  const [unlimited, setUnlimited] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [message, setMessage] = useState('')

  const refresh = () => {
    fetch('/api/library/mine')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return
        setItems(d.items); setUsedMb(d.used_mb); setQuotaMb(d.quota_mb)
        setUnlimited(d.unlimited); setIsSuperAdmin(d.unlimited)
      })
  }
  const refreshAll = () => {
    fetch('/api/admin/library/all-uploads')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setAllItems(d.items) })
  }
  useEffect(() => { refresh(); }, [])
  useEffect(() => { if (scope === 'all' && isSuperAdmin) refreshAll() }, [scope, isSuperAdmin])

  const upload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) { setMessage('仅支持 PDF'); return }
    if (file.size > 200 * 1024 * 1024) { setMessage('单文件不能超过 200 MB'); return }
    setUploading(true); setProgress(0); setMessage('')
    const fd = new FormData()
    fd.append('pdf', file)
    try {
      const data: Record<string, unknown> = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', '/api/library/upload')
        xhr.upload.onprogress = e => { if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100)) }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText)) } catch (e) { reject(e) }
          } else {
            try { reject(new Error((JSON.parse(xhr.responseText) as { error?: string }).error || `HTTP ${xhr.status}`)) }
            catch { reject(new Error(`HTTP ${xhr.status}`)) }
          }
        }
        xhr.onerror = () => reject(new Error('网络错误'))
        xhr.send(fd)
      })
      setMessage(data.duplicate ? ((data.message as string) || '已存在') : `✓ 上传成功：${data.filename as string}`)
      refresh()
    } catch (e) {
      setMessage(`❌ ${(e as Error).message}`)
    } finally {
      setUploading(false); setProgress(null)
    }
  }

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files?.[0]; if (f) upload(f)
  }

  const toggleVisibility = async (id: number, currentPrivate: number) => {
    await fetch(`/api/library/${id}/visibility`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_private: currentPrivate ? 0 : 1 }),
    })
    refresh()
  }
  const doDelete = async (id: number, filename: string) => {
    if (!confirm(`确认删除「${filename}」？`)) return
    await fetch(`/api/library/${id}`, { method: 'DELETE' })
    refresh()
  }

  const usedPct = unlimited ? 0 : Math.min(100, Math.round((usedMb / quotaMb) * 100))

  return (
    <div className="space-y-4">
      {/* superadmin 视角切换 */}
      {isSuperAdmin && (
        <div className="flex gap-2">
          <button onClick={() => setScope('mine')}
            className={`flex-1 py-2 rounded-[12px] text-sm font-extrabold transition-colors
              ${scope === 'mine' ? 'bg-peach text-white' : 'bg-white text-brown-mute hover:bg-cream-card'}`}>
            我的上传
          </button>
          <button onClick={() => setScope('all')}
            className={`flex-1 py-2 rounded-[12px] text-sm font-extrabold transition-colors
              ${scope === 'all' ? 'bg-peach text-white' : 'bg-white text-brown-mute hover:bg-cream-card'}`}>
            所有用户
          </button>
        </div>
      )}

      {scope === 'all' ? (
        /* ── 全账号视图（superadmin）── */
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-extrabold text-brown-text">所有用户上传（{allItems.length}）</span>
            <button onClick={refreshAll} className="text-xs text-brown-mute hover:text-peach">刷新</button>
          </div>
          {allItems.length === 0 ? (
            <p className="text-brown-mute text-sm text-center py-4">暂无上传记录</p>
          ) : allItems.map(it => (
            <div key={it.id} className="bg-white rounded-[12px] p-3 flex items-center gap-3 shadow-[0_2px_12px_rgba(224,122,95,0.06)]">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-brown-text text-sm truncate">{it.filename}</p>
                <p className="text-xs text-brown-mute">
                  {Math.ceil(it.size_bytes / 1024 / 1024)} MB · {it.created_at?.slice(0,10)} · @{it.uploader_username}
                </p>
              </div>
              <span className={`text-xs font-bold px-2 py-1 rounded-[6px] ${it.is_private ? 'bg-cream text-brown-mute' : 'bg-mint/20 text-mint'}`}>
                {it.is_private ? '私有' : '公开'}
              </span>
              <button onClick={async () => {
                if (!confirm(`确认删除「${it.filename}」（@${it.uploader_username}）？`)) return
                await fetch(`/api/library/${it.id}`, { method: 'DELETE' })
                refreshAll()
              }} className="text-xs font-extrabold text-red-500 hover:text-red-600 px-2 py-1.5">删除</button>
            </div>
          ))}
        </div>
      ) : (
      <>
      {/* 配额 */}
      <div className="bg-white rounded-[16px] p-4 shadow-[0_4px_24px_rgba(224,122,95,0.08)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-extrabold text-brown-text">存储配额</span>
          <span className="text-sm font-bold text-brown-mute">
            {unlimited ? '无限制（superadmin）' : `${usedMb} / ${quotaMb} MB`}
          </span>
        </div>
        {!unlimited && (
          <div className="h-2 bg-cream rounded-full overflow-hidden">
            <div className="h-full bg-peach transition-all" style={{ width: `${usedPct}%` }} />
          </div>
        )}
      </div>

      {/* 拖拽上传 */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`bg-white rounded-[16px] p-8 text-center border-2 border-dashed transition-colors
          ${dragOver ? 'border-peach bg-peach/5' : 'border-[#F0D8C8]'}`}>
        <p className="text-brown-mute text-sm mb-3">拖拽 PDF 到此 或</p>
        <label className="inline-block bg-peach text-white font-extrabold px-5 py-2 rounded-[12px] cursor-pointer hover:opacity-90">
          选择文件
          <input type="file" accept="application/pdf,.pdf" onChange={onFileInput} className="hidden" disabled={uploading} />
        </label>
        {uploading && progress !== null && (
          <p className="text-brown-mute text-sm mt-3">上传中 {progress}%（请勿关闭页面）</p>
        )}
        {message && <p className="text-sm mt-3 text-brown-text">{message}</p>}
      </div>

      {/* 列表 */}
      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="text-brown-mute text-sm text-center py-4">还没有上传任何 PDF</p>
        ) : items.map(it => (
          <div key={it.id} className="bg-white rounded-[12px] p-3 flex items-center gap-3
            shadow-[0_2px_12px_rgba(224,122,95,0.06)]">
            <div className="flex-1 min-w-0">
              <p className="font-bold text-brown-text text-sm truncate">{it.filename}</p>
              <p className="text-xs text-brown-mute">{Math.ceil(it.size_bytes / 1024 / 1024)} MB · {it.created_at?.slice(0,10)}</p>
            </div>
            <button onClick={() => toggleVisibility(it.id, it.is_private)}
              className={`text-xs font-extrabold px-3 py-1.5 rounded-[8px] transition-colors
                ${it.is_private ? 'bg-cream text-brown-mute' : 'bg-mint/20 text-mint'}`}>
              {it.is_private ? '🔒 私有' : '🌐 公开'}
            </button>
            <button onClick={() => doDelete(it.id, it.filename)}
              className="text-xs font-extrabold text-red-500 hover:text-red-600 px-2 py-1.5">
              删除
            </button>
          </div>
        ))}
      </div>
      </>
      )}
    </div>
  )
}

function AccountInlineSettings() {
  const [me, setMe] = useState<MeData | null | undefined>(undefined)
  const [editingUsername, setEditingUsername] = useState(false)
  const [editingPassword, setEditingPassword] = useState(false)
  const [editingPin, setEditingPin] = useState(false)
  const [usernameInput, setUsernameInput] = useState('')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')
  const [oldPin, setOldPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [newPin2, setNewPin2] = useState('')
  const [hasPin, setHasPin] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const loadMe = () => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(setMe)
      .catch(() => setMe(null))
    fetch('/api/auth/parent-status')
      .then(r => r.ok ? r.json() : null)
      .then(s => { if (s) setHasPin(s.has_pin) })
      .catch(() => {})
  }
  useEffect(loadMe, [])

  const saveUsername = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true); setError(''); setSuccess('')
    try {
      const res = await fetch('/api/auth/set-username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameInput.trim() }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error || `修改失败 ${res.status}`)
      }
      setSuccess('用户名修改成功')
      setEditingUsername(false); setUsernameInput('')
      loadMe()
    } catch (err: unknown) { setError(err instanceof Error ? err.message : '网络错误') }
    finally { setSubmitting(false) }
  }

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== newPassword2) { setError('两次密码不一致'); return }
    if (newPassword.length < 8) { setError('新密码至少 8 位'); return }
    setSubmitting(true); setError(''); setSuccess('')
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword, newPassword }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error || `修改失败 ${res.status}`)
      }
      setSuccess('密码修改成功')
      setEditingPassword(false); setOldPassword(''); setNewPassword(''); setNewPassword2('')
    } catch (err: unknown) { setError(err instanceof Error ? err.message : '网络错误') }
    finally { setSubmitting(false) }
  }

  const savePin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPin !== newPin2) { setError('两次 PIN 不一致'); return }
    if (!/^\d{4,6}$/.test(newPin)) { setError('PIN 必须是 4-6 位数字'); return }
    setSubmitting(true); setError(''); setSuccess('')
    try {
      const body: Record<string, string> = { newPin }
      if (hasPin && oldPin) body.oldPin = oldPin
      const res = await fetch('/api/auth/set-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error || `修改失败 ${res.status}`)
      }
      setSuccess('家长 PIN 修改成功')
      setEditingPin(false); setOldPin(''); setNewPin(''); setNewPin2('')
      setHasPin(true)
    } catch (err: unknown) { setError(err instanceof Error ? err.message : '网络错误') }
    finally { setSubmitting(false) }
  }

  if (!me) return null

  return (
    <div>
      <div className="mb-3">
        <h2 className="text-xl font-extrabold text-brown-text">账户设置</h2>
        <p className="text-sm text-brown-mute mt-0.5">登录用户信息、修改用户名、修改密码、家长 PIN</p>
      </div>
      <div className="bg-white rounded-[20px] p-5 shadow-[0_4px_24px_rgba(224,122,95,0.08)]">
        <div className="bg-cream rounded-[12px] p-4 mb-4 text-sm space-y-1.5">
          <div className="flex justify-between gap-2">
            <span className="text-brown-mute">邮箱：</span>
            <span className="font-bold text-brown-text break-all">{me.email}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-brown-mute">用户名：</span>
            <span className="font-bold text-brown-text">
              {me.username || <span className="text-brown-faint italic">（未设置）</span>}
            </span>
          </div>
          {me.is_superadmin && (
            <div className="flex justify-between gap-2">
              <span className="text-brown-mute">权限：</span>
              <span className="font-bold text-peach-deep">👑 超级管理员</span>
            </div>
          )}
        </div>

        {(error || success) && (
          <p className={`text-sm mb-3 ${error ? 'text-red-500' : 'text-mint font-bold'}`}>{error || success}</p>
        )}

        {!editingUsername ? (
          <button onClick={() => { setEditingUsername(true); setUsernameInput(me.username || ''); setError(''); setSuccess('') }}
            className="w-full text-left bg-cream/60 hover:bg-cream rounded-[10px] px-4 py-2.5 mb-2 text-sm font-bold text-brown-text">
            ✏️ {me.username ? '修改用户名' : '设置用户名'}
          </button>
        ) : (
          <form onSubmit={saveUsername} className="bg-cream/40 rounded-[10px] p-4 mb-2 space-y-2">
            <input type="text" required placeholder="用户名（3-32 位，字母/数字/_/-）" value={usernameInput}
              onChange={e => setUsernameInput(e.target.value)} pattern="[a-zA-Z0-9_-]{3,32}"
              className="w-full bg-white rounded-[8px] px-3 py-2 text-sm border-2 border-transparent focus:border-peach outline-none" />
            <div className="flex gap-2">
              <button type="submit" disabled={submitting}
                className="flex-1 bg-peach text-white py-2 rounded-[8px] text-sm font-extrabold disabled:opacity-40">
                {submitting ? '保存中...' : '保存'}
              </button>
              <button type="button" onClick={() => { setEditingUsername(false); setError('') }}
                className="px-4 bg-cream text-brown-mute py-2 rounded-[8px] text-sm font-bold">取消</button>
            </div>
          </form>
        )}

        {!editingPassword ? (
          <button onClick={() => { setEditingPassword(true); setError(''); setSuccess('') }}
            className="w-full text-left bg-cream/60 hover:bg-cream rounded-[10px] px-4 py-2.5 mb-2 text-sm font-bold text-brown-text">
            🔒 修改密码
          </button>
        ) : (
          <form onSubmit={savePassword} className="bg-cream/40 rounded-[10px] p-4 mb-2 space-y-2">
            <input type="password" placeholder="当前密码（首次设置可空）" value={oldPassword}
              onChange={e => setOldPassword(e.target.value)}
              className="w-full bg-white rounded-[8px] px-3 py-2 text-sm border-2 border-transparent focus:border-peach outline-none" />
            <input type="password" required placeholder="新密码（至少 8 位）" value={newPassword}
              onChange={e => setNewPassword(e.target.value)} minLength={8}
              className="w-full bg-white rounded-[8px] px-3 py-2 text-sm border-2 border-transparent focus:border-peach outline-none" />
            <input type="password" required placeholder="再输一次新密码" value={newPassword2}
              onChange={e => setNewPassword2(e.target.value)}
              className="w-full bg-white rounded-[8px] px-3 py-2 text-sm border-2 border-transparent focus:border-peach outline-none" />
            <div className="flex gap-2">
              <button type="submit" disabled={submitting}
                className="flex-1 bg-peach text-white py-2 rounded-[8px] text-sm font-extrabold disabled:opacity-40">
                {submitting ? '保存中...' : '保存'}
              </button>
              <button type="button" onClick={() => { setEditingPassword(false); setError('') }}
                className="px-4 bg-cream text-brown-mute py-2 rounded-[8px] text-sm font-bold">取消</button>
            </div>
          </form>
        )}

        {!editingPin ? (
          <button onClick={() => { setEditingPin(true); setError(''); setSuccess('') }}
            className="w-full text-left bg-cream/60 hover:bg-cream rounded-[10px] px-4 py-2.5 text-sm font-bold text-brown-text">
            🔑 {hasPin ? '修改家长 PIN' : '设置家长 PIN'}
          </button>
        ) : (
          <form onSubmit={savePin} className="bg-cream/40 rounded-[10px] p-4 space-y-2">
            {hasPin && (
              <input type="password" inputMode="numeric" maxLength={6} placeholder="当前 PIN" value={oldPin}
                onChange={e => setOldPin(e.target.value.replace(/\D/g, ''))}
                className="w-full bg-white rounded-[8px] px-3 py-2 text-sm border-2 border-transparent focus:border-peach outline-none" />
            )}
            <input type="password" inputMode="numeric" maxLength={6} required placeholder="新 PIN（4-6 位数字）" value={newPin}
              onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
              className="w-full bg-white rounded-[8px] px-3 py-2 text-sm border-2 border-transparent focus:border-peach outline-none" />
            <input type="password" inputMode="numeric" maxLength={6} required placeholder="再输一次新 PIN" value={newPin2}
              onChange={e => setNewPin2(e.target.value.replace(/\D/g, ''))}
              className="w-full bg-white rounded-[8px] px-3 py-2 text-sm border-2 border-transparent focus:border-peach outline-none" />
            <div className="flex gap-2">
              <button type="submit" disabled={submitting}
                className="flex-1 bg-peach text-white py-2 rounded-[8px] text-sm font-extrabold disabled:opacity-40">
                {submitting ? '保存中...' : '保存'}
              </button>
              <button type="button" onClick={() => { setEditingPin(false); setOldPin(''); setNewPin(''); setNewPin2(''); setError('') }}
                className="px-4 bg-cream text-brown-mute py-2 rounded-[8px] text-sm font-bold">取消</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ParentPage() {
  const navigate = useNavigate()

  // Auth state
  const [view,        setView]        = useState<View>('loading')
  const [pin,         setPin]         = useState('')
  const [confirmPin,  setConfirmPin]  = useState('')
  const [error,       setError]       = useState('')
  const [lockSeconds, setLockSeconds] = useState(0)

  // Dashboard state
  const [tab,          setTab]          = useState<'review' | 'pool' | 'recitation' | 'users' | 'uploads'>('review')
  const [sessions,     setSessions]     = useState<Session[]>([])
  const [loadingSess,  setLoadingSess]  = useState(false)
  const [expandedAudio, setExpandedAudio] = useState<number | null>(null)

  // Filter state (Task A)
  const [filterChild,  setFilterChild]  = useState<string>('all')
  const [filterType,   setFilterType]   = useState<'all' | 'reading' | 'recitation'>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending_review' | 'passed' | 'redo_required' | 'time_short' | 'long_pause'>('all')
  const [selectedIds,  setSelectedIds]  = useState<Set<number>>(new Set())
  const [selectMode,   setSelectMode]   = useState(false)

  // Pool state
  const [allChildren,        setAllChildren]        = useState<{
    id: string; name: string; age?: number; daily_count?: number; min_duration_s?: number | null
    cursor_library_id?: number | null; cursor_filename?: string | null
    advance_after_reads?: number | null; requires_recitation?: number | null
    recitation_mode?: string | null; recitation_weekday?: number | null
    time_window_start?: string | null; time_window_end?: string | null
  }[]>([])
  const [localCursorIds,       setLocalCursorIds]       = useState<Record<string, number | null>>({})
  const [localCursorFilenames, setLocalCursorFilenames] = useState<Record<string, string | null>>({})
  const [localCounts,          setLocalCounts]          = useState<Record<string, number>>({})
  const [localMinDurations,    setLocalMinDurations]    = useState<Record<string, string>>({})
  const [localAdvanceReads,    setLocalAdvanceReads]    = useState<Record<string, number>>({})
  const [localRequiresRec,     setLocalRequiresRec]     = useState<Record<string, boolean>>({})
  const [localRecMode,         setLocalRecMode]         = useState<Record<string, 'auto' | 'manual'>>({})
  const [localRecWeekday,      setLocalRecWeekday]      = useState<Record<string, number>>({})
  const [localTimeStart,       setLocalTimeStart]       = useState<Record<string, string>>({})
  const [localTimeEnd,         setLocalTimeEnd]         = useState<Record<string, string>>({})
  const [loadingPool,          setLoadingPool]          = useState(false)
  const [savingChild,          setSavingChild]          = useState<string | null>(null)
  const [poolModal,            setPoolModal]            = useState<string | null>(null) // childId
  const [addUserOpen,          setAddUserOpen]          = useState(false)
  const [newUserName,          setNewUserName]          = useState('')
  const [newUserAge,           setNewUserAge]           = useState('')

  // Recitation state
  const [recPlans,      setRecPlans]      = useState<RecPlan[]>([])
  const [loadingRec,    setLoadingRec]    = useState(false)
  const [recChildId,    setRecChildId]    = useState('')
  const [recPdf,        setRecPdf]        = useState<string | null>(null)
  const [recLibraryId,  setRecLibraryId]  = useState<number | null>(null)
  const [recDate,       setRecDate]       = useState('')
  const [schedulingRec, setSchedulingRec] = useState(false)
  const [recModal,      setRecModal]      = useState(false)

  // ── Init ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/auth/parent-status').then(r => r.json()).then(status => {
      if (!status.logged_in) { navigate('/login'); return }
      if (!status.has_pin)            setView('setup')
      else if (status.parent_unlocked) setView('dashboard')
      else                             setView('login')
    }).catch(() => setView('login'))
  }, [])

  const refreshSessions = () => {
    setLoadingSess(true)
    adminFetch('/api/admin/sessions?limit=50')
      .then(r => r.json())
      .then(data => { setSessions(Array.isArray(data) ? data : []); setLoadingSess(false) })
      .catch(() => setLoadingSess(false))
  }

  // Load sessions when entering dashboard
  useEffect(() => {
    if (view !== 'dashboard') return
    refreshSessions()
  }, [view])

  // Load children list at dashboard init
  useEffect(() => {
    if (view !== 'dashboard') return
    fetch('/api/children').then(r => r.json())
      .then((data: any[]) => setAllChildren(data.map(c => ({
        id: c.id, name: c.name, age: c.age, daily_count: c.daily_count,
        min_duration_s: c.min_duration_s,
        cursor_library_id: c.cursor_library_id ?? null, cursor_filename: c.cursor_filename ?? null,
        advance_after_reads: c.advance_after_reads ?? null, requires_recitation: c.requires_recitation ?? null,
        recitation_mode: c.recitation_mode ?? null, recitation_weekday: c.recitation_weekday ?? null,
        time_window_start: c.time_window_start ?? null, time_window_end: c.time_window_end ?? null,
      }))))
      .catch(() => {})
  }, [view])

  // 加载 allChildren 后，若 recChildId 未设置则默认选第一个孩子
  useEffect(() => {
    if (!recChildId && allChildren.length > 0) {
      setRecChildId(allChildren[0].id)
    }
    // 故意只依赖 allChildren，避免外部 setRecChildId('') 时立即覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allChildren])

  // Load pool configs when on pool tab
  useEffect(() => {
    if (view !== 'dashboard' || tab !== 'pool') return
    refreshChildConfigs()
  }, [view, tab])

  // Load recitation plans and child configs when on recitation tab
  useEffect(() => {
    if (view !== 'dashboard' || tab !== 'recitation') return
    refreshRecPlans()
    refreshChildConfigs()
  }, [view, tab])

  // Clear selection when filters change
  useEffect(() => { setSelectedIds(new Set()); setSelectMode(false) }, [filterChild, filterType, filterStatus])

  // Lock countdown
  useEffect(() => {
    if (lockSeconds <= 0) return
    const t = setTimeout(() => setLockSeconds(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [lockSeconds])

  // ── Pool helpers ──────────────────────────────────────────────────────────
  const refreshChildConfigs = async () => {
    setLoadingPool(true)
    try {
      const results: any[] = await fetch('/api/children').then(r => r.json())
      setAllChildren(results.map(c => ({
        id: c.id, name: c.name, age: c.age, daily_count: c.daily_count,
        min_duration_s: c.min_duration_s,
        cursor_library_id: c.cursor_library_id ?? null,
        cursor_filename: c.cursor_filename ?? null,
        advance_after_reads: c.advance_after_reads ?? null,
        requires_recitation: c.requires_recitation ?? null,
        recitation_mode: c.recitation_mode ?? null,
        recitation_weekday: c.recitation_weekday ?? null,
        time_window_start: c.time_window_start ?? null,
        time_window_end: c.time_window_end ?? null,
      })))
      const cursorIds:   Record<string, number | null>    = {}
      const cursorFns:   Record<string, string | null>    = {}
      const counts:      Record<string, number>           = {}
      const durations:   Record<string, string>           = {}
      const advReads:    Record<string, number>           = {}
      const reqRec:      Record<string, boolean>          = {}
      const recModes:    Record<string, 'auto'|'manual'>  = {}
      const recWeekdays: Record<string, number>           = {}
      const timeStarts:  Record<string, string>           = {}
      const timeEnds:    Record<string, string>           = {}
      results.forEach(c => {
        cursorIds[c.id]   = c.cursor_library_id ?? null
        cursorFns[c.id]   = c.cursor_filename ?? null
        counts[c.id]      = c.daily_count ?? 3
        durations[c.id]   = c.min_duration_s != null ? String(Math.round(c.min_duration_s / 60)) : ''
        advReads[c.id]    = c.advance_after_reads ?? 5
        reqRec[c.id]      = (c.requires_recitation ?? 1) !== 0
        recModes[c.id]    = (c.recitation_mode ?? 'auto') === 'manual' ? 'manual' : 'auto'
        recWeekdays[c.id] = c.recitation_weekday ?? 5
        timeStarts[c.id]  = c.time_window_start ?? '07:00'
        timeEnds[c.id]    = c.time_window_end ?? '08:00'
      })
      setLocalCursorIds(cursorIds)
      setLocalCursorFilenames(cursorFns)
      setLocalCounts(counts)
      setLocalMinDurations(durations)
      setLocalAdvanceReads(advReads)
      setLocalRequiresRec(reqRec)
      setLocalRecMode(recModes)
      setLocalRecWeekday(recWeekdays)
      setLocalTimeStart(timeStarts)
      setLocalTimeEnd(timeEnds)
    } finally {
      setLoadingPool(false)
    }
  }

  const handleOpenPoolModal = (childId: string) => {
    setPoolModal(childId)
  }

  const handleSaveConfig = async (childId: string) => {
    setSavingChild(childId)
    try {
      const minDurMin = localMinDurations[childId]
      const min_duration_s = minDurMin ? parseInt(minDurMin) * 60 : null
      const res = await adminFetch('/api/admin/pool/configure', {
        method: 'POST',
        body: JSON.stringify({
          child_id: childId,
          cursor_library_id: localCursorIds[childId] ?? null,
          daily_count: localCounts[childId],
          min_duration_s,
          advance_after_reads: localAdvanceReads[childId] ?? undefined,
          requires_recitation: localRequiresRec[childId] !== undefined ? (localRequiresRec[childId] ? 1 : 0) : undefined,
          recitation_mode: localRecMode[childId] ?? undefined,
          recitation_weekday: localRecWeekday[childId] ?? undefined,
          time_window_start: localTimeStart[childId] || null,
          time_window_end: localTimeEnd[childId] || null,
        }),
      })
      if (!res.ok) { alert('保存失败'); return }
    } finally {
      setSavingChild(null)
    }
  }

  const handleDeleteSession = async (sessionId: number) => {
    const session = sessions.find(s => s.id === sessionId)
    if (!session) return
    if (!confirm(`确认删除这条录音？此操作不可恢复。\n孩子：${session.child_name}\n时间：${session.start_time}`)) return
    await adminFetch(`/api/admin/sessions/${sessionId}`, { method: 'DELETE' })
    refreshSessions()
  }

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (!confirm(`确认删除选中的 ${ids.length} 条录音？此操作不可恢复。`)) return
    await adminFetch('/api/admin/sessions/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    })
    setSelectedIds(new Set())
    refreshSessions()
  }

  // ── Recitation helpers ────────────────────────────────────────────────────
  const refreshRecPlans = async () => {
    setLoadingRec(true)
    try {
      const data = await adminFetch('/api/admin/recitation?upcoming=1').then(r => r.json())
      setRecPlans(Array.isArray(data) ? data : [])
    } finally {
      setLoadingRec(false)
    }
  }

  const handleScheduleRecitation = async () => {
    if (!recChildId || !recPdf || !recDate) { alert('请填写所有字段'); return }
    setSchedulingRec(true)
    try {
      const res = await adminFetch('/api/admin/recitation/schedule', {
        method: 'POST',
        body: JSON.stringify({
          child_id: recChildId,
          pdf_filename: recPdf,
          pdf_library_id: recLibraryId,
          scheduled_date: recDate,
        }),
      })
      if (!res.ok) { alert('安排失败'); return }
      setRecPdf(null)
      setRecLibraryId(null)
      setRecDate('')
      await refreshRecPlans()
    } finally {
      setSchedulingRec(false)
    }
  }

  const handleDeleteRecPlan = async (id: number) => {
    if (!confirm('确认删除此考核计划？')) return
    await adminFetch(`/api/admin/recitation/${id}`, { method: 'DELETE' })
    setRecPlans(prev => prev.filter(p => p.id !== id))
  }

  const handleCancelRecPlan = async (id: number) => {
    if (!confirm('确认取消此考核计划？')) return
    const res = await adminFetch(`/api/admin/recitation/${id}/cancel`, { method: 'POST' })
    if (!res.ok) { alert('取消失败'); return }
    setRecPlans(prev => prev.filter(p => p.id !== id))
  }

  const handleOpenRecModal = () => { setRecModal(true) }

  const handleSelectRecPdf = (libraryId: number, filename: string) => {
    setRecPdf(filename)
    setRecLibraryId(libraryId)
    setRecModal(false)
  }

  const handleAddUser = async () => {
    if (!newUserName.trim() || !newUserAge) return
    const res = await adminFetch('/api/admin/children', {
      method: 'POST',
      body: JSON.stringify({ name: newUserName.trim(), age: parseInt(newUserAge) }),
    })
    if (!res.ok) { alert('添加失败'); return }
    setAddUserOpen(false); setNewUserName(''); setNewUserAge('')
    await refreshChildConfigs()
  }

  const handleDeleteChild = async (childId: string, childName: string) => {
    if (!confirm(`确认删除用户 ${childName}？所有录音、记录将一并删除，此操作不可恢复。`)) return
    const res = await adminFetch(`/api/admin/children/${childId}`, { method: 'DELETE' })
    if (!res.ok) { alert('删除失败'); return }
    await refreshChildConfigs()
  }

  // ── Auth handlers ─────────────────────────────────────────────────────────
  const handleSetup = async () => {
    if (!/^\d{4,6}$/.test(pin))  { setError('PIN 必须是 4-6 位数字'); return }
    if (pin !== confirmPin)       { setError('两次输入的 PIN 不一致'); return }
    setError('')
    try {
      const r1 = await fetch('/api/auth/set-pin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPin: pin }),
      })
      if (!r1.ok) { const d = await r1.json(); setError(d.error || '设置失败'); return }
      const r2 = await fetch('/api/auth/parent-unlock', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      if (!r2.ok) { const d = await r2.json(); setError(d.error || '解锁失败'); return }
      setPin(''); setConfirmPin('')
      setView('dashboard')
    } catch { setError('网络错误') }
  }

  const handleUnlock = async () => {
    if (!pin || lockSeconds > 0) return
    setError('')
    try {
      const res = await fetch('/api/auth/parent-unlock', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      if (res.ok) {
        setPin(''); setView('dashboard')
      } else if (res.status === 429) {
        const d = await res.json()
        setLockSeconds(d.retryAfter || 60)
      } else {
        setError('PIN 错误'); setPin('')
      }
    } catch { setError('网络错误') }
  }

  const handleReview = async (sessionId: number, decision: string) => {
    try {
      await adminFetch(`/api/admin/sessions/${sessionId}/review`, {
        method: 'POST', body: JSON.stringify({ decision }),
      })
      setSessions(prev => prev.map(s =>
        s.id === sessionId ? { ...s, status: decision === 'redo' ? 'redo_required' : decision } : s
      ))
    } catch { /* ignore */ }
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (view === 'loading') return (
    <div className="min-h-screen bg-cream flex items-center justify-center">
      <p className="text-brown-mute">加载中...</p>
    </div>
  )

  // ── Auth card ─────────────────────────────────────────────────────────────
  if (view === 'setup' || view === 'login') {
    const isSetup = view === 'setup'
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-[24px] p-8
          shadow-[0_4px_24px_rgba(224,122,95,0.15)]">
          <h1 className="text-[28px] font-extrabold text-brown-text text-center mb-2">
            {isSetup ? '设置家长 PIN' : '家长验证'}
          </h1>
          <p className="text-brown-mute text-sm text-center mb-8">
            {isSetup ? '首次使用，请设置 4-6 位数字 PIN' : '请输入家长 PIN 以进入审核面板'}
          </p>
          <div className="flex flex-col gap-4">
            <PinInput value={pin} onChange={setPin}
              placeholder={isSetup ? 'PIN（4-6 位数字）' : '请输入 PIN'} />
            {isSetup && (
              <PinInput value={confirmPin} onChange={setConfirmPin} placeholder="再次输入 PIN 确认" />
            )}
            {error && <p className="text-red-500 text-sm text-center">{error}</p>}
            {lockSeconds > 0 && (
              <p className="text-orange-500 text-sm text-center font-bold">
                请稍候 {lockSeconds} 秒后重试
              </p>
            )}
            <button onClick={isSetup ? handleSetup : handleUnlock} disabled={lockSeconds > 0}
              className="bg-peach text-white rounded-[14px] py-3.5 font-extrabold w-full
                text-[15px] hover:bg-peach-deep transition-colors disabled:opacity-40">
              {isSetup ? '设置 PIN' : '进入面板'}
            </button>
          </div>
          <div className="mt-6 text-center">
            <Link to="/" className="text-brown-faint text-sm font-bold hover:text-peach">← 返回首页</Link>
          </div>
        </div>
      </div>
    )
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  const pendingCount = sessions.filter(s => s.status === 'pending_review').length
  const filtered = sessions.filter(s =>
    (filterChild  === 'all' || s.child_id      === filterChild) &&
    (filterType   === 'all' || (s.session_type ?? 'reading') === filterType) &&
    (filterStatus === 'all' || s.status        === filterStatus)
  )
  const allSelected = filtered.length > 0 && filtered.every(s => selectedIds.has(s.id))
  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(filtered.map(s => s.id)))
  }
  const toggleOne = (id: number) => setSelectedIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  return (
    <div className="min-h-screen bg-cream">
      {/* Top bar */}
      <div className="bg-shell-dark px-6 py-4 flex justify-between items-center">
        <span className="text-white font-extrabold text-[18px]">家长面板</span>
        <button onClick={() => { fetch('/api/auth/parent-lock', { method: 'POST' }); navigate('/') }}
          className="text-[#C09A80] text-sm font-bold hover:text-white transition-colors">
          退出 →
        </button>
      </div>

      <div className="max-w-4xl mx-auto p-6">
        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button onClick={() => setTab('review')}
            className={`px-5 py-2.5 rounded-[12px] font-extrabold text-sm transition-colors flex items-center gap-2
              ${tab === 'review' ? 'bg-peach text-white' : 'bg-white text-brown-mute hover:bg-cream-card'}`}>
            待审核录音
            {pendingCount > 0 && (
              <span className={`text-[11px] font-extrabold px-1.5 py-0.5 rounded-full
                ${tab === 'review' ? 'bg-white/30 text-white' : 'bg-peach text-white'}`}>
                {pendingCount}
              </span>
            )}
          </button>
          <button onClick={() => setTab('pool')}
            className={`px-5 py-2.5 rounded-[12px] font-extrabold text-sm transition-colors
              ${tab === 'pool' ? 'bg-peach text-white' : 'bg-white text-brown-mute hover:bg-cream-card'}`}>
            书单管理
          </button>
          <button onClick={() => setTab('recitation')}
            className={`px-5 py-2.5 rounded-[12px] font-extrabold text-sm transition-colors
              ${tab === 'recitation' ? 'bg-peach text-white' : 'bg-white text-brown-mute hover:bg-cream-card'}`}>
            考核计划
          </button>
          <button onClick={() => setTab('users')}
            className={`px-5 py-2.5 rounded-[12px] font-extrabold text-sm transition-colors
              ${tab === 'users' ? 'bg-peach text-white' : 'bg-white text-brown-mute hover:bg-cream-card'}`}>
            用户管理
          </button>
          <button onClick={() => setTab('uploads')}
            className={`px-4 py-2 rounded-[12px] text-sm font-extrabold transition-colors
              ${tab === 'uploads' ? 'bg-peach text-white' : 'bg-white text-brown-mute hover:bg-cream-card'}`}>
            我的上传
          </button>
        </div>

        {/* ── Review tab ── */}
        {tab === 'review' && (
          <div>
            {/* Filter bar */}
            <div className="bg-white rounded-[14px] p-4 mb-4 flex flex-wrap items-center gap-4
              shadow-[0_2px_12px_rgba(224,122,95,0.08)]">
              <div className="flex items-center gap-2">
                <span className="text-xs text-brown-mute font-extrabold">孩子</span>
                {(['all', ...allChildren.map(c => c.id)] as string[]).map(c => (
                  <button key={c} onClick={() => setFilterChild(c)}
                    className={`px-3 py-1.5 rounded-[10px] text-xs font-extrabold transition-colors
                      ${filterChild === c ? 'bg-peach text-white' : 'bg-cream text-brown-mute hover:bg-[#F5E8DD]'}`}>
                    {c === 'all' ? '全部' : (allChildren.find(ch => ch.id === c)?.name ?? c)}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-brown-mute font-extrabold">类型</span>
                {(['all', 'reading', 'recitation'] as const).map(t => (
                  <button key={t} onClick={() => setFilterType(t)}
                    className={`px-3 py-1.5 rounded-[10px] text-xs font-extrabold transition-colors
                      ${filterType === t ? 'bg-peach text-white' : 'bg-cream text-brown-mute hover:bg-[#F5E8DD]'}`}>
                    {t === 'all' ? '全部' : t === 'reading' ? '🎤 朗读' : '📚 背诵'}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-brown-mute font-extrabold">状态</span>
                {([
                  ['all',           '全部'],
                  ['pending_review','待审核'],
                  ['passed',        '通过'],
                  ['redo_required', '需重读'],
                  ['time_short',    '时长不足'],
                  ['long_pause',    '停顿过长'],
                ] as const).map(([s, label]) => (
                  <button key={s} onClick={() => setFilterStatus(s)}
                    className={`px-3 py-1.5 rounded-[10px] text-xs font-extrabold transition-colors
                      ${filterStatus === s ? 'bg-peach text-white' : 'bg-cream text-brown-mute hover:bg-[#F5E8DD]'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Selection bar */}
            {filtered.length > 0 && !selectMode && (
              <div className="flex justify-end mb-3 px-1">
                <button onClick={() => setSelectMode(true)}
                  className="text-sm font-bold text-brown-mute hover:text-peach transition-colors">
                  选择
                </button>
              </div>
            )}
            {filtered.length > 0 && selectMode && (
              <div className="flex items-center justify-between mb-3 px-1">
                <div className="flex items-center gap-4">
                  <span className="text-sm font-bold text-brown-text">已选 {selectedIds.size}/{filtered.length}</span>
                  <button onClick={toggleAll} className="text-sm font-bold text-brown-mute hover:text-peach transition-colors">
                    {allSelected ? '取消全选' : '全选'}
                  </button>
                </div>
                <div className="flex items-center gap-4">
                  <button onClick={handleBulkDelete} disabled={selectedIds.size === 0}
                    className="text-sm font-bold text-red-500 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                    删除（{selectedIds.size}）
                  </button>
                  <button onClick={() => { setSelectMode(false); setSelectedIds(new Set()) }}
                    className="text-sm font-bold text-brown-mute hover:text-peach transition-colors">
                    取消
                  </button>
                </div>
              </div>
            )}

            {loadingSess && <p className="text-brown-mute text-sm">加载中...</p>}
            {!loadingSess && filtered.length === 0 && (
              <div className="bg-white rounded-[20px] p-8 text-center
                shadow-[0_4px_24px_rgba(224,122,95,0.10)]">
                <p className="text-brown-mute">{sessions.length === 0 ? '暂无会话记录' : '没有符合筛选条件的记录'}</p>
              </div>
            )}
            <div className="space-y-3">
              {filtered.map(session => (
                <SessionCard key={session.id} session={session}
                  expandedAudio={expandedAudio}
                  onToggleAudio={id => setExpandedAudio(prev => prev === id ? null : id)}
                  onReview={handleReview}
                  onDelete={handleDeleteSession}
                  checked={selectedIds.has(session.id)}
                  onToggleCheck={toggleOne}
                  selectMode={selectMode} />
              ))}
            </div>
          </div>
        )}

        {/* ── Pool tab ── */}
        {tab === 'pool' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-brown-text">书单管理</h3>
              <button onClick={() => setTab('recitation')}
                className="text-sm font-extrabold text-peach hover:underline">
                去考核计划修改设置 →
              </button>
            </div>
            {loadingPool ? (
              <p className="text-brown-mute text-sm">加载中...</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {allChildren.map(c => {
                  const cursorId = localCursorIds[c.id] ?? c.cursor_library_id ?? null
                  const cursorFn = localCursorFilenames[c.id] !== undefined ? localCursorFilenames[c.id] : (c.cursor_filename ?? null)
                  return (
                    <div key={c.id} className="bg-white rounded-[20px] p-5 shadow-[0_4px_24px_rgba(224,122,95,0.08)]">
                      <h3 className="text-lg font-extrabold text-brown-text mb-3">{c.name}</h3>
                      <p className="text-sm font-extrabold text-brown-text mb-1.5">起点 PDF</p>
                      <div className="bg-cream rounded-[10px] p-3">
                        {cursorId && cursorFn ? (
                          <>
                            <p className="font-extrabold text-brown-text text-sm truncate">{cursorFn}</p>
                            <p className="text-xs text-brown-mute mt-0.5">library_id={cursorId}</p>
                          </>
                        ) : (
                          <p className="text-brown-mute text-sm">未配置</p>
                        )}
                      </div>
                      <button onClick={() => setTab('recitation')}
                        className="mt-3 text-sm font-extrabold text-peach hover:underline">
                        去考核计划修改设置 →
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Recitation tab ── */}
        {tab === 'recitation' && (
          <div>
            {/* 角色考核设置 */}
            {allChildren.length > 0 && (
              <div className="mb-6">
                <h3 className="text-lg font-extrabold text-brown-text mb-3">角色考核设置</h3>
                {loadingPool ? (
                  <p className="text-brown-mute text-sm">加载中...</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {allChildren.map(c => (
                      <ChildExamConfigCard
                        key={c.id}
                        child={{ id: c.id, name: c.name }}
                        localData={{
                          cursorId: localCursorIds[c.id] ?? c.cursor_library_id ?? null,
                          cursorFilename: localCursorFilenames[c.id] !== undefined
                            ? localCursorFilenames[c.id]
                            : (c.cursor_filename ?? null),
                          count: localCounts[c.id] ?? 3,
                          minDurationMin: localMinDurations[c.id] ?? '',
                          timeWindowStart: localTimeStart[c.id] ?? '07:00',
                          timeWindowEnd: localTimeEnd[c.id] ?? '08:00',
                          advanceAfterReads: localAdvanceReads[c.id] ?? 5,
                          requiresRecitation: localRequiresRec[c.id] !== undefined
                            ? localRequiresRec[c.id]
                            : (c.requires_recitation ?? 1) !== 0,
                          recitationMode: localRecMode[c.id] ?? 'auto',
                          recitationWeekday: localRecWeekday[c.id] ?? 5,
                        }}
                        onChangeCursor={() => handleOpenPoolModal(c.id)}
                        onChange={(field, value) => {
                          if (field === 'count') setLocalCounts(p => ({ ...p, [c.id]: value as number }))
                          else if (field === 'minDurationMin') setLocalMinDurations(p => ({ ...p, [c.id]: value as string }))
                          else if (field === 'timeWindowStart') setLocalTimeStart(p => ({ ...p, [c.id]: value as string }))
                          else if (field === 'timeWindowEnd') setLocalTimeEnd(p => ({ ...p, [c.id]: value as string }))
                          else if (field === 'advanceAfterReads') setLocalAdvanceReads(p => ({ ...p, [c.id]: value as number }))
                          else if (field === 'requiresRecitation') setLocalRequiresRec(p => ({ ...p, [c.id]: value as boolean }))
                          else if (field === 'recitationMode') setLocalRecMode(p => ({ ...p, [c.id]: value as 'auto'|'manual' }))
                          else if (field === 'recitationWeekday') setLocalRecWeekday(p => ({ ...p, [c.id]: value as number }))
                        }}
                        onSave={() => handleSaveConfig(c.id)}
                        saving={savingChild === c.id}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 手动安排背诵 form */}
            <div className="bg-white rounded-[20px] p-5 shadow-[0_4px_24px_rgba(224,122,95,0.08)] mb-5">
              <h3 className="font-extrabold text-brown-text mb-4">手动安排背诵</h3>
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-sm font-extrabold text-brown-text mb-1.5 block">孩子</label>
                  <select value={recChildId} onChange={e => setRecChildId(e.target.value)}
                    className="w-full bg-cream rounded-[10px] px-3 py-2.5 text-brown-text font-extrabold
                      border-2 border-transparent focus:border-peach outline-none">
                    {allChildren.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-extrabold text-brown-text mb-1.5 block">考核 PDF</label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-cream rounded-[10px] px-3 py-2.5 min-h-[44px] flex items-center min-w-0">
                      {recPdf ? (
                        <span className="text-sm text-brown-text truncate">{recPdf.split('/').pop()}</span>
                      ) : (
                        <span className="text-sm text-brown-mute">未选择</span>
                      )}
                    </div>
                    <button onClick={handleOpenRecModal}
                      className="bg-peach text-white text-sm font-extrabold px-3 py-2.5 rounded-[10px]
                        hover:opacity-90 transition-opacity shrink-0">
                      选择 PDF
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-extrabold text-brown-text mb-1.5 block">考核日期</label>
                  <input type="date" value={recDate} onChange={e => setRecDate(e.target.value)}
                    min={new Date().toISOString().slice(0, 10)}
                    className="w-full bg-cream rounded-[10px] px-3 py-2.5 text-brown-text font-extrabold
                      border-2 border-transparent focus:border-peach outline-none" />
                </div>
                <button onClick={handleScheduleRecitation} disabled={schedulingRec}
                  className="bg-peach text-white py-2.5 px-5 rounded-[12px] font-extrabold w-full
                    hover:opacity-90 transition-opacity disabled:opacity-40">
                  {schedulingRec ? '安排中...' : '📅 手动安排背诵'}
                </button>
              </div>
            </div>

            {/* Plans list */}
            {loadingRec ? (
              <p className="text-brown-mute text-sm">加载中...</p>
            ) : recPlans.length === 0 ? (
              <div className="bg-white rounded-[20px] p-8 text-center shadow-[0_4px_24px_rgba(224,122,95,0.08)]">
                <p className="text-brown-mute">暂无考核计划</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recPlans.map(plan => {
                  const si = REC_STATUS[plan.status] ?? { label: plan.status, cls: 'bg-[#F5E8DD] text-brown-faint' }
                  const isActive = plan.status === 'scheduled' || plan.status === 'retry'
                  return (
                    <div key={plan.id}
                      className="bg-white rounded-[20px] p-4 shadow-[0_4px_24px_rgba(224,122,95,0.08)] flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-extrabold text-brown-text text-[15px]">{plan.child_name}</span>
                          <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full
                            ${plan.auto ? 'bg-blue-100 text-blue-700' : 'bg-[#F5E8DD] text-brown-text'}`}>
                            {plan.auto ? '🤖 自动' : '👤 手动'}
                          </span>
                          <span className="text-brown-mute text-[12px]">· {plan.scheduled_date}</span>
                          <span className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full ${si.cls}`}>
                            {si.label}
                          </span>
                        </div>
                        <p className="text-sm text-brown-text truncate">
                          {plan.pdf_filename.split('/').pop()?.replace('.pdf', '')}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {isActive && (
                          <button onClick={() => handleCancelRecPlan(plan.id)}
                            className="text-[12px] font-extrabold text-orange-600 bg-orange-50
                              hover:bg-orange-100 px-2.5 py-1 rounded-[8px] transition-colors">
                            取消
                          </button>
                        )}
                        <button onClick={() => handleDeleteRecPlan(plan.id)}
                          className="text-red-400 hover:text-red-600 text-xl leading-none px-1">
                          ×
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Uploads tab ── */}
        {tab === 'uploads' && <UploadsTab />}

        {/* ── Users tab ── */}
        {tab === 'users' && (
          <div className="space-y-6">
            {/* 子区 1: 账户设置 */}
            <AccountInlineSettings />

            {/* 子区 2: 角色管理 */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-xl font-extrabold text-brown-text">角色管理</h2>
                  <p className="text-sm text-brown-mute mt-0.5">添加、查看、删除朗读角色</p>
                </div>
                <button onClick={() => setAddUserOpen(true)}
                  className="bg-peach text-white font-extrabold px-5 py-3 rounded-[14px]
                    hover:opacity-90 transition-opacity text-sm">
                  + 添加角色
                </button>
              </div>
              <div className="bg-white rounded-[20px] shadow-[0_4px_24px_rgba(224,122,95,0.08)]
                divide-y divide-[#F5E8DD]">
                {allChildren.map(c => (
                  <div key={c.id} className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-peach/20 flex items-center justify-center
                           text-peach-deep font-extrabold text-lg shrink-0">
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-extrabold text-brown-text">{c.name}</div>
                        <div className="text-xs text-brown-mute mt-0.5">
                          {c.age} 岁 · 每日 {c.daily_count ?? 3} 本 ·
                          时长 {Math.round((c.min_duration_s ?? 300) / 60)} 分钟
                        </div>
                      </div>
                    </div>
                    <button onClick={() => handleDeleteChild(c.id, c.name)}
                      className="text-red-400 hover:text-red-600 text-sm font-extrabold
                        px-3 py-1.5 rounded-[10px] hover:bg-red-50 transition-colors shrink-0">
                      🗑 删除
                    </button>
                  </div>
                ))}
                {allChildren.length === 0 && (
                  <p className="text-center text-brown-mute py-8 text-sm">
                    尚未添加角色，点击右上角「+ 添加角色」开始
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Pool cursor PDF modal */}
      {poolModal && (
        <AddPdfModal
          childName={allChildren.find(c => c.id === poolModal)?.name ?? ''}
          onAdd={(libraryId, filename) => {
            setLocalCursorIds(prev => ({ ...prev, [poolModal]: libraryId }))
            setLocalCursorFilenames(prev => ({ ...prev, [poolModal]: filename }))
            setPoolModal(null)
          }}
          onClose={() => setPoolModal(null)}
        />
      )}

      {/* Recitation PDF modal */}
      {recModal && (
        <AddPdfModal
          childName={allChildren.find(c => c.id === recChildId)?.name ?? ''}
          onAdd={handleSelectRecPdf}
          onClose={() => setRecModal(false)}
        />
      )}

      {/* 添加用户 modal */}
      {addUserOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
             onClick={() => setAddUserOpen(false)}>
          <div className="bg-white rounded-[24px] max-w-sm w-full p-6"
               onClick={e => e.stopPropagation()}>
            <h3 className="font-extrabold text-brown-text text-lg mb-4">添加角色</h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-extrabold text-brown-text mb-1 block">姓名</label>
                <input value={newUserName} onChange={e => setNewUserName(e.target.value)}
                  placeholder="例如：Alex"
                  className="w-full bg-cream rounded-[10px] px-3 py-2.5 text-brown-text outline-none
                    border-2 border-transparent focus:border-peach transition-colors" />
              </div>
              <div>
                <label className="text-sm font-extrabold text-brown-text mb-1 block">年龄</label>
                <input type="number" min={1} max={99} value={newUserAge}
                  onChange={e => setNewUserAge(e.target.value)} placeholder="例如：8"
                  className="w-full bg-cream rounded-[10px] px-3 py-2.5 text-brown-text outline-none
                    border-2 border-transparent focus:border-peach transition-colors" />
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button onClick={() => { setAddUserOpen(false); setNewUserName(''); setNewUserAge('') }}
                  className="bg-cream text-brown-mute text-sm font-extrabold px-4 py-2 rounded-[10px]
                    hover:bg-cream-card transition-colors">
                  取消
                </button>
                <button onClick={handleAddUser}
                  className="bg-peach text-white text-sm font-extrabold px-4 py-2 rounded-[10px]
                    hover:opacity-90 transition-opacity">
                  添加
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
