import { useState } from 'react'
import { Link } from 'react-router-dom'

type Status = 'idle' | 'requesting' | 'ok' | 'error'

export default function MicTest() {
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')
  const [stream, setStream] = useState<MediaStream | null>(null)

  async function testMic() {
    setStatus('requesting')
    setMessage('正在请求麦克风权限...')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      setStream(s)
      setStatus('ok')
      setMessage('✅ 麦克风正常 — 授权成功')
    } catch (err) {
      setStatus('error')
      const e = err as { name?: string; message?: string }
      const name = e?.name ?? 'UnknownError'
      const msg = e?.message ?? '(无消息)'
      setMessage(`❌ [${name}] ${msg}`)
    }
  }

  function stopMic() {
    stream?.getTracks().forEach(t => t.stop())
    setStream(null)
    setStatus('idle')
    setMessage('')
  }

  const bgColor =
    status === 'ok' ? 'bg-green-50' :
    status === 'error' ? 'bg-red-50' :
    'bg-gray-50'

  return (
    <div className={`flex flex-col items-center justify-center min-h-screen gap-6 p-8 ${bgColor}`}>
      <Link to="/" className="self-start text-blue-500 text-sm">← 返回</Link>

      <h1 className="text-2xl font-bold text-gray-800">🎤 麦克风测试</h1>
      <p className="text-gray-500 text-center text-sm">
        测试 iOS Safari 是否可以获取麦克风权限
        <br />
        （必须通过 mac-mini.local 或 localhost 访问）
      </p>

      {status === 'idle' || status === 'error' ? (
        <button
          onClick={testMic}
          className="bg-blue-500 text-white py-5 px-10 rounded-2xl text-xl font-bold active:bg-blue-700"
        >
          测试麦克风
        </button>
      ) : status === 'requesting' ? (
        <div className="text-gray-500 text-lg animate-pulse">请求中...</div>
      ) : (
        <button
          onClick={stopMic}
          className="bg-red-500 text-white py-5 px-10 rounded-2xl text-xl font-bold"
        >
          停止麦克风
        </button>
      )}

      {message && (
        <div className={`text-lg font-medium text-center px-4 py-3 rounded-xl ${
          status === 'ok' ? 'bg-green-100 text-green-800' :
          status === 'error' ? 'bg-red-100 text-red-800' :
          'text-gray-600'
        }`}>
          {message}
        </div>
      )}

      {status === 'error' && (
        <textarea
          readOnly
          value={message}
          onClick={e => (e.target as HTMLTextAreaElement).select()}
          className="w-full max-w-sm text-xs text-red-800 bg-red-50 border border-red-300 rounded-xl p-3 resize-none h-20 mt-2"
        />
      )}

      <div className="text-xs text-gray-400 text-center mt-4 space-y-1">
        <p>地址：{window.location.href}</p>
        <p>HTTPS：{location.protocol === 'https:' ? '✓' : '✗（getUserMedia 要求 HTTPS）'}</p>
        <p>mediaDevices：{typeof navigator.mediaDevices !== 'undefined' ? '✓' : '✗（API 不存在）'}</p>
        <p>getUserMedia：{typeof navigator.mediaDevices?.getUserMedia === 'function' ? '✓' : '✗'}</p>
        <p className="break-all">UA：{navigator.userAgent}</p>
      </div>
    </div>
  )
}
