const ENCOURAGEMENTS = [
  '太棒了！{name}，你今天朗读得很认真！解锁今日彩蛋 🎁',
  '{name}，你对自己有要求！来玩一个小游戏奖励一下 🎮',
  '完成啦！{name}，你又坚持完成了今天的朗读，了不起！',
  '今天的朗读你做得真好！{name}，先来个小游戏放松一下 🎁',
  '{name}，你坚持完成了今天的任务，真是个有毅力的孩子！',
  'Great job, {name}! 今天的朗读已达标，去看看今日彩蛋 🎮',
  '{name}，朗读完成！你的努力没有白费，彩蛋送给你 🎁',
  '厉害了 {name}！又一次超越了自己，玩个小游戏吧！',
  '{name}，你的认真我看在眼里！来享受彩蛋时间 🎮',
  '今天的朗读完成得非常棒！{name}，去解锁今日彩蛋吧 🎁',
] as const

export function pickEncouragement(name: string, seed: number): string {
  const t = ENCOURAGEMENTS[seed % ENCOURAGEMENTS.length]
  return t.replace('{name}', name)
}
