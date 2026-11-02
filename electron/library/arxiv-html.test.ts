import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArxivHtmlStore, detectArxivId, detectDoi, hasArxivStamp, imageComplete } from './arxiv-html'

const PID = 'b'.repeat(40)
const DOC = '<html><body><article class="ltx_document"><p class="ltx_p">Hi</p></article></body></html>'
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'readarc-arxiv-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function reply(status: number, body: string | Uint8Array, url = 'https://arxiv.org/html/2608.24753v1'): Response {
  const r = new Response(body, { status })
  Object.defineProperty(r, 'url', { value: url })
  return r
}

describe('识别 arXiv 号', () => {
  it('首页水印带版本号，优先用它；库里手改过的号不一致时听库里的', () => {
    const blocks = [{ page: 1, text: 'arXiv:2608.24753v1 [cs.CL] 25 Aug 2026' }]
    expect(detectArxivId({ arxiv_id: null }, blocks)).toBe('2608.24753v1')
    expect(detectArxivId({ arxiv_id: '2608.24753' }, blocks)).toBe('2608.24753v1')
    expect(detectArxivId({ arxiv_id: '2401.00001' }, blocks)).toBe('2401.00001')
    expect(detectArxivId({ arxiv_id: null }, [{ page: 2, text: 'arXiv:2608.24753v1' }])).toBeNull()
  })
})

describe('arXiv 网页版缓存', () => {
  it('取到后读缓存，不再联网', async () => {
    const fetcher = vi.fn(async () => reply(200, DOC))
    const store = new ArxivHtmlStore(dir, fetcher)
    expect(await store.get(PID, '2608.24753v1')).toMatchObject({ status: 'ok', arxivId: '2608.24753v1' })
    expect(await store.get(PID, '2608.24753v1')).toMatchObject({ status: 'ok' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('arXiv 没有 HTML 版（404 或说明页）：七天内不再重试；连不上则下次再试', async () => {
    let now = 1_000_000
    const fetcher = vi.fn(async () => reply(200, '<p>HTML is not available</p>'))
    const store = new ArxivHtmlStore(dir, fetcher, () => now)
    expect((await store.get(PID, '2608.24753v1')).status).toBe('unavailable')
    expect((await store.get(PID, '2608.24753v1')).status).toBe('unavailable')
    expect(fetcher).toHaveBeenCalledTimes(1)
    now += 8 * 24 * 3600 * 1000
    await store.get(PID, '2608.24753v1')
    expect(fetcher).toHaveBeenCalledTimes(2)

    const offline = new ArxivHtmlStore(join(dir, 'o'), vi.fn(async () => { throw new TypeError('fetch failed') }))
    expect((await offline.get(PID, '2608.24753v1')).status).toBe('offline')
  })

  it('同时来的两次请求只下载一次', async () => {
    const fetcher = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20))
      return reply(200, DOC)
    })
    const store = new ArxivHtmlStore(dir, fetcher)
    const [a, b] = await Promise.all([store.get(PID, '2608.24753v1'), store.get(PID, '2608.24753v1')])
    expect(a.status).toBe('ok')
    expect(b.status).toBe('ok')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('没有 arXiv 号、论文 id 不合法：直接不可用，不联网', async () => {
    const fetcher = vi.fn()
    const store = new ArxivHtmlStore(dir, fetcher)
    expect((await store.get(PID, null)).status).toBe('unavailable')
    expect((await store.get('../etc', '2608.24753v1')).status).toBe('unavailable')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('图片：只取 arxiv.org 上的普通相对路径，下载后缓存', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 73, 69, 78, 68])
    const fetcher = vi.fn(async (url: string) => (url.endsWith('.png') ? reply(200, png, url) : url.endsWith('.svg') ? reply(200, '<svg></svg>', url) : reply(200, DOC)))
    const store = new ArxivHtmlStore(dir, fetcher)
    await store.get(PID, '2608.24753v1')
    const url = await store.asset(PID, '2608.24753v1/figures/metrics.png')
    expect(url).toBe(`data:image/png;base64,${Buffer.from(png).toString('base64')}`)
    expect(fetcher).toHaveBeenLastCalledWith('https://arxiv.org/html/2608.24753v1/figures/metrics.png', expect.anything())
    await store.asset(PID, '2608.24753v1/figures/metrics.png')
    expect(fetcher).toHaveBeenCalledTimes(2)
    // 同一个文件并发要：只下载一次
    const many = await Promise.all([1, 2, 3].map(() => store.asset(PID, '2608.24753v1/orcid.svg')))
    expect(new Set(many).size).toBe(1)
    expect(fetcher.mock.calls.filter(([u]) => String(u).endsWith('orcid.svg'))).toHaveLength(1)
    for (const bad of ['../secret.png', '/etc/passwd.png', 'https://evil.example/x.png', 'x.exe', 'a b.png']) {
      expect(await store.asset(PID, bad), bad).toBeNull()
    }
  })
})

describe('图片下载的重试与并发', () => {
  const ready = async (fetcher: (url: string) => Promise<Response>): Promise<ArxivHtmlStore> => {
    const pages = { first: true }
    const store = new ArxivHtmlStore(
      dir,
      async (url) => {
        if (pages.first) {
          pages.first = false
          return reply(200, DOC)
        }
        return fetcher(url)
      },
      Date.now,
      async () => {}
    )
    await store.get(PID, '2608.24753v1')
    return store
  }

  it('限流、断网后重试，成功就给图', async () => {
    let calls = 0
    const store = await ready(async () => {
      calls++
      if (calls === 1) return reply(429, 'slow down')
      if (calls === 2) throw new Error('connection reset')
      return reply(200, new Uint8Array([1, 2, 3, 73, 69, 78, 68]))
    })
    expect(await store.asset(PID, 'a.png')).toMatch(/^data:image\/png;base64,/)
    expect(calls).toBe(3)
  })

  it('试满次数还不行给 null；404 不重试；失败不缓存，下次能再试', async () => {
    let calls = 0
    let healthy = false
    const store = await ready(async (url) => {
      calls++
      if (url.endsWith('gone.png')) return reply(404, 'nope')
      return healthy ? reply(200, new TextEncoder().encode('xIEND')) : reply(503, 'busy')
    })
    expect(await store.asset(PID, 'gone.png')).toBeNull()
    expect(calls).toBe(1)
    calls = 0
    expect(await store.asset(PID, 'b.png')).toBeNull()
    expect(calls).toBe(3)
    healthy = true
    expect(await store.asset(PID, 'b.png')).toMatch(/^data:image/)
  })

  it('一次来很多张图时同时下载不超过 4 张', async () => {
    let active = 0
    let peak = 0
    const store = await ready(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return reply(200, new TextEncoder().encode('xIEND'))
    })
    const all = await Promise.all(Array.from({ length: 12 }, (_, i) => store.asset(PID, `f${i}.png`)))
    expect(all.every(Boolean)).toBe(true)
    expect(peak).toBeLessThanOrEqual(4)
  })
})

describe('半截图片', () => {
  it('按文件尾判断是否完整', () => {
    expect(imageComplete(Buffer.from('<svg>...</svg>\n'), 'svg')).toBe(true)
    expect(imageComplete(Buffer.from('<svg><path d="M0 0'), 'svg')).toBe(false)
    expect(imageComplete(Buffer.from('xxxIEND\xaeB`'), 'png')).toBe(true)
    expect(imageComplete(Buffer.from([1, 2, 3]), 'png')).toBe(false)
    expect(imageComplete(Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]), 'jpg')).toBe(true)
    expect(imageComplete(Buffer.alloc(0), 'gif')).toBe(false)
  })

  it('下载到半截文件时绕开 CDN 缓存重取，半截的不进缓存；缓存里已有的半截文件自动换掉', async () => {
    const SVG = '<svg>ok</svg>'
    let calls = 0
    const pages = { first: true }
    const store = new ArxivHtmlStore(
      dir,
      async (url) => {
        if (pages.first) {
          pages.first = false
          return reply(200, DOC)
        }
        calls++
        // CDN 缓存着半截文件：只有绕开缓存（带查询参数）才拿得到完整的
        return reply(200, url.includes('?r=') ? SVG : '<svg><path')
      },
      Date.now,
      async () => {}
    )
    await store.get(PID, '2608.24753v1')
    expect(await store.asset(PID, 'a.svg')).toContain('base64,')
    expect(calls).toBe(2)
    const file = join(dir, PID, 'a.svg')
    expect(readFileSync(file, 'utf8')).toBe(SVG)

    // 以前的版本留下的半截文件
    mkdirSync(join(dir, PID), { recursive: true })
    writeFileSync(file, '<svg><path')
    const url = await store.asset(PID, 'a.svg')
    expect(Buffer.from((url ?? '').split(',')[1], 'base64').toString()).toBe(SVG)
    expect(readFileSync(file, 'utf8')).toBe(SVG)
  })
})

describe('首页编号', () => {
  it('水印写法才算这篇自己的 arXiv 号，正文里的引用不算', () => {
    expect(hasArxivStamp([{ page: 1, text: 'arXiv:2608.24753v1 [cs.CL] 12 Aug 2026' }])).toBe(true)
    expect(hasArxivStamp([{ page: 1, text: 'see arXiv preprint arXiv:2210.03629, 2022' }])).toBe(false)
  })

  it('认出首页的 DOI，去掉结尾标点；第二页以后的不算', () => {
    expect(detectDoi([{ page: 1, text: 'Nature 645, https://doi.org/10.1038/s41586-025-09422-z.' }])).toBe('10.1038/s41586-025-09422-z')
    expect(detectDoi([{ page: 2, text: 'doi:10.1000/xyz' }])).toBeNull()
  })
})
