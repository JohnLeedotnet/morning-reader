import { useState, useEffect } from 'react'

interface LibraryItem { id: number; filename: string; category_path?: string | null }
interface Category { path: string; count: number }

interface Props {
  authMe: { email: string; username: string | null; is_superadmin: boolean }
  onDone: () => void
}

type Step = 1 | 2 | 3 | 4 | 5 | 6

export default function OnboardingWizard({ authMe: _authMe, onDone }: Props) {
  const [step, setStep] = useState<Step>(1)
  const [parentStatus, setParentStatus] = useState<{ has_pin: boolean; parent_unlocked: boolean } | null>(null)
  // Step 2 (PIN)
  const [newPin, setNewPin] = useState('')
  const [pinError, setPinError] = useState('')
  // Step 3 (child)
  const [childName, setChildName] = useState('')
  const [childAge, setChildAge] = useState('8')
  const [createdChildId, setCreatedChildId] = useState<string | null>(null)
  // Step 4 (PDF)
  const [items, setItems] = useState<LibraryItem[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set())
  const [expandedLevels, setExpandedLevels] = useState<Set<string>>(new Set())
  const [selectedLibraryId, setSelectedLibraryId] = useState<number | null>(null)
  const [selectedFilename, setSelectedFilename] = useState('')
  // Step 5 (config)
  const [dailyCount, setDailyCount] = useState(3)
  const [minDurationMin, setMinDurationMin] = useState(5)
  const [windowStart, setWindowStart] = useState('07:00')
  const [windowEnd, setWindowEnd] = useState('08:00')
  // common
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/auth/parent-status').then(r => r.json()).then(setParentStatus).catch(() => {})
  }, [])

  useEffect(() => {
    if (step !== 4) return
    fetch('/api/library/list').then(r => r.json()).then((data: { items: LibraryItem[]; categories: Category[] }) => {
      setItems(data.items); setCategories(data.categories || [])
    }).catch(() => {})
  }, [step])

  // 如果已有 PIN，跳 Step 2
  useEffect(() => {
    if (step === 2 && parentStatus?.has_pin) setStep(3)
  }, [step, parentStatus])

  const submitPin = async () => {
    setSubmitting(true); setPinError('')
    try {
      if (!/^\d{4,8}$/.test(newPin)) throw new Error('PIN 必须 4-8 位数字')
      const res = await fetch('/api/auth/set-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPin }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(d.error || `设置失败 ${res.status}`)
      }
      setStep(3)
    } catch (err) {
      setPinError(err instanceof Error ? err.message : '操作失败')
    } finally { setSubmitting(false) }
  }

  const submitChild = async () => {
    setSubmitting(true); setError('')
    try {
      const age = parseInt(childAge, 10)
      if (!childName.trim()) throw new Error('请填写姓名')
      if (isNaN(age) || age < 3 || age > 18) throw new Error('年龄需 3-18')
      const res = await fetch('/api/admin/children', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: childName.trim(), age }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(d.error || `创建失败 ${res.status}`)
      }
      const data = await res.json() as { id?: string; child_id?: string }
      setCreatedChildId(data.id ?? data.child_id ?? null)
      setStep(4)
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally { setSubmitting(false) }
  }

  const submitConfig = async () => {
    setSubmitting(true); setError('')
    try {
      if (!createdChildId) throw new Error('child not created')
      if (!selectedLibraryId) throw new Error('请选起点 PDF')
      const r1 = await fetch('/api/admin/pool/configure', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          child_id: createdChildId,
          cursor_library_id: selectedLibraryId,
          daily_count: dailyCount,
          min_duration_s: minDurationMin * 60,
        }),
      })
      if (!r1.ok) {
        const d = await r1.json().catch(() => ({})) as { error?: string }
        throw new Error(d.error || `保存配置失败 ${r1.status}`)
      }
      const r2 = await fetch('/api/auth/set-window', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ window_start: windowStart, window_end: windowEnd }),
      })
      if (!r2.ok) {
        const d = await r2.json().catch(() => ({})) as { error?: string }
        throw new Error(d.error || `时间窗口失败 ${r2.status}`)
      }
      setStep(6)
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally { setSubmitting(false) }
  }

  // Step 4 树：series / level 分组
  const seriesMap = (() => {
    const m = new Map<string, Array<{ level: string; count: number; fullPath: string }>>()
    for (const c of categories) {
      const i = c.path.indexOf('/')
      const s = i > 0 ? c.path.slice(0, i) : c.path
      const l = i > 0 ? c.path.slice(i + 1) : '(根目录)'
      if (!m.has(s)) m.set(s, [])
      m.get(s)!.push({ level: l, count: c.count, fullPath: c.path })
    }
    return m
  })()

  const itemsByCategory = (() => {
    const m = new Map<string, LibraryItem[]>()
    for (const it of items) {
      const c = it.category_path || '(未分类)'
      if (!m.has(c)) m.set(c, [])
      m.get(c)!.push(it)
    }
    return m
  })()

  const goToStep2 = () => setStep(parentStatus?.has_pin ? 3 : 2)

  return (
    <div className="fixed inset-0 bg-cream z-50 overflow-auto">
      <div className="max-w-xl mx-auto p-6">
        <div className="bg-white rounded-[24px] p-8 shadow-[0_8px_32px_rgba(224,122,95,0.15)]">
          {/* 步骤指示 */}
          <div className="flex gap-1.5 mb-6">
            {[1, 2, 3, 4, 5].map(n => (
              <div key={n} className={`flex-1 h-1.5 rounded-full ${step >= n ? 'bg-peach' : 'bg-cream'}`} />
            ))}
          </div>

          {step === 1 && (
            <>
              <h1 className="text-2xl font-extrabold text-brown-text mb-3">🌅 欢迎使用 Morning Reader</h1>
              <p className="text-brown-mute mb-6 leading-relaxed">
                我们将引导你 5 步完成首次设置：<br />
                设置家长 PIN → 添加角色 → 选起点 PDF → 配置朗读要求
              </p>
              <button onClick={goToStep2}
                className="w-full bg-peach text-white font-extrabold py-3 rounded-[12px]">
                开始配置
              </button>
            </>
          )}

          {step === 2 && parentStatus && !parentStatus.has_pin && (
            <>
              <h2 className="text-xl font-extrabold text-brown-text mb-3">第 1 步：设置家长 PIN</h2>
              <p className="text-sm text-brown-mute mb-4">家长进入管理面板需要输入此 PIN（4-8 位数字）</p>
              <input
                type="text" inputMode="numeric" pattern="\d{4,8}" maxLength={8}
                placeholder="4-8 位数字"
                value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                className="w-full bg-cream rounded-[10px] px-4 py-3 text-2xl text-center tracking-[8px]
                  tabular-nums font-extrabold border-2 border-transparent focus:border-peach outline-none mb-3"
              />
              {pinError && <p className="text-red-500 text-sm mb-3">{pinError}</p>}
              <button onClick={submitPin} disabled={submitting || newPin.length < 4}
                className="w-full bg-peach text-white font-extrabold py-3 rounded-[12px] disabled:opacity-40">
                {submitting ? '保存中...' : '下一步'}
              </button>
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-xl font-extrabold text-brown-text mb-3">第 2 步：添加第一个朗读角色</h2>
              <p className="text-sm text-brown-mute mb-4">这是要朗读的家庭成员（如孩子）</p>
              <input type="text" placeholder="姓名（如 Mike）" value={childName}
                onChange={e => setChildName(e.target.value)}
                className="w-full bg-cream rounded-[10px] px-4 py-3 mb-3 border-2 border-transparent focus:border-peach outline-none" />
              <input type="number" min={3} max={18} placeholder="年龄" value={childAge}
                onChange={e => setChildAge(e.target.value)}
                className="w-full bg-cream rounded-[10px] px-4 py-3 mb-3 border-2 border-transparent focus:border-peach outline-none" />
              {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
              <button onClick={submitChild} disabled={submitting || !childName.trim()}
                className="w-full bg-peach text-white font-extrabold py-3 rounded-[12px] disabled:opacity-40">
                {submitting ? '创建中...' : '下一步'}
              </button>
            </>
          )}

          {step === 4 && (
            <>
              <h2 className="text-xl font-extrabold text-brown-text mb-3">第 3 步：选择起点 PDF</h2>
              <p className="text-sm text-brown-mute mb-4">从公共图书馆选第一本书</p>
              <div className="max-h-[400px] overflow-auto bg-cream/30 rounded-[10px] p-2 mb-3">
                {seriesMap.size === 0 && <p className="text-center text-brown-mute py-8">图书馆为空</p>}
                {Array.from(seriesMap.entries()).map(([series, levels]) => (
                  <div key={series} className="mb-2">
                    <button onClick={() => {
                      const n = new Set(expandedSeries)
                      n.has(series) ? n.delete(series) : n.add(series)
                      setExpandedSeries(n)
                    }} className="w-full text-left bg-white hover:bg-cream rounded-[8px] px-3 py-2 font-extrabold text-sm">
                      {expandedSeries.has(series) ? '▼' : '▶'} {series}
                      <span className="text-xs text-brown-mute font-bold ml-2">
                        {levels.reduce((s, l) => s + l.count, 0)} 本
                      </span>
                    </button>
                    {expandedSeries.has(series) && (
                      <div className="ml-4 mt-1">
                        {levels.map(({ level, count, fullPath }) => (
                          <div key={fullPath}>
                            <button onClick={() => {
                              const n = new Set(expandedLevels)
                              n.has(fullPath) ? n.delete(fullPath) : n.add(fullPath)
                              setExpandedLevels(n)
                            }} className="w-full text-left bg-cream/50 hover:bg-cream rounded-[6px] px-3 py-1.5 text-sm font-bold">
                              {expandedLevels.has(fullPath) ? '▼' : '▶'} {level}
                              <span className="text-xs text-brown-mute ml-1">({count})</span>
                            </button>
                            {expandedLevels.has(fullPath) && (
                              <ul className="ml-4">
                                {(itemsByCategory.get(fullPath) ?? []).map(it => (
                                  <li key={it.id}>
                                    <button
                                      onClick={() => { setSelectedLibraryId(it.id); setSelectedFilename(it.filename) }}
                                      className={`w-full text-left text-xs px-3 py-1 rounded
                                        ${selectedLibraryId === it.id
                                          ? 'bg-peach text-white font-extrabold'
                                          : 'hover:bg-cream text-brown-text'}`}>
                                      {it.filename}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {selectedLibraryId && (
                <p className="text-xs text-brown-mute mb-3">
                  ✅ 已选：<span className="font-bold text-brown-text">{selectedFilename}</span>
                </p>
              )}
              <button onClick={() => setStep(5)} disabled={!selectedLibraryId}
                className="w-full bg-peach text-white font-extrabold py-3 rounded-[12px] disabled:opacity-40">
                下一步
              </button>
            </>
          )}

          {step === 5 && (
            <>
              <h2 className="text-xl font-extrabold text-brown-text mb-3">第 4 步：朗读要求</h2>
              <div className="space-y-4 mb-4">
                <div>
                  <label className="text-sm font-bold text-brown-text">
                    每日本数：<span className="text-peach">{dailyCount}</span>
                  </label>
                  <input type="range" min={1} max={10} value={dailyCount}
                    onChange={e => setDailyCount(parseInt(e.target.value))}
                    className="w-full accent-peach" />
                </div>
                <div>
                  <label className="text-sm font-bold text-brown-text">
                    朗读时长：<span className="text-peach">{minDurationMin} 分钟</span>
                  </label>
                  <input type="range" min={1} max={30} value={minDurationMin}
                    onChange={e => setMinDurationMin(parseInt(e.target.value))}
                    className="w-full accent-peach" />
                </div>
                <div>
                  <label className="text-sm font-bold text-brown-text block mb-1">时间窗口</label>
                  <div className="flex gap-2 items-center">
                    <input type="time" value={windowStart} onChange={e => setWindowStart(e.target.value)}
                      className="bg-cream rounded-[8px] px-3 py-2 flex-1 outline-none border-2 border-transparent focus:border-peach" />
                    <span className="text-brown-mute text-sm">到</span>
                    <input type="time" value={windowEnd} onChange={e => setWindowEnd(e.target.value)}
                      className="bg-cream rounded-[8px] px-3 py-2 flex-1 outline-none border-2 border-transparent focus:border-peach" />
                  </div>
                </div>
              </div>
              {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
              <button onClick={submitConfig} disabled={submitting}
                className="w-full bg-peach text-white font-extrabold py-3 rounded-[12px] disabled:opacity-40">
                {submitting ? '保存中...' : '完成配置'}
              </button>
            </>
          )}

          {step === 6 && (
            <>
              <h1 className="text-2xl font-extrabold text-brown-text mb-3">🎉 配置完成</h1>
              <div className="bg-cream rounded-[10px] p-4 mb-6 space-y-1 text-sm">
                <p><strong>{childName}</strong>（{childAge} 岁）已添加</p>
                <p>起点 PDF：{selectedFilename}</p>
                <p>每日 {dailyCount} 本 · {minDurationMin} 分钟 · {windowStart}–{windowEnd}</p>
              </div>
              <button onClick={onDone}
                className="w-full bg-peach text-white font-extrabold py-3 rounded-[12px]">
                进入首页
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
