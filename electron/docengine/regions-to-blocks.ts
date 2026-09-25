/**
 * ML 版面区域 → 块（纯函数）。
 * 关键取舍：
 * - inline_formula 留在所属段落里；独立公式及其编号保留原位截图
 * - header/footer/页码/侧栏水印/竖排文本直接丢弃（arXiv 水印与授权声明的终解）
 * - 区域顺序 = 模型阅读顺序（PP-DocLayoutV2 联合输出），不再自己猜栏序
 */
import type { PageItems, ParsedBlock, ParseResult, TextItem } from './layout'
import { joinLines, linesFromItems } from './layout'
import type { LayoutRegion } from './layout-ml'
import { inlinePlaceholder, type InlineFormula } from '../../shared/inline-formula'

const DROP = new Set([
  'header', 'footer', 'number', 'header_image', 'footer_image',
  'aside_text', 'vertical_text', 'seal'
])
const NON_GROUPING = new Set(['inline_formula'])
const EQUATION = new Set(['display_formula', 'algorithm', 'formula_number'])
const HEADING = new Set(['doc_title', 'paragraph_title'])
const FIGURE = new Set(['image', 'chart'])

function headingLevel(label: string, text: string): number {
  if (label === 'doc_title') return 1
  const m = /^(\d+(\.\d+)*)/.exec(text)
  return m ? m[1].split('.').length : 1
}

function regionArea(r: LayoutRegion): number {
  return Math.max(0, r.x2 - r.x1) * Math.max(0, r.y2 - r.y1)
}

function centerIn(item: TextItem, r: LayoutRegion, pad = 2): boolean {
  const cx = item.x + item.width / 2
  const cy = item.y + item.fontSize / 2
  return cx >= r.x1 - pad && cx <= r.x2 + pad && cy >= r.y1 - pad && cy <= r.y2 + pad
}

/** 块内 text item 字号中位数（pt）——镜像页按原字号层级排版的依据。 */
function medianFontSize(items: TextItem[]): number | undefined {
  const sizes = items.map((i) => i.fontSize).filter((f) => f > 1).sort((a, b) => a - b)
  if (sizes.length === 0) return undefined
  return sizes[Math.floor(sizes.length / 2)]
}

/**
 * 文本块的 bbox：区域框与实际文字边界的交。
 * ML 偶发输出覆盖整栏的巨型区域却只捕到一行文字（典型：参考文献栏里
 * 落单的 DOI 行）——按区域框摆放会把整栏其他块全部撞开。
 * 文字铺满区域时结果与区域框一致（±2pt 填充），版式不受影响。
 */
function textBbox(r: LayoutRegion, items: TextItem[]): [number, number, number, number] {
  const region: [number, number, number, number] = [r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1]
  if (items.length === 0) return region
  const pad = 2
  const minX = Math.min(...items.map((i) => i.x)) - pad
  const maxX = Math.max(...items.map((i) => i.x + i.width)) + pad
  const minY = Math.min(...items.map((i) => i.y)) - pad
  const maxY = Math.max(...items.map((i) => i.y + i.fontSize)) + pad
  const x1 = Math.max(r.x1, minX)
  const y1 = Math.max(r.y1, minY)
  const x2 = Math.min(r.x2, maxX)
  const y2 = Math.min(r.y2, maxY)
  if (x2 <= x1 || y2 <= y1) return region
  return [x1, y1, x2 - x1, y2 - y1]
}

/** 原图区域还须覆盖归属于它的文字：检测框外的图标题、坐标标签不能在裁切时消失。 */
function visualBbox(r: LayoutRegion, items: TextItem[]): [number, number, number, number] {
  const x1 = Math.min(r.x1, ...items.map((it) => it.x))
  const y1 = Math.min(r.y1, ...items.map((it) => it.y - it.fontSize * 0.2))
  const x2 = Math.max(r.x2, ...items.map((it) => it.x + it.width))
  const y2 = Math.max(r.y2, ...items.map((it) => it.y + it.fontSize))
  return [x1, y1, x2 - x1, y2 - y1]
}

/**
 * 图表噪声判定：几乎全是数字刻度的「段落」是 ML 漏检的图
 * （典型：多联子图中间那条没被识别成 image 区域，坐标轴刻度成了乱码文本）。
 * 这类块转为截图占位，比一段数字乱码可读得多。
 */
function isChartNoise(text: string): boolean {
  // 目录的点引导线（「Abstract . . . . . 3」）不算数字：以前一个「.」也被当成刻度数字，整页目录成了截图
  const tokens = text.split(/\s+/).filter((t) => t.length > 0 && !/^[.·…]+$/.test(t))
  if (tokens.length < 8) return false
  const numeric = tokens.filter((t) => /^[-+()]?\d[\d.]*[)%]?$|^[-+]?\.\d+$/.test(t)).length
  const letters = (text.match(/[A-Za-z]/g) ?? []).length
  return numeric / tokens.length >= 0.6 && letters < text.length * 0.3
}

/**
 * 表格区域重建：模型没识别出 table 时，常把每个单元格标成 inline_formula
 * （实测某页 40 多个），这些碎片随后被并进邻近段落，整段变成数字乱码。
 * 密集成网格的 inline_formula 聚簇（≥8 个、跨 ≥3 行、够高）重建为 table 区域，
 * 让单元格文字在分桶阶段就归表格所有，正文段落保持干净。
 */
function tableRegionsFromCells(regions: LayoutRegion[]): LayoutRegion[] {
  const cells = regions.filter((r) => r.label === 'inline_formula')
  if (cells.length < 8) return []
  const used = new Set<LayoutRegion>()
  const out: LayoutRegion[] = []
  for (const seed of cells) {
    if (used.has(seed)) continue
    const cluster = [seed]
    used.add(seed)
    for (let i = 0; i < cluster.length; i++) {
      const c = cluster[i]
      for (const o of cells) {
        if (used.has(o)) continue
        const dx = Math.max(c.x1 - o.x2, o.x1 - c.x2, 0)
        const dy = Math.max(c.y1 - o.y2, o.y1 - c.y2, 0)
        if (dx <= 40 && dy <= 24) {
          used.add(o)
          cluster.push(o)
        }
      }
    }
    if (cluster.length < 8) continue
    const rows = new Set(cluster.map((c) => Math.round(c.y1 / 8)))
    if (rows.size < 3) continue // 单行公式串不是表
    const x1 = Math.min(...cluster.map((c) => c.x1))
    const x2 = Math.max(...cluster.map((c) => c.x2))
    const y1 = Math.min(...cluster.map((c) => c.y1))
    const y2 = Math.max(...cluster.map((c) => c.y2))
    if (y2 - y1 < 60) continue
    const pad = 4
    out.push({ label: 'table', score: 0.5, order: 8000 + out.length, x1: x1 - pad, y1: y1 - pad, x2: x2 + pad, y2: y2 + pad })
  }
  return out
}

/**
 * 重建出的表格框只覆盖到公式单元格，行首标签/日期那几列还在框外。
 * 沿同一行带向两侧扩展，吸收「不属于任何文本区域」的游离文字项——
 * 正文永远在 text 区域里，因此不会被吞。
 */
function expandTableRegion(t: LayoutRegion, items: TextItem[], regions: LayoutRegion[]): void {
  const textRegions = regions.filter((r) => !DROP.has(r.label) && !NON_GROUPING.has(r.label) && r.label !== 'table')
  const loose = items.filter((it) => {
    if (it.str.trim().length === 0) return false
    return !textRegions.some((r) => centerIn(it, r, 2))
  })
  for (let iter = 0; iter < 4; iter++) {
    let grew = false
    for (const it of loose) {
      const cx = it.x + it.width / 2
      const cy = it.y + it.fontSize / 2
      if (cx >= t.x1 && cx <= t.x2 && cy >= t.y1 && cy <= t.y2) continue
      if (cy < t.y1 - 8 || cy > t.y2 + 8) continue // 只在同一行带里扩
      if (cx < t.x1 - 90 || cx > t.x2 + 90) continue
      t.x1 = Math.min(t.x1, it.x - 3)
      t.x2 = Math.max(t.x2, it.x + it.width + 3)
      t.y1 = Math.min(t.y1, it.y - 3)
      t.y2 = Math.max(t.y2, it.y + it.fontSize + 3)
      grew = true
    }
    if (!grew) break
  }
}

function textFromItems(items: TextItem[], page: number): string {
  const lines = linesFromItems(items, page)
  if (lines.length === 0) return ''
  return lines.map((l) => l.text).reduce((a, b) => joinLines(a, b))
}

/* ---- 行内公式 → 占位符 ---- */

/** 数学符号：文本层里能直接看到的那部分（花体 / 帽子 / 上下标只能靠字号与基线判断） */
const INLINE_MATH_SYMBOLS = /[∈∉∪∩⊂⊆⊃⊇×∑∏√≤≥±≈≠≡→←↔∇∂∞∝⊙⊗⊕·∀∃∫∮αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩ=+<>|ˆ˜¯‖ℓℝℕℤ𝒜-𝒵𝔸-𝕐]/u

/**
 * 模型标出的 inline_formula 区域是否真是公式。误标的普通单词若也换成截图，
 * 译文里会夹一个没翻译的英文词图片；这里只认：带数学符号、带上下标（小字号项）、
 * 单个字母变量、字母数字混排（x1、10⁻²²）。纯数字（脚注 / 引用角标）不算。
 */
function looksLikeInlineMath(items: TextItem[], bodyFont: number): boolean {
  const joined = items.map((it) => it.str).join('').trim()
  if (joined.length === 0) return false
  if (/^[\d\s.,;:()[\]]+$/.test(joined)) return false
  if (INLINE_MATH_SYMBOLS.test(joined)) return true
  if (items.some((it) => it.fontSize <= bodyFont * 0.8) && items.some((it) => it.fontSize > bodyFont * 0.8)) return true
  if (/^[A-Za-z]{1,2}$/.test(joined)) return true
  if (/\d/.test(joined) && /[A-Za-z]/.test(joined) && joined.length <= 12) return true
  return false
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/**
 * 段落里的 inline_formula 区域换成 ⟦fN⟧ 占位项，公式项从段落文本里拿掉并记下截图框。
 * 占位项沿用所在行主基线与正文字号，这样行拼接不会把它当成上下标包起来。
 * 跨行的公式（区域高过 1.8 行）、整段都是公式的、模型误标的普通词，都原样留在文本里。
 */
function substituteInlineFormulas(
  region: LayoutRegion,
  items: TextItem[],
  formulas: LayoutRegion[],
  page: number
): { items: TextItem[]; inlines: InlineFormula[] } {
  const bodyFont = medianFontSize(items) ?? 10
  // 版面模型漏框的公式：按数学字体补出候选框（单个花体 𝓛、变量 t 这类小目标模型常常不框）
  const synthesized = mathFontRuns(items, bodyFont).filter(
    (run) => !formulas.some((f) => run.items.every((it) => centerIn(it, f, 1)))
  )
  const candidates = [...formulas, ...synthesized.map((r) => r.region)]
    .filter((f) => {
      const cx = (f.x1 + f.x2) / 2
      const cy = (f.y1 + f.y2) / 2
      return cx >= region.x1 && cx <= region.x2 && cy >= region.y1 && cy <= region.y2
    })
    .filter((f) => f.y2 - f.y1 <= bodyFont * 1.8)
    // 阅读顺序：先上后下，同一行从左到右
    .sort((a, b) => (Math.abs(a.y1 - b.y1) > bodyFont * 0.5 ? b.y1 - a.y1 : a.x1 - b.x1))
  if (candidates.length === 0) return { items, inlines: [] }

  const consumed = new Set<TextItem>()
  const placeholders: TextItem[] = []
  const inlines: InlineFormula[] = []
  for (const f of candidates) {
    const inside = items.filter((it) => !consumed.has(it) && centerIn(it, f, 1))
    if (inside.length === 0 || inside.length === items.length) continue
    if (!looksLikeInlineMath(inside, bodyFont)) continue
    const n = inlines.length + 1
    for (const it of inside) consumed.add(it)
    const maxFont = Math.max(...inside.map((it) => it.fontSize))
    // 主基线：公式里最大字号项的基线，再用同一行相邻正文项校正（公式只有下标时自身基线偏低）。
    // 只认离它最近的那一行——相邻两行都在窗口里时取中位数会算到上一行去
    const own = inside.find((it) => it.fontSize === maxFont)!.y
    const peers = items.filter(
      (it) => !consumed.has(it) && it.fontSize >= bodyFont * 0.85 && Math.abs(it.y - own) < bodyFont * 0.8
    )
    let base = own
    if (peers.length > 0) {
      const nearest = peers.reduce((a, it) => (Math.abs(it.y - own) < Math.abs(a.y - own) ? it : a))
      base = median(peers.filter((it) => Math.abs(it.y - nearest.y) < bodyFont * 0.15).map((it) => it.y))
    }
    const minX = Math.min(...inside.map((it) => it.x))
    const maxX = Math.max(...inside.map((it) => it.x + it.width))
    const minY = Math.min(...inside.map((it) => it.y))
    const maxY = Math.max(...inside.map((it) => it.y + it.fontSize))
    // 截图框：模型框与文字边界的交——模型框偶尔压到邻字，文字边界又不含下伸部，两者取交并留余量
    let x1 = Math.max(f.x1, minX - 0.5)
    let x2 = Math.min(f.x2, maxX + 0.5)
    let y1 = Math.max(f.y1, minY - maxFont * 0.3)
    let y2 = Math.min(f.y2, maxY + maxFont * 0.15)
    // 同一行紧挨着的正文项（句末逗号、前一个词）不许进截图：以它们的边为界
    for (const it of items) {
      if (consumed.has(it) || Math.abs(it.y - base) > bodyFont * 0.5) continue
      const l = it.x
      const r = it.x + it.width
      if (l >= maxX - 0.5 && l < x2) x2 = l
      if (r <= minX + 0.5 && r > x1) x1 = r
    }
    if (x2 - x1 < 2 || y2 - y1 < 2) {
      x1 = f.x1
      x2 = f.x2
      y1 = f.y1
      y2 = f.y2
    }
    inlines.push({ n, bbox: [x1, y1, x2 - x1, y2 - y1], base, text: textFromItems(inside, page) })
    placeholders.push({ str: inlinePlaceholder(n), x: minX, y: base, width: maxX - minX, height: bodyFont, fontSize: bodyFont })
  }
  if (inlines.length === 0) return { items, inlines: [] }
  return { items: [...items.filter((it) => !consumed.has(it)), ...placeholders], inlines }
}

/**
 * 数学字体项的连续段 → 合成的行内公式区域。同一行上相邻（间距 < 0.6em）的数学字体项连成一段，
 * 紧挨着的小字号项（上下标，间距 < 0.3em）也并进来。字体名判定见 extract.ts 的 isMathFontName。
 */
function mathFontRuns(items: TextItem[], bodyFont: number): { region: LayoutRegion; items: TextItem[] }[] {
  if (!items.some((it) => it.math)) return []
  // 先按基线聚成行（上下标的基线偏移在 0.7em 以内），行内再按 x 找相邻——
  // 直接按 y 排序会把下标排到整行末尾，c 和 t 就连不到一起
  const lines: TextItem[][] = []
  for (const it of [...items].sort((a, b) => b.y - a.y)) {
    const line = lines[lines.length - 1]
    if (line && Math.abs(line[0].y - it.y) < bodyFont * 0.7) line.push(it)
    else lines.push([it])
  }
  const runs: TextItem[][] = []
  let run: TextItem[] = []
  const flush = (): void => {
    if (run.some((it) => it.math)) runs.push(run)
    run = []
  }
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x)
    for (const it of line) {
      const prev = run[run.length - 1]
      if (prev) {
        const gap = it.x - (prev.x + prev.width)
        const small = it.fontSize <= bodyFont * 0.8
        const joins = gap < bodyFont * (it.math ? 0.6 : small ? 0.3 : -1)
        if (!joins) flush()
      }
      if (it.math || (run.length > 0 && it.fontSize <= bodyFont * 0.8)) run.push(it)
      else flush()
    }
    flush()
  }
  return runs.map((r, i) => {
    const x1 = Math.min(...r.map((it) => it.x))
    const x2 = Math.max(...r.map((it) => it.x + it.width))
    const maxFont = Math.max(...r.map((it) => it.fontSize))
    const y1 = Math.min(...r.map((it) => it.y)) - maxFont * 0.3
    const y2 = Math.max(...r.map((it) => it.y + it.fontSize)) + maxFont * 0.15
    return { region: { label: 'inline_formula', score: 1, order: 10_000 + i, x1, y1, x2, y2 }, items: r }
  })
}

/** 段落块的文本与行内公式记录：有公式时文本里带 ⟦fN⟧ 占位符 */
function paraWithInlines(
  region: LayoutRegion,
  items: TextItem[],
  formulas: LayoutRegion[],
  page: number
): Pick<ParsedBlock, 'kind' | 'text' | 'inlines'> {
  const sub = substituteInlineFormulas(region, items, formulas, page)
  const text = textFromItems(sub.items, page)
  return sub.inlines.length > 0 ? { kind: 'para', text, inlines: sub.inlines } : { kind: 'para', text }
}

/**
 * 文字表：模型标成 table、实际是成段文字的区域（提示词、推理轨迹、对话示例）。
 * 这类整页整页的内容按截图呈现就一句都没翻；数字表（结果表）才截图。
 */
export function isTextTable(items: TextItem[]): boolean {
  const tokens = items.map((i) => i.str).join(' ').split(/\s+/).filter(Boolean)
  const words = tokens.filter((t) => /[A-Za-z]{2,}/.test(t)).length
  // 只数独立的数字格（62.3、$10.99、40%、(2006)），商品编号 B078GWRC1J 这种夹着数字的词不算
  const nums = tokens.filter((t) => /^[([$€£±+−-]*\d[\d.,]*[%)\]]*[,;:]?$/.test(t)).length
  // 编号多的散文（ALFWorld 的「a cabinet 13, a cabinet 12, …」）数字格占比高，但按字符算仍以字母为主
  const joined = tokens.join('')
  const letters = (joined.match(/[A-Za-z]/g) ?? []).length
  const digits = (joined.match(/\d/g) ?? []).length
  return words >= 40 && (nums <= words * 0.35 || letters >= (letters + digits) * 0.8)
}

// 轨迹 / 提示词里的行首标签：「Action: …」「Observation 2: …」「Thought 1 …」。
// 必须带冒号或编号，免得把以 Answer、Action 开头的普通句子也切开
const CELL_LABEL_WORDS = 'Action|Observation|Thought|Question|Claim|Answer|Instruction|Obs|Act|Think|Context|Input|Output|Example|Prompt|Response|User|Assistant|System|Original|Score'
const CELL_LABEL = new RegExp(`^(?:${CELL_LABEL_WORDS})\\b(?:\\s*\\d+\\s*:?|\\s*:)`, 'i')
/** 标签栏里的标签（左边窄栏，不带冒号）：「Answer 1,800 to 7,000 ft」「Act Question …」 */
const CELL_LABEL_WORD = new RegExp(`^(?:${CELL_LABEL_WORDS})\\b`)

/**
 * 文字表拆成单元格。按行处理（行 = 同一基线的文字项）：
 * ① 栏界：统计每个横坐标被多少行的文字覆盖，覆盖很少的竖条是栏间空白——
 *    个别跨栏的整行（表题、Instruction）不影响判断。表格的栏距常常只有 10pt，
 *    通用的断行逻辑会把左右两栏同一基线的文字并成一行，所以这里自己按栏界切行。
 * ② 左边一栏全是短标签（Question / Action 1 / Observation 2）不算分栏：
 *    标签和内容是同一行，Observation 换行后还顶格写，按两栏切会把一段观察拆碎。
 * ③ 一两栏的表：同一栏里行距正常的连续行合成一格，遇到大行距或行首标签另起一格；
 *    三栏以上是网格，一行一格，免得把不同行的单元格拼成一句。
 * 每格按自己的位置成为普通段落块：逐格翻译，镜像页上放回原位置。
 */
export function splitTextTable(r: LayoutRegion, items: TextItem[], page: number): { region: LayoutRegion; items: TextItem[] }[] {
  const its = items.filter((i) => i.str.trim().length > 0)
  if (its.length === 0) return []
  const rows: TextItem[][] = []
  for (const it of [...its].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows[rows.length - 1]
    if (row && Math.abs(row[0].y - it.y) <= Math.max(2.5, 0.35 * Math.max(row[0].fontSize, it.fontSize))) row.push(it)
    else rows.push([it])
  }
  // 只有括号的「行」：彩色方括号常是单独的文字项、基线还偏一点（WebShop 轨迹里的 [B078GWRC1J]），
  // 自成一行会让编号丢了括号、括号跑到上一格末尾。并回纵向最近的一行，按横坐标排回原位
  for (let i = rows.length - 1; i >= 0; i--) {
    if (!rows[i].every((it) => /^[[\]()|\s]+$/.test(it.str))) continue
    const y = rows[i][0].y
    let best = -1
    for (let j = 0; j < rows.length; j++) {
      if (j === i || rows[j].every((it) => /^[[\]()|\s]+$/.test(it.str))) continue
      if (best < 0 || Math.abs(rows[j][0].y - y) < Math.abs(rows[best][0].y - y)) best = j
    }
    if (best >= 0 && Math.abs(rows[best][0].y - y) <= Math.max(...rows[i].map((it) => it.fontSize)) * 1.2) {
      rows[best].push(...rows[i])
      rows.splice(i, 1)
    }
  }
  for (const row of rows) row.sort((a, b) => a.x - b.x)

  // ① 候选栏界：被覆盖的行数不到峰值 15% 的竖条，宽 ≥ 4pt，两侧都有文字。
  // 记成区间 [a, b]：左栏右边参差不齐，低覆盖带可能从左栏中间一直延到右栏起头，取中点会切在左栏文字里
  const x0 = Math.floor(Math.min(r.x1, ...its.map((i) => i.x)))
  const width = Math.max(1, Math.ceil(Math.max(r.x2, ...its.map((i) => i.x + i.width))) - x0)
  const count = new Uint16Array(width)
  for (const row of rows) {
    const mark = new Uint8Array(width)
    for (const it of row) for (let x = Math.max(0, Math.floor(it.x) - x0); x < Math.min(width, Math.ceil(it.x + it.width) - x0); x++) mark[x] = 1
    for (let x = 0; x < width; x++) count[x] += mark[x]
  }
  const peak = Math.max(...count)
  const low = Math.max(1, Math.floor(peak * 0.15))
  // 栏间空白至少 1.1 个字号宽：等宽字体里各行的空格在同一横坐标上对齐，会形成一条条
  // 一个字宽（约 0.6 字号）的「河道」，不能当成栏界把一段话切碎
  const fsMed = [...its].map((i) => i.fontSize).sort((a, b) => a - b)[Math.floor(its.length / 2)] || 8
  const minGutter = Math.max(4, fsMed * 1.1)
  let gutters: { a: number; b: number }[] = []
  if (rows.length >= 4) {
    let first = 0
    while (first < width && count[first] <= low) first++
    let last = width - 1
    while (last > first && count[last] <= low) last--
    let run = -1
    for (let x = first; x <= last; x++) {
      if (count[x] <= low && run < 0) run = x
      if (count[x] > low && run >= 0) {
        if (x - run >= minGutter) gutters.push({ a: x0 + run, b: x0 + x })
        run = -1
      }
    }
  }

  interface Seg { items: TextItem[]; x1: number; x2: number; y: number; fs: number; col: number; text: string }
  // 各栏的左边线：栏界右侧 40pt 内最常见的行首横坐标。左栏文字一直写到栏界边上时空隙可能不到一个空格，
  // 这时靠「右边的字正好从栏的左边线起头」认出这是两栏
  const colStart = (g: { a: number; b: number }): number | null => {
    const tally = new Map<number, number>()
    for (const row of rows) {
      const it = row.find((i) => i.x >= g.b - 2 && i.x <= g.b + 40)
      if (it && row.some((p) => p.x + p.width <= g.b + 1)) tally.set(Math.round(it.x), (tally.get(Math.round(it.x)) ?? 0) + 1)
    }
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
    return best && best[1] >= 3 ? best[0] : null
  }
  const segment = (gs: { a: number; b: number }[]): Seg[] => {
    const starts = gs.map(colStart)
    const out: Seg[] = []
    for (const row of rows) {
      const fs = Math.max(...row.map((i) => i.fontSize))
      let cur: TextItem[] = []
      const push = (): void => {
        if (cur.length === 0) return
        const x1 = Math.min(...cur.map((i) => i.x))
        const x2 = Math.max(...cur.map((i) => i.x + i.width))
        const crosses = gs.some((g) => x1 < g.a && x2 > g.b)
        out.push({ items: cur, x1, x2, y: row[0].y, fs, col: crosses ? -1 : gs.filter((g) => x1 >= g.b - 2).length, text: textFromItems(cur, page) })
        cur = []
      }
      for (const it of row) {
        const prev = cur[cur.length - 1]
        // 这一行在栏界处真的断开（没有字压线、空隙超过一个空格）才切开；连续跨过栏界的是整行
        const gap = prev ? it.x - (prev.x + prev.width) : 0
        if (
          prev &&
          gs.some((g, k) => prev.x + prev.width <= g.b + 1 && it.x >= g.b - 2 && (gap >= fs * 0.9 || (starts[k] != null && Math.abs(it.x - starts[k]!) <= 1.5)))
        )
          push()
        cur.push(it)
      }
      push()
    }
    return out
  }
  // ② 去掉「左边是标签栏」的栏界：栏很窄（不到表宽 30%）且多是三个词以内的短格。
  // 只看短格不够：Act | ReAct 这种对照表里也满是「[Next]」「$85.0」这样的短格，但栏是宽的
  const words = (t: string): number => (t.match(/[A-Za-z]{2,}|[\u4e00-\u9fff]/g) ?? []).length
  let labelColumn = false
  let segs = segment(gutters)
  for (let pass = 0; pass < 3; pass++) {
    const keep = gutters.filter((_, k) => {
      const left = segs.filter((sg) => sg.col === k)
      if (left.length === 0) return false
      const colWidth = Math.max(...left.map((sg) => sg.x2)) - Math.min(...left.map((sg) => sg.x1))
      const short = left.filter((sg) => words(sg.text) <= 3).length / left.length
      const isLabels = colWidth < width * 0.3 && short >= 0.6
      if (isLabels) labelColumn = true
      return !isLabels
    })
    if (keep.length === gutters.length) break
    gutters = keep
    segs = segment(gutters)
  }
  const grid = gutters.length >= 2
  // 有标签栏的表（HotpotQA 提示词）：标签不带冒号也算新的一格（「Answer 1,800 to 7,000 ft」）
  // 粗体标记要先去掉：Table 10 这类表里行首是「**Action**:」
  const startsCell = (t: string): boolean => {
    const plain = t.replace(/\*\*/g, '')
    // 「> go to fridge 1」：交互轨迹里一行一个动作，动作连同后面的环境反馈成一格
    return CELL_LABEL.test(plain) || /^>\s*\S/.test(plain) || (labelColumn && CELL_LABEL_WORD.test(plain))
  }

  // ③ 合格
  interface Chunk { col: number; segs: Seg[] }
  const chunks: Chunk[] = []
  const open = new Map<number, Chunk>()
  for (const sg of segs) {
    // 跨栏行出现：各栏的当前格到此为止；栏内行出现：跨栏说明到此为止
    if (sg.col === -1) {
      for (const k of [...open.keys()]) if (k !== -1) open.delete(k)
    } else {
      open.delete(-1)
    }
    const cur = open.get(sg.col)
    const prev = cur?.segs[cur.segs.length - 1]
    const joins = cur && prev && !grid && prev.y - sg.y <= Math.max(prev.fs, sg.fs) * 1.7 && !startsCell(sg.text.trim())
    if (joins) cur.segs.push(sg)
    else {
      const c = { col: sg.col, segs: [sg] }
      chunks.push(c)
      open.set(sg.col, c)
    }
  }

  // 阅读顺序：两栏对照（Act | ReAct）先读完左栏再读右栏；网格按行；跨栏说明原位
  const ordered: Chunk[] = []
  let group: Chunk[] = []
  const flush = (): void => {
    if (!grid) group.sort((a, b) => a.col - b.col)
    ordered.push(...group)
    group = []
  }
  for (const c of chunks) {
    if (c.col === -1) {
      flush()
      ordered.push(c)
    } else group.push(c)
  }
  flush()

  return ordered.map((c) => {
    const cellItems = c.segs.flatMap((sg) => sg.items)
    return {
      region: {
        label: 'text',
        score: 1,
        order: r.order,
        x1: Math.min(...c.segs.map((sg) => sg.x1)) - 1,
        x2: Math.max(...c.segs.map((sg) => sg.x2)) + 1,
        y1: Math.min(...cellItems.map((i) => i.y)) - 2,
        y2: Math.max(...cellItems.map((i) => i.y + i.fontSize)) + 1
      },
      items: cellItems
    }
  })
}

/**
 * 模型偶尔给同一段话出两个大面积重叠的 text 区域（CKM 论文第 3 页公式 (1) 下面那段）：文字按「最小区域」
 * 归属被拆到两边，一边只剩上下标碎片，正文字号估错、行内公式认不出，译文成了乱码。
 * 两个普通文字区域几乎重合（交并比 ≥ 0.6）就并成一个。
 */
function mergeOverlappingText(regions: LayoutRegion[]): LayoutRegion[] {
  const plain = (r: LayoutRegion): boolean =>
    !DROP.has(r.label) && !NON_GROUPING.has(r.label) && !HEADING.has(r.label) && !EQUATION.has(r.label) && !FIGURE.has(r.label) && r.label !== 'table'
  const out = [...regions]
  for (let merged = true; merged; ) {
    merged = false
    for (let i = 0; i < out.length && !merged; i++) {
      for (let j = i + 1; j < out.length && !merged; j++) {
        const a = out[i]
        const b = out[j]
        if (!plain(a) || !plain(b)) continue
        const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)
        const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1)
        // 只并「几乎是同一块」的两个框（交并比 ≥ 0.6）：列表、参考文献里每条一个框、相邻框本来就会压一点边，
        // 按「重叠超过较小者一半」会一条接一条地连锁并成整页一大段
        const inter = w > 0 && h > 0 ? w * h : 0
        if (inter < (regionArea(a) + regionArea(b) - inter) * 0.6) continue
        out[i] = { ...a, order: Math.min(a.order, b.order), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) }
        out.splice(j, 1)
        merged = true
      }
    }
  }
  return out
}

/**
 * 一个区域里的文字按行距切成几段：相邻两行的基线相距超过 3 倍字号（正常行距约 1.2 倍）就断开。
 * 没有这种大空隙时原样返回同一个数组。
 */
function splitAtGaps(items: TextItem[]): TextItem[][] {
  if (items.length < 2) return [items]
  const sorted = [...items].sort((a, b) => b.y - a.y)
  const fs = medianFontSize(items) ?? 10
  const parts: TextItem[][] = [[sorted[0]]]
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    if (prev.y - sorted[i].y > fs * 3) parts.push([])
    parts[parts.length - 1].push(sorted[i])
  }
  return parts.length === 1 ? [items] : parts
}

/** 数字型碎片：表格单元格被模型拆成的小块（"Window 300 Hz"、"7.1×10 2020 April 28"）。 */
function isTableFragment(b: ParsedBlock): boolean {
  if (b.kind === 'figure' || b.kind === 'table' || b.tableCell) return false
  if (b.text.length > 220) return false
  const tokens = b.text.split(/\s+/).filter(Boolean)
  if (tokens.length < 2) return b.kind === 'equation'
  const numeric = tokens.filter((t) => /\d/.test(t)).length
  return b.kind === 'equation' || numeric / tokens.length >= 0.35
}

/**
 * 表格碎片合并：模型没把表格识别成 table 区域时，会把单元格拆成十几个
 * para/equation 小块——它们被逐个翻译再按坐标摆放，镜像页就是一团乱码。
 * 同栏内纵向相邻的数字型碎片成簇（≥5 块且至少 2 块是文本）时合成单个
 * table 块，按截图呈现：表格保持原样可读，也不再浪费翻译。
 */
function mergeTableFragments(pageBlocks: ParsedBlock[]): ParsedBlock[] {
  const frags = pageBlocks.filter(isTableFragment)
  if (frags.length < 5) return pageBlocks
  interface Box { x1: number; y1: number; x2: number; y2: number }
  const box = (b: ParsedBlock): Box => ({
    x1: b.bbox[0], y1: b.bbox[1], x2: b.bbox[0] + b.bbox[2], y2: b.bbox[1] + b.bbox[3]
  })
  const union = (a: Box, b: Box): Box => ({
    x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2)
  })

  // ① 自上而下逐块并入「同栏且紧邻其下」的簇（要和所有开放簇比，
  //    否则左右栏交错时会把一张表切成许多碎簇）
  const clusters: { box: Box; items: ParsedBlock[] }[] = []
  for (const f of [...frags].sort((a, b) => box(b).y2 - box(a).y2)) {
    const fb = box(f)
    let best = -1
    let bestGap = Infinity
    for (let i = 0; i < clusters.length; i++) {
      const cb = clusters[i].box
      const xo = Math.min(cb.x2, fb.x2) - Math.max(cb.x1, fb.x1)
      if (xo <= Math.min(cb.x2 - cb.x1, fb.x2 - fb.x1) * 0.5) continue
      // 表格碎片彼此常纵向重叠（模型把行/列切得交错），不能只认「紧邻下方」
      const yOverlap = Math.min(cb.y2, fb.y2) - Math.max(cb.y1, fb.y1)
      const gapBelow = cb.y1 - fb.y2
      if (yOverlap <= 0 && (gapBelow < -6 || gapBelow > 22)) continue
      const gap = yOverlap > 0 ? 0 : gapBelow
      if (gap < bestGap) {
        bestGap = gap
        best = i
      }
    }
    if (best >= 0) {
      clusters[best].items.push(f)
      clusters[best].box = union(clusters[best].box, fb)
    } else {
      clusters.push({ box: fb, items: [f] })
    }
  }

  // ② 跨栏合并：纵向大幅重叠且横向相邻的两簇属于同一张宽表
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const a = clusters[i]
      const b = clusters[j]
      if (a.items.length === 0 || b.items.length === 0) continue
      const yo = Math.min(a.box.y2, b.box.y2) - Math.max(a.box.y1, b.box.y1)
      const minH = Math.min(a.box.y2 - a.box.y1, b.box.y2 - b.box.y1)
      const xgap = Math.max(a.box.x1, b.box.x1) - Math.min(a.box.x2, b.box.x2)
      if (yo > minH * 0.5 && xgap < 60) {
        a.items.push(...b.items)
        a.box = union(a.box, b.box)
        b.items = []
      }
    }
  }

  const merged: ParsedBlock[] = []
  const consumed = new Set<ParsedBlock>()
  for (const c of clusters) {
    if (c.items.length < 5) continue
    if (c.items.filter((b) => b.kind !== 'equation').length < 2) continue // 纯公式串不是表
    if (c.box.y2 - c.box.y1 < 40) continue // 太扁不像表
    for (const b of c.items) consumed.add(b)
    const pad = 3
    merged.push({
      page: c.items[0].page,
      order: Math.min(...c.items.map((b) => b.order)),
      kind: 'table',
      section: c.items[0].section,
      text: '[表]',
      bbox: [c.box.x1 - pad, c.box.y1 - pad, c.box.x2 - c.box.x1 + pad * 2, c.box.y2 - c.box.y1 + pad * 2]
    })
  }
  if (merged.length === 0) return pageBlocks
  // 几何上落在表框内的块都归表格所有——表头里的 "Extended"、"SG-E Date"
  // 这类不含数字的单元格文本不在碎片候选里，留着就会被单独翻译成乱码。
  // 标题与长正文除外（避免吞掉恰好压在表格附近的段落）
  for (const m of merged) {
    const [mx, my, mw, mh] = m.bbox
    for (const f of pageBlocks) {
      if (consumed.has(f) || f.kind === 'heading') continue
      if (f.kind === 'figure' || f.kind === 'table') continue
      // 散文（字母占比高的长文本）不吞：表格里的单元格再长也是数字密集的
      const letters = (f.text.match(/[A-Za-z\u4e00-\u9fff]/g) ?? []).length
      if (f.text.length > 120 && letters / f.text.length > 0.5) continue
      const b = box(f)
      const cx = (b.x1 + b.x2) / 2
      const cy = (b.y1 + b.y2) / 2
      if (cx >= mx - 6 && cx <= mx + mw + 6 && cy >= my - 6 && cy <= my + mh + 6) consumed.add(f)
    }
  }
  return [...pageBlocks.filter((b) => !consumed.has(b)), ...merged].sort((a, b) => a.order - b.order)
}

export function blocksFromRegions(
  pages: PageItems[],
  regionsByPage: Map<number, LayoutRegion[]>
): ParseResult {
  const blocks: ParsedBlock[] = []
  let currentSection: string | null = null
  let title: string | undefined
  let order = 0

  for (const page of pages) {
    const detected = regionsByPage.get(page.page) ?? []
    // 行内公式密集的段落（物理论文里一段话十几个公式）也会聚出「表格」：里面四成以上是正文字体的
    // 英文单词就不是表，不重建——重建了会把整段按表格拆格，行内公式不再换截图，译文成了乱码
    const synthTables = tableRegionsFromCells(detected).filter((t) => {
      // 按字符算：公式被拆成很多个一两个字符的文字项，按项数算会被它们淹没
      const inside = page.items.filter((it) => it.str.trim().length > 0 && centerIn(it, t))
      const chars = (list: TextItem[]): number => list.reduce((n, it) => n + it.str.replace(/\s/g, '').length, 0)
      const prose = chars(inside.filter((it) => !it.math && /[A-Za-z]{3,}/.test(it.str)))
      return inside.length === 0 || prose < chars(inside) * 0.4
    })
    for (const t of synthTables) expandTableRegion(t, page.items, detected)
    // 文字表里模型常另外标出几个 text 小区域，文字按「最小区域」归属会被它们抢走，
    // 变成横跨两栏的普通段落。确认是文字表的，里面的普通文字区域一律让位给表格统一拆格
    const textTables = detected.filter(
      (r) => r.label === 'table' && isTextTable(page.items.filter((it) => it.str.trim().length > 0 && centerIn(it, r)))
    )
    // 模型偶尔给同一块文字表再标一个同样大的 image 区域（ReAct 的 Table 6），文字会被图片框抢走，
    // 和文字表几乎重合（交并比 > 0.8）的图片框也让位
    const overlap = (a: LayoutRegion, b: LayoutRegion): number => {
      const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)
      const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1)
      const inter = w > 0 && h > 0 ? w * h : 0
      return inter / Math.max(1, regionArea(a) + regionArea(b) - inter)
    }
    const nestedInTextTable = (r: LayoutRegion): boolean =>
      r.label !== 'table' &&
      !HEADING.has(r.label) &&
      !EQUATION.has(r.label) &&
      textTables.some((t) => {
        if (FIGURE.has(r.label)) return overlap(r, t) > 0.8
        const cx = (r.x1 + r.x2) / 2
        const cy = (r.y1 + r.y2) / 2
        return cx >= t.x1 && cx <= t.x2 && cy >= t.y1 && cy <= t.y2 && regionArea(r) < regionArea(t)
      })
    const regions = mergeOverlappingText([...detected, ...synthTables].filter((r) => !nestedInTextTable(r)))
    // 分组候选：非丢弃、非行内公式类
    const grouping = regions.filter((r) => !DROP.has(r.label) && !NON_GROUPING.has(r.label))
    const dropped = regions.filter((r) => DROP.has(r.label))

    const inlineFormulas = regions.filter((r) => r.label === 'inline_formula')

    const buckets = new Map<LayoutRegion, TextItem[]>()
    for (const r of grouping) buckets.set(r, [])

    for (const item of page.items) {
      if (item.str.trim().length === 0) continue
      // 命中多个区域取面积最小者（正文大框里套小图题框时归小框）
      let best: LayoutRegion | null = null
      for (const r of grouping) {
        if (centerIn(item, r) && (!best || regionArea(r) < regionArea(best))) best = r
      }
      if (best) {
        buckets.get(best)!.push(item)
        continue
      }
      // 页眉页脚等丢弃区域内的文本直接扔掉；两不沾的散项也扔（多为渲染噪声）
      if (!dropped.some((r) => centerIn(item, r, 4))) {
        // 散项：并入最近的分组区域（中心距离 < 40pt），否则丢弃
        let nearest: LayoutRegion | null = null
        let nearestDist = 40
        const cx = item.x + item.width / 2
        const cy = item.y + item.fontSize / 2
        for (const r of grouping) {
          const dx = Math.max(r.x1 - cx, 0, cx - r.x2)
          const dy = Math.max(r.y1 - cy, 0, cy - r.y2)
          const dist = Math.hypot(dx, dy)
          if (dist < nearestDist) {
            nearestDist = dist
            nearest = r
          }
        }
        if (nearest) buckets.get(nearest)!.push(item)
      }
    }

    for (const r of grouping) {
      const items = buckets.get(r)!
      const text = textFromItems(items, page.page)
      const bbox = textBbox(r, items)

      if (HEADING.has(r.label)) {
        if (text.length === 0) continue
        // paragraph_title 误判过滤：真标题不会太长、不含邮箱/链接
        // （典型误判：通讯作者/资助声明等脚注文本）——降级为正文段落
        const fakeTitle =
          r.label === 'paragraph_title' && (text.length > 120 || /@|https?:\/\//.test(text))
        if (!fakeTitle) {
          const level = headingLevel(r.label, text)
          if (r.label === 'doc_title' && !title) title = text
          currentSection = text
          blocks.push({
            page: page.page,
            order: order++,
            kind: 'heading',
            section: currentSection,
            text,
            bbox,
            headingLevel: level,
            fontSize: medianFontSize(items)
          })
          continue
        }
        blocks.push({ ...paraWithInlines(r, items, inlineFormulas, page.page), page: page.page, order: order++, section: currentSection, bbox, fontSize: medianFontSize(items) })
        continue
      }

      // 模型把等宽排版的大段文字（ALFWorld 提示词、交互轨迹）标成 algorithm：
      // 这不是公式，按文字表逐段翻译；真正的伪代码 / 公式（带数学字体）照旧截图
      if (EQUATION.has(r.label) && isTextTable(items) && items.filter((it) => it.math).length <= items.length * 0.1) {
        for (const cell of splitTextTable(r, items, page.page)) {
          // 单元格是散文，不做行内公式替换：轨迹里行首的「>」会被当成数学符号换成截图
          const cellText = textFromItems(cell.items, page.page)
          if (!cellText) continue
          blocks.push({ kind: 'para', text: cellText, page: page.page, order: order++, section: currentSection, bbox: textBbox(cell.region, cell.items), fontSize: medianFontSize(cell.items), tableCell: true })
        }
        continue
      }

      if (EQUATION.has(r.label)) {
        // 无文本层的向量公式也必须显示；公式编号按自己的位置截图，不能混进下一段译文。
        blocks.push({ page: page.page, order: order++, kind: 'equation', section: currentSection, text: text || '[公式]', bbox: visualBbox(r, items), fontSize: medianFontSize(items) })
        continue
      }

      if (r.label === 'table' && isTextTable(items)) {
        for (const cell of splitTextTable(r, items, page.page)) {
          // 单元格是散文，不做行内公式替换：轨迹里行首的「>」会被当成数学符号换成截图
          const cellText = textFromItems(cell.items, page.page)
          if (!cellText) continue
          blocks.push({ kind: 'para', text: cellText, page: page.page, order: order++, section: currentSection, bbox: textBbox(cell.region, cell.items), fontSize: medianFontSize(cell.items), tableCell: true })
        }
        continue
      }

      if (FIGURE.has(r.label) || r.label === 'table') {
        // 图/表：文本多为坐标轴刻度等噪声，块占位以便将来按 bbox 截图嵌入。
        // 截图必须用完整区域框（文字边界会把图形部分裁掉）
        blocks.push({
          page: page.page,
          order: order++,
          kind: r.label === 'table' ? 'table' : 'figure',
          section: currentSection,
          text: text.length > 0 && text.length <= 200 ? text : r.label === 'table' ? '[表]' : '[图]',
          bbox: visualBbox(r, items)
        })
        continue
      }

      // 其余 text 系（abstract/text/content/reference/figure_title/footnote…）→ 段落
      if (text.length === 0) continue
      if (isChartNoise(text)) {
        // ML 漏检的图：刻度文字只是图形的零星散点，文字边界往往是一条扁带。
        // 纵向扩展到同栏上下相邻区域之间的空隙（上到上方区域下缘、下到下方
        // 区域上缘），把真正的图形捕进裁剪框
        const pad = 8
        const x1 = Math.max(0, bbox[0] - pad)
        let y1 = Math.max(0, bbox[1] - pad)
        const x2 = bbox[0] + bbox[2] + pad
        let y2 = bbox[1] + bbox[3] + pad
        const xOverlap = (o: LayoutRegion): number => {
          const w = Math.min(x2, o.x2) - Math.max(x1, o.x1)
          return w / Math.max(1, Math.min(x2 - x1, o.x2 - o.x1))
        }
        // 只认最近的上/下邻居，扩展量各限 400pt
        let above = Infinity
        let below = -Infinity
        for (const o of regions) {
          if (o === r || xOverlap(o) < 0.5) continue
          if (o.y1 >= y2) above = Math.min(above, o.y1)
          else if (o.y2 <= y1) below = Math.max(below, o.y2)
        }
        if (Number.isFinite(above)) y2 = Math.min(above - 4, y2 + 400)
        if (Number.isFinite(below)) y1 = Math.max(below + 4, y1 - 400)
        blocks.push({
          page: page.page,
          order: order++,
          kind: 'figure',
          section: currentSection,
          text: '[图]',
          bbox: [x1, y1, x2 - x1, y2 - y1]
        })
        continue
      }
      // 模型偶尔把相隔很远的两行框成一个区域（作者单位表里两条续行「Palaiseau, France」「Netherlands」
      // 相距 300pt 被框在一起）：整块 325pt 高，镜像页上把中间几十条全推开叠成一团。按大行距拆开
      for (const part of splitAtGaps(items)) {
        const sub: LayoutRegion = part === items ? r : { ...r, x1: Math.min(...part.map((i) => i.x)), x2: Math.max(...part.map((i) => i.x + i.width)), y1: Math.min(...part.map((i) => i.y)) - 2, y2: Math.max(...part.map((i) => i.y + i.fontSize)) + 2 }
        blocks.push({ ...paraWithInlines(sub, part, inlineFormulas, page.page), page: page.page, order: order++, section: currentSection, bbox: part === items ? bbox : textBbox(sub, part), fontSize: medianFontSize(part) })
      }
    }
  }

  // 逐页合并表格碎片（模型漏检 table 时的兜底）
  const byPage = new Map<number, ParsedBlock[]>()
  for (const b of blocks) {
    const arr = byPage.get(b.page)
    if (arr) arr.push(b)
    else byPage.set(b.page, [b])
  }
  const finalBlocks: ParsedBlock[] = []
  for (const [, pb] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    finalBlocks.push(...mergeTableFragments(pb))
  }
  blocks.length = 0
  blocks.push(...finalBlocks)

  const outline = blocks
    .filter((b) => b.kind === 'heading')
    .map((b) => ({ title: b.text, level: b.headingLevel ?? 1, page: b.page, order: b.order }))

  return { blocks, outline, title }
}
