import { describe, expect, it } from 'vitest'
import { buildContradictionsMessages, buildSearchSummaryMessages } from './insights'

describe('找矛盾提示词', () => {
  it('逐条列出论文/摘录/笔记；system 禁止硬找矛盾', () => {
    const msgs = buildContradictionsMessages([
      { paper: 'RASR', excerpt: 'WER drops 14.2%', note: '检索有效' },
      { paper: 'Other', excerpt: 'retrieval hurts WER', note: '检索有害？' }
    ])
    expect(msgs[0].content).toContain('没有矛盾就直说没有')
    expect(msgs[1].content).toContain('《RASR》')
    expect(msgs[1].content).toContain('检索有害？')
  })
})

describe('检索总结提示词', () => {
  it('带查询与结果元信息，摘要截断，限 12 条', () => {
    const results = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      title: `Paper ${i}`,
      authors: [],
      year: 2024,
      source: 'arXiv',
      url: '',
      pdfUrl: null,
      doi: null,
      arxivId: null,
      citations: i * 10,
      abstract: 'x'.repeat(500)
    }))
    const msgs = buildSearchSummaryMessages('retrieval asr', results)
    expect(msgs[1].content).toContain('检索问题：retrieval asr')
    expect(msgs[1].content).toContain('Paper 11')
    expect(msgs[1].content).not.toContain('Paper 12') // 限 12 条
    expect(msgs[1].content).toContain('被引110')
    expect(msgs[1].content).not.toContain('x'.repeat(320)) // 摘要截断到 300
  })
})
