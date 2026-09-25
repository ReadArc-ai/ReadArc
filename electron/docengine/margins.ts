/**
 * 页边块：页眉页脚、页码、侧边水印（arXiv 编号那一列）。
 * 解析器把它们从正文流里剔掉是对的（混进段落会污染译文），但镜像页上少了它们就不像原版了，
 * 所以在正文块定下来之后再作为 kind='margin' 补回来：不翻译、不进目录、不计入未译数，
 * 镜像页按原位原文摆出来（竖排的照样竖排）。
 * 来源两处：① 页面上下边缘、没被任何正文块盖住的横排文本行；② 提取时单独收起来的旋转文本。
 */
import { linesFromItems, type PageItems, type ParsedBlock, type TextItem } from './layout'

/** 只需要页码与外接框：导入时是 ParsedBlock，给老论文补块时是库里的行 */
export interface Covering {
  page: number
  bbox: [number, number, number, number] | null
}

/** 上下各这么高的页面比例算页边 */
const EDGE = 0.085

function covered(it: TextItem, boxes: [number, number, number, number][]): boolean {
  const cx = it.x + it.width / 2
  const cy = it.y + it.fontSize * 0.35
  return boxes.some(([x, y, w, h]) => cx >= x - 2 && cx <= x + w + 2 && cy >= y - 2 && cy <= y + h + 2)
}

/** 旋转项的几何中心是否落在某个块框里（旋转项的 height 是文字延伸方向的长度） */
function coveredRotated(it: TextItem, boxes: [number, number, number, number][]): boolean {
  const cx = it.x + it.width / 2
  const cy = it.y + it.height / 2
  return boxes.some(([x, y, w, h]) => cx >= x - 2 && cx <= x + w + 2 && cy >= y - 2 && cy <= y + h + 2)
}

/** 旋转文本按列聚类（同一转向、x 相近），列内按阅读方向排序 */
function rotatedColumns(items: TextItem[]): TextItem[][] {
  const cols: TextItem[][] = []
  for (const it of [...items].sort((a, b) => a.x - b.x)) {
    const col = cols.find(
      (c) =>
        Math.abs(c[0].x - it.x) < Math.max(c[0].fontSize, it.fontSize) * 1.5 &&
        Math.sign(c[0].angle ?? 0) === Math.sign(it.angle ?? 0)
    )
    if (col) col.push(it)
    else cols.push([it])
  }
  for (const col of cols) {
    // 逆时针转 90°（arXiv 水印）自下而上读：y 升序；顺时针的反之
    const up = (col[0].angle ?? 0) > 0
    col.sort((a, b) => (up ? a.y - b.y : b.y - a.y))
  }
  return cols
}

function joinColumn(col: TextItem[]): string {
  const up = (col[0].angle ?? 0) > 0
  let text = ''
  for (let i = 0; i < col.length; i++) {
    const it = col[i]
    if (i > 0) {
      const prev = col[i - 1]
      const gap = up ? it.y - (prev.y + prev.height) : prev.y - (it.y + it.height)
      if (gap > it.fontSize * 0.25 && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' '
    }
    text += it.str
  }
  return text.replace(/\s+/g, ' ').trim()
}

export function marginBlocks(pages: PageItems[], blocks: Covering[], startOrder: number): ParsedBlock[] {
  const out: ParsedBlock[] = []
  let order = startOrder
  for (const page of pages) {
    const boxes = blocks.filter((b) => b.page === page.page && b.bbox).map((b) => b.bbox!)
    const top = page.height * (1 - EDGE)
    const bottom = page.height * EDGE
    const edgeItems = page.items.filter((it) => (it.y >= top || it.y <= bottom) && !covered(it, boxes))
    for (const line of linesFromItems(edgeItems, page.page)) {
      const text = line.text.replace(/\s+/g, ' ').trim()
      if (!text || !/[\p{L}\p{N}]/u.test(text)) continue
      out.push({
        page: page.page,
        order: order++,
        kind: 'margin',
        section: null,
        text,
        bbox: [line.x, line.y - line.fontSize * 0.25, line.width, line.fontSize * 1.2],
        fontSize: line.fontSize
      })
    }
    for (const col of rotatedColumns(page.rotated ?? [])) {
      // 落在图/表块里的竖排文字是坐标轴标签（「HotpotQA EM」），图已经整块截图，
      // 再当页边块按原位画一遍就和截图里的字叠在一起
      const inFigure = col.filter((it) => coveredRotated(it, boxes)).length * 2 > col.length
      if (inFigure) continue
      const text = joinColumn(col)
      if (!text || !/[\p{L}\p{N}]/u.test(text)) continue
      const x = Math.min(...col.map((c) => c.x))
      const y = Math.min(...col.map((c) => c.y))
      const fs = [...col.map((c) => c.fontSize)].sort((a, b) => a - b)
      out.push({
        page: page.page,
        order: order++,
        kind: 'margin',
        section: null,
        text,
        bbox: [x, y, Math.max(...col.map((c) => c.x + c.width)) - x, Math.max(...col.map((c) => c.y + c.height)) - y],
        fontSize: fs[Math.floor(fs.length / 2)]
      })
    }
  }
  return out
}

/**
 * 漏网文字：正文块、图表块、页边块都定下来之后，页面上仍没被任何块盖住的横排文字。
 * 版面模型偶尔丢掉整个区域（首页右上角的报告编号与日期、续页表头「Continued from previous page」、
 * 图上方的小标题、落在图框外的坐标刻度），这些字在原文页上看得见，译文页上却凭空消失——
 * 按行距聚成段、作为普通段落补回原位：散文照常翻译，纯数字 / 编号原样显示。
 */
export function orphanBlocks(pages: PageItems[], blocks: Covering[], startOrder: number): ParsedBlock[] {
  const out: ParsedBlock[] = []
  let order = startOrder
  for (const page of pages) {
    const boxes = blocks.filter((b) => b.page === page.page && b.bbox).map((b) => b.bbox!)
    const items = page.items.filter((it) => it.str.trim().length > 0 && !covered(it, boxes))
    if (items.length === 0) continue
    // 行自上而下；行距正常、横向有重叠的相邻行并成一段
    const lines = linesFromItems(items, page.page)
      .filter((l) => l.text.trim().length > 0)
      .sort((a, b) => b.y - a.y || a.x - b.x)
    const groups: (typeof lines)[] = []
    for (const l of lines) {
      const g = groups.find((grp) => {
        const last = grp[grp.length - 1]
        const overlap = Math.min(last.x + last.width, l.x + l.width) - Math.max(last.x, l.x)
        return last.y - l.y > 0 && last.y - l.y <= Math.max(last.fontSize, l.fontSize) * 1.6 && overlap > 0
      })
      if (g) g.push(l)
      else groups.push([l])
    }
    for (const g of groups) {
      const text = g.map((l) => l.text.trim()).join(' ').replace(/\s+/g, ' ').trim()
      if (!text || !/[\p{L}\p{N}]/u.test(text)) continue
      const x = Math.min(...g.map((l) => l.x))
      const fs = [...g.map((l) => l.fontSize)].sort((a, b) => a - b)[Math.floor(g.length / 2)]
      const y = Math.min(...g.map((l) => l.y)) - fs * 0.25
      out.push({
        page: page.page,
        order: order++,
        kind: 'para',
        section: null,
        text,
        bbox: [x, y, Math.max(...g.map((l) => l.x + l.width)) - x, Math.max(...g.map((l) => l.y + l.fontSize)) - y],
        fontSize: fs,
        tableCell: true
      })
    }
  }
  return out
}
