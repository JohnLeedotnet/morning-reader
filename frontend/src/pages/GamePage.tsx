import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { GAMES } from '../games'

const TOTAL_S = 60

export default function GamePage() {
  const { gameId }  = useParams<{ gameId: string }>()
  const navigate    = useNavigate()
  const [playing,       setPlaying]       = useState(false)
  const [remaining,     setRemaining]     = useState(TOTAL_S)
  const [score,         setScore]         = useState(0)
  const [timeUp,        setTimeUp]        = useState(false)
  const [containerSize, setContainerSize] = useState(320)
  const scoreFinalRef = useRef(0)
  const gameAreaRef   = useRef<HTMLDivElement>(null)

  const gameDef = GAMES.find(g => g.id === gameId)
  useEffect(() => { if (!gameDef) navigate('/') }, [gameDef, navigate])

  useEffect(() => {
    const el = gameAreaRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setContainerSize(Math.max(240, Math.min(width, height) - 16))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!playing) return
    const interval = setInterval(() => {
      setRemaining(s => {
        if (s <= 1) {
          clearInterval(interval)
          setTimeUp(true)
          setTimeout(() => navigate('/', { replace: true }), 1500)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [navigate, playing])

  const handleScore = (s: number) => {
    setScore(s)
    scoreFinalRef.current = s
  }

  if (!gameDef) return null

  const GameComponent = gameDef.component

  return (
    <div className="h-screen bg-cream flex flex-col overflow-hidden">
      {/* 顶栏 */}
      <div className="bg-shell-dark px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl">{gameDef.emoji}</span>
          <div>
            <p className="text-white font-extrabold text-sm leading-tight">{gameDef.name}</p>
            <p className="text-[#C09A80] text-xs font-bold tabular-nums">
              {playing ? `分数 ${score}` : '点击开始游戏'}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-center">
          <span className={`font-black tabular-nums text-3xl ${remaining <= 10 && playing ? 'text-peach' : 'text-white'}`}>
            {remaining}s
          </span>
          <span className="text-[#C09A80] text-xs">剩余时间</span>
        </div>

        <button
          onClick={() => navigate('/', { replace: true })}
          className="text-white font-extrabold text-sm bg-white/10 px-4 py-2 rounded-[10px]
            active:bg-white/20 transition-colors"
        >
          ✕ 结束
        </button>
      </div>

      {/* 主区域 */}
      <div ref={gameAreaRef} className="flex-1 flex items-center justify-center p-2 overflow-hidden relative">
        {!playing ? (
          <div className="bg-white rounded-[24px] p-8 max-w-md w-full mx-4
            shadow-[0_4px_24px_rgba(224,122,95,0.2)] text-center">
            <div className="text-6xl mb-4">{gameDef.emoji}</div>
            <h2 className="text-2xl font-extrabold text-brown-text mb-3">{gameDef.name}</h2>
            <p className="text-brown-mute text-sm leading-relaxed mb-6 whitespace-pre-line">
              {gameDef.instructions}
            </p>
            <button
              onClick={() => setPlaying(true)}
              className="bg-peach text-white w-full font-extrabold text-lg py-3.5 rounded-[14px]
                active:scale-[0.98] transition-transform"
            >
              ▶ 开始游戏
            </button>
          </div>
        ) : (
          <GameComponent onScore={handleScore} containerSize={containerSize} />
        )}

        {/* 时间到遮罩 */}
        {timeUp && (
          <div className="absolute inset-0 bg-cream/90 flex flex-col items-center justify-center gap-4">
            <div className="text-6xl">🎉</div>
            <p className="text-brown-text font-black text-2xl">时间到！</p>
            <p className="text-peach font-extrabold text-xl">最终分数：{scoreFinalRef.current}</p>
            <p className="text-brown-mute text-sm">正在返回首页...</p>
          </div>
        )}
      </div>
    </div>
  )
}
