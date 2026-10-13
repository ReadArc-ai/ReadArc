import { describe, expect, it } from 'vitest'
import type { PaperRow } from '../../shared/models'
import { filterByQuery, filterByTag, sortPapers, tagCounts } from './library'

const paper = (over: Partial<PaperRow>): PaperRow =>
  ({
    id: 'x',
    file_path: '/x.pdf',
    title: null,
    title_zh: null,
    authors: null,
    year: null,
    source: null,
    arxiv_id: null,
    doi: null,
    status: 'new',
    progress: 0,
    last_section: null,
    scroll_position: 0,
    added_at: 0,
    last_opened_at: null,
    margins_ready: 1,
    ...over
  }) as PaperRow

describe('论文库内搜索', () => {
  const papers = [
    paper({ id: '1', title: 'Attention Is All You Need', authors: '["Vaswani"]', year: 2017, source: 'arxiv' }),
    paper({ id: '2', title: 'Sparse Attention for Long Context', title_zh: '面向长文档的稀疏注意力', year: 2024 }),
    paper({ id: '3', title: 'Diffusion Models', authors: '["Ho"]', year: 2020 })
  ]

  it('按标题、中文标题、作者、年份、来源匹配，不区分大小写', () => {
    expect(filterByQuery(papers, 'attention').map((p) => p.id)).toEqual(['1', '2'])
    expect(filterByQuery(papers, '稀疏').map((p) => p.id)).toEqual(['2'])
    expect(filterByQuery(papers, 'vaswani').map((p) => p.id)).toEqual(['1'])
    expect(filterByQuery(papers, '2020').map((p) => p.id)).toEqual(['3'])
    expect(filterByQuery(papers, 'arxiv').map((p) => p.id)).toEqual(['1'])
  })

  it('空查询原样返回；没有匹配返回空', () => {
    expect(filterByQuery(papers, '   ')).toHaveLength(3)
    expect(filterByQuery(papers, 'zzz')).toHaveLength(0)
  })
})

describe('论文库排序与标签', () => {
  const papers = [
    paper({ id: 'a', title: 'beta', year: 2020, added_at: 3, last_opened_at: 10, tags: ['NLP'] }),
    paper({ id: 'b', title: 'Alpha', year: null, added_at: 1, last_opened_at: 30, tags: ['NLP', 'CV'] }),
    paper({ id: 'c', title: 'gamma 10', year: 2024, added_at: 2, last_opened_at: null }),
    paper({ id: 'd', title: 'gamma 9', year: 2018, added_at: 4, last_opened_at: 20 })
  ]
  const ids = (ps: PaperRow[]): string => ps.map((p) => p.id).join('')

  it('四种排序', () => {
    expect(ids(sortPapers(papers, 'opened'))).toBe('bdac')
    expect(ids(sortPapers(papers, 'added'))).toBe('dacb')
    // 标题不分大小写，数字按数值（gamma 9 在 gamma 10 前）
    expect(ids(sortPapers(papers, 'title'))).toBe('badc')
    // 没有年份的排最后
    expect(ids(sortPapers(papers, 'year'))).toBe('cadb')
  })

  it('置顶的总在最前，后置顶的更靠前', () => {
    const pinned = papers.map((p) => (p.id === 'c' ? { ...p, pinned_at: 100 } : p.id === 'a' ? { ...p, pinned_at: 200 } : p))
    expect(ids(sortPapers(pinned, 'title'))).toBe('acbd')
  })

  it('按标签筛选、统计，搜索也命中标签', () => {
    expect(ids(filterByTag(papers, 'CV'))).toBe('b')
    expect(ids(filterByTag(papers, null))).toBe('abcd')
    expect(tagCounts(papers)).toEqual([
      { tag: 'CV', count: 1 },
      { tag: 'NLP', count: 2 }
    ])
    expect(ids(filterByQuery(papers, 'nlp'))).toBe('ab')
  })
})

