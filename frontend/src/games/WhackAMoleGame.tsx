import { useEffect, useRef, useState } from 'react'
import type { GameProps } from './index'

type Cell = 'empty' | 'active' | 'hit'

const MOLE_LIFETIME_MS = 1200
const SPAWN_INTERVAL_MS = 800
const HIT_FLASH_MS = 200
const GAP = 12

export function WhackAMoleGame({ onScore, containerSize }: GameProps) {
  const [cells, setCells] = useState<Cell[]>(() => Array(9).fill('empty'))
  const scoreRef  = useRef(0)
  // activeRef mirrors which slots are truly "hittable"; updated synchronously to prevent double-hit
  const activeRef = useRef<boolean[]>(Array(9).fill(false))

  const cellSize = Math.floor((containerSize - GAP * 2) / 3)
  const moleDiam = Math.floor(cellSize * 0.8)

  useEffect(() => {
    const interval = setInterval(() => {
      const freeIdxs = activeRef.current
        .map((v, i) => (!v ? i : -1))
        .filter(i => i >= 0)
      if (freeIdxs.length === 0) return
      const idx = freeIdxs[Math.floor(Math.random() * freeIdxs.length)]
      activeRef.current[idx] = true
      setCells(prev => { const n = [...prev]; n[idx] = 'active'; return n })
      setTimeout(() => {
        if (!activeRef.current[idx]) return   // already hit
        activeRef.current[idx] = false
        setCells(m => { const n = [...m]; n[idx] = 'empty'; return n })
      }, MOLE_LIFETIME_MS)
    }, SPAWN_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  const hit = (idx: number) => {
    if (!activeRef.current[idx]) return       // not hittable (empty or already hit)
    activeRef.current[idx] = false            // synchronous guard — prevents double-hit
    scoreRef.current++
    onScore(scoreRef.current)
    setCells(prev => { const n = [...prev]; n[idx] = 'hit'; return n })
    setTimeout(() => {
      setCells(m => { const n = [...m]; if (n[idx] === 'hit') n[idx] = 'empty'; return n })
    }, HIT_FLASH_MS)
  }

  // Touch-move: hit whichever hole the finger slides over
  const handleTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0]
    if (!touch) return
    const el = document.elementFromPoint(touch.clientX, touch.clientY)
    const target = el instanceof HTMLElement ? el.closest<HTMLElement>('[data-mole-idx]') : null
    if (target) hit(parseInt(target.dataset.moleIdx!))
  }

  const moleBg = (cell: Cell) => cell === 'hit' ? '#81B29A' : '#C54B38'

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(3, ${cellSize}px)`, gap: GAP, touchAction: 'none' }}
        onTouchMove={handleTouchMove}
      >
        {cells.map((cell, i) => (
          <div
            key={i}
            data-mole-idx={i}
            onMouseEnter={() => hit(i)}
            onTouchStart={() => hit(i)}
            className="rounded-full flex items-center justify-center select-none"
            style={{
              width: cellSize,
              height: cellSize,
              backgroundColor: '#4A3020',
              boxShadow: 'inset 0 4px 12px rgba(0,0,0,0.4)',
              cursor: cell === 'active' ? 'pointer' : 'default',
            }}
          >
            {cell !== 'empty' && (
              <div
                className={`rounded-full flex items-center justify-center transition-colors duration-100
                  ${cell === 'active' ? 'animate-bounce' : ''}`}
                style={{
                  width: moleDiam,
                  height: moleDiam,
                  backgroundColor: moleBg(cell),
                  fontSize: moleDiam * 0.45,
                  lineHeight: 1,
                  pointerEvents: 'none',   // let hit-test fall through to parent div
                }}
              >
                🐭
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="text-brown-mute text-xs">鼠标滑过 / 触摸钻出来的鼹鼠得分！</p>
    </div>
  )
}
