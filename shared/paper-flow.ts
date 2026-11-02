/**
 * 论文的段落流：参考文献整节跳过翻译、跨页 / 跨栏断开的段落接回同一段。
 * 主进程（翻译、费用预估）与渲染进程（未译计数、流式双语视图）共用，口径必须一致。
 */
import type { BlockRow } from './models'
import { skipTranslation, type TargetLang } from './lang'

/** 参考文献一节的标题：References / Bibliography / Works Cited / 参考文献，允许带章节号 */
const REFERENCES_HEADING = /^\s*(?:\d+(?:\.\d+)*\.?\s*)?(?:references?|bibliography|works\s+cited|literature\s+cited|参考文献)\s*$/i

export function isReferencesSection(section: string | null | undefined): boolean {
  return !!section && REFERENCES_HEADING.test(section)
}

/** 参考文献一节里的正文块（标题本身照常翻译，只有一行） */
export function isReferenceBlock(block: Pick<BlockRow, 'kind' | 'section'>): boolean {
  return block.kind === 'para' && isReferencesSection(block.section)
}

/**
 * 这一块要不要调模型翻译。逐条判断的文献条目识别会漏掉一部分（作者名写法五花八门），
 * 所以参考文献按整节跳过；其余沿用按文字判断的规则（纯符号、本来就是目标语言）。
 */
export function skipBlockTranslation(block: Pick<BlockRow, 'kind' | 'section' | 'text'>, lang: TargetLang = 'zh'): boolean {
  return isReferenceBlock(block) || skipTranslation(block.text, lang)
}

/* ---- 跨页 / 跨栏续段 ---- */

/**
 * 段末没有句末标点（或以连字符断词结束）：话还没说完。
 * 只认像正文的段：太短的（表格碎片、子图编号）和以网址结尾的（脚注）不算
 */
function endsMidSentence(text: string): boolean {
  const t = text.replace(/[\s*^~]+$/, '')
  if (t.length < 40 || (t.match(/\b[a-z]{3,}\b/g) ?? []).length < 5) return false
  if (/https?:\/\/\S*$|\b\S+\.(?:com|org|io|net|edu)\/\S*$/.test(t)) return false
  if (/-$/.test(t)) return true
  return !/[.!?。！？:：;；)"”’\]]$/.test(t)
}

/**
 * 段首只能接在半句话后面：小写单词、逗号分号、右括号，或者括号里跟着小写单词。
 * 「(a) 子图标题」「(Barcelona)」这类大写或编号开头的不算，网址开头的（脚注）也不算
 */
function startsMidSentence(text: string): boolean {
  const t = text.replace(/^[\s*]+/, '')
  if (/^https?:\/\//.test(t)) return false
  if (/^\([a-z0-9]{1,3}\)\s/i.test(t)) return false
  return /^(?:[a-z]|[,;:)]|\([a-z]{2,})/.test(t)
}

function box(b: BlockRow): [number, number, number, number] | null {
  if (!b.bbox) return null
  try {
    const v = JSON.parse(b.bbox) as unknown
    return Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number') ? (v as [number, number, number, number]) : null
  } catch {
    return null
  }
}

/** 两块之间发生了换页或换栏（后一块在右边一栏，或者跑到了前一块上方）：同一栏里连续的两块不算 */
function brokeAcrossPageOrColumn(a: BlockRow, b: BlockRow): boolean {
  if (b.page !== a.page) return b.page > a.page
  const ba = box(a)
  const bb = box(b)
  if (!ba || !bb) return false
  const movedRight = bb[0] > ba[0] + ba[2] * 0.5
  // bbox 的 y 向上：后一块的顶边高过前一块的顶边，说明换到了新的一栏
  const movedUp = bb[1] + bb[3] > ba[1] + ba[3] + 2
  return movedRight || movedUp
}

/** 图注：Figure 1: / Table 2. / Algorithm 1: 开头的段（流式视图也按它排小一号） */
export const CAPTION_RE = /^\s*(?:\*\*)?(?:Figure|Fig\.|Table|Algorithm|Listing)\s*[A-Z]?\d+[.:]/i

/** 两段之间允许隔着的块：图、表、图注这类浮动体和页眉页脚。隔着公式或标题就不是同一段了 */
const FLOATING_KINDS = new Set<BlockRow['kind']>(['figure', 'table', 'margin'])
function floating(b: BlockRow): boolean {
  return FLOATING_KINDS.has(b.kind) || (b.kind === 'para' && CAPTION_RE.test(b.text))
}

/**
 * 被换页或换栏截断的段落链：返回「链头 id → 依次的各部分」，只收两部分以上的链。
 * blocks 必须按阅读顺序（页、块序）排好。参考文献里的条目不接（每条本来就各自成段）。
 */
export function continuationChains(blocks: BlockRow[]): Map<string, BlockRow[]> {
  const chains = new Map<string, BlockRow[]>()
  let current: BlockRow[] | null = null
  for (let i = 0; i < blocks.length; i++) {
    const a = blocks[i]
    if (a.kind !== 'para' || isReferenceBlock(a) || floating(a)) {
      if (!floating(a)) current = null
      continue
    }
    if (!current || current[current.length - 1] !== a) current = [a]
    if (!endsMidSentence(a.text)) {
      if (current.length > 1) chains.set(current[0].block_id, current)
      current = null
      continue
    }
    // 往后找下一块正文，跳过浮动体；碰到公式、标题就断。
    // 段落被插进来的图、表从中间隔开时同一栏上下两段也算（论文排版里很常见）
    let j = i + 1
    let crossedFloat = false
    while (j < blocks.length && floating(blocks[j])) {
      if (blocks[j].kind !== 'margin') crossedFloat = true
      j++
    }
    const b = blocks[j]
    if (b && b.kind === 'para' && !isReferenceBlock(b) && startsMidSentence(b.text) && (crossedFloat || brokeAcrossPageOrColumn(a, b))) {
      current.push(b)
      continue
    }
    if (current.length > 1) chains.set(current[0].block_id, current)
    current = null
  }
  if (current && current.length > 1) chains.set(current[0].block_id, current)
  return chains
}

/* ---- 图块归并 ---- */

/** 一组同属一张图的图块：box 是它们的外接框（PDF 坐标 [x, y, w, h]，y 向上） */
export interface FigureCluster<T> {
  blocks: T[]
  box: [number, number, number, number]
}

type Box = [number, number, number, number]

/** 一组图块至少占满外接框的多少，才拼成一张 */
const MIN_CLUSTER_FILL = 0.7

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

/** a 的面积有多少落在 b 里 */
function insideRatio(a: Box, b: Box): number {
  const area = a[2] * a[3]
  if (area <= 0) return 0
  return (overlap(a[0], a[0] + a[2], b[0], b[0] + b[2]) * overlap(a[1], a[1] + a[3], b[1], b[1] + b[3])) / area
}

/** 版面模型同时框出整图和图里的碎块时，返回应该丢掉的碎块（面积小、九成以上落在别的图块里） */
export function containedFigures<T>(items: T[], boxOf: (t: T) => Box | null): Set<T> {
  const dropped = new Set<T>()
  for (const a of items) {
    const ba = boxOf(a)
    if (!ba) continue
    for (const b of items) {
      const bb = boxOf(b)
      if (a === b || !bb || bb[2] * bb[3] <= ba[2] * ba[3]) continue
      if (insideRatio(ba, bb) >= 0.9) {
        dropped.add(a)
        break
      }
    }
  }
  return dropped
}

/**
 * 把贴在一起的图块归成一张图：版面模型常把一张横向长图切成几块，
 * 按块各排各的就会换行、留缝，图被切开。左右相邻（纵向重叠过半）或上下相邻（横向重叠过半）的算一组，
 * 显示时按原版相对位置拼回去。
 */
export function clusterFigures<T>(items: T[], boxOf: (t: T) => Box | null, gapX = 30, gapY = 14): FigureCluster<T>[] {
  const parent = items.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  items.forEach((a, i) => {
    const ba = boxOf(a)
    if (!ba) return
    items.forEach((b, j) => {
      if (j <= i) return
      const bb = boxOf(b)
      if (!bb) return
      const dx = Math.max(bb[0] - (ba[0] + ba[2]), ba[0] - (bb[0] + bb[2]))
      const dy = Math.max(bb[1] - (ba[1] + ba[3]), ba[1] - (bb[1] + bb[3]))
      const vShared = overlap(ba[1], ba[1] + ba[3], bb[1], bb[1] + bb[3]) / Math.max(1, Math.min(ba[3], bb[3]))
      const hShared = overlap(ba[0], ba[0] + ba[2], bb[0], bb[0] + bb[2]) / Math.max(1, Math.min(ba[2], bb[2]))
      if ((dx <= gapX && vShared >= 0.5) || (dy <= gapY && hShared >= 0.5)) parent[find(j)] = find(i)
    })
  })
  const groups = new Map<number, T[]>()
  items.forEach((t, i) => {
    const root = find(i)
    const list = groups.get(root)
    if (list) list.push(t)
    else groups.set(root, [t])
  })
  const cluster = (blocks: T[]): FigureCluster<T> => {
    const boxes = blocks.map(boxOf).filter((b): b is Box => !!b)
    if (boxes.length === 0) return { blocks, box: [0, 0, 0, 0] }
    const x0 = Math.min(...boxes.map((b) => b[0]))
    const y0 = Math.min(...boxes.map((b) => b[1]))
    const x1 = Math.max(...boxes.map((b) => b[0] + b[2]))
    const y1 = Math.max(...boxes.map((b) => b[1] + b[3]))
    return { blocks, box: [x0, y0, x1 - x0, y1 - y0] }
  }
  return [...groups.values()].flatMap((blocks) => {
    const whole = cluster(blocks)
    // 外接框要整张裁下来：图块占不满它（比如两栏里错开的两张图）就可能框进别的内容，这种不并
    const filled = blocks.reduce((sum, t) => {
      const b = boxOf(t)
      return sum + (b ? b[2] * b[3] : 0)
    }, 0)
    return blocks.length > 1 && filled < whole.box[2] * whole.box[3] * MIN_CLUSTER_FILL ? blocks.map((t) => cluster([t])) : [whole]
  })
}

/** 拼起来的一组图的截图 id */
export function figureClusterKey(firstBlockId: string): string {
  return `${firstBlockId}:strip`
}

/** 块的版面框：JSON 串 [x, y, w, h]（PDF 坐标，y 向上） */
function parseBlockBox(b: Pick<BlockRow, 'bbox'>): Box | null {
  if (!b.bbox) return null
  try {
    return JSON.parse(b.bbox) as Box
  } catch {
    return null
  }
}

export interface FigureLayout<T> {
  /** 块 id → 所在的组（只有几块拼成的组才在表里） */
  clusterOf: Map<string, FigureCluster<T>>
  /** 落在别的图块里的碎块：不单独显示 */
  duplicates: Set<string>
}

/**
 * 全文的图块归并结果。裁图（主进程）和显示（流式视图、镜像页）用同一份，否则显示要的截图可能没裁。
 * 只归并阅读顺序上连续的图块（中间隔着正文的不算一张图）；页边块不打断连续
 */
export function figureLayout<T extends Pick<BlockRow, 'block_id' | 'kind' | 'page' | 'bbox'>>(blocks: T[]): FigureLayout<T> {
  const byPage = new Map<number, T[]>()
  for (const b of blocks) {
    if (b.kind !== 'figure') continue
    const list = byPage.get(b.page)
    if (list) list.push(b)
    else byPage.set(b.page, [b])
  }
  const duplicates = new Set<string>()
  for (const list of byPage.values()) for (const b of containedFigures(list, parseBlockBox)) duplicates.add(b.block_id)

  const clusterOf = new Map<string, FigureCluster<T>>()
  let run: T[] = []
  const flush = (): void => {
    for (const c of clusterFigures(run, parseBlockBox)) {
      if (c.blocks.length > 1) for (const b of c.blocks) clusterOf.set(b.block_id, c)
    }
    run = []
  }
  for (const b of blocks) {
    if (b.kind === 'margin' || duplicates.has(b.block_id)) continue
    if (b.kind !== 'figure' || (run.length > 0 && run[0].page !== b.page)) flush()
    if (b.kind === 'figure') run.push(b)
  }
  flush()
  return { clusterOf, duplicates }
}
