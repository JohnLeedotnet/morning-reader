import type { FC } from 'react'
import { SnakeGame }      from './SnakeGame'
import { WhackAMoleGame } from './WhackAMoleGame'
import { MemoryGame }     from './MemoryGame'
import { SimonGame }      from './SimonGame'
import { Game2048 }       from './Game2048'
import { MathGame }       from './MathGame'

export interface GameProps {
  onScore: (n: number) => void
  containerSize: number
}

export interface GameDef {
  id: string
  name: string
  emoji: string
  instructions: string
  component: FC<GameProps>
}

export const GAMES: GameDef[] = [
  {
    id: 'snake', name: '贪吃蛇', emoji: '🐍',
    instructions: '用鼠标移动控制方向\n蛇头朝鼠标位置走\n吃到食物变长，撞墙重新开始',
    component: SnakeGame,
  },
  {
    id: 'whackamole', name: '打地鼠', emoji: '🔨',
    instructions: '鼠标或手指滑过冒出的鼹鼠\n触碰即得分（无需点击）\n命中地鼠变绿后消失',
    component: WhackAMoleGame,
  },
  {
    id: 'memory', name: '翻牌配对', emoji: '🃏',
    instructions: '点击卡片翻开\n找到两张相同的图案就算一对\n配对越多分越高',
    component: MemoryGame,
  },
  {
    id: 'simon', name: 'Simon 跟我做', emoji: '🎵',
    instructions: '看清楚色块的闪烁顺序\n按相同顺序点击\n每答对一轮，序列长度 +1',
    component: SimonGame,
  },
  {
    id: '2048', name: '2048', emoji: '🔢',
    instructions: '方向键或滑动\n相同数字合并变两倍\n挑战合出更大的数字！',
    component: Game2048,
  },
  {
    id: 'math', name: '心算挑战', emoji: '➕',
    instructions: '看到题目后点击正确答案\n答对越多分越高\n限时 60 秒',
    component: MathGame,
  },
]

export function pickRandomGame(seed: number): GameDef {
  return GAMES[seed % GAMES.length]
}
