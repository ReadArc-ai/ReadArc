import { describe, expect, it, vi } from 'vitest'

vi.mock('../i18n', () => ({ uiText: (k: string) => k }))
import { findPaperMeta, lookupByTitle, lookupPaperMeta, sameTitle } from './meta-lookup'

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

describe('自动补全用的查询', () => {
  const json = (v: unknown, status = 200): Response => new Response(JSON.stringify(v), { status })
  const work = (title: string, authors: string[], extra: object = {}): object => ({
    title,
    publication_year: 2024,
    authorships: authors.map((display_name) => ({ author: { display_name } })),
    ...extra
  })

  it('arXiv API 超时时摘要页照样查得到', async () => {
    const urls: string[] = []
    const hit = await findPaperMeta({ arxiv_id: '2210.03629' }, async (url) => {
      urls.push(url)
      return new Response('<meta name="citation_title" content="ReAct" /><meta name="citation_author" content="Yao, Shunyu" /><meta name="citation_date" content="2022/10/06" />')
    })
    expect(hit).toMatchObject({ title: 'ReAct', authors: ['Shunyu Yao'], year: 2022, source: 'arXiv' })
    expect(urls[0]).toContain('arxiv.org/abs/2210.03629')
    expect(urls).toHaveLength(1)
  })

  it('Semantic Scholar 限流时改问 OpenAlex；都查不到返回 null，断网抛错', async () => {
    const hit = await findPaperMeta({ doi: '10.1000/x' }, async (url) =>
      url.includes('semanticscholar') ? json({}, 429) : json(work('A Paper', ['Ann Lee'], { primary_location: { source: { display_name: 'Nature' } } }))
    )
    expect(hit).toMatchObject({ title: 'A Paper', source: 'Nature', authors: ['Ann Lee'] })
    expect(await findPaperMeta({ doi: '10.1000/x' }, async () => json({}, 404))).toBeNull()
    await expect(
      findPaperMeta({ doi: '10.1000/x' }, async () => {
        throw new Error('offline')
      })
    ).rejects.toThrow('offline')
  })

  it('按标题查：标题要完全相同，作者姓氏要出现在首页', async () => {
    const results = [work('Language Agents and Beyond', ['Shunyu Yao']), work('Language agents', ['Someone Else']), work('Language Agents', ['Shunyu Yao'], { publication_year: 2024 })]
    const fetcher = async (): Promise<Response> => json({ results })
    expect(await lookupByTitle('Language Agents', 'LANGUAGE AGENTS\nShunyu Yao\nA dissertation', fetcher)).toMatchObject({ authors: ['Shunyu Yao'], year: 2024 })
    expect(await lookupByTitle('Language Agents', 'LANGUAGE AGENTS by an unrelated writer', fetcher)).toBeNull()
  })

  it('标题比较只看字母数字：拆开的小型大写算同一篇，脚注里别的论文不算', () => {
    expect(sameTitle('REAC T: Synergizing Reasoning', 'ReAct: Synergizing Reasoning')).toBe(true)
    expect(sameTitle('Mental-LLM', 'Mental-LLM: Leveraging Large Language Models')).toBe(true)
    expect(sameTitle('Attention Is All You Need', 'ReAct: Synergizing Reasoning')).toBe(false)
  })
})

