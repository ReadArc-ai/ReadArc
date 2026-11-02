/**
 * arXiv 官方 HTML 版（LaTeXML 从论文源码生成）：公式是真正的 MathML，表格是真正的表格。
 * 有 arXiv 号的论文在流式视图里优先用它，没有或取不到时回到 PDF 解析。
 *
 * 只在这里联网：HTML 与图片下载后缓存在 userData/arxiv/，之后离线也能读。
 * 取不到（arXiv 没有生成 HTML 版）记一笔，七天内不再重试，免得每次打开都白等。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ArxivHtmlResult, BlockRow, PaperRow } from '../../shared/models'
import { normalizeArxivId } from '../../shared/paper-meta'

const MISSING_RETRY_MS = 7 * 24 * 3600 * 1000
const FETCH_TIMEOUT_MS = 25_000
/** 实测 8MB 的 SVG 在普通线路上要 30～50 秒 */
const ASSET_TIMEOUT_MS = 120_000
const MAX_HTML_BYTES = 30 * 1024 * 1024
const MAX_ASSET_BYTES = 40 * 1024 * 1024
/** 同时下载几张图：一篇几十上百张图一起请求，arXiv 会回 429，慢网下也容易集体超时 */
const ASSET_CONCURRENCY = 4
/** 第一次失败后再试两次（等待毫秒）：网络抖动、限流多半等一下就好 */
const ASSET_RETRY_MS = [1000, 3000]

interface CacheMeta {
  id: string
  /** 页面的最终地址（跟随重定向后），图片相对它解析 */
  url: string
  status: 'ok' | 'missing'
  fetchedAt: number
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

/** 先写临时文件再改名：下载写到一半退出应用，也不会留下一个看着正常、其实解不开的半截文件 */
function writeFileAtomic(path: string, data: string | Buffer): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, path)
}

/**
 * 图片是不是完整的：连接中途断开时有的情况不报错，只是字节不够。
 * 半截文件进了缓存，这张图就永远是空白，所以下载和读缓存时都查一下文件尾
 */
export function imageComplete(bytes: Buffer, ext: string): boolean {
  if (bytes.length === 0) return false
  const tail = bytes.subarray(Math.max(0, bytes.length - 64))
  if (ext === 'svg') return tail.includes('</svg')
  if (ext === 'png') return tail.includes('IEND')
  if (ext === 'jpg' || ext === 'jpeg') return tail.includes(Buffer.from([0xff, 0xd9]))
  return true
}

/**
 * 论文的 arXiv 号：库里记的优先；没有就看首页的 arXiv 侧边水印（「arXiv:2608.24753v1 [cs.CL] …」），
 * 水印带版本号，正好对上手里这份 PDF 的版本
 */
export function detectArxivId(paper: Pick<PaperRow, 'arxiv_id'>, blocks: Pick<BlockRow, 'page' | 'text'>[]): string | null {
  for (const b of blocks) {
    if (b.page > 1) break
    const m = /arXiv:\s*(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)/.exec(b.text)
    if (m) {
      const fromPdf = normalizeArxivId(m[1])
      const stored = normalizeArxivId(paper.arxiv_id)
      // 库里记的号与水印不一致（用户手改过）时听库里的
      if (!stored || fromPdf?.replace(/v\d+$/, '') === stored.replace(/v\d+$/, '')) return fromPdf
      return stored
    }
  }
  return normalizeArxivId(paper.arxiv_id)
}

/** 侧边水印的写法（「arXiv:2608.24753v1 [cs.CL] 12 Aug 2026」）：是这篇自己的编号，不是脚注里的引用 */
export function hasArxivStamp(blocks: Pick<BlockRow, 'page' | 'text'>[]): boolean {
  return blocks.some((b) => b.page === 1 && /arXiv:\s*[\w./-]+\s*\[[\w.-]+\]/.test(b.text))
}

/** 首页上的 DOI（期刊论文一般印在页眉或脚注） */
export function detectDoi(blocks: Pick<BlockRow, 'page' | 'text'>[]): string | null {
  for (const b of blocks) {
    if (b.page > 1) break
    const m = /\b10\.\d{4,9}\/[^\s"<>,;]+/.exec(b.text)
    if (m) return m[0].replace(/[.)\]]+$/, '')
  }
  return null
}

export class ArxivHtmlStore {
  /** 同一篇正在下载：后来的请求等同一次下载（导入后的预取和打开论文常常撞在一起） */
  private readonly inflight = new Map<string, Promise<ArxivHtmlResult>>()
  /** 同一个图片文件正在下载：并发的请求等同一次 */
  private readonly assetInflight = new Map<string, Promise<string | null>>()
  private activeDownloads = 0
  private readonly downloadQueue: (() => void)[] = []

  constructor(
    private readonly dir: string,
    private readonly fetcher: Fetcher = (url, init) => fetch(url, init),
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
  ) {}

  private async withDownloadSlot<T>(job: () => Promise<T>): Promise<T> {
    if (this.activeDownloads >= ASSET_CONCURRENCY) await new Promise<void>((r) => this.downloadQueue.push(r))
    this.activeDownloads++
    try {
      return await job()
    } finally {
      this.activeDownloads--
      this.downloadQueue.shift()?.()
    }
  }

  /** 下载一张图：网络错误、超时、429、5xx 重试；404 这类重试也没用的直接放弃 */
  private async downloadAsset(url: string, ext: string): Promise<Buffer | null> {
    // arXiv 的 CDN 偶尔缓存着半截文件（Content-Length 也是半截的），重试多少次拿到的都一样：
    // 发现不完整就带个查询参数绕开这份缓存，回源取完整的
    let bypass = false
    for (let attempt = 0; ; attempt++) {
      let retryable = true
      try {
        const res = await this.fetcher(bypass ? `${url}?r=${attempt}` : url, { signal: AbortSignal.timeout(ASSET_TIMEOUT_MS) })
        if (res.ok) {
          const bytes = Buffer.from(await res.arrayBuffer())
          if (imageComplete(bytes, ext)) return bytes
          bypass = true
        } else {
          retryable = res.status === 429 || res.status >= 500
        }
      } catch {
        // 连不上、超时：下面按重试处理
      }
      if (!retryable || attempt >= ASSET_RETRY_MS.length) return null
      await this.sleep(ASSET_RETRY_MS[attempt])
    }
  }

  private metaPath(paperId: string): string {
    return join(this.dir, `${paperId}.json`)
  }

  private htmlPath(paperId: string): string {
    return join(this.dir, `${paperId}.html`)
  }

  private assetDir(paperId: string): string {
    return join(this.dir, paperId)
  }

  private readMeta(paperId: string): CacheMeta | null {
    try {
      return JSON.parse(readFileSync(this.metaPath(paperId), 'utf8')) as CacheMeta
    } catch {
      return null
    }
  }

  private writeMeta(paperId: string, meta: CacheMeta): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(this.metaPath(paperId), JSON.stringify(meta))
  }

  /** 取 HTML：先看缓存；没有就联网取一次。refresh 时无视缓存（arXiv 出了新版） */
  get(paperId: string, arxivId: string | null, refresh = false): Promise<ArxivHtmlResult> {
    const key = `${paperId}#${arxivId}#${refresh}`
    const running = this.inflight.get(key)
    if (running) return running
    const job = this.load(paperId, arxivId, refresh).finally(() => this.inflight.delete(key))
    this.inflight.set(key, job)
    return job
  }

  private async load(paperId: string, arxivId: string | null, refresh: boolean): Promise<ArxivHtmlResult> {
    if (!/^[0-9a-f]{40}$/.test(paperId)) return { status: 'unavailable' }
    if (!arxivId) return { status: 'unavailable' }
    const meta = this.readMeta(paperId)
    if (!refresh && meta && meta.id === arxivId) {
      if (meta.status === 'ok' && existsSync(this.htmlPath(paperId))) {
        return { status: 'ok', html: readFileSync(this.htmlPath(paperId), 'utf8'), url: meta.url, arxivId }
      }
      if (meta.status === 'missing' && this.now() - meta.fetchedAt < MISSING_RETRY_MS) return { status: 'unavailable', arxivId }
    }
    const url = `https://arxiv.org/html/${arxivId}`
    let res: Response
    try {
      res = await this.fetcher(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' })
    } catch {
      // 网络不通不记「没有」：下次打开再试
      return { status: 'offline', arxivId }
    }
    const finalUrl = res.url || url
    const text = res.ok ? await res.text() : ''
    // arXiv 对没生成 HTML 的论文有时也回 200 加一张说明页：只认真正的 LaTeXML 文档
    if (!res.ok || !text.includes('ltx_document') || text.length > MAX_HTML_BYTES) {
      if (res.status === 404 || res.ok) this.writeMeta(paperId, { id: arxivId, url: finalUrl, status: 'missing', fetchedAt: this.now() })
      return { status: res.ok || res.status === 404 ? 'unavailable' : 'offline', arxivId }
    }
    mkdirSync(this.dir, { recursive: true })
    writeFileAtomic(this.htmlPath(paperId), text)
    this.writeMeta(paperId, { id: arxivId, url: finalUrl, status: 'ok', fetchedAt: this.now() })
    return { status: 'ok', html: text, url: finalUrl, arxivId }
  }

  /**
   * 页面里的图片（相对路径）：只认 arxiv.org 上、路径不含「..」的普通文件，下载后缓存到本地，
   * 以 data URL 交给页面（应用的 CSP 不允许直接加载外部图片）
   */
  asset(paperId: string, src: string): Promise<string | null> {
    const key = `${paperId}|${src}`
    const running = this.assetInflight.get(key)
    if (running) return running
    const job = this.loadAsset(paperId, src).finally(() => this.assetInflight.delete(key))
    this.assetInflight.set(key, job)
    return job
  }

  private async loadAsset(paperId: string, src: string): Promise<string | null> {
    if (!/^[0-9a-f]{40}$/.test(paperId)) return null
    if (!/^[\w.\-/]{1,300}$/.test(src) || src.includes('..') || src.startsWith('/')) return null
    const meta = this.readMeta(paperId)
    if (!meta || meta.status !== 'ok') return null
    let target: URL
    try {
      target = new URL(src, meta.url)
    } catch {
      return null
    }
    if (target.protocol !== 'https:' || target.hostname !== 'arxiv.org') return null
    const ext = (/\.(png|jpe?g|gif|svg|webp)$/i.exec(target.pathname)?.[1] ?? '').toLowerCase()
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext ? `image/${ext}` : null
    if (!mime) return null
    const file = join(this.assetDir(paperId), src.replace(/\//g, '__'))
    // 以前的版本可能留下半截文件：不完整的当没缓存，重新下载
    const cached = existsSync(file) ? readFileSync(file) : null
    let bytes: Buffer
    if (cached && imageComplete(cached, ext)) {
      bytes = cached
    } else {
      const got = await this.withDownloadSlot(() => this.downloadAsset(target.href, ext))
      if (!got || got.length > MAX_ASSET_BYTES) return null
      bytes = got
      mkdirSync(this.assetDir(paperId), { recursive: true })
      writeFileAtomic(file, bytes)
    }
    return `data:${mime};base64,${bytes.toString('base64')}`
  }

  /** 删除论文时一并清掉 */
  remove(paperId: string): void {
    if (!/^[0-9a-f]{40}$/.test(paperId)) return
    for (const p of [this.metaPath(paperId), this.htmlPath(paperId), this.assetDir(paperId)]) {
      try {
        rmSync(p, { recursive: true, force: true })
      } catch {
        /* 清理失败不影响删除 */
      }
    }
  }
}
