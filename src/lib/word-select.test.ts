import { describe, expect, it } from 'vitest'
import { buildLine, inkRuns, pickToken, tokenize, wordWithinToken, inkXForChar } from './word-select'

describe('双击选词（以画布墨迹为准）', () => {
  it('拼行：不紧挨的段之间补空格，紧挨的段直接接上（同一个词被拆成两个 span）', () => {
    const line = buildLine([
      { text: 'across tasks in', glued: false },
      { text: 'language', glued: false },
      { text: 'and inte', glued: false },
      { text: 'ractive decision', glued: true }
    ])
    expect(line.text).toBe('across tasks in language and interactive decision')
    // 补出来的空格不指向任何段
    expect(line.map[line.text.indexOf(' language')]).toEqual({ seg: -1, off: 0 })
    // "ractive" 的 r 来自第 4 段第 0 个字符
    expect(line.map[line.text.indexOf('ractive')]).toEqual({ seg: 3, off: 0 })
  })

  it('墨迹段：间隙超过阈值才断开', () => {
    //            0123456789
    const col = [1, 1, 0, 1, 1, 0, 0, 0, 1, 1]
    expect(inkRuns(col, 2)).toEqual([
      { L: 0, R: 4 },
      { L: 8, R: 9 }
    ])
  })

  it('段数与词数相等：点到哪段就是哪个词，不受文本层漂移影响', () => {
    const text = 'and interactive decision making,'
    const tokens = tokenize(text)
    const runs = [
      { L: 0, R: 20 },
      { L: 30, R: 90 },
      { L: 100, R: 150 },
      { L: 160, R: 210 }
    ]
    const p = pickToken(tokens, runs, 60)!
    expect(p.tokenIdx).toBe(1)
    expect(text.slice(tokens[p.tokenIdx].s, tokens[p.tokenIdx].e)).toBe('interactive')
  })

  it('段数与词数不等（上标多出一段）：按墨迹宽度比例映射，仍落在正确的词附近', () => {
    const text = 'Shunyu Yao, Jeffrey Zhao, Dian Yu'
    const tokens = tokenize(text) // 6 个词
    // 7 段：Yao 后面的上标 "*,1" 单独成段
    const runs = [
      { L: 0, R: 60 },
      { L: 70, R: 100 },
      { L: 102, R: 112 },
      { L: 122, R: 190 },
      { L: 200, R: 250 },
      { L: 260, R: 300 },
      { L: 310, R: 330 }
    ]
    const p = pickToken(tokens, runs, 225)! // 点在 "Zhao,"
    expect(text.slice(tokens[p.tokenIdx].s, tokens[p.tokenIdx].e)).toBe('Zhao,')
  })

  it('点在空隙里：取最近的段', () => {
    const tokens = tokenize('a b')
    const runs = [
      { L: 0, R: 10 },
      { L: 40, R: 50 }
    ]
    expect(pickToken(tokens, runs, 36)!.tokenIdx).toBe(1)
    expect(pickToken(tokens, runs, 14)!.tokenIdx).toBe(0)
  })

  it('token 内再切：标点不选、连字符两半只选点到的那半', () => {
    const t1 = 'making,'
    expect(wordWithinToken(t1, { s: 0, e: t1.length }, 0.99)).toEqual({ s: 0, e: 6 })
    const t2 = 'machine-generated'
    expect(wordWithinToken(t2, { s: 0, e: t2.length }, 0.2)).toEqual({ s: 0, e: 7 })
    expect(wordWithinToken(t2, { s: 0, e: t2.length }, 0.8)).toEqual({ s: 8, e: 17 })
  })
})

describe('inkXForChar', () => {
  const tokens = [
    { s: 0, e: 3 }, // abc
    { s: 4, e: 12 }, // training
    { s: 13, e: 16 } // xyz
  ]
  it('整行并成一段时按字符比例定位，而不是整段', () => {
    const runs = [{ L: 0, R: 139 }] // 一整行 140px 墨迹，14 个词字符
    const a = inkXForChar(tokens, runs, 4)
    const b = inkXForChar(tokens, runs, 12)
    expect(a).toBeCloseTo(30, 0) // 前面 3 个字符 / 14
    expect(b).toBeCloseTo(110, 0) // 前面 11 个字符 / 14
    expect((b as number) - (a as number)).toBeLessThan(140) // 远小于整行
  })
  it('多段时按累计墨迹推进：位置随字符单调增长，且宽度与字数成比例', () => {
    const runs = [{ L: 0, R: 29 }, { L: 40, R: 119 }, { L: 130, R: 159 }]
    const a = inkXForChar(tokens, runs, 0) as number
    const b = inkXForChar(tokens, runs, 4) as number
    const c = inkXForChar(tokens, runs, 12) as number
    expect(a).toBeLessThan(b)
    expect(b).toBeLessThan(c)
    // 「training」占 8/14 个字符，对应的墨迹宽度也该在这个量级（总墨迹 140）
    expect(c - b).toBeGreaterThan(50)
    expect(c - b).toBeLessThan(100)
  })
  it('空输入返回 null', () => {
    expect(inkXForChar([], [{ L: 0, R: 10 }], 0)).toBeNull()
    expect(inkXForChar(tokens, [], 0)).toBeNull()
  })
})
