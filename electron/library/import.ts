/**
 * 导入管线（M0）：PDF 文件 → 提取 → 版面解析 → papers/blocks 入库。
 * 拖入、DOI/arXiv 下载、文件夹监听最终都汇到 importPdf 这一条路。
 */
import type Database from 'better-sqlite3'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { blockId, sha1, simhash64 } from '../docengine/anchor'
import { extractPages } from '../docengine/extract'
import { parsePages, type ParseResult } from '../docengine/layout'
import { CROP_SCALE, CROP_VERSION, cropRegions, detectDocumentRegions, modelAvailable, type CropRequest } from '../docengine/layout-ml'
import { inlineFigureKey, parseInlines } from '../../shared/inline-formula'
import { blocksFromRegions } from '../docengine/regions-to-blocks'
import { marginBlocks, orphanBlocks } from '../docengine/margins'
import { getBlocks, getPaper, markMarginsReady, migrateTranslationsBySimhash, replaceBlocks, setLayoutState, upsertPaper, type BlockRow } from '../db'
import type { ImportOutcome } from '../../shared/models'

/** block_id 含 ':'，做文件名前替换 */
/** 截图目录里的倍率标记文件：记录这批截图是按几倍裁的，老于当前倍率的整篇重裁 */
export const FIGURE_SCALE_MARK = '.crop-scale'

/**
 * 版面解析规则的版本。改了区域 → 块的规则（文字表拆格、算法区域里的散文、目录页判定……）就加一：
 * 启动时用旧版识别的论文会在后台按新规则重识别，译文按内容指纹搬家、笔记按原文重定位。
 * 1：文字表逐格翻译、目录页不当图、algorithm 区域里的散文按段翻译
 * 2：等宽字体里对齐的空格不当栏界（ALFWorld 轨迹被竖着切碎）
 * 3：保留脚注上标、图表注释、独立公式编号和图框外的标题/标签；没被任何块盖住的漏网文字作为段落补回原位
 * 4：看不见的文字（写在表单对象内容框外被裁掉、叠字里被后画的图盖住）不进文本层
 * 5：大面积重叠的文字区域合并、区域里相隔很远的行拆开
 * 6：只合并几乎重合的文字区域（5 的阈值太松，列表条目被连锁并成整页一段）
 * 7：行内公式密集的段落不再被当成表格重建
 * 8：7 的判定改为按字符数算（公式被拆成大量单字符文字项，按项数算判不出）
 */
export const LAYOUT_VERSION = 8

/** 标记文件内容：「倍率/算法版本」。老版本只写了倍率，读的时候按版本 1 处理 */
export function cropMark(): string {
  return `${CROP_SCALE}/${CROP_VERSION}`
}

/** 已有的截图是不是按当前倍率与当前裁法生成的 */
export function cropMarkCurrent(raw: string | null): boolean {
  if (!raw) return false
  const [scale, version] = raw.trim().split('/')
  return Number(scale) >= CROP_SCALE && Number(version ?? 1) >= CROP_VERSION
}

/** 删掉目录里不在 keep 集合内的截图；目录不存在或删不掉都不致命。倍率标记等点文件不动。 */
export function pruneStaleFigures(dir: string, keep: Set<string>): number {
  let removed = 0
  try {
    for (const name of readdirSync(dir)) {
      if (keep.has(name) || name.startsWith('.')) continue
      try {
        rmSync(join(dir, name), { force: true })
        removed++
      } catch {
        /* 单个删不掉就跳过 */
      }
    }
  } catch {
    /* 目录不存在：没什么可清的 */
  }
  return removed
}

export function figureFileName(blockIdStr: string): string {
  return blockIdStr.replace(/:/g, '_') + '.png'
}

/**
 * 截图框正上方 / 正下方最近的文字块（横向与框重叠三成以上）。
 * 上方块的底边落在框的上半部以上、下方块的顶边落在框的下半部以下才算，框里压着的文字不算
 */
function textNeighbours(
  rows: BlockRow[],
  page: number,
  [x, y, w, h]: [number, number, number, number]
): Pick<CropRequest, 'above' | 'below'> {
  let above: CropRequest['above']
  let below: CropRequest['below']
  const mid = y + h / 2
  for (const n of rows) {
    if (n.page !== page || (n.kind !== 'para' && n.kind !== 'heading') || !n.bbox) continue
    const [nx, ny, nw, nh] = JSON.parse(n.bbox) as [number, number, number, number]
    const overlap = Math.min(x + w, nx + nw) - Math.max(x, nx)
    if (overlap < Math.min(w, nw) * 0.3) continue
    const fs = n.font_size ?? 10
    if (ny >= mid && ny + nh / 2 > y + h && ny < y + h + fs * 2) {
      if (!above || ny < above.y) above = { y: ny, fs }
    } else if (ny + nh <= mid && ny + nh / 2 < y && ny + nh > y - fs * 2) {
      if (!below || ny + nh > below.y) below = { y: ny + nh, fs }
    }
  }
  return { ...(above ? { above } : {}), ...(below ? { below } : {}) }
}

/**
 * 一篇论文要裁的全部截图：图 / 表 / 独立公式按块框裁，段落里的行内公式按各自记录的小框紧裁。
 * 导入落盘与老截图升级重裁共用这一份清单，别让两边各漏一类。
 */
export function cropRequestsFor(rows: BlockRow[]): CropRequest[] {
  const out: CropRequest[] = []
  for (const r of rows) {
    if ((r.kind === 'figure' || r.kind === 'table' || r.kind === 'equation') && r.bbox) {
      const bbox = JSON.parse(r.bbox) as [number, number, number, number]
      out.push({ key: r.block_id, page: r.page, bbox, ...textNeighbours(rows, r.page, bbox) })
    }
    for (const f of parseInlines(r.inlines)) {
      out.push({ key: inlineFigureKey(r.block_id, f.n), page: r.page, bbox: f.bbox, tight: true })
    }
  }
  return out
}

export type { ImportOutcome }

/** 后台识别被用户正在看的论文打断：不是失败，论文保持 pending，排回队列稍后重做 */
export class LayoutPreempted extends Error {
  constructor() {
    super('layout refine preempted')
  }
}

/** ML 版面优先（模型在场），失败回退启发式——解析永不让导入失败。 */
async function parseDocument(
  data: Buffer,
  pages: Parameters<typeof parsePages>[0],
  onLayoutPage?: (done: number, total: number) => void
): Promise<ParseResult> {
  if (modelAvailable()) {
    try {
      // 传入文字项：漏检兜底只对「有墨迹但既无区域也无文字」的地方补图块
      const textByPage = new Map(pages.map((p) => [p.page, p.items]))
      const regions = await detectDocumentRegions(data, onLayoutPage, textByPage)
      const result = blocksFromRegions(pages, regions)
      if (result.blocks.length > 0) return result
    } catch (err) {
      // 被打断不能回退启发式：那样会把启发式分段当成识别结果存下
      if (err instanceof LayoutPreempted) throw err
      console.warn('ML layout failed, fallback to heuristic:', err)
    }
  }
  return parsePages(pages)
}

export interface ImportOptions {
  /** 先用启发式分段入库、立刻开页；模型版面识别交给 refineLayout 在后台做。模型不在场时等同普通导入 */
  quick?: boolean
}

export async function importPdf(
  db: Database.Database,
  filePath: string,
  figuresDir?: string,
  onLayoutPage?: (done: number, total: number) => void,
  opts: ImportOptions = {}
): Promise<ImportOutcome> {
  const tImport = Date.now()
  const { pages, data } = await extractPages(filePath)
  const tExtract = Date.now()
  // 零页 PDF（页树为空）不是「解析不出内容」，是根本没有内容。放行的话
  // 库里会多出一篇 0 块的空论文，用户既看不懂也只能手动删。
  if (pages.length === 0) throw new Error('PDF_NO_PAGES')
  const paperId = sha1(data)
  const quick = !!opts.quick && modelAvailable()
  const parsed = quick ? parsePages(pages) : await parseDocument(data, pages, onLayoutPage)
  const tParse = Date.now()
  if (process.env['READARC_PROFILE']) console.log('[profile] import', JSON.stringify({ quick, extract: tExtract - tImport, parse: tParse - tExtract }))
  // quick 导入的启发式分段里图表块不准，截图留给后台识别那一遍
  // 启发式分段认标题很不准（整行大写、图注都会当标题），先开页的这 20 秒里全按正文显示，目录留空等模型结果
  const outcome = await storeParsed(db, paperId, filePath, pages, data, parsed, quick ? undefined : figuresDir, { demoteHeadings: quick })
  // 模型不在场时是启发式分段，不记版本：装上模型后还会按模型重识别
  setLayoutState(db, paperId, quick ? 'pending' : 'done', !quick && modelAvailable() ? LAYOUT_VERSION : undefined)
  return outcome
}

/**
 * 后台版面识别：把 quick 导入的启发式分段换成模型结果。译文按内容指纹搬家，
 * 笔记 / 高亮锚点在读取时按 simhash 重定位，所以先读起来不会丢东西。
 * 返回 false 表示论文已不存在，或识别期间被删掉又重新导入（这一轮作废）。
 */
export async function refineLayout(
  db: Database.Database,
  paperId: string,
  figuresDir?: string,
  onLayoutPage?: (done: number, total: number) => void
): Promise<boolean> {
  const paper = getPaper(db, paperId)
  if (!paper) return false
  // 识别期间论文可能被删掉又重新导入（新行 added_at 不同）：那一份的启发式分段不能被这轮标成 done
  const sameImport = (): boolean => getPaper(db, paperId)?.added_at === paper.added_at
  const { pages, data } = await extractPages(paper.file_path)
  if (pages.length === 0) {
    // 抽不出页：模型也无从识别，置 done，别一直挂着「识别中」
    setLayoutState(db, paperId, 'done', LAYOUT_VERSION)
    return true
  }
  const parsed = await parseDocument(data, pages, onLayoutPage)
  if (!sameImport()) return false
  // 从搜索页加入的论文带着 arXiv / Semantic Scholar 的正式标题（source 非空），模型识别的标题不覆盖它
  await storeParsed(db, paperId, paper.file_path, pages, data, parsed, figuresDir, { keepTitle: !!paper.source })
  if (!sameImport()) return false
  setLayoutState(db, paperId, 'done', modelAvailable() ? LAYOUT_VERSION : undefined)
  return true
}

/** 解析结果入库：页边块、标题、块行、译文搬家、图表截图。导入和后台识别共用 */
async function storeParsed(
  db: Database.Database,
  paperId: string,
  filePath: string,
  pages: Awaited<ReturnType<typeof extractPages>>['pages'],
  data: Buffer,
  parsed: ParseResult,
  figuresDir?: string,
  opts: { demoteHeadings?: boolean; keepTitle?: boolean } = {}
): Promise<ImportOutcome> {
  const { blocks, outline, title: mlTitle } = parsed
  // 页眉页脚 / 页码 / 侧边水印：正文流不要，镜像页要——正文块定下来之后作为页边块补回来
  blocks.push(...marginBlocks(pages, blocks, blocks.reduce((m, b) => Math.max(m, b.order), -1) + 1))
  // 模型漏掉的文字（首页报告编号、续页表头、图外的刻度……）作为普通段落补回原位，原文页上有的字译文页上都有
  blocks.push(...orphanBlocks(pages, blocks, blocks.reduce((m, b) => Math.max(m, b.order), -1) + 1))

  // 标题：ML 路径直接用 doc_title；启发式路径取第一页字号最大的 heading
  // （排除 arXiv 侧边水印；heading 的 bbox[3] 即字号）
  const rawTitle =
    mlTitle ??
    blocks
      .filter((b) => b.page === 1 && b.kind === 'heading' && !/^arxiv:/i.test(b.text))
      .sort((a, b) => b.bbox[3] - a.bbox[3] || a.order - b.order)[0]?.text ??
    basename(filePath).replace(/\.pdf$/i, '')
  // 标题取自正文块的文本，带着排版标记（加粗 **、上标 ^…^、下标 ~…~、公式占位 ⟦fN⟧）：
  // 论文库、窗口标题、笔记文件名里不该出现「CKM **angle**」这样的字样
  const title = plainTitle(rawTitle) || basename(filePath).replace(/\.pdf$/i, '')

  // 保留原标题时也去掉里面的排版标记（旧版解析存下的「CKM **angle**」）
  const kept = opts.keepTitle ? getPaper(db, paperId)?.title : null
  upsertPaper(db, { id: paperId, file_path: filePath, title: opts.keepTitle ? (kept ? plainTitle(kept) : null) : title, added_at: Date.now() })

  const rows: BlockRow[] = blocks.map((b) => ({
    block_id: blockId(paperId, b.page, b.order),
    paper_id: paperId,
    page: b.page,
    block_order: b.order,
    kind: opts.demoteHeadings && b.kind === 'heading' ? 'para' : b.kind,
    section: b.section,
    text: b.text,
    bbox: JSON.stringify(b.bbox),
    simhash: simhash64(b.text),
    heading_level: b.headingLevel ?? null,
    font_size: b.fontSize ?? null,
    inlines: b.inlines && b.inlines.length > 0 ? JSON.stringify(b.inlines) : null
  }))
  const oldBlocks = getBlocks(db, paperId)
  replaceBlocks(db, paperId, rows)
  markMarginsReady(db, paperId)
  // 解析器升级或后台识别导致的序号偏移：译文缓存按内容指纹搬家，不重花一分钱
  if (oldBlocks.length > 0) migrateTranslationsBySimhash(db, paperId, oldBlocks, rows)

  // 图/表区域截图落盘（失败不影响导入——占位符照常显示）
  if (figuresDir) {
    try {
      // 公式也裁原图：重排/镜像视图里公式用原版截图，不用文本层的乱序字符
      const requests = cropRequestsFor(rows)
      const dir = join(figuresDir, paperId)
      if (requests.length > 0) {
        const tCrop = Date.now()
        const crops = await cropRegions(data, requests)
        if (process.env['READARC_PROFILE']) console.log('[profile] crops', JSON.stringify({ ms: Date.now() - tCrop, n: requests.length }))
        mkdirSync(dir, { recursive: true })
        for (const [key, png] of crops) {
          writeFileSync(join(dir, figureFileName(key)), png)
        }
        writeFileSync(join(dir, FIGURE_SCALE_MARK), cropMark())
      }
      // 清掉上一次解析留下的截图：文件名带块序号（sha1_page_order.png），
      // 重新解析后序号一变就换了名字，旧文件既没人引用也没人删，
      // 反复重导会让一篇论文的截图目录里堆满永远不会被请求的死文件。
      pruneStaleFigures(dir, new Set(requests.map((r) => figureFileName(r.key))))
    } catch (err) {
      console.warn('figure crop failed:', err)
    }
  }
  return { paperId, blockCount: rows.length, outline: opts.demoteHeadings ? [] : outline }
}

/** 去掉标题里的排版标记，只留可读文字 */
export function plainTitle(text: string): string {
  return text
    .replace(/⟦f\d+⟧/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/\^([^^]*)\^/g, '$1')
    .replace(/~([^~]*)~/g, ' $1')
    .replace(/\s+/g, ' ')
    .trim()
}
