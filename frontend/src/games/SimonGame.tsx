import { useEffect, useRef, useState } from 'react'
import type { GameProps } from './index'

const COLORS = ['#E07A5F', '#81B29A', '#FACC15', '#60A5FA']
const GAP = 12

interface Indicator { id: number; x: number; y: number; n: number }

export function SimonGame({ onScore, containerSize }: GameProps) {
  const blockSize    = Math.floor((containerSize - 3 * GAP) / 2)
  const [sequence,   setSequence]   = useState<number[]>(() => [Math.floor(Math.random() * 4)])
  const [phase,      setPhase]      = useState<'showing' | 'waiting' | 'over'>('showing')
  const [lit,        setLit]        = useState<number | null>(null)
  const [playerStep, setPlayerStep] = useState(0)
  const [indicators, setIndicators] = useState<Indicator[]>([])
  const scoreRef     = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (phase !== 'showing') return
    const seq = sequence
    let cancelled = false
    let i = 0

    const step = () => {
      if (cancelled) return
      if (i >= seq.length) { setLit(null); setPhase('waiting'); setPlayerStep(0); return }
      setLit(seq[i])
      setTimeout(() => {
        if (!cancelled) setLit(null)
        setTimeout(() => { if (!cancelled) { i++; step() } }, 200)
      }, 400)
    }

    const t = setTimeout(step, 600)
    return () => { cancelled = true; clearTimeout(t) }
  }, [phase, sequence])

  useEffect(() => {
    if (phase !== 'over') return
    const t = setTimeout(() => {
      scoreRef.current = 0
      onScore(0)
      setSequence([Math.floor(Math.random() * 4)])
      setIndicators([])
      setPhase('showing')
    }, 800)
    return () => clearTimeout(t)
  }, [phase, onScore])

  const handleTileClick = (idx: number, e: React.MouseEvent<HTMLButtonElement>) => {
    if (phase !== 'waiting') return

    const containerEl = containerRef.current
    if (containerEl) {
      const rect = containerEl.getBoundingClientRect()
      setIndicators(prev => [
        ...prev,
        { id: Date.now() + Math.random(), x: e.clientX - rect.left, y: e.clientY - rect.top, n: prev.length + 1 },
      ])
    }

    if (idx === sequence[playerStep]) {
      const nextStep = playerStep + 1
      if (nextStep === sequence.length) {
        const newSeq = [...sequence, Math.floor(Math.random() * 4)]
        scoreRef.current = newSeq.length - 1
        onScore(scoreRef.current)
        setSequence(newSeq)
        setIndicators([])
        setPhase('showing')
      } else {
        setPlayerStep(nextStep)
      }
    } else {
      setPhase('over')
    }
  }

  const statusText =
    phase === 'showing' ? '观察色块顺序...' :
    phase === 'over'    ? '错了！重新开始...' :
    `按顺序点击 (${playerStep} / ${sequence.length})`

  return (
    <div className="flex flex-col items-center gap-4">
      <p className={`text-sm font-extrabold ${phase === 'over' ? 'text-peach-deep' : 'text-brown-mute'}`}>
        {statusText}
      </p>

      <div ref={containerRef} className="relative inline-block">
        <div style={{ display: 'grid', gridTemplateColumns: `${blockSize}px ${blockSize}px`, gap: GAP }}>
          {COLORS.map((color, i) => (
            <button
              key={i}
              onClick={(e) => handleTileClick(i, e)}
              style={{
                width: blockSize, height: blockSize,
                backgroundColor: color,
                opacity: lit === i ? 1 : 0.4,
                boxShadow: lit === i ? `0 0 32px ${color}` : 'none',
                border: lit === i ? '3px solid rgba(255,255,255,0.9)' : '3px solid transparent',
              }}
              className="rounded-[18px] transition-all duration-100 select-none"
            />
          ))}
        </div>

        {indicators.map(ind => (
          <div
            key={ind.id}
            className="absolute pointer-events-none rounded-full bg-white border-2 border-peach-deep
              flex items-center justify-center text-peach-deep font-extrabold text-base
              shadow-[0_2px_8px_rgba(224,122,95,0.3)]"
            style={{ width: 36, height: 36, left: ind.x - 18, top: ind.y - 18 }}
          >
            {ind.n}
          </div>
        ))}
      </div>

      <p className="text-brown-mute text-xs">
        {phase === 'showing' ? '请勿点击，记住顺序' : '点击色块跟着做'}
      </p>
    </div>
  )
}
