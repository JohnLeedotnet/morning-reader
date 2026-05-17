import { type CSSProperties, useEffect, useRef, useState } from 'react'
import type { GameProps } from './index'

const GAP = 8

function slideRow(row: number[]): { result: number[]; gained: number } {
  const vals = row.filter(v => v)
  let gained = 0
  const merged: number[] = []
  for (let i = 0; i < vals.length; ) {
    if (i + 1 < vals.length && vals[i] === vals[i + 1]) {
      const v = vals[i] * 2; merged.push(v); gained += v; i += 2
    } else { merged.push(vals[i]); i++ }
  }
  while (merged.length < 4) merged.push(0)
  return { result: merged, gained }
}

type MoveDir = 'left' | 'right' | 'up' | 'down'

function applyMove(board: number[][], dir: MoveDir): { board: number[][]; gained: number } {
  let gained = 0
  const slide = (row: number[]) => { const r = slideRow(row); gained += r.gained; return r.result }
  const t   = (m: number[][]): number[][] => Array.from({ length: 4 }, (_, c) => m.map(r => r[c]))
  const rev = (m: number[][]): number[][] => m.map(r => [...r].reverse())
  const all = (m: number[][]): number[][] => m.map(slide)
  const b = board.map(r => [...r])
  const result =
    dir === 'left'  ? all(b)               :
    dir === 'right' ? rev(all(rev(b)))      :
    dir === 'up'    ? t(all(t(b)))          :
    /* down */        t(rev(all(rev(t(b)))))
  return { board: result, gained }
}

function boardEqual(a: number[][], b: number[][]): boolean {
  return a.every((row, r) => row.every((v, c) => v === b[r][c]))
}

function addTile(board: number[][]): number[][] {
  const empty: [number, number][] = []
  board.forEach((row, r) => row.forEach((v, c) => { if (!v) empty.push([r, c]) }))
  if (!empty.length) return board
  const [r, c] = empty[Math.floor(Math.random() * empty.length)]
  const next = board.map(row => [...row])
  next[r][c] = Math.random() < 0.9 ? 2 : 4
  return next
}

function makeBoard(): number[][] {
  return addTile(addTile(Array.from({ length: 4 }, () => Array(4).fill(0))))
}

function isOver(board: number[][]): boolean {
  if (board.some(r => r.some(v => !v))) return false
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      if (c < 3 && board[r][c] === board[r][c + 1]) return false
      if (r < 3 && board[r][c] === board[r + 1][c]) return false
    }
  return true
}

function tileStyle(v: number): CSSProperties {
  if (!v)     return { background: '#F5E8DD', color: '#F5E8DD' }
  if (v <= 2) return { background: '#FFF5EB', color: '#8B6F5E' }
  if (v <= 4) return { background: '#FFE8D5', color: '#8B6F5E' }
  if (v <= 8) return { background: '#F0B090', color: '#fff' }
  if (v <= 16) return { background: '#E8906A', color: '#fff' }
  if (v <= 32) return { background: '#E07A5F', color: '#fff' }
  if (v <= 64) return { background: '#D06045', color: '#fff' }
  if (v <= 512) return { background: '#C54B38', color: '#fff' }
  return              { background: '#C54B38', color: '#fff', outline: '3px solid #F6C860' }
}

export function Game2048({ onScore, containerSize }: GameProps) {
  const cellSize = Math.floor((containerSize - 5 * GAP) / 4)
  const [board,  setBoard]  = useState<number[][]>(makeBoard)
  const scoreRef = useRef(0)
  const touchRef = useRef<{ x: number; y: number } | null>(null)
  const moveRef  = useRef<(dir: MoveDir) => void>(() => {})

  moveRef.current = (dir: MoveDir) => {
    const { board: next, gained } = applyMove(board, dir)
    if (boardEqual(board, next)) return
    const withTile = addTile(next)
    const newScore = scoreRef.current + gained
    scoreRef.current = newScore
    if (isOver(withTile)) {
      setBoard(makeBoard())
      scoreRef.current = 0
      onScore(0)
    } else {
      setBoard(withTile)
      onScore(newScore)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, MoveDir> = {
        ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down'
      }
      const dir = map[e.key]
      if (dir) { e.preventDefault(); moveRef.current(dir) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    touchRef.current = { x: t.clientX, y: t.clientY }
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchRef.current) return
    const dx = e.changedTouches[0].clientX - touchRef.current.x
    const dy = e.changedTouches[0].clientY - touchRef.current.y
    touchRef.current = null
    if (Math.abs(dx) < 30 && Math.abs(dy) < 30) return
    moveRef.current(Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down'  : 'up'))
  }

  return (
    <div
      className="flex flex-col items-center gap-3 touch-none"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(4, ${cellSize}px)`,
          gap: GAP,
          background: '#C9A88A',
          padding: GAP,
          borderRadius: 12,
        }}
      >
        {board.flat().map((v, i) => (
          <div
            key={i}
            style={{
              width: cellSize, height: cellSize,
              fontSize: v >= 1000 ? Math.floor(cellSize * 0.28)
                       : v >= 100 ? Math.floor(cellSize * 0.35)
                       : Math.floor(cellSize * 0.45),
              borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 900, userSelect: 'none',
              ...tileStyle(v),
            }}
          >
            {v || ''}
          </div>
        ))}
      </div>
      <p className="text-brown-mute text-xs">方向键 / 滑动 — 合并相同数字</p>
    </div>
  )
}
