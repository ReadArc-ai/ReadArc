import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArxivHtmlStore, detectArxivId } from './arxiv-html'

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
    const png = new Uint8Array([137, 80, 78, 71])
    const fetcher = vi.fn(async (url: string) => (url.endsWith('.png') ? reply(200, png, url) : reply(200, DOC)))
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
