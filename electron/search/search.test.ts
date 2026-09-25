import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb } from '../db'
import { parseArxivAtom, ARXIV_ID_RE } from './sources/arxiv'
import { normalizeS2 } from './sources/semanticscholar'
import { dedupResults, computeWhy } from './dedup'
import { searchAll } from './service'
import type { SearchOutcome, SearchResult } from './types'

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2406.01234v2</id>
    <title>Retrieval-Augmented Speech
      Recognition</title>
    <summary>We propose RASR &amp; friends.</summary>
    <published>2024-06-03T00:00:00Z</published>
    <author><name>A. Author</name></author>
    <author><name>B. Author</name></author>
    <link title="pdf" href="https://arxiv.org/pdf/2406.01234v2" rel="related"/>
  </entry>
</feed>`

describe('arXiv Atom 解析', () => {
  it('折行标题压平、实体解码、pdf 链接与 id 抽取', () => {
    const [r] = parseArxivAtom(ATOM)
    expect(r.title).toBe('Retrieval-Augmented Speech Recognition')
    expect(r.arxivId).toBe('2406.01234')
    expect(r.pdfUrl).toContain('arxiv.org/pdf')
    expect(r.abstract).toBe('We propose RASR & friends.')
    expect(r.authors).toEqual(['A. Author', 'B. Author'])
    expect(r.year).toBe(2024)
  })

  it('arXiv ID 识别（粘贴即解析的入口）', () => {
    expect(ARXIV_ID_RE.test('2406.01234')).toBe(true)
    expect(ARXIV_ID_RE.test('2406.01234v2')).toBe(true)
    expect(ARXIV_ID_RE.test('retrieval speech')).toBe(false)
  })
})

describe('S2 归一化', () => {
  it('externalIds/openAccessPdf 映射', () => {
    const [r] = normalizeS2([
      {
        paperId: 'abc',
        title: 'RASR',
        year: 2024,
        citationCount: 42,
        authors: [{ name: 'A' }],
        externalIds: { DOI: '10.1/x', ArXiv: '2406.01234' },
        openAccessPdf: { url: 'https://pdf' }
      }
    ])
    expect(r).toMatchObject({ doi: '10.1/x', arxivId: '2406.01234', citations: 42, pdfUrl: 'https://pdf' })
  })
})

function fake(partial: Partial<SearchResult>): SearchResult {
  return {
    id: partial.id ?? Math.random().toString(),
    title: 'T',
    authors: [],
    year: null,
    source: 'X',
    url: '',
    pdfUrl: null,
    doi: null,
    arxivId: null,
    citations: null,
    abstract: null,
    ...partial
  }
}

describe('去重', () => {
  it('同 arXiv ID 合并且字段择优（引用数、PDF、来源徽标）', () => {
    const merged = dedupResults([
      fake({ id: 'a', title: 'Retrieval-Augmented Speech Recognition', arxivId: '2406.01234', source: 'arXiv', pdfUrl: 'p' }),
      fake({ id: 'b', title: 'Retrieval Augmented Speech Recognition', arxivId: '2406.01234', source: 'S2', citations: 42 })
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ citations: 42, pdfUrl: 'p', source: 'arXiv+S2' })
  })

  it('无 ID 靠标题 simhash 合并；不同论文不误并', () => {
    const merged = dedupResults([
      fake({ id: 'a', title: 'Retrieval-Augmented Speech Recognition for Long Audio' }),
      fake({ id: 'b', title: 'Retrieval Augmented Speech Recognition for Long Audio' }),
      fake({ id: 'c', title: 'A Completely Different Study of Protein Folding Dynamics' })
    ])
    expect(merged).toHaveLength(2)
  })
})

describe('WHY 行', () => {
  it('给出命中词；无命中给兜底理由', () => {
    const r = fake({ title: 'Retrieval-Augmented Speech Recognition', abstract: 'exemplar retrieval' })
    expect(computeWhy(r, 'speech retrieval')).toContain('retrieval')
    expect(computeWhy(fake({ title: 'X' }), 'zzz')).toBe('同领域相关结果')
  })
  it('纯数字不算关键词：论文里恰好出现「1706」不是相关性', () => {
    const r = fake({ title: 'GLU Variants Improve Transformer', abstract: 'arXiv 1706.03762 introduced attention' })
    expect(computeWhy(r, '1706.03762')).toBe('同领域相关结果')
  })
})

describe('searchAll（退避 + 缓存 + 单源失败不拖垮）', () => {
  let db: Database.Database
  beforeEach(() => {
    db = openDb(':memory:')
  })

  const atomRes = (): Response => new Response(ATOM, { status: 200 })
  const s2Res = (): Response =>
    new Response(JSON.stringify({ data: [{ paperId: 'abc', title: 'Other Paper', year: 2023 }] }), {
      status: 200
    })

  it('arXiv 编号查询：只打 arXiv，精确命中排第一并标为 id', async () => {
    const urls: string[] = []
    const fetcher = async (url: string): Promise<Response> => {
      urls.push(url)
      return url.includes('arxiv') ? atomRes() : s2Res()
    }
    const out = await searchAll(db, '2406.01234', { fetcher, sleep: async () => {} })
    expect(urls.every((u) => u.includes('arxiv'))).toBe(true)
    expect(out.sources.map((s) => s.count)).toEqual([1, 0])
    expect(out.results[0].arxivId).toBe('2406.01234')
    expect(out.results[0].whyKind).toBe('id')
  })

  it('并发打源、去重计数、结果缓存 24h', async () => {
    let calls = 0
    const fetcher = async (url: string): Promise<Response> => {
      calls++
      return url.includes('arxiv') ? atomRes() : s2Res()
    }
    const out1 = await searchAll(db, 'retrieval speech', { fetcher, sleep: async () => {} })
    expect(out1.sources.map((s) => s.count)).toEqual([1, 1])
    expect(out1.rawCount).toBe(2)
    expect(calls).toBe(2)

    const out2 = await searchAll(db, 'Retrieval  Speech', { fetcher, sleep: async () => {} }) // 归一化命中缓存
    expect(calls).toBe(2)
    expect(out2.fromCache).toBe(true)
  })

  it('429 指数退避后成功；4xx 不重试', async () => {
    const attempts: string[] = []
    const fetcher = async (url: string): Promise<Response> => {
      if (url.includes('arxiv')) {
        attempts.push('arxiv')
        return attempts.filter((a) => a === 'arxiv').length < 3
          ? new Response('rate', { status: 429 })
          : atomRes()
      }
      attempts.push('s2')
      return new Response('bad', { status: 400 })
    }
    const delays: number[] = []
    const out = await searchAll(db, 'q', {
      fetcher,
      sleep: async (ms) => {
        delays.push(ms)
      }
    })
    expect(delays).toEqual([500, 1500]) // 指数退避
    expect(out.sources.find((s) => s.slug === 'arxiv')?.count).toBe(1)
    const s2 = out.sources.find((s) => s.slug === 's2')!
    expect(s2.error).toContain('400')
    expect(attempts.filter((a) => a === 's2')).toHaveLength(1) // 4xx 不重试
  })

  it('单源超时：不重试、不拖垮另一源，错误标注为超时', async () => {
    const attempts: string[] = []
    const fetcher = async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.includes('arxiv')) {
        attempts.push('arxiv')
        return atomRes()
      }
      attempts.push('s2')
      return new Promise((_, reject) =>
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      )
    }
    const out = await searchAll(db, 'q', { fetcher, sleep: async () => {}, timeoutMs: 20, cooldowns: new Map() })
    expect(out.sources.find((s) => s.slug === 'arxiv')?.count).toBe(1)
    expect(out.sources.find((s) => s.slug === 's2')?.error).toContain('超时')
    expect(attempts.filter((a) => a === 's2')).toHaveLength(1)
  })

  it('快的源先回：onPartial 先给带 pending 标记的中间结果，最终结果不带', async () => {
    let releaseS2: () => void = () => {}
    const fetcher = async (url: string): Promise<Response> => {
      if (url.includes('arxiv')) return atomRes()
      await new Promise<void>((r) => (releaseS2 = r))
      return s2Res()
    }
    const partials: SearchOutcome[] = []
    const done = searchAll(db, 'q', { fetcher, sleep: async () => {}, cooldowns: new Map() }, (o) =>
      partials.push(o)
    )
    await new Promise((r) => setTimeout(r, 20))
    expect(partials).toHaveLength(1)
    expect(partials[0].partial).toBe(true)
    expect(partials[0].results).toHaveLength(1)
    expect(partials[0].sources.find((s) => s.slug === 's2')?.pending).toBe(true)
    releaseS2()
    const out = await done
    expect(out.partial).toBeFalsy()
    expect(out.results).toHaveLength(2)
    expect(out.sources.every((s) => !s.pending)).toBe(true)
  })

  it('重试仍 429 的源进入 60 秒冷却：期间直接跳过不发请求，到期恢复', async () => {
    let s2Calls = 0
    const fetcher = async (url: string): Promise<Response> => {
      if (url.includes('arxiv')) return atomRes()
      s2Calls++
      return new Response('rate', { status: 429 })
    }
    let t = 1_000_000
    const deps = { fetcher, sleep: async () => {}, now: () => t, cooldowns: new Map<string, number>() }
    const out1 = await searchAll(db, 'q1', deps)
    expect(s2Calls).toBe(3)
    expect(out1.sources.find((s) => s.slug === 's2')?.error).toMatch(/限制了请求频率/)
    const out2 = await searchAll(db, 'q2', deps)
    expect(s2Calls).toBe(3) // 冷却期内没有再打
    expect(out2.sources.find((s) => s.slug === 's2')?.error).toContain('暂时限制请求')
    expect(out2.sources.find((s) => s.slug === 'arxiv')?.count).toBe(1) // 另一源照常
    t += 61_000
    await searchAll(db, 'q3', deps)
    expect(s2Calls).toBe(6)
  })
})

describe('friendlySourceError', () => {
  it('限流、服务端故障、网络错误各有人话，其它原样', async () => {
    const { friendlySourceError } = await import('./service')
    expect(friendlySourceError(new Error('S2 HTTP 429'))).toMatch(/限制了请求频率/)
    expect(friendlySourceError(new Error('arXiv HTTP 503'))).toMatch(/不可用.*503/)
    expect(friendlySourceError(new Error('S2 HTTP 404'))).toMatch(/404/)
    expect(friendlySourceError(new Error('fetch failed'))).toMatch(/无法连接/)
    expect(friendlySourceError(new Error('weird'))).toBe('weird')
  })
})

describe('中文检索词转英文', () => {
  let db: Database.Database
  beforeEach(() => {
    db = openDb(':memory:')
  })
  const empty = (): Response => new Response(JSON.stringify({ data: [] }), { status: 200 })

  it('中文先翻成英文再查源，结果里标出实际用的词', async () => {
    const urls: string[] = []
    const fetcher = async (url: string): Promise<Response> => {
      urls.push(url)
      return empty()
    }
    const out = await searchAll(db, '长文本的注意力优化', { fetcher, sleep: async () => {}, translate: async () => 'long context attention' })
    expect(out.queryUsed).toBe('long context attention')
    expect(urls.every((u) => u.includes(encodeURIComponent('long context attention').replace(/%20/g, '+')) || u.includes('long%20context%20attention') || u.includes('long+context+attention'))).toBe(true)
  })

  it('翻译失败：照原词查，标注错误', async () => {
    const out = await searchAll(db, '长文本的注意力优化', { fetcher: async () => empty(), sleep: async () => {}, translate: async () => { throw new Error('没接模型') } })
    expect(out.queryUsed).toBeUndefined()
    expect(out.translateError).toBe('没接模型')
  })

  it('英文和 arXiv ID 不翻', async () => {
    let called = 0
    const translate = async (): Promise<string> => { called++; return 'x' }
    await searchAll(db, 'retrieval speech', { fetcher: async () => empty(), sleep: async () => {}, translate })
    await searchAll(db, '2406.01234', { fetcher: async () => empty(), sleep: async () => {}, translate })
    expect(called).toBe(0)
  })
})
