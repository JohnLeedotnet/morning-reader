import { useRef, useState } from 'react'
import type { GameProps } from './index'

const GAP = 12

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

interface Question { display: string; answer: number; choices: number[] }

function makeQuestion(): Question {
  const a = Math.floor(Math.random() * 20) + 1
  const b = Math.floor(Math.random() * 20) + 1
  const isAdd = Math.random() < 0.5
  const [x, y, ans] = isAdd ? [a, b, a + b] : a >= b ? [a, b, a - b] : [b, a, b - a]
  const op = isAdd ? '+' : '−'
  const wrongs = new Set<number>()
  while (wrongs.size < 3) {
    const d = Math.floor(Math.random() * 5) + 1
    const w = Math.random() < 0.5 ? ans + d : Math.max(0, ans - d)
    if (w !== ans) wrongs.add(w)
  }
  return { display: `${x} ${op} ${y} = ?`, answer: ans, choices: shuffle([ans, ...wrongs]) }
}

export function MathGame({ onScore, containerSize }: GameProps) {
  const btnSize = Math.floor((containerSize - 3 * GAP) / 2)
  const [question, setQuestion] = useState<Question>(makeQuestion)
  const [correct,  setCorrect]  = useState<number | null>(null)
  const [wrong,    setWrong]    = useState<number | null>(null)
  const scoreRef = useRef(0)

  const pick = (idx: number) => {
    if (correct !== null || wrong !== null) return
    if (question.choices[idx] === question.answer) {
      setCorrect(idx)
      scoreRef.current++
      onScore(scoreRef.current)
      setTimeout(() => {
        setCorrect(null)
        setWrong(null)
        setQuestion(makeQuestion())
      }, 200)
    } else {
      setWrong(idx)
      setTimeout(() => setWrong(null), 500)
    }
  }

  const questionFontSize = Math.min(Math.floor(containerSize * 0.1), 48)
  const answerFontSize   = Math.floor(btnSize * 0.4)

  return (
    <div className="flex flex-col items-center gap-4" style={{ width: btnSize * 2 + GAP }}>
      <div className="bg-white rounded-[20px] w-full py-6 text-center
        shadow-[0_2px_12px_rgba(224,122,95,0.12)]">
        <p className="text-brown-mute text-xs mb-1">计算结果是？</p>
        <p className="text-brown-text font-black" style={{ fontSize: questionFontSize }}>
          {question.display}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `${btnSize}px ${btnSize}px`, gap: GAP }}>
        {question.choices.map((choice, i) => (
          <button
            key={i}
            onClick={() => pick(i)}
            style={{ width: btnSize, height: btnSize, fontSize: answerFontSize }}
            className={`rounded-[16px] font-extrabold select-none transition-colors
              ${correct === i ? 'bg-mint text-white' :
                wrong   === i ? 'bg-red-400 text-white' :
                'bg-[#F5E8DD] text-brown-text hover:bg-[#FFE8D5]'
              }`}
          >
            {choice}
          </button>
        ))}
      </div>

      <p className="text-brown-mute text-xs">点击正确答案</p>
    </div>
  )
}
