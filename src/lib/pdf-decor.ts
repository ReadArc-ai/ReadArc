import { OPS, Util } from 'pdfjs-dist/legacy/build/pdf.mjs'

/**
 * 原版页上的装饰：表格线、彩色底块、文字颜色。镜像译文页把它们画回去，
 * 译文才和原文一样有表格的横竖线、「Original」「Act」这类标签的彩色底，
 * 以及 WebShop 轨迹里按颜色区分的指令和按钮。坐标一律是 PDF 点，原点在页左下角。
 */
export interface PdfLine {
  x1: number
  y1: number
  x2: number
  y2: number
  thickness: number
  color: string
}

export interface PdfFill {
  x: number
  y: number
  width: number
  height: number
  color: string
}

/** 一次绘字（showText）：起点、终点横坐标、基线、颜色、字数 */
export interface PdfTextRun {
  x1: number
  x2: number
  y: number
  color: string
  chars: number
}

export interface PdfDecor {
  lines: PdfLine[]
  fills: PdfFill[]
  runs: PdfTextRun[]
}

const STROKES = new Set<number>([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke])
const FILLS = new Set<number>([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke])

/** 点经矩阵变换（pdf.js 6 的 Util.applyTransform 原地改数组、无返回值，这里另写一个） */
function apply(p: number[], m: number[]): [number, number] {
  return [p[0] * m[0] + p[1] * m[2] + m[4], p[0] * m[1] + p[1] * m[3] + m[5]]
}

function hexOf(args: unknown[]): string {
  const v = args[0]
  if (typeof v === 'string') return v.toLowerCase()
  if (typeof v === 'number') return `#${[v, args[1], args[2]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`
  return '#000000'
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** 接近白色：底块画了也看不出来，还会盖住别的装饰 */
function nearWhite(hex: string): boolean {
  const [r, g, b] = rgb(hex)
  return r > 240 && g > 240 && b > 240
}

/** 黑色和灰色算默认墨色：正文本来就是黑的，不用单独上色 */
export function isNeutralInk(hex: string): boolean {
  const [r, g, b] = rgb(hex)
  return Math.max(r, g, b) - Math.min(r, g, b) < 40
}

export function pageDecor(ops: { fnArray: number[]; argsArray: unknown[] }, page: { width: number; height: number }): PdfDecor {
  let ctm = [1, 0, 0, 1, 0, 0]
  let lineWidth = 1
  let fill = '#000000'
  let stroke = '#000000'
  let font = 10
  let charSpacing = 0
  let wordSpacing = 0
  let hScale = 1
  let leading = 0
  let tm = [1, 0, 0, 1, 0, 0]
  let tlm = [1, 0, 0, 1, 0, 0]
  // 裁剪范围（表单对象内容框、显式裁剪路径的外接框）：柱状图的柱子常画成很高的矩形再裁到坐标区里，
  // 不按裁剪收窄就会拿到一根根远超图框的「底块」，被当成装饰画到译文上
  let clip: { x1: number; y1: number; x2: number; y2: number } | null = null
  let pendingClip = false
  const clipTo = (b: { x1: number; y1: number; x2: number; y2: number }): void => {
    clip = clip ? { x1: Math.max(clip.x1, b.x1), y1: Math.max(clip.y1, b.y1), x2: Math.min(clip.x2, b.x2), y2: Math.min(clip.y2, b.y2) } : b
  }
  const rectOf = (m: number[], b: ArrayLike<number>): { x1: number; y1: number; x2: number; y2: number } => {
    const pts = [[b[0], b[1]], [b[0], b[3]], [b[2], b[1]], [b[2], b[3]]].map((p) => apply(p, m))
    return { x1: Math.min(...pts.map((p) => p[0])), y1: Math.min(...pts.map((p) => p[1])), x2: Math.max(...pts.map((p) => p[0])), y2: Math.max(...pts.map((p) => p[1])) }
  }
  const stack: { ctm: number[]; lineWidth: number; fill: string; stroke: string; clip: { x1: number; y1: number; x2: number; y2: number } | null }[] = []
  const lines: PdfLine[] = []
  const fills: PdfFill[] = []
  const runs: PdfTextRun[] = []
  const pageArea = page.width * page.height

  const moveText = (tx: number, ty: number): void => {
    tlm = Util.transform(tlm, [1, 0, 0, 1, tx, ty])
    tm = [...tlm]
  }

  for (let i = 0; i < ops.fnArray.length; i++) {
    const op = ops.fnArray[i]
    const args = (ops.argsArray[i] ?? []) as unknown[]
    switch (op) {
      case OPS.save:
      case OPS.paintFormXObjectBegin: {
        const cur = clip as { x1: number; y1: number; x2: number; y2: number } | null
        stack.push({ ctm: [...ctm], lineWidth, fill, stroke, clip: cur ? { ...cur } : null })
        if (op === OPS.paintFormXObjectBegin) {
          if (Array.isArray(args[0])) ctm = Util.transform(ctm, args[0] as number[])
          const bb = args[1] as ArrayLike<number> | null | undefined
          if (bb && bb.length === 4) clipTo(rectOf(ctm, bb))
        }
        break
      }
      case OPS.restore:
      case OPS.paintFormXObjectEnd: {
        const saved = stack.pop()
        if (saved) ({ ctm, lineWidth, fill, stroke, clip } = saved)
        break
      }
      case OPS.clip:
      case OPS.eoClip:
        pendingClip = true
        break
      case OPS.transform:
        ctm = Util.transform(ctm, args as number[])
        break
      case OPS.setLineWidth:
        lineWidth = Number(args[0])
        break
      case OPS.setGState:
        for (const [key, value] of (args[0] ?? []) as [string, unknown][]) if (key === 'LW') lineWidth = Number(value)
        break
      case OPS.setFillRGBColor:
        fill = hexOf(args)
        break
      case OPS.setStrokeRGBColor:
        stroke = hexOf(args)
        break
      case OPS.beginText:
        tm = [1, 0, 0, 1, 0, 0]
        tlm = [1, 0, 0, 1, 0, 0]
        break
      case OPS.setFont:
        font = Number(args[1]) || font
        break
      case OPS.setCharSpacing:
        charSpacing = Number(args[0]) || 0
        break
      case OPS.setWordSpacing:
        wordSpacing = Number(args[0]) || 0
        break
      case OPS.setHScale:
        hScale = (Number(args[0]) || 100) / 100
        break
      case OPS.setLeading:
        leading = Number(args[0]) || 0
        break
      case OPS.setTextMatrix: {
        // pdf.js 6 把矩阵整个包在第一个参数里：[[a, b, c, d, e, f]]
        const m = (Array.isArray(args[0]) || ArrayBuffer.isView(args[0]) ? args[0] : args) as ArrayLike<number>
        tm = Array.from(m).map(Number)
        tlm = [...tm]
        break
      }
      case OPS.moveText:
        moveText(Number(args[0]), Number(args[1]))
        break
      case OPS.setLeadingMoveText:
        leading = -Number(args[1])
        moveText(Number(args[0]), Number(args[1]))
        break
      case OPS.nextLine:
        moveText(0, -leading)
        break
      case OPS.showText:
      case OPS.showSpacedText:
      case OPS.nextLineShowText:
      case OPS.nextLineSetSpacingShowText: {
        if (op === OPS.nextLineShowText || op === OPS.nextLineSetSpacingShowText) moveText(0, -leading)
        const glyphs = (args[0] ?? []) as unknown[]
        // 起点：当前文本矩阵原点经 CTM 换到页面坐标；推进量按字宽、字距、词距、水平缩放累加
        const start = apply([0, 0], Util.transform(ctm, tm))
        let advance = 0
        let chars = 0
        for (const g of glyphs) {
          if (typeof g === 'number') advance -= (g / 1000) * font * hScale
          else if (g && typeof g === 'object') {
            const glyph = g as { width?: number; isSpace?: boolean; unicode?: string }
            advance += (((glyph.width ?? 0) / 1000) * font + charSpacing + (glyph.isSpace ? wordSpacing : 0)) * hScale
            if (glyph.unicode && glyph.unicode.trim()) chars++
          }
        }
        tm = Util.transform(tm, [1, 0, 0, 1, advance, 0])
        const end = apply([0, 0], Util.transform(ctm, tm))
        if (chars > 0) runs.push({ x1: Math.min(start[0], end[0]), x2: Math.max(start[0], end[0]), y: start[1], color: fill, chars })
        break
      }
      case OPS.constructPath: {
        const paint = args[0] as number
        const bounds = args[2] as ArrayLike<number> | undefined
        if (pendingClip) {
          if (bounds && bounds.length === 4) clipTo(rectOf(ctm, bounds))
          pendingClip = false
        }
        const stroked = STROKES.has(paint)
        const filled = FILLS.has(paint)
        if (!stroked && !filled) break
        if (!bounds || bounds.length !== 4) break
        // 画出来的部分 = 路径外接框 ∩ 当前裁剪范围；全被裁掉的不算
        const r = rectOf(ctm, bounds)
        const c = clip as { x1: number; y1: number; x2: number; y2: number } | null
        const x = c ? Math.max(r.x1, c.x1) : r.x1
        const y = c ? Math.max(r.y1, c.y1) : r.y1
        const w = (c ? Math.min(r.x2, c.x2) : r.x2) - x
        const h = (c ? Math.min(r.y2, c.y2) : r.y2) - y
        if (w < 0 || h < 0) break
        const scale = Math.max(Math.hypot(ctm[0], ctm[1]), Math.hypot(ctm[2], ctm[3]))
        const color = stroked ? stroke : fill
        const weight = Math.max(0.3, stroked ? lineWidth * scale : 0)
        if (h <= 2 && w >= 8) {
          lines.push({ x1: x, y1: y + h / 2, x2: x + w, y2: y + h / 2, thickness: Math.max(weight, h), color })
        } else if (w <= 2 && h >= 8) {
          lines.push({ x1: x + w / 2, y1: y, x2: x + w / 2, y2: y + h, thickness: Math.max(weight, w), color })
        } else if (filled && !nearWhite(fill) && w >= 3 && h >= 3 && w * h < pageArea * 0.4) {
          fills.push({ x, y, width: w, height: h, color: fill })
        }
        break
      }
    }
  }
  return { lines, fills, runs }
}

/** 一块文字的主色：框内绘字按字数加权，非黑非灰且占六成以上才算；否则用默认墨色 */
export function dominantInk(runs: PdfTextRun[], bbox: [number, number, number, number]): string | null {
  const [x, y, w, h] = bbox
  const tally = new Map<string, number>()
  let total = 0
  for (const r of runs) {
    const cx = (r.x1 + r.x2) / 2
    if (cx < x - 1 || cx > x + w + 1 || r.y < y - 2 || r.y > y + h + 1) continue
    tally.set(r.color, (tally.get(r.color) ?? 0) + r.chars)
    total += r.chars
  }
  if (total === 0) return null
  const [color, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
  return !isNeutralInk(color) && n >= total * 0.6 ? color : null
}

/**
 * 夜间纸面把原文页做了 invert(0.9) hue-rotate(180deg)；彩色译文按同一套颜色矩阵换算，
 * 两边看起来一致（深蓝字在深色纸上变成浅蓝）。
 */
export function paperDarkInk(hex: string): string {
  const inv = rgb(hex).map((c) => 0.9 * (255 - c) + 0.1 * c)
  const m = [
    [-0.574, 1.43, 0.144],
    [0.426, 0.43, 0.144],
    [0.426, 1.43, -0.856]
  ]
  const out = m.map((row) => Math.round(Math.min(255, Math.max(0, row[0] * inv[0] + row[1] * inv[1] + row[2] * inv[2]))))
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}
