import { describe, expect, it } from 'vitest'
import { normalizeArxivId, normalizeDoi, normalizeTags, sanitizeMetaPatch, splitAuthors, MAX_TAGS } from './paper-meta'

describe('论文信息规整', () => {
  it('DOI 去掉链接前缀与句末标点', () => {
    expect(normalizeDoi('https://doi.org/10.1145/3292500.3330701.')).toBe('10.1145/3292500.3330701')
    expect(normalizeDoi('doi:10.48550/arXiv.1706.03762')).toBe('10.48550/arXiv.1706.03762')
    expect(normalizeDoi('not a doi')).toBeNull()
  })

  it('arXiv 号认链接、前缀、版本号和老式编号', () => {
    expect(normalizeArxivId('https://arxiv.org/abs/1706.03762v7')).toBe('1706.03762v7')
    expect(normalizeArxivId('arXiv:2401.12345')).toBe('2401.12345')
    expect(normalizeArxivId('hep-th/9901001')).toBe('hep-th/9901001')
    expect(normalizeArxivId('')).toBeNull()
  })

  it('作者按逗号、分号、换行与 and 分开', () => {
    expect(splitAuthors('Ashish Vaswani, Noam Shazeer; Niki Parmar and Jakob Uszkoreit')).toEqual([
      'Ashish Vaswani',
      'Noam Shazeer',
      'Niki Parmar',
      'Jakob Uszkoreit'
    ])
  })

  it('标签去掉 #、同名忽略大小写只留一个、个数和长度有上限', () => {
    expect(normalizeTags(['#NLP', 'nlp', '  注意力 ', '', 42])).toEqual(['NLP', '注意力'])
    expect(normalizeTags(Array.from({ length: 30 }, (_, i) => `t${i}`))).toHaveLength(MAX_TAGS)
    expect(normalizeTags(['x'.repeat(100)])[0]).toHaveLength(32)
  })

  it('写库前校验：标题必填，年份越界与非整数一律置空', () => {
    expect(sanitizeMetaPatch({ title: '   ' })).toBeNull()
    expect(sanitizeMetaPatch(null)).toBeNull()
    const ok = sanitizeMetaPatch({ title: ' Attention ', year: 2017.5, authors: ['A', '', 3], tags: ['x'], doi: 'bad', source: '' })
    expect(ok).toEqual({ title: 'Attention', title_zh: null, authors: ['A'], year: null, source: null, doi: null, arxiv_id: null, tags: ['x'] })
    expect(sanitizeMetaPatch({ title: 'T', year: 99999 })?.year).toBeNull()
    expect(sanitizeMetaPatch({ title: 'T', year: 2017 })?.year).toBe(2017)
  })
})
