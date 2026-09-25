/**
 * 启发式版面解析（M0 路线）：
 *   x 坐标分栏 + 行距聚段 + 重复性剔页眉页脚 + 字号识别标题。
 * 双栏论文目标覆盖 ~85%；三栏/浮动图/算法框留给 M4 的 ONNX 版面模型。
 *
 * 坐标系：PDF 用户空间（y 向上），阅读顺序按 y 从大到小。
 * 本模块是纯函数——输入文本项几何，输出有序块与目录树，不碰 PDF.js。
 */

import type { InlineFormula } from '../../shared/inline-formula'

export interface TextItem {
  str: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  /** 字体为粗体（按字体真名判定）；缺省视为常规 */
  bold?: boolean
  /** 数学字体（花体 / 数学斜体 / 黑板体等，按字体真名判定）：文本层的字形已失真，要按公式截图 */
  math?: boolean
  /** 旋转文本的角度（弧度，逆时针为正）；横排文本缺省 */
  angle?: number
}

export interface PageItems {
  page: number
  width: number
  height: number
  items: TextItem[]
  /** 旋转文本（arXiv 侧边水印、侧转表头）：不进正文流，只供页边块使用；x/y/width/height 是页面坐标下的外接框 */
  rotated?: TextItem[]
}

export interface ParsedBlock {
  page: number
  order: number
  /** margin = 页眉页脚 / 页码 / 侧边水印，由 margins.ts 在正文块之后补上 */
  kind: 'para' | 'heading' | 'equation' | 'figure' | 'table' | 'margin'
  /** 所属章节标题（塞给块的 section 字段，供目录定位与引用显示） */
  section: string | null
  text: string
  bbox: [number, number, number, number]
  headingLevel?: number
  /** 原始字号（pt，块内 item 中位数）；启发式路径可缺省 */
  fontSize?: number
  /** 行内公式：text 里的 ⟦fN⟧ 占位符各对应一条截图记录（仅 ML 路径） */
  inlines?: InlineFormula[]
  /** 从文字表里拆出来的单元格：已经按单元格切好，表格碎片合并不再把它们并回截图 */
  tableCell?: boolean
}

export type { OutlineEntry } from '../../shared/models'
import type { OutlineEntry } from '../../shared/models'

export interface ParseResult {
  blocks: ParsedBlock[]
  outline: OutlineEntry[]
  /** ML 路径直接给出论文标题（doc_title 区域）；启发式路径为空 */
  title?: string
}

/* ---- 行装配 ---- */

interface Line {
  text: string
  x: number
  y: number
  width: number
  fontSize: number
  page: number
}

const Y_TOLERANCE = 2.5

export type { Line }
export { joinLines }

/** 一组文本项 → 行（供 ML 版面路径按区域复用同一套行装配） */
export function linesFromItems(items: TextItem[], page: number): Line[] {
  return assembleLines({ page, width: 0, height: 0, items })
}

function medianFont(items: TextItem[]): number {
  if (items.length === 0) return 10
  const fs = items.map((i) => i.fontSize).sort((a, b) => a - b)
  return fs[Math.floor(fs.length / 2)]
}

function assembleLines(page: PageItems): Line[] {
  const sorted = [...page.items]
    .filter((it) => it.str.trim().length > 0)
    .sort((a, b) => b.y - a.y || a.x - b.x)

  // 第一遍：聚类成行。行内公式的上下标基线偏移 ~0.5em，
  // 固定容差会把它们劈成独立行并按 y 排到正文前面（10^-22 变成 "-22 10"）——
  // 用自适应容差（0.55 × 行主字号）把它们吸附进所在行。
  // x 间隙仍须小于栏间距——双栏论文左右栏基线常常对齐，
  // 不按间隙断行会把两栏并成一条"全宽行"，整页阅读顺序全错。
  const clusters: TextItem[][] = []
  for (const it of sorted) {
    const cluster = clusters[clusters.length - 1]
    if (cluster) {
      const baseFont = Math.max(...cluster.map((c) => c.fontSize))
      const baseY = cluster.reduce((a, c) => (c.fontSize === baseFont ? c.y : a), cluster[0].y)
      // 全尺寸对全尺寸：基线对齐的正常字形 y 抖动 <1pt，用紧容差——
      // 否则下一行的抬升字形（√、大括号）会被吸进上一行（Δ~3pt < 0.55em）；
      // 小字号（上下标）保持宽容差以吸附 ~0.5em 的基线偏移
      const bothFull = it.fontSize >= baseFont * 0.9
      const tol = bothFull
        ? Math.max(Y_TOLERANCE, 0.3 * baseFont)
        : Math.max(Y_TOLERANCE, 0.55 * Math.max(baseFont, it.fontSize))
      const right = Math.max(...cluster.map((c) => c.x + c.width))
      const gap = it.x - right
      if (Math.abs(baseY - it.y) <= tol && gap <= it.fontSize * 2) {
        cluster.push(it)
        continue
      }
    }
    clusters.push([it])
  }

  // 第 1.5 遍：孤立碎片簇折叠。两类：
  // ① 全小字号且极窄的簇（落单的 "-22" 上下标）→ 并入纵向最近的相邻行
  // ② 落单的窄全尺寸字形（√、大括号等抬升符号，被紧容差挡在行外）→
  //    只并入它下方的行——抬升字形永远高于所属行的基线，绝不属于上一行
  const pageFont = medianFont(sorted)
  for (let i = clusters.length - 1; i >= 0; i--) {
    const c = clusters[i]
    const maxFont = Math.max(...c.map((x) => x.fontSize))
    const width = Math.max(...c.map((x) => x.x + x.width)) - Math.min(...c.map((x) => x.x))
    const smallFrag = maxFont <= pageFont * 0.78 && width <= pageFont * 4
    // 混合碎片：窄簇里唯一的全尺寸项是落单窄字形（√ 及其吸附来的上下标，
    // 如 GEO600 的 "−22 √"）——按抬升方向整簇折入下方的行
    const fullItems = c.filter((x) => x.fontSize > pageFont * 0.78)
    const raisedGlyph =
      !smallFrag &&
      width <= pageFont * 4 &&
      fullItems.length === 1 &&
      fullItems[0].width <= pageFont * 1.4
    if (!smallFrag && !raisedGlyph) continue
    const y = raisedGlyph ? fullItems[0].y : c[0].y
    // 抬升字形悬在所属行上方 ≲1em；行距本身 >1.1em——上限收紧到 1.0em
    // 以免段落末尾的孤字被折进下一段首行
    const maxDy = raisedGlyph ? 1.0 : 1.2
    // 碎片中心：目标行必须横向覆盖它（±2em），否则双栏页会折进隔壁栏
    const fragCx =
      (Math.min(...c.map((x) => x.x)) + Math.max(...c.map((x) => x.x + x.width))) / 2
    let best = -1
    let bestDy = Infinity
    for (const j of [i - 2, i - 1, i + 1, i + 2]) {
      const n = clusters[j]
      if (!n) continue
      const nf = Math.max(...n.map((x) => x.fontSize))
      if (nf <= pageFont * 0.78) continue // 邻居自身也是碎片簇时不作为折叠目标
      const nLeft = Math.min(...n.map((x) => x.x))
      const nRight = Math.max(...n.map((x) => x.x + x.width))
      if (fragCx < nLeft - pageFont * 2 || fragCx > nRight + pageFont * 2) continue
      const ny = n[0].y
      // 抬升字形只认下方的行（基线更低）；上下标碎片两侧皆可
      if (raisedGlyph && ny >= y) continue
      const dy = Math.abs(ny - y)
      if (dy < bestDy && dy <= nf * maxDy) {
        bestDy = dy
        best = j
      }
    }
    if (best >= 0) {
      clusters[best].push(...c)
      clusters.splice(i, 1)
    }
  }

  // 第二遍：簇内按 x 重排后拼接（上标在流里先到，但视觉顺序由 x 决定）
  return clusters.map((cluster) => {
    const xs = [...cluster].sort((a, b) => a.x - b.x)
    const baseFont = Math.max(...xs.map((c) => c.fontSize))
    const baseY = xs.reduce((a, c) => (c.fontSize === baseFont ? c.y : a), xs[0].y)
    // 脚注标号也是原文内容：和公式指数一样用上标标记保留，不能因紧随句号而丢弃。
    const kept = xs
    // 行内样式标记（供翻译保留、镜像页还原）：
    // - 粗体连续段包 **……**，只在混排行标注——整行粗体（标题）由块级样式呈现
    // - 上标包 ^……^、下标包 ~……~（小字号 + 基线偏移判定），公式的 θ_R、10^-22
    //   不再被拍平成基线文本
    const mixedBold = kept.some((it) => it.bold) && kept.some((it) => !it.bold)
    const scriptOf = (it: TextItem): '' | '^' | '~' => {
      if (it.fontSize > baseFont * 0.78) return ''
      const dy = it.y - baseY
      if (dy > baseFont * 0.15) return '^'
      if (dy < -baseFont * 0.08) return '~'
      return ''
    }
    let text = ''
    let prevBold = false
    let prevScript: '' | '^' | '~' = ''
    for (let i = 0; i < kept.length; i++) {
      const it = kept[i]
      const bold = mixedBold && !!it.bold
      const script = scriptOf(it)
      const gap = i === 0 ? 0 : it.x - (kept[i - 1].x + kept[i - 1].width)
      // 公式占位项两侧的词距常常只有 0.15em（数学字体的边距比正文紧），阈值放宽，
      // 否则「space to ⟦f1⟧」会粘成「to⟦f1⟧」；紧贴的下标（d_model）间距接近 0，不受影响
      const nearPlaceholder = it.str.startsWith('⟦') || (i > 0 && kept[i - 1].str.startsWith('⟦'))
      const sep = i > 0 && gap > it.fontSize * (nearPlaceholder ? 0.12 : 0.25) ? ' ' : ''
      // 闭合顺序与开启顺序互逆：粗体在外层、上下标在内层
      if (prevScript && prevScript !== script) text = text.trimEnd() + prevScript
      if (prevBold && !bold) text = text.trimEnd() + '**'
      text += sep
      if (bold && !prevBold) text += '**'
      if (script && script !== prevScript) text += script
      text += it.str
      prevBold = bold
      prevScript = script
    }
    if (prevScript) text = text.trimEnd() + prevScript
    if (prevBold) text = text.trimEnd() + '**'
    const left = xs[0].x
    const right = Math.max(...xs.map((c) => c.x + c.width))
    return { text, x: left, y: baseY, width: right - left, fontSize: baseFont, page: page.page }
  })
}

/* ---- 页眉页脚剔除：跨页重复 ---- */

function normalizeForRepeat(text: string): string {
  // 页码数字归一，"Page 3 of 12" / "3" 之类跨页只有数字变
  return text.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase()
}

function findRepeatedFurniture(pagesLines: Line[][]): Set<string> {
  if (pagesLines.length < 3) return new Set()
  const seen = new Map<string, Set<number>>()
  for (let p = 0; p < pagesLines.length; p++) {
    for (const line of pagesLines[p]) {
      const key = normalizeForRepeat(line.text)
      if (!key) continue
      if (!seen.has(key)) seen.set(key, new Set())
      seen.get(key)!.add(p)
    }
  }
  const repeated = new Set<string>()
  const threshold = Math.max(3, Math.ceil(pagesLines.length * 0.5))
  for (const [key, pages] of seen) {
    if (pages.size >= threshold) repeated.add(key)
  }
  return repeated
}

function isPageNumber(line: Line, pageHeight: number): boolean {
  const nearEdge = line.y < pageHeight * 0.06 || line.y > pageHeight * 0.94
  return nearEdge && /^\s*\d{1,4}\s*$/.test(line.text)
}

/* ---- 分栏 ---- */

interface Band {
  full: Line[]
  left: Line[]
  right: Line[]
}

/** 行是否横跨页面中线（全宽行：标题、摘要、跨栏图题） */
function spansMiddle(line: Line, pageWidth: number): boolean {
  const mid = pageWidth / 2
  return line.x < mid - pageWidth * 0.08 && line.x + line.width > mid + pageWidth * 0.08
}

/**
 * 把一页的行切成若干竖直带（band）：全宽行自成一带，
 * 连续的栏内行合成一带、带内先左栏后右栏。
 */
function bandsForPage(lines: Line[], pageWidth: number): Band[] {
  const mid = pageWidth / 2
  const bands: Band[] = []
  let current: Band | null = null

  for (const line of [...lines].sort((a, b) => b.y - a.y)) {
    if (spansMiddle(line, pageWidth)) {
      bands.push({ full: [line], left: [], right: [] })
      current = null
    } else {
      if (!current) {
        current = { full: [], left: [], right: [] }
        bands.push(current)
      }
      if (line.x + line.width / 2 < mid) current.left.push(line)
      else current.right.push(line)
    }
  }
  return bands
}

/** 阅读顺序：带从上到下；带内全宽行 → 左栏 → 右栏。 */
function readingOrder(lines: Line[], pageWidth: number): Line[] {
  const ordered: Line[] = []
  for (const band of bandsForPage(lines, pageWidth)) {
    ordered.push(...band.full)
    ordered.push(...band.left.sort((a, b) => b.y - a.y))
    ordered.push(...band.right.sort((a, b) => b.y - a.y))
  }
  return ordered
}

/* ---- 聚段 ---- */

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** 正文字号：按文本长度加权的众数 */
function bodyFontSize(lines: Line[]): number {
  const weight = new Map<number, number>()
  for (const l of lines) {
    const size = Math.round(l.fontSize * 2) / 2
    weight.set(size, (weight.get(size) ?? 0) + l.text.length)
  }
  let best = 10
  let bestW = -1
  for (const [size, w] of weight) {
    if (w > bestW) {
      best = size
      bestW = w
    }
  }
  return best
}

const HEADING_PATTERN = /^(\d+(\.\d+)*\.?|[IVXLC]+\.?|[A-Z]\.)\s+\S|^(abstract|references|acknowledg(e)?ments|appendix)\b/i

function isHeading(line: Line, body: number): boolean {
  if (line.text.length > 120) return false
  if (/^arxiv:\d/i.test(line.text)) return false // 侧边水印字号大，但不是标题
  if (line.fontSize >= body * 1.15) return true
  return line.fontSize >= body && HEADING_PATTERN.test(line.text)
}

function headingLevel(text: string): number {
  const m = /^(\d+(\.\d+)*)/.exec(text)
  if (!m) return 1
  return m[1].split('.').length
}

/** 换行连字符合并："aug-" + "mented" → "augmented" */
function joinLines(a: string, b: string): string {
  if (/[a-zA-Z]-$/.test(a)) return a.slice(0, -1) + b
  // 跨行断开的 URL 直接续接：中间掺空格会把链接拼坏（github.com/ vodezhaw）
  if (/https?:\/\/\S*$/.test(a)) return a + b
  return a + ' ' + b
}

/* ---- 公式碎片合并 ---- */

const MATH_CHARS = /[∈×∑∏√≤≥±≈≠→←∇∂∞∝⊙⊗⊕·∀∃∫αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩ]|\^|_/

/**
 * 公式碎片判定：上下标、矩阵维度（d×d_k）、`W ∈ R` 这类被文本层拆散的数学元素。
 * 公式的定位是「渲染，不翻译」，不该以段落身份挂着「未译」占一行。
 */
export function isFormulaFragment(text: string): boolean {
  const t = text.trim()
  if (t.length === 0) return false
  if (t.length <= 8) return true // "i" / "ii" / "V" / "model" 之类的孤立碎片
  const words = t.match(/[a-zA-Z]{4,}/g) ?? []
  if (t.length <= 90 && words.length <= 2 && MATH_CHARS.test(t)) return true
  // 显示公式整行：单大写字母（Q/K/V/W/R…）密集且含关系符
  const singleCaps = t.match(/\b[A-Z]\b/g) ?? []
  if (t.length <= 160 && singleCaps.length >= 3 && /[=∈]/.test(t)) return true
  return false
}

/** 连续的公式碎片段合并为一个 equation 块；随后统一重排 order 并重建目录。 */
function mergeFormulaFragments(blocks: ParsedBlock[]): ParsedBlock[] {
  const out: ParsedBlock[] = []
  let run: ParsedBlock[] = []

  const flushRun = (): void => {
    if (run.length === 0) return
    const first = run[0]
    const minX = Math.min(...run.map((b) => b.bbox[0]))
    const minY = Math.min(...run.map((b) => b.bbox[1]))
    const maxX = Math.max(...run.map((b) => b.bbox[0] + b.bbox[2]))
    const maxY = Math.max(...run.map((b) => b.bbox[1] + b.bbox[3]))
    out.push({
      page: first.page,
      order: 0,
      kind: 'equation',
      section: first.section,
      text: run.map((b) => b.text).join('  '),
      bbox: [minX, minY, maxX - minX, maxY - minY]
    })
    run = []
  }

  for (const b of blocks) {
    if (b.kind === 'para' && isFormulaFragment(b.text)) {
      // 跨页不合并（页对不上会让 bbox 与锚点失真）
      if (run.length > 0 && run[0].page !== b.page) flushRun()
      run.push(b)
    } else {
      flushRun()
      out.push(b)
    }
  }
  flushRun()
  return out.map((b, i) => ({ ...b, order: i }))
}

/* ---- 主入口 ---- */

export function parsePages(pages: PageItems[]): ParseResult {
  const pagesLines = pages.map(assembleLines)
  const furniture = findRepeatedFurniture(pagesLines)

  const blocks: ParsedBlock[] = []
  let currentSection: string | null = null
  let order = 0

  for (let p = 0; p < pages.length; p++) {
    const page = pages[p]
    const kept = pagesLines[p].filter(
      (l) => !furniture.has(normalizeForRepeat(l.text)) && !isPageNumber(l, page.height)
    )
    const ordered = readingOrder(kept, page.width)
    const body = bodyFontSize(kept)
    const gaps: number[] = []
    for (let i = 1; i < ordered.length; i++) {
      const gap = ordered[i - 1].y - ordered[i].y
      if (gap > 0 && gap < body * 3) gaps.push(gap)
    }
    const lineGap = median(gaps) || body * 1.2
    const paraGapThreshold = lineGap * 1.6

    let acc: Line[] = []

    const flush = (): void => {
      if (acc.length === 0) return
      const text = acc.map((l) => l.text).reduce((a, b) => joinLines(a, b))
      const minX = Math.min(...acc.map((l) => l.x))
      const maxX = Math.max(...acc.map((l) => l.x + l.width))
      const minY = Math.min(...acc.map((l) => l.y))
      const maxY = Math.max(...acc.map((l) => l.y + l.fontSize))
      blocks.push({
        page: page.page,
        order: order++,
        kind: 'para',
        section: currentSection,
        text,
        bbox: [minX, minY, maxX - minX, maxY - minY]
      })
      acc = []
    }

    for (let i = 0; i < ordered.length; i++) {
      const line = ordered[i]

      if (isHeading(line, body)) {
        flush()
        currentSection = line.text.trim()
        const level = headingLevel(line.text)
        blocks.push({
          page: page.page,
          order: order++,
          kind: 'heading',
          section: currentSection,
          text: currentSection,
          bbox: [line.x, line.y, line.width, line.fontSize],
          headingLevel: level
        })
        continue
      }

      const prev = acc[acc.length - 1]
      if (prev) {
        const sameColumn = Math.abs(prev.x - line.x) < 60 || prev.y - line.y > 0
        const gap = prev.y - line.y
        // 换段信号：行距跳变，或换栏/换带（gap ≤ 0 表示 y 不再单调下降）
        if (gap <= 0 || gap > paraGapThreshold || !sameColumn) flush()
      }
      acc.push(line)
    }
    flush()
  }

  // 公式碎片合并会改变块序：先合并、再重排 order、最后由 heading 块重建目录
  const merged = mergeFormulaFragments(blocks)
  const outline: OutlineEntry[] = merged
    .filter((b) => b.kind === 'heading')
    .map((b) => ({
      title: b.text,
      level: b.headingLevel ?? 1,
      page: b.page,
      order: b.order
    }))

  return { blocks: merged, outline }
}
