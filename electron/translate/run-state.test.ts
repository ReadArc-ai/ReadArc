import { describe, expect, it } from 'vitest'
import { TranslationRunState } from './run-state'

const P = 'paper-1'

describe('全文翻译启停状态机', () => {
  it('停止请求还没被消化时再点翻译 = 续译，撤回停止', () => {
    const s = new TranslationRunState()
    s.begin(P)
    s.requestStop(P)
    expect(s.shouldStop(P)).toBe(true)

    // 当前段还在等模型返回，用户又点了「翻译全文」
    expect(s.resumeIfRunning(P)).toBe(true)
    expect(s.shouldStop(P)).toBe(false) // 撤回了，循环会继续跑下去
    expect(s.isRunning(P)).toBe(true)
  })

  it('没在跑时 resumeIfRunning 为 false，且不会把论文标成运行中', () => {
    const s = new TranslationRunState()
    expect(s.resumeIfRunning(P)).toBe(false)
    expect(s.isRunning(P)).toBe(false) // 早退分支不能留下占用
  })

  it('没在跑时请求停止是空操作，不会污染下一轮', () => {
    const s = new TranslationRunState()
    s.requestStop(P)
    expect(s.shouldStop(P)).toBe(false)
    s.begin(P)
    expect(s.shouldStop(P)).toBe(false)
  })

  it('end 清干净，下一轮从零开始', () => {
    const s = new TranslationRunState()
    s.begin(P)
    s.requestStop(P)
    s.end(P)
    expect(s.isRunning(P)).toBe(false)
    expect(s.shouldStop(P)).toBe(false)
    s.begin(P)
    expect(s.shouldStop(P)).toBe(false)
  })

  it('多篇论文互不干扰', () => {
    const s = new TranslationRunState()
    s.begin('a')
    s.begin('b')
    s.requestStop('a')
    expect(s.shouldStop('a')).toBe(true)
    expect(s.shouldStop('b')).toBe(false)
    s.end('a')
    expect(s.isRunning('b')).toBe(true)
  })
})
