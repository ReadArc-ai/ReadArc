/** 库服务：持有应用 DB 单例，聚合导入/打开/进度等主进程操作。 */
import { uiText } from '../i18n'
import { app } from 'electron'
import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { basename, join } from 'node:path'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import {
  appendBlocks,
  deletePaperData,
  enrichPaperMeta,
  findPaperByIds,
  getBlocks,
  getPaper,
  listPapers,
  markMarginsReady,
  marginsReady,
  openDb,
  recordProgress,
  markStaleLayouts,
  setLayoutState,
  pendingLayoutPaperIds
} from '../db'
import { extractPages } from '../docengine/extract'
import { marginBlocks } from '../docengine/margins'
import { blockId, sha1, simhash64 } from '../docengine/anchor'
import { cachedTranslations, PROMPT_VERSION } from '../translate/translator'
import { promptVersionFor, targetLang } from '../translate/target-lang'
import { loadGlossary } from '../translate/glossary'
import { FIGURE_SCALE_MARK, LAYOUT_VERSION, LayoutPreempted, cropMark, cropMarkCurrent, cropRequestsFor, figureFileName, importPdf, pruneStaleFigures, refineLayout } from './import'
import { fetchPublicDownload, isDownloadableUrl } from '../safe-url'
import { cropRegions, releaseLayoutSession, retainLayoutSession, modelAvailable } from '../docengine/layout-ml'
import type { SearchResult } from '../search/types'
import type { LayoutProgressEvent } from '../../shared/models'
import type {
  BlockRow,
  ImportBatchResult,
  ImportOutcome,
  ImportProgressEvent,
  PaperBundle,
  ProgressUpdate
} from '../../shared/models'

let db: Database.Database | null = null

export function appDb(): Database.Database {
  if (!db) {
    db = openDb(join(app.getPath('userData'), 'readarc.db'))
  }
  return db
}

/** 全部重置前关库：删文件前必须释放句柄，否则 WAL 会把已删的库又写回来 */
export function closeAppDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

export function figuresDir(): string {
  return join(app.getPath('userData'), 'figures')
}

const figureUpgrades = new Map<string, Promise<void>>()

/**
 * 存量论文的截图是按老倍率裁的（Retina 上发糊）：第一次请求这篇的截图时按当前倍率整篇重裁一次，
 * 写上倍率标记，之后直接走文件。同一篇并发请求共用一个在途任务；重裁失败不影响老图照常返回。
 */
export function ensureFigureQuality(paperId: string): Promise<void> {
  const dir = join(figuresDir(), paperId)
  let mark: string | null = null
  try {
    mark = readFileSync(join(dir, FIGURE_SCALE_MARK), 'utf8')
  } catch {
    /* 没有标记 = 老版本裁的 */
  }
  if (cropMarkCurrent(mark)) return Promise.resolve()
  let job = figureUpgrades.get(paperId)
  if (!job) {
    job = (async () => {
      const paper = getPaper(appDb(), paperId)
      if (!paper) return
      const requests = cropRequestsFor(getBlocks(appDb(), paperId))
      mkdirSync(dir, { recursive: true })
      if (requests.length > 0) {
        const crops = await cropRegions(readFileSync(paper.file_path), requests)
        for (const [key, png] of crops) writeFileSync(join(dir, figureFileName(key)), png)
      }
      writeFileSync(join(dir, FIGURE_SCALE_MARK), cropMark())
    })().finally(() => figureUpgrades.delete(paperId))
    figureUpgrades.set(paperId, job)
  }
  return job
}

/** 外部 PDF 统一拷贝进应用目录再入库：沙箱（MAS）下重启后仍可读，
 *  源文件被移动/删除也不影响库。已在库目录内的路径直接使用。 */
/** 两个文件内容是否完全相同（先比大小，再比内容哈希）。 */
export function sameContent(a: string, b: string): boolean {
  try {
    if (statSync(a).size !== statSync(b).size) return false
    const h = (p: string): string => createHash('sha1').update(readFileSync(p)).digest('hex')
    return h(a) === h(b)
  } catch {
    return false
  }
}

/**
 * 内容一样的 PDF 已经在库里（不看文件名）：直接给已有的那篇，不复制、不重新解析。
 * 之前同一份文件换个名字再拖进来，会重新解析十几秒，库目录里还多一份 2MB 的副本。
 * 开发时要验证解析器改动，设 READARC_REPARSE=1 让它照常重解析。
 */
function existingPaperFor(paperId: string, restoreCopy: () => string): ImportOutcome | null {
  if (process.env.READARC_REPARSE === '1') return null
  const db = appDb()
  const paper = getPaper(db, paperId)
  if (!paper) return null
  const blocks = getBlocks(db, paperId)
  if (blocks.length === 0) return null
  // 库里的副本没了（被手动删掉、换过电脑）：这次导入正好把文件补回来，解析结果照旧
  if (!existsSync(paper.file_path)) {
    const dest = restoreCopy()
    db.prepare('UPDATE papers SET file_path = ? WHERE id = ?').run(dest, paperId)
  }
  return { paperId, blockCount: blocks.length, outline: [], existing: true }
}

function intoLibrary(srcPath: string): string {
  const dir = join(app.getPath('userData'), 'papers')
  if (srcPath.startsWith(dir)) return srcPath
  mkdirSync(dir, { recursive: true })
  let name = basename(srcPath)
  let dest = join(dir, name)
  if (existsSync(dest)) {
    // 同一篇论文重新导入（解析器升级后重导、或又拖了一次同一个文件）时，
    // 直接复用已有副本。不比内容就加后缀的话，每次重导都白留一份 2MB 的旧副本，
    // upsertPaper 把 file_path 指向新副本后，旧的就再也没人引用了。
    if (sameContent(srcPath, dest)) return dest
    // 真的同名不同文件：加短哈希后缀避免覆盖
    const stamp = createHash('sha1').update(srcPath).digest('hex').slice(0, 8)
    name = name.replace(/\.pdf$/i, `-${stamp}.pdf`)
    dest = join(dir, name)
    if (existsSync(dest) && sameContent(srcPath, dest)) return dest
  }
  copyFileSync(srcPath, dest)
  return dest
}

/**
 * 启动时清掉 figures/ 里过期的截图。
 *
 * 截图文件名带块序号（sha1_page_order.png），重新解析后序号一变就换了名字，
 * 旧文件既没人引用也没人删。导入路径已经会顺手清理，这里是给存量用户补一刀；
 * 顺带删掉论文已不存在的整个截图目录。
 */
export function sweepStaleFigures(dir = figuresDir()): number {
  if (!existsSync(dir)) return 0
  const papers = allPapers()
  const alive = new Set(papers.map((p) => p.id))
  let removed = 0
  for (const name of readdirSync(dir)) {
    const sub = join(dir, name)
    if (!alive.has(name)) {
      try {
        rmSync(sub, { recursive: true, force: true })
        removed++
      } catch {
        /* 删不掉就留着 */
      }
      continue
    }
    // 只保留当前块还在用的截图：图/表/公式块，以及段落里的行内公式——清单与裁图同源，别各认各的
    const keep = new Set(cropRequestsFor(getBlocks(appDb(), name)).map((r) => figureFileName(r.key)))
    removed += pruneStaleFigures(sub, keep)
  }
  return removed
}

/**
 * 启动时清掉 papers/ 里没有任何论文引用的 PDF 副本。
 * 来源有二：历史上重复导入留下的旧副本；导入拷完文件但还没写库时应用被强杀。
 * 只在启动时扫一次——那时没有导入在进行，不会误删刚拷好还没入库的文件。
 */
export function sweepOrphanCopies(
  dir = join(app.getPath('userData'), 'papers'),
  referencedPaths?: Iterable<string>
): number {
  if (!existsSync(dir)) return 0
  const referenced = new Set(referencedPaths ?? allPapers().map((p) => p.file_path))
  let removed = 0
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (referenced.has(full)) continue
    try {
      rmSync(full, { force: true })
      removed++
    } catch {
      /* 删不掉就留着，不值得打扰用户 */
    }
  }
  return removed
}

/**
 * 坏 PDF 的底层报错 → 用户能看懂的一句话。
 * 兜底不再直接抛底层英文原句（pdf.js 的 "The PDF file is empty, i.e. its size is
 * zero bytes." 这类会直接出现在导入失败列表里），而是包一层中文并把原文附在后面，
 * 用户看得懂、反馈问题时也没丢信息。
 */
export function friendlyImportError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/PDF_NO_PAGES/.test(msg)) return uiText('import.no-pages')
  if (/size is zero bytes|file is empty|EMPTY_FILE/i.test(msg)) return uiText('import.empty')
  if (/InvalidPDF|Invalid PDF|corrupt/i.test(msg)) return uiText('import.invalid')
  if (/password|encrypted/i.test(msg)) return uiText('import.password')
  if (/ENOENT|no such file/i.test(msg)) return uiText('import.missing')
  if (/copyfile|EROFS|read-only file system/i.test(msg)) return uiText('import.write')
  if (/EACCES|EPERM|permission denied/i.test(msg)) return uiText('import.read')
  if (/EISDIR|illegal operation on a directory/i.test(msg)) return uiText('import.folder')
  if (/ENOSPC|no space left/i.test(msg)) return uiText('import.disk')
  return uiText('import.failed', { detail: msg })
}

export async function importPdfFiles(
  paths: string[],
  onProgress?: (e: ImportProgressEvent) => void
): Promise<ImportBatchResult> {
  const outcomes: ImportOutcome[] = []
  const failures: { file: string; error: string }[] = []
  // 版面模型占几百 MB，只在导入期间需要：批次结束就放掉
  retainLayoutSession()
  try {
    for (const p of paths) {
      if (!/\.pdf$/i.test(p)) continue
      const file = basename(p)
      // intoLibrary 也要在 try 里：拷贝本身会失败（库目录只读、磁盘满），
      // 放在外面的话原始的 EACCES 会直接冲到界面上，还会中断整批导入。
      let dest = p
      try {
        const dup = existingPaperFor(sha1(readFileSync(p)), () => intoLibrary(p))
        if (dup) {
          outcomes.push(dup)
          continue
        }
        dest = intoLibrary(p)
        outcomes.push(
          await importPdf(appDb(), dest, figuresDir(), (page, pages) => onProgress?.({ file, page, pages }), { quick: true })
        )
        const last = outcomes[outcomes.length - 1]
        if (last && getPaper(appDb(), last.paperId)?.layout_state === 'pending') void scheduleLayoutRefine(last.paperId, { urgent: true })
      } catch (err) {
        // 单个坏文件不拖垮整批；解析失败的拷贝不留在库目录里
        failures.push({ file, error: friendlyImportError(err) })
        if (dest !== p) {
          try {
            rmSync(dest, { force: true })
          } catch {
            /* 清理失败无碍 */
          }
        }
      }
    }
  } finally {
    void releaseLayoutSession()
  }
  return { outcomes, failures }
}

/** 删除论文：DB 痕迹 + 应用目录里的文件拷贝/截图/缩略图。
 *  只删应用自己目录内的 PDF 拷贝，绝不碰目录外的原件；笔记 Markdown 保留。 */
export function deletePaper(paperId: string): boolean {
  const paper = getPaper(appDb(), paperId)
  if (!paper) return false
  deletePaperData(appDb(), paperId)
  const papersDir = join(app.getPath('userData'), 'papers')
  try {
    if (paper.file_path.startsWith(papersDir + '/')) rmSync(paper.file_path, { force: true })
  } catch (err) {
    console.warn('delete pdf copy failed:', err)
  }
  try {
    rmSync(join(figuresDir(), paperId), { recursive: true, force: true })
  } catch (err) {
    console.warn('delete figures failed:', err)
  }
  try {
    rmSync(join(app.getPath('userData'), 'thumbs', `${paperId}.png`), {
      force: true
    })
  } catch (err) {
    console.warn('delete thumb failed:', err)
  }
  return true
}

const marginUpgrades = new Map<string, Promise<boolean>>()

/**
 * 老版本解析的论文没有页边块（页眉页脚 / 侧边水印）：首次打开时从 PDF 文本层补一遍，只做一次。
 * 返回是否真的补了块（调用方据此通知渲染进程刷新）。同篇并发共用一个在途任务。
 */
export type LayoutNotifier = (e: LayoutProgressEvent) => void
let layoutNotify: LayoutNotifier = () => {}
export function setLayoutNotifier(fn: LayoutNotifier): void {
  layoutNotify = fn
}

/**
 * 后台版面识别队列：一次只做一篇（推理已吃满 CPU）。用显式队列而不是 Promise 链，
 * 因为用户正在看的论文要能插到队首——升级后几篇论文一起重新识别时，
 * 打开的那篇不该排在最后干等。
 */
const refineQueue: string[] = []
const refineWaiters = new Map<string, { promise: Promise<void>; resolve: () => void }>()
let refineRunning: string | null = null
/** 正在识别的那篇要让位给用户正在看的论文：下一页做完就停 */
let preemptRunning = false

/** 把各篇的排队位置推给界面：前面还有几篇（正在识别的那篇也算一篇） */
function notifyRefineQueue(): void {
  refineQueue.forEach((paperId, i) =>
    layoutNotify({ paperId, page: 0, pages: 0, done: false, ahead: i + (refineRunning ? 1 : 0) })
  )
}

/**
 * 排队做一篇论文的后台版面识别；同一篇重复调用返回同一个任务。
 * urgent：用户正在看这篇（打开、刚导入），挪到队首。
 */
export function scheduleLayoutRefine(paperId: string, opts: { urgent?: boolean } = {}): Promise<void> {
  let waiter = refineWaiters.get(paperId)
  if (!waiter) {
    let resolve: () => void = () => {}
    const promise = new Promise<void>((r) => {
      resolve = r
    })
    waiter = { promise, resolve }
    refineWaiters.set(paperId, waiter)
    refineQueue.push(paperId)
  }
  if (opts.urgent) {
    const i = refineQueue.indexOf(paperId)
    if (i > 0) {
      refineQueue.splice(i, 1)
      refineQueue.unshift(paperId)
    }
    // 后台正在识别别的论文（升级后的批量重识别、长论文要好几分钟）：打断它，先做眼前这篇
    if (refineRunning && refineRunning !== paperId) preemptRunning = true
  }
  notifyRefineQueue()
  void pumpRefineQueue()
  return waiter.promise
}

async function pumpRefineQueue(): Promise<void> {
  if (refineRunning) return
  const paperId = refineQueue.shift()
  if (!paperId) return
  refineRunning = paperId
  notifyRefineQueue()
  retainLayoutSession()
  let preempted = false
  try {
    await refineLayout(appDb(), paperId, figuresDir(), (page, pages) => {
      if (preemptRunning) throw new LayoutPreempted()
      layoutNotify({ paperId, page, pages, done: false })
    })
  } catch (err) {
    if (err instanceof LayoutPreempted) preempted = true
    else {
      // 文件没了或解析崩了：置 done 免得每次打开都重来；启发式分段照常可读
      console.warn('layout refine failed:', err)
      // 记上当前版本：坏文件不该每次启动都重来一遍
      if (getPaper(appDb(), paperId)) setLayoutState(appDb(), paperId, 'done', LAYOUT_VERSION)
    }
  } finally {
    void releaseLayoutSession()
    refineRunning = null
    preemptRunning = false
  }
  if (preempted) {
    // 被打断的排在插队那篇后面，等待它的调用方继续等
    refineQueue.splice(Math.min(1, refineQueue.length), 0, paperId)
    void pumpRefineQueue()
    return
  }
  const waiter = refineWaiters.get(paperId)
  refineWaiters.delete(paperId)
  // 这一轮作废（识别期间被删掉又重新导入）：新导入那份还是 pending，重新排队
  if (getPaper(appDb(), paperId)?.layout_state === 'pending') void scheduleLayoutRefine(paperId)
  else layoutNotify({ paperId, page: 0, pages: 0, done: true })
  waiter?.resolve()
  void pumpRefineQueue()
}

/** 渲染进程刚打开一篇论文时，打开请求返回前推的排队位置会被当成别的论文的事件丢掉，稍后补推一次 */
export function renotifyRefineQueueSoon(): void {
  setTimeout(notifyRefineQueue, 400)
}

/** 应用上次退出时没做完的版面识别，启动后接着做 */
export function resumePendingLayouts(): void {
  // 解析规则升级过：用旧版识别的论文一并排队（模型不在场时重识别也还是启发式，不排）
  if (modelAvailable()) markStaleLayouts(appDb(), LAYOUT_VERSION)
  for (const id of pendingLayoutPaperIds(appDb())) void scheduleLayoutRefine(id)
}

export function ensureMarginBlocks(paperId: string): Promise<boolean> {
  const db = appDb()
  if (marginsReady(db, paperId)) return Promise.resolve(false)
  let job = marginUpgrades.get(paperId)
  if (!job) {
    job = (async () => {
      const paper = getPaper(db, paperId)
      if (!paper) return false
      const existing = getBlocks(db, paperId)
      const { pages } = await extractPages(paper.file_path)
      const covering = existing.map((b) => ({
        page: b.page,
        bbox: b.bbox ? (JSON.parse(b.bbox) as [number, number, number, number]) : null
      }))
      const startOrder = existing.reduce((m, b) => Math.max(m, b.block_order), -1) + 1
      const rows: BlockRow[] = marginBlocks(pages, covering, startOrder).map((b) => ({
        block_id: blockId(paperId, b.page, b.order),
        paper_id: paperId,
        page: b.page,
        block_order: b.order,
        kind: b.kind,
        section: null,
        text: b.text,
        bbox: JSON.stringify(b.bbox),
        simhash: simhash64(b.text),
        heading_level: null,
        font_size: b.fontSize ?? null
      }))
      if (rows.length > 0) appendBlocks(db, rows)
      markMarginsReady(db, paperId)
      return rows.length > 0
    })().finally(() => marginUpgrades.delete(paperId))
    marginUpgrades.set(paperId, job)
  }
  return job
}

export function openPaperBundle(paperId: string): PaperBundle | null {
  const paper = getPaper(appDb(), paperId)
  if (!paper) return null
  const blocks = getBlocks(appDb(), paperId)
  const outline = blocks
    .filter((b) => b.kind === 'heading')
    .map((b) => ({
      title: b.text,
      level: b.heading_level ?? 1,
      page: b.page,
      order: b.block_order
    }))
  appDb().prepare('UPDATE papers SET last_opened_at = ? WHERE id = ?').run(Date.now(), paperId)
  const cached = cachedTranslations(appDb(), paperId, loadGlossary().version)
  return {
    paper,
    blocks,
    outline,
    translations: Object.fromEntries(Object.entries(cached).map(([id, c]) => [id, c.text])),
    translationModels: Object.fromEntries(Object.entries(cached).map(([id, c]) => [id, c.model]))
  }
}

export function saveProgress(paperId: string, update: ProgressUpdate): void {
  recordProgress(appDb(), paperId, update.progress, update.scrollPosition, update.lastSection)
}

export function allPapers() {
  // 进度口径跟阅读器对齐：当前术语表版本 + 当前目标语言的提示词版本（译文缓存按语言错开）
  return listPapers(appDb(), loadGlossary().version, promptVersionFor(PROMPT_VERSION, targetLang()))
}

/** 检索结果一键入库：已在库（DOI/arXiv 命中）直接返回；否则下载 PDF → 导入 → 补元数据。 */
export interface AddProgress {
  stage: 'download' | 'import'
  received: number
  /** 0 = 服务器没给 content-length（进度未知，只报字节数） */
  total: number
}

/** 下载停滞判定：连上了却一直不发数据，超过这个时长就中止。 */
const DOWNLOAD_STALL_MS = 30_000
/** 单篇 PDF 的体积上限：整个响应体要先进内存，必须有个刹车。 */
const MAX_PDF_BYTES = 200 * 1024 * 1024

export async function addSearchResult(
  result: SearchResult,
  onProgress?: (p: AddProgress) => void
): Promise<{ paperId: string; existed: boolean }> {
  const existing = findPaperByIds(appDb(), result.doi, result.arxivId)
  if (existing) return { paperId: existing.id, existed: true }

  if (!result.pdfUrl) throw new Error(uiText('download.no-pdf'))
  if (!isDownloadableUrl(result.pdfUrl)) throw new Error(uiText('download.scheme'))

  // 停滞看门狗：连上了但一直不发数据的服务器会让「下载中」永远转下去。
  // 每收到一个分片就重置计时，只有真正静默超过阈值才中止。
  const ctrl = new AbortController()
  let stall = setTimeout(() => ctrl.abort(), DOWNLOAD_STALL_MS)
  const touch = (): void => {
    clearTimeout(stall)
    stall = setTimeout(() => ctrl.abort(), DOWNLOAD_STALL_MS)
  }

  let res: Response
  try {
    res = await fetchPublicDownload(result.pdfUrl, { signal: ctrl.signal })
  } catch (err) {
    clearTimeout(stall)
    throw ctrl.signal.aborted
      ? new Error(uiText('download.timeout', { seconds: Math.round(DOWNLOAD_STALL_MS / 1000) }), { cause: err })
      : (err as Error)
  }
  if (!res.ok) {
    clearTimeout(stall)
    throw new Error(uiText('download.http', { status: res.status }))
  }

  const total = Number(res.headers.get('content-length') ?? 0)
  const chunks: Buffer[] = []
  let received = 0
  try {
    if (res.body) {
      for await (const chunk of res.body) {
        const buf = Buffer.from(chunk as Uint8Array)
        received += buf.length
        // 整个响应体先攒在内存里，没有上限的话一个坏地址就能把内存撑爆
        if (received > MAX_PDF_BYTES) {
          throw new Error(uiText('download.size', { mb: Math.round(MAX_PDF_BYTES / 1048576) }))
        }
        chunks.push(buf)
        touch()
        onProgress?.({ stage: 'download', received, total })
      }
    }
  } catch (err) {
    // 只要是看门狗中止的就报超时——不能再加「一个字节都没收到」的条件：
    // 挂起的服务器往往先吐几个字节再装死，那时 received > 0，
    // 用户会看到原始的 AbortError 而不是「下载超时」。
    if (ctrl.signal.aborted) {
      throw new Error(uiText('download.timeout', { seconds: Math.round(DOWNLOAD_STALL_MS / 1000) }), {
        cause: err
      })
    }
    throw err
  } finally {
    clearTimeout(stall)
    ctrl.abort()
  }
  const data = Buffer.concat(chunks)
  if (data.length === 0) throw new Error(uiText('download.empty'))
  onProgress?.({ stage: 'import', received, total })
  // 同一份 PDF 之前从别处导入过（arXiv ID 对不上时按内容认）：不再写文件、不再解析
  const dup = existingPaperFor(sha1(data), () => {
    const dir = join(app.getPath('userData'), 'papers')
    mkdirSync(dir, { recursive: true })
    const restored = join(dir, `${sha1(data).slice(0, 12)}.pdf`)
    writeFileSync(restored, data)
    return restored
  })
  if (dup) return { paperId: dup.paperId, existed: true }

  const dir = join(app.getPath('userData'), 'papers')
  mkdirSync(dir, { recursive: true })
  // 标题与 arXiv ID 都为空时，直接拼出来的是 ".pdf"——一个隐藏文件，且多条会互相覆盖
  const base =
    (result.arxivId ?? result.title.slice(0, 40).replace(/[^\w一-鿿-]+/g, '-'))
      .replace(/^[-.]+|[-.]+$/g, '') || createHash('sha1').update(result.pdfUrl).digest('hex').slice(0, 12)
  // 标题前 40 字相同的两篇会拼出同一个文件名：已有文件且内容不同时加内容哈希，别覆盖另一篇的 PDF
  let path = join(dir, `${base}.pdf`)
  if (existsSync(path) && sha1(readFileSync(path)) !== sha1(data)) path = join(dir, `${base}-${sha1(data).slice(0, 8)}.pdf`)
  writeFileSync(path, data)

  let outcome
  try {
    outcome = await importPdf(appDb(), path, figuresDir(), undefined, { quick: true })
  } catch (err) {
    // 解析失败就把刚下载的文件删掉，别在库目录里留孤儿
    try {
      rmSync(path, { force: true })
    } catch {
      /* 清理失败无碍：启动清扫会兜底 */
    }
    throw new Error(friendlyImportError(err), { cause: err })
  }
  enrichPaperMeta(appDb(), outcome.paperId, {
    title: result.title,
    authors: result.authors.length > 0 ? JSON.stringify(result.authors) : null,
    year: result.year,
    source: result.source.split('+')[0],
    doi: result.doi,
    arxiv_id: result.arxivId
  })
  // quick 导入只做了启发式分段：模型识别排到后台，阅读器里会显示进度
  if (getPaper(appDb(), outcome.paperId)?.layout_state === 'pending') void scheduleLayoutRefine(outcome.paperId, { urgent: true })
  return { paperId: outcome.paperId, existed: false }
}
