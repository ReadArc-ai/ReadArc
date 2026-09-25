import { OPS, Util } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { BlockRow } from '../../shared/models'

export interface PdfRule {
  x: number
  /** PDF 坐标，原点在页左下角。 */
  y: number
  width: number
  thickness: number
}

/** PDF.js 的绘制路径包含原始包围框；只提取实际绘制的细水平线。 */
export function horizontalRules(ops: { fnArray: number[]; argsArray: unknown[] }): PdfRule[] {
  let matrix = [1, 0, 0, 1, 0, 0]
  let lineWidth = 1
  const stack: { matrix: number[]; lineWidth: number }[] = []
  const rules: PdfRule[] = []
  for (let i = 0; i < ops.fnArray.length; i++) {
    const op = ops.fnArray[i]
    const args = (ops.argsArray[i] ?? []) as unknown[]
    if (op === OPS.save || op === OPS.paintFormXObjectBegin) {
      stack.push({ matrix: [...matrix], lineWidth })
      if (op === OPS.paintFormXObjectBegin && Array.isArray(args[0])) matrix = Util.transform(matrix, args[0])
    } else if (op === OPS.restore || op === OPS.paintFormXObjectEnd) {
      const saved = stack.pop()
      if (saved) ({ matrix, lineWidth } = saved)
    } else if (op === OPS.transform) {
      matrix = Util.transform(matrix, args as number[])
    } else if (op === OPS.setLineWidth) {
      lineWidth = Number(args[0])
    } else if (op === OPS.setGState) {
      for (const [key, value] of args[0] as [string, unknown][]) {
        if (key === 'LW') lineWidth = Number(value)
      }
    } else if (op === OPS.constructPath) {
      const paint = args[0] as number
      const stroked = [OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].includes(paint)
      if (!stroked && paint !== OPS.fill && paint !== OPS.eoFill) continue
      const bounds = args[2] as ArrayLike<number> | undefined
      if (!bounds || bounds.length !== 4) continue
      const points = [[bounds[0], bounds[1]], [bounds[0], bounds[3]], [bounds[2], bounds[1]], [bounds[2], bounds[3]]]
        .map(([x, y]) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]])
      const xs = points.map((p) => p[0]), ys = points.map((p) => p[1])
      const x = Math.min(...xs), bottom = Math.min(...ys)
      const width = Math.max(...xs) - x, height = Math.max(...ys) - bottom
      const stroke = stroked ? lineWidth * Math.max(Math.hypot(matrix[0], matrix[1]), Math.hypot(matrix[2], matrix[3])) : 0
      const thickness = Math.max(0.25, height + stroke)
      if (width >= 20 && height <= 1 && thickness <= 2) rules.push({ x, y: bottom + height / 2, width, thickness })
    }
  }
  return rules
}

/** 仅绑定紧邻页下方脚注的原有横线，不凭空给普通段落画分隔线。 */
export function footnoteRules(blocks: BlockRow[], rules: PdfRule[], pageHeight: number): Map<string, PdfRule> {
  const matched = new Map<string, PdfRule>()
  for (const rule of rules) {
    if (rule.y > pageHeight * 0.4) continue
    const candidates = blocks.flatMap((b) => {
      if (b.kind !== 'para' || !b.bbox || !/^\s*(?:\^(?:\d+|[*†‡])\^|[¹²³⁴⁵⁶⁷⁸⁹⁰†‡*])/.test(b.text)) return []
      try {
        const [x, y, w, h] = JSON.parse(b.bbox) as number[]
        const gap = rule.y - (y + h)
        if (gap < 0 || gap > 14 || Math.abs(x - rule.x) > 30 || rule.x + rule.width > x + w + 30) return []
        return [{ b, gap }]
      } catch { return [] }
    }).sort((a, b) => a.gap - b.gap)
    const first = candidates[0]?.b
    if (first && !matched.has(first.block_id)) matched.set(first.block_id, rule)
  }
  return matched
}
