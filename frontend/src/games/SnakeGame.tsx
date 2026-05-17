import { useEffect, useRef } from 'react'
import type { GameProps } from './index'

const COLS = 20
const ROWS = 20
const TICK_MS = 150

type Pt  = { x: number; y: number }
type Dir = 'up' | 'down' | 'left' | 'right'

function dirToDelta(d: Dir): Pt {
  if (d === 'up')   return { x: 0, y: -1 }
  if (d === 'down') return { x: 0, y:  1 }
  if (d === 'left') return { x: -1, y: 0 }
  return                   { x:  1, y: 0 }
}

function opposite(a: Dir, b: Dir): boolean {
  return (a === 'up'    && b === 'down')  || (a === 'down'  && b === 'up') ||
         (a === 'left'  && b === 'right') || (a === 'right' && b === 'left')
}

function pickDirection(head: Pt, target: Pt, current: Dir): Dir {
  const dx = target.x - head.x
  const dy = target.y - head.y
  const horiz: Dir = dx >= 0 ? 'right' : 'left'
  const vert:  Dir = dy >= 0 ? 'down'  : 'up'
  let chosen = Math.abs(dx) >= Math.abs(dy) ? horiz : vert
  if (opposite(chosen, current)) {
    chosen = chosen === horiz ? vert : horiz
    if (opposite(chosen, current)) return current
  }
  return chosen
}

function randFood(snake: Pt[]): Pt {
  const occupied = new Set(snake.map(p => `${p.x},${p.y}`))
  let pt: Pt
  do { pt = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) } }
  while (occupied.has(`${pt.x},${pt.y}`))
  return pt
}

export function SnakeGame({ onScore, containerSize }: GameProps) {
  const canvasRef     = useRef<HTMLCanvasElement>(null)
  const snakeRef      = useRef<Pt[]>([{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }])
  const dirRef        = useRef<Dir>('right')
  const targetCellRef = useRef<Pt | null>(null)
  const foodRef       = useRef<Pt>({ x: 5, y: 5 })
  const scoreRef      = useRef(0)

  function updateTargetFromEvent(clientX: number, clientY: number) {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const cell = canvas.width / COLS
    targetCellRef.current = {
      x: (clientX - rect.left) * canvas.width  / rect.width  / cell,
      y: (clientY - rect.top)  * canvas.height / rect.height / cell,
    }
  }

  const handleMouseMove    = (e: React.MouseEvent<HTMLCanvasElement>) =>
    updateTargetFromEvent(e.clientX, e.clientY)
  const handlePointerLeave = () => { targetCellRef.current = null }
  const handleTouchMove    = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const t = e.touches[0]
    if (t) updateTargetFromEvent(t.clientX, t.clientY)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    const draw = () => {
      const cs   = canvas.width
      const cell = cs / COLS
      ctx.fillStyle = '#FFF8F2'
      ctx.fillRect(0, 0, cs, cs)
      ctx.fillStyle = '#E07A5F'
      for (const p of snakeRef.current)
        ctx.fillRect(p.x * cell + 1, p.y * cell + 1, cell - 2, cell - 2)
      ctx.fillStyle = '#81B29A'
      const f = foodRef.current
      ctx.beginPath()
      ctx.arc(f.x * cell + cell / 2, f.y * cell + cell / 2, cell / 2 - 1, 0, Math.PI * 2)
      ctx.fill()

      const W = cs, H = cs
      const wallW = Math.max(8, W * 0.025)
      ctx.fillStyle = '#E07A5F'
      ctx.fillRect(0, 0, W, wallW)
      ctx.fillRect(0, H - wallW, W, wallW)
      ctx.fillRect(0, 0, wallW, H)
      ctx.fillRect(W - wallW, 0, wallW, H)
      ctx.lineWidth = 2
      ctx.strokeStyle = '#C54B38'
      ctx.strokeRect(wallW, wallW, W - 2 * wallW, H - 2 * wallW)
      const dotR = wallW / 2
      ctx.fillStyle = '#3D2B1F'
      ;[[wallW / 2, wallW / 2], [W - wallW / 2, wallW / 2],
        [wallW / 2, H - wallW / 2], [W - wallW / 2, H - wallW / 2]].forEach(([x, y]) => {
        ctx.beginPath()
        ctx.arc(x, y, dotR * 0.6, 0, Math.PI * 2)
        ctx.fill()
      })
    }

    const tick = () => {
      const head = snakeRef.current[0]
      if (targetCellRef.current) {
        const dx = targetCellRef.current.x - head.x
        const dy = targetCellRef.current.y - head.y
        if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5)
          dirRef.current = pickDirection(head, targetCellRef.current, dirRef.current)
      }

      const delta = dirToDelta(dirRef.current)
      const next  = { x: head.x + delta.x, y: head.y + delta.y }

      const hitWall = next.x < 0 || next.x >= COLS || next.y < 0 || next.y >= ROWS
      const hitSelf = snakeRef.current.some(p => p.x === next.x && p.y === next.y)
      if (hitWall || hitSelf) {
        snakeRef.current = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }]
        dirRef.current   = 'right'
        scoreRef.current = 0
        onScore(0)
        foodRef.current = randFood(snakeRef.current)
        draw(); return
      }

      const ate      = next.x === foodRef.current.x && next.y === foodRef.current.y
      const newSnake = [next, ...snakeRef.current]
      if (!ate) newSnake.pop()
      snakeRef.current = newSnake
      if (ate) {
        scoreRef.current++
        onScore(scoreRef.current)
        foodRef.current = randFood(snakeRef.current)
      }
      draw()
    }

    draw()
    const interval = setInterval(tick, TICK_MS)

    const onKey = (e: KeyboardEvent) => {
      let newDir: Dir | null = null
      if (e.key === 'ArrowUp')    newDir = 'up'
      if (e.key === 'ArrowDown')  newDir = 'down'
      if (e.key === 'ArrowLeft')  newDir = 'left'
      if (e.key === 'ArrowRight') newDir = 'right'
      if (newDir && !opposite(newDir, dirRef.current)) {
        dirRef.current      = newDir
        targetCellRef.current = null
      }
    }
    window.addEventListener('keydown', onKey)

    return () => {
      clearInterval(interval)
      window.removeEventListener('keydown', onKey)
    }
  }, [onScore])

  return (
    <div className="flex flex-col items-center gap-3">
      <canvas
        ref={canvasRef}
        width={containerSize}
        height={containerSize}
        className="rounded-[12px] border-2 border-[#F0D8C8] touch-none"
        onMouseMove={handleMouseMove}
        onMouseLeave={handlePointerLeave}
        onTouchMove={handleTouchMove}
        onTouchEnd={handlePointerLeave}
      />
      <p className="text-brown-mute text-xs">鼠标指向目标位置 / 键盘方向键控制蛇的方向</p>
    </div>
  )
}
