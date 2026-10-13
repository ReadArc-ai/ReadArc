import { describe, expect, it, vi } from 'vitest'

vi.mock('../i18n', () => ({ uiText: (k: string) => k }))
import { lookupPaperMeta } from './meta-lookup'

const atom = `<feed><entry><id>http://arxiv.org/abs/1706.03762v7</id><published>2017-06-12T17:57:34Z</published>
<title>Attention Is All You
  Need</title><author><name>Ashish Vaswani</name></author><author><name>Noam Shazeer</name></author>
<summary>The dominant sequence transduction models…</summary></entry></feed>`

const res = (status: number, body: unknown): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })

describe('按编号补全论文信息', () => {
  it('有 DOI 先问 Semantic Scholar，拿到期刊名', async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toContain('/paper/DOI:10.1145%2F1')
      return res(200, { title: 'A Paper', year: 2021, venue: 'KDD', authors: [{ name: 'X' }], externalIds: { DOI: '10.1145/1' } })
    })
    const hit = await lookupPaperMeta({ doi: 'https://doi.org/10.1145/1' }, fetcher)
    expect(hit).toEqual({ title: 'A Paper', authors: ['X'], year: 2021, source: 'KDD', doi: '10.1145/1', arxiv_id: null })
  })

  it('DOI 查不到时退到 arXiv', async () => {
    const fetcher = vi.fn(async (url: string) => (url.includes('semanticscholar') ? res(404, {}) : res(200, atom)))
    const hit = await lookupPaperMeta({ doi: '10.1/x', arxiv_id: 'arXiv:1706.03762' }, fetcher)
    expect(hit.title).toBe('Attention Is All You Need')
    expect(hit.authors).toEqual(['Ashish Vaswani', 'Noam Shazeer'])
    expect(hit.year).toBe(2017)
    expect(hit.source).toBe('arXiv')
  })

  it('没有编号、查不到、连不上，分别给出不同提示', async () => {
    await expect(lookupPaperMeta({}, vi.fn())).rejects.toThrow('meta.need-id')
    await expect(lookupPaperMeta({ arxiv_id: '2401.00001' }, async () => res(200, '<feed></feed>'))).rejects.toThrow('meta.not-found')
    await expect(
      lookupPaperMeta({ arxiv_id: '2401.00001' }, async () => {
        throw new TypeError('fetch failed')
      })
    ).rejects.toThrow('meta.lookup-failed')
  })
})
