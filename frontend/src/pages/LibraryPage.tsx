import { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Document, Page, pdfjs } from 'react-pdf'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

interface LibraryItem {
  id: number; sha256: string; filename: string
  title: string | null; size_bytes: number
  is_private: number; is_builtin: number
  category_path: string | null
}
interface LibraryCategory { path: string; count: number }

function fmtSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

// ── PDF 预览 Modal ─────────────────────────────────────────────────────────────

function PdfModal({ item, onClose }: { item: LibraryItem; onClose: () => void }) {
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
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-start overflow-auto py-6 px-2"
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

        {/* 翻页 */}
        <div className="flex items-center justify-center gap-6 px-5 py-3 border-t border-cream-card">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-cream
              text-brown-text font-extrabold disabled:opacity-30 hover:bg-cream-card transition-colors">
            ←
          </button>
          <span className="text-sm font-bold text-brown-text min-w-[80px] text-center">
            {numPages > 0 ? `${page} / ${numPages}` : '—'}
          </span>
          <button onClick={() => setPage(p => Math.min(numPages, p + 1))}
            disabled={page >= numPages || numPages === 0}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-cream
              text-brown-text font-extrabold disabled:opacity-30 hover:bg-cream-card transition-colors">
            →
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 主页面 ─────────────────────────────────────────────────────────────────────

export default function LibraryPage() {
  const navigate = useNavigate()
  const [authed,          setAuthed]          = useState<boolean | null>(null)
  const [items,           setItems]           = useState<LibraryItem[]>([])
  const [categories,      setCategories]      = useState<LibraryCategory[]>([])
  const [loading,         setLoading]         = useState(true)
  const [q,               setQ]               = useState('')
  const [debouncedQ,      setDebouncedQ]      = useState('')
  const [selectedCat,     setSelectedCat]     = useState('')
  const [expandedSeries,  setExpandedSeries]  = useState<Set<string>>(new Set())
  const [preview,         setPreview]         = useState<LibraryItem | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 鉴权
  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(me => {
        if (!me) { navigate('/login?next=/library'); return }
        setAuthed(true)
      })
      .catch(() => navigate('/login?next=/library'))
  }, [navigate])

  // debounce 搜索框
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQ(q), 500)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [q])

  // 拉 API
  useEffect(() => {
    if (!authed) return
    setLoading(true)
    const params = new URLSearchParams()
    if (debouncedQ)  params.set('q', debouncedQ)
    if (selectedCat) params.set('category', selectedCat)
    fetch(`/api/library/list?${params}`)
      .then(r => r.json())
      .then((d: { items: LibraryItem[]; categories: LibraryCategory[] }) => {
        setItems(d.items ?? [])
        // 不过滤时才刷新分类树（保持侧栏稳定）
        if (!selectedCat && !debouncedQ) setCategories(d.categories ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [authed, debouncedQ, selectedCat])

  // 分类树：按 "/" 分两级
  const seriesMap = (() => {
    const m = new Map<string, string[]>()
    for (const c of categories) {
      const sep = c.path.indexOf('/')
      const series = sep > 0 ? c.path.slice(0, sep) : c.path
      if (!m.has(series)) m.set(series, [])
      if (sep > 0) m.get(series)!.push(c.path)
    }
    return m
  })()

  const toggleSeries = (s: string) => {
    setExpandedSeries(prev => {
      const n = new Set(prev)
      n.has(s) ? n.delete(s) : n.add(s)
      return n
    })
  }

  if (authed === null) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <p className="text-brown-mute">加载中...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-cream">

      {/* ── 顶部 sticky 栏 ── */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-cream-card
          flex items-center gap-3 px-4 py-3">
        <Link to="/"
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full
            bg-cream hover:bg-cream-card text-brown-text font-bold transition-colors">
          ←
        </Link>
        <h1 className="text-base font-extrabold text-brown-text shrink-0">📖 公共图书馆</h1>
        <div className="flex-1" />
        <input
          type="search" placeholder="搜索 PDF..."
          value={q} onChange={e => setQ(e.target.value)}
          className="w-40 sm:w-56 bg-cream rounded-[10px] px-3 py-1.5 text-sm
            text-brown-text border-2 border-transparent focus:border-peach outline-none"
        />
      </div>

      {/* ── 移动端分类下拉 ── */}
      <div className="md:hidden px-4 pt-3">
        <select value={selectedCat} onChange={e => setSelectedCat(e.target.value)}
          className="w-full bg-white rounded-[10px] px-3 py-2 text-sm text-brown-text
            border-2 border-cream-card focus:border-peach outline-none">
          <option value="">全部分类</option>
          {categories.map(c => (
            <option key={c.path} value={c.path}>{c.path} ({c.count})</option>
          ))}
        </select>
      </div>

      <div className="flex max-w-[1200px] mx-auto">

        {/* ── 左侧分类树（桌面端 sticky）── */}
        <aside className="hidden md:flex flex-col w-56 shrink-0 sticky top-[57px]
            self-start h-[calc(100vh-57px)] overflow-auto p-4 border-r border-cream-card gap-0.5">
          <p className="text-[11px] font-extrabold text-brown-faint tracking-[0.15em] mb-2">分类</p>
          <button
            onClick={() => setSelectedCat('')}
            className={`w-full text-left text-sm px-2.5 py-1.5 rounded-[8px] font-bold
              ${selectedCat === ''
                ? 'bg-peach text-white'
                : 'text-brown-text hover:bg-cream'}`}>
            全部
          </button>

          {Array.from(seriesMap.entries()).map(([series, subPaths]) => (
            <div key={series}>
              {subPaths.length === 0 ? (
                <button
                  onClick={() => setSelectedCat(selectedCat === series ? '' : series)}
                  className={`w-full text-left text-sm px-2.5 py-1.5 rounded-[8px] font-bold
                    ${selectedCat === series
                      ? 'bg-peach text-white'
                      : 'text-brown-text hover:bg-cream'}`}>
                  {series}
                </button>
              ) : (
                <>
                  <button onClick={() => toggleSeries(series)}
                    className="w-full text-left text-sm px-2.5 py-1.5 rounded-[8px] font-bold
                      text-brown-text hover:bg-cream">
                    {expandedSeries.has(series) ? '▼' : '▶'} {series}
                  </button>
                  {expandedSeries.has(series) && subPaths.map(p => (
                    <button key={p}
                      onClick={() => setSelectedCat(selectedCat === p ? '' : p)}
                      className={`w-full text-left text-xs px-4 py-1.5 rounded-[8px]
                        ${selectedCat === p
                          ? 'bg-peach text-white font-extrabold'
                          : 'text-brown-mute hover:bg-cream'}`}>
                      {p.slice(p.indexOf('/') + 1)}
                    </button>
                  ))}
                </>
              )}
            </div>
          ))}
        </aside>

        {/* ── 右侧 PDF 网格 ── */}
        <main className="flex-1 min-w-0 p-4">
          {loading ? (
            <p className="text-brown-mute text-sm py-16 text-center">加载中...</p>
          ) : items.length === 0 ? (
            <p className="text-brown-mute text-sm py-16 text-center">暂无可见 PDF</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {items.map(item => (
                <button key={item.id}
                  onClick={() => setPreview(item)}
                  className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow
                    p-3 text-left flex flex-col gap-1 active:scale-[0.98] transition-transform">
                  <div className="w-full aspect-[3/4] bg-cream rounded-[10px]
                      flex items-center justify-center mb-1 shrink-0">
                    <span className="text-3xl">📄</span>
                  </div>
                  <p className="text-xs font-extrabold text-brown-text line-clamp-2 leading-snug">
                    {item.filename.replace(/\.pdf$/i, '')}
                  </p>
                  <div className="flex items-center mt-auto pt-1">
                    <span className="text-[10px] text-brown-faint">
                      {item.size_bytes ? fmtSize(item.size_bytes) : '—'}
                    </span>
                    {item.is_private === 1 && (
                      <span className="text-[10px] ml-auto" title="仅自己可见">🔒</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {!loading && items.length > 0 && (
            <p className="text-xs text-brown-faint text-center mt-6 pb-2">
              共 {items.length} 本 PDF
            </p>
          )}
        </main>
      </div>

      {preview && <PdfModal item={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}
