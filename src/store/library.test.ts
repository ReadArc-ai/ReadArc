import { describe, expect, it } from 'vitest'
import type { PaperRow } from '../../shared/models'
import { filterByQuery } from './library'

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
