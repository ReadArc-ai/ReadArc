import { describe, expect, it } from 'vitest'
import { streamText, useGen, type GenStream } from './gen'

const A = 'paper-a'
const B = 'paper-b'

describe('生成流按论文归属隔离', () => {
  it('属于当前论文的流正常返回', () => {
    const s: Record<string, GenStream> = { notes: { text: '草稿', paperId: A } }
    expect(streamText(s, 'notes', A)).toBe('草稿')
  })

  it('别的论文的流当作不存在（生成中切换论文不该串台）', () => {
    const s: Record<string, GenStream> = { notes: { text: 'A 的草稿', paperId: A } }
    expect(streamText(s, 'notes', B)).toBeUndefined()
  })

  it('全局流（找矛盾 / 检索总结）不带归属，谁都能读', () => {
    const s: Record<string, GenStream> = { contradictions: { text: '结论相反的两篇…' } }
    expect(streamText(s, 'contradictions')).toBe('结论相反的两篇…')
    expect(streamText(s, 'contradictions', A)).toBe('结论相反的两篇…')
  })

  it('没有这段流时返回 undefined', () => {
    expect(streamText({}, 'notes', A)).toBeUndefined()
  })
})

describe('useGen.apply', () => {
  it('同一篇论文的增量按序拼接', () => {
    useGen.getState().clear('notes')
    useGen.getState().apply('notes', '前半', A)
    useGen.getState().apply('notes', '后半', A)
    expect(streamText(useGen.getState().streams, 'notes', A)).toBe('前半后半')
  })

  it('换了论文从头开始，不把两篇的草稿接在一起', () => {
    useGen.getState().clear('notes')
    useGen.getState().apply('notes', 'A 的内容', A)
    useGen.getState().apply('notes', 'B 的内容', B)
    expect(streamText(useGen.getState().streams, 'notes', B)).toBe('B 的内容')
    expect(streamText(useGen.getState().streams, 'notes', A)).toBeUndefined()
  })

  it('clear 之后彻底消失', () => {
    useGen.getState().apply('summary', 'x', A)
    useGen.getState().clear('summary')
    expect(streamText(useGen.getState().streams, 'summary', A)).toBeUndefined()
  })
})

describe('重来（reset）', () => {
  it('主进程判定第一次输出不合格：reset 让流从头开始，不把两次接在一起', () => {
    useGen.setState({ streams: {} })
    useGen.getState().apply('summary', 'English echo', 'p1')
    useGen.getState().apply('summary', '', 'p1', true)
    useGen.getState().apply('summary', '中文摘要', 'p1')
    expect(useGen.getState().streams['summary']?.text).toBe('中文摘要')
  })
})
