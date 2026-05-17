import { useRef, useState } from 'react'
import type { GameProps } from './index'

const EMOJIS = ['🐶', '🐱', '🐰', '🦊', '🐼', '🐧', '🐸', '🦄']
type CardState = 'hidden' | 'revealed' | 'matched'
interface Card { id: number; emoji: string; state: CardState }

const GAP = 8

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function makeCards(): Card[] {
  return shuffle([...EMOJIS, ...EMOJIS]).map((emoji, id) => ({ id, emoji, state: 'hidden' }))
}

export function MemoryGame({ onScore, containerSize }: GameProps) {
  const cellSize  = Math.floor((containerSize - 5 * GAP) / 4)
  const [cards,    setCards]    = useState<Card[]>(makeCards)
  const [revealed, setRevealed] = useState<number[]>([])
  const [locked,   setLocked]   = useState(false)
  const scoreRef = useRef(0)

  const flip = (idx: number) => {
    if (locked || cards[idx].state !== 'hidden') return

    const flipped = cards.map((c, i) =>
      i === idx ? { ...c, state: 'revealed' as CardState } : c
    )

    if (revealed.length === 1) {
      const first = revealed[0]
      if (flipped[first].emoji === flipped[idx].emoji) {
        const matched = flipped.map((c, i) =>
          i === first || i === idx ? { ...c, state: 'matched' as CardState } : c
        )
        scoreRef.current++
        onScore(scoreRef.current)
        setCards(matched)
        setRevealed([])
        if (matched.every(c => c.state === 'matched'))
          setTimeout(() => setCards(makeCards()), 500)
      } else {
        setLocked(true)
        setCards(flipped)
        setRevealed([first, idx])
        setTimeout(() => {
          setCards(prev => prev.map((c, i) =>
            (i === first || i === idx) && c.state === 'revealed'
              ? { ...c, state: 'hidden' as CardState } : c
          ))
          setRevealed([])
          setLocked(false)
        }, 600)
      }
    } else {
      setCards(flipped)
      setRevealed([idx])
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(4, ${cellSize}px)`, gap: GAP }}>
        {cards.map((card, i) => (
          <button
            key={card.id}
            onClick={() => flip(i)}
            style={{ width: cellSize, height: cellSize, fontSize: Math.floor(cellSize * 0.45) }}
            className={`rounded-[10px] flex items-center justify-center select-none transition-colors
              ${card.state === 'hidden'
                ? 'bg-peach text-white'
                : card.state === 'matched'
                  ? 'bg-[#D6EAE0] border-2 border-mint'
                  : 'bg-cream border-2 border-[#F0D8C8]'
              }`}
          >
            {card.state === 'hidden' ? '❓' : card.emoji}
          </button>
        ))}
      </div>
      <p className="text-brown-mute text-xs">点击翻开卡片，找到相同的图案！</p>
    </div>
  )
}
