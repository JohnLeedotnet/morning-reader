import { useLocation, useNavigate, Navigate } from 'react-router-dom'

interface DiscardedState {
  reason: 'too_short' | 'too_silent'
  total_duration_s: number
  silence_ratio: number
  childName: string
  isRecitation: boolean
}

export default function DiscardedPage() {
  const navigate = useNavigate()
  const loc = useLocation()
  const state = loc.state as DiscardedState | null

  if (!state) {
    return <Navigate to="/" replace />
  }

  const reasonText = state.reason === 'too_short'
    ? `录音时长不足 20 秒（实际 ${state.total_duration_s} 秒）`
    : `录音静音超过 70%（实际 ${Math.round(state.silence_ratio * 100)}%）`

  return (
    <div className="min-h-screen bg-cream flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-[480px] bg-white rounded-[24px] p-8
        shadow-[0_4px_24px_rgba(224,122,95,0.12)]">

        <h1 className="text-[22px] font-black text-brown-text text-center mb-6">
          {state.isRecitation ? '背诵考核未保存' : '朗读未保存'}
        </h1>

        <div className="flex justify-center mb-7">
          <span className="bg-orange-400 text-white text-[15px] font-extrabold px-6 py-2.5 rounded-full">
            ⚠ 录音质量不达标
          </span>
        </div>

        <div className="bg-[#FFF5EB] rounded-[14px] p-5 space-y-2.5">
          <div className="flex justify-between">
            <span className="text-brown-mute text-[14px]">用户名</span>
            <span className="font-extrabold text-[14px] text-brown-text">{state.childName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-brown-mute text-[14px]">录音时长</span>
            <span className={`font-extrabold text-[14px] ${
              state.reason === 'too_short' ? 'text-red-500' : 'text-brown-text'}`}>
              {state.total_duration_s} 秒
            </span>
          </div>
          {state.reason === 'too_silent' && (
            <div className="flex justify-between">
              <span className="text-brown-mute text-[14px]">静音比例</span>
              <span className="font-extrabold text-[14px] text-red-500">
                {Math.round(state.silence_ratio * 100)}%
              </span>
            </div>
          )}
        </div>

        <div className="mt-5 bg-orange-50 border-l-4 border-orange-400 rounded-[10px] p-4">
          <p className="text-brown-text text-[14px] font-bold leading-relaxed">
            原因：{reasonText}
          </p>
          <p className="text-brown-mute text-[13px] mt-1.5">
            本次录音已自动删除，请重新开始朗读 🎤
          </p>
        </div>

        <button
          onClick={() => navigate('/', { replace: true })}
          className="w-full mt-6 bg-peach text-white font-extrabold rounded-[14px] py-3.5 text-[16px]
            active:scale-[0.98] transition-transform"
        >
          返回首页
        </button>
      </div>
    </div>
  )
}
