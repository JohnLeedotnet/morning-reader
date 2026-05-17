import { useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { Link } from 'react-router-dom'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export default function PdfTest() {
  const [numPages, setNumPages] = useState<number>(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages)
    setLoaded(true)
    setError('')
  }

  function onDocumentLoadError(err: Error) {
    setError(`❌ PDF 加载失败：${err.message}`)
    setLoaded(false)
  }

  const isWide = window.innerWidth >= 768

  return (
    <div className="flex flex-col items-center min-h-screen bg-gray-100 p-4 gap-4">
      <div className="w-full max-w-4xl">
        <Link to="/" className="text-blue-500 text-sm">← 返回</Link>
        <h1 className="text-2xl font-bold text-gray-800 mt-2">📄 PDF 渲染测试</h1>
        <p className="text-gray-500 text-sm">
          设备宽度：{window.innerWidth}px（{isWide ? 'iPad/Mac — 双页' : 'iPhone — 单页'}）
        </p>
      </div>

      {error && (
        <div className="bg-red-100 text-red-800 px-4 py-3 rounded-xl text-sm w-full max-w-4xl">
          {error}
        </div>
      )}

      {loaded && (
        <div className="flex items-center gap-4 text-sm text-gray-600 bg-white px-4 py-2 rounded-xl shadow-sm">
          <button
            onClick={() => setPageNumber(p => Math.max(1, p - 1))}
            disabled={pageNumber <= 1}
            className="px-3 py-1 bg-gray-200 rounded disabled:opacity-40"
          >← 上一页</button>
          <span>第 {pageNumber} / {numPages} 页</span>
          <button
            onClick={() => setPageNumber(p => Math.min(numPages, p + 1))}
            disabled={pageNumber >= numPages}
            className="px-3 py-1 bg-gray-200 rounded disabled:opacity-40"
          >下一页 →</button>
        </div>
      )}

      {loaded && (
        <div className="text-sm text-green-700 bg-green-100 px-4 py-2 rounded-xl">
          ✅ PDF 加载成功，共 {numPages} 页
        </div>
      )}

      <Document
        file="/api/pdfs/sample"
        onLoadSuccess={onDocumentLoadSuccess}
        onLoadError={onDocumentLoadError}
        loading={<div className="text-gray-500 py-8">正在加载 PDF...</div>}
      >
        {isWide ? (
          <div className="flex gap-2 justify-center">
            <Page pageNumber={pageNumber} width={Math.min(window.innerWidth / 2 - 24, 500)} />
            {pageNumber + 1 <= numPages && (
              <Page pageNumber={pageNumber + 1} width={Math.min(window.innerWidth / 2 - 24, 500)} />
            )}
          </div>
        ) : (
          <Page pageNumber={pageNumber} width={window.innerWidth - 32} />
        )}
      </Document>
    </div>
  )
}
