import { describe, expect, it } from 'vitest'
import { sanitizeResult, sanitizeResults } from './sanitize'
import type { SearchResult } from './types'

const base: SearchResult = {
  id: 'x',
  title: 'A normal paper title',
  authors: ['A. One', 'B. Two'],
  year: 2024,
  source: 'arXiv',
  url: 'https://arxiv.org/abs/1',
  pdfUrl: 'https://arxiv.org/pdf/1',
  doi: null,
  arxivId: '2406.01234',
  citations: 3,
  abstract: 'Short abstract.'
}

describe('检索结果收口', () => {
  it('正常结果原样通过', () => {
    expect(sanitizeResult(base)).toMatchObject({ title: base.title, year: 2024 })
  })

  it('没有任何可用身份的条目丢弃（畸形 feed 不该往列表里塞空卡片）', () => {
    const empty = { ...base, title: '', arxivId: null, doi: null, pdfUrl: null }
    expect(sanitizeResult(empty)).toBeNull()
    expect(sanitizeResults([empty, base])).toHaveLength(1)
  })

  it('只有 id 没有标题的仍保留（还能下载）', () => {
    expect(sanitizeResult({ ...base, title: '' })).not.toBeNull()
  })

  it('超长标题截断', () => {
    const r = sanitizeResult({ ...base, title: 'A'.repeat(200000) })!
    expect(r.title.length).toBe(300)
  })

  it('超长摘要截断、空摘要归 null', () => {
    expect(sanitizeResult({ ...base, abstract: 'x'.repeat(99999) })!.abstract!.length).toBe(4000)
    expect(sanitizeResult({ ...base, abstract: '   ' })!.abstract).toBeNull()
  })

  it('作者数量与单个作者名都设上限', () => {
    const r = sanitizeResult({
      ...base,
      authors: Array.from({ length: 5000 }, () => 'N'.repeat(500))
    })!
    expect(r.authors).toHaveLength(60)
    expect(r.authors[0].length).toBe(120)
  })

  it('离谱年份归 null', () => {
    for (const y of [0, 1000, 9999, Number.NaN]) {
      expect(sanitizeResult({ ...base, year: y })!.year, String(y)).toBeNull()
    }
    expect(sanitizeResult({ ...base, year: 1998 })!.year).toBe(1998)
  })

  it('标题里的空白折平', () => {
    expect(sanitizeResult({ ...base, title: '  a\n\n  b  ' })!.title).toBe('a b')
  })
})
