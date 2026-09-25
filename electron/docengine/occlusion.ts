/**
 * 被遮住的文字：有的 PDF 在图下面压着一行字（Attention 论文第 13 页，图的原始标题「Input-Input Layer5」
 * 被后画的注意力图盖住，页面上只看得见「Attention Visualizations」）。文本层照样把它吐出来，
 * 和看得见的标题叠在一起被拼成一段，译文页上就出现了原文页上根本看不见的字。
 *
 * 只处理「两段不同的文字在同一位置叠在一起」这种情况：按绘制顺序看其中哪一段之后被不透明的图片
 * 或白色填充盖住，盖住的那段丢掉。没有叠字的页面不读绘制指令，也不会误删半透明图层下面的正文。
 */
import { OPS, Util } from 'pdfjs-dist/legacy/build/pdf.mjs'

export interface Box {
  x1: number
  y1: number
  x2: number
  y2: number
}

interface TextLike {
  str: string
  x: number
  y: number
  width: number
  fontSize: number
}

function area(b: Box): number {
  return Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1)
}

function inter(a: Box, b: Box): number {
  return area({ x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), x2: Math.min(a.x2, b.x2), y2: Math.min(a.y2, b.y2) })
}

const boxOf = (it: TextLike): Box => ({ x1: it.x, y1: it.y, x2: it.x + it.width, y2: it.y + it.fontSize })

/** 互相叠着的不同文字（各至少 3 个字符、交叠超过较小者的四成）：这些才需要查谁被盖住 */
export function collidingTexts<T extends TextLike>(items: T[]): Set<T> {
  const out = new Set<T>()
  const cand = items.filter((it) => it.str.trim().length >= 3 && it.width > 0)
  for (let i = 0; i < cand.length; i++) {
    for (let j = i + 1; j < cand.length; j++) {
      const a = cand[i]
      const b = cand[j]
      if (a.str.trim() === b.str.trim()) continue // 同样的字重叠画两遍是模拟加粗
      const ba = boxOf(a)
      const bb = boxOf(b)
      if (inter(ba, bb) > Math.min(area(ba), area(bb)) * 0.4) {
        out.add(a)
        out.add(b)
      }
    }
  }
  return out
}

/** 一次绘字的起点与之后被不透明绘制盖住的区域（按绘制顺序） */
interface Paint {
  index: number
  box: Box
}

function apply(p: number[], m: number[]): [number, number] {
  return [p[0] * m[0] + p[1] * m[2] + m[4], p[0] * m[1] + p[1] * m[3] + m[5]]
}

function rectOf(m: number[], x1: number, y1: number, x2: number, y2: number): Box {
  const pts = [apply([x1, y1], m), apply([x1, y2], m), apply([x2, y1], m), apply([x2, y2], m)]
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }
}

/**
 * 从绘制指令里找出看不见的文字位置，分两类：
 * - clipped：起点落在当前裁剪范围外（表单对象声明的内容框、显式裁剪路径）。这一定看不见——
 *   Attention 第 13 页那行字就是写在图的表单对象内容框（高 194）之外的 y=217 处
 * - covered：之后画的图片或白色填充盖住了起点。图片可能半透明，只在叠字时用来判定
 */
export function hiddenTextOrigins(ops: { fnArray: number[]; argsArray: unknown[] }): {
  clipped: { x: number; y: number }[]
  covered: { x: number; y: number }[]
} {
  let ctm = [1, 0, 0, 1, 0, 0]
  let clip: Box | null = null
  let pendingClip = false
  let tm = [1, 0, 0, 1, 0, 0]
  let tlm = [1, 0, 0, 1, 0, 0]
  let leading = 0
  let fill = '#000000'
  const stack: { ctm: number[]; fill: string; clip: Box | null }[] = []
  const texts: { index: number; x: number; y: number; clipped: boolean }[] = []
  const clipTo = (b: Box): void => {
    clip = clip ? { x1: Math.max(clip.x1, b.x1), y1: Math.max(clip.y1, b.y1), x2: Math.min(clip.x2, b.x2), y2: Math.min(clip.y2, b.y2) } : b
  }
  const covers: Paint[] = []
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
        stack.push({ ctm: [...ctm], fill, clip: clip ? { ...clip } : null })
        if (op === OPS.paintFormXObjectBegin) {
          if (Array.isArray(args[0])) ctm = Util.transform(ctm, args[0] as number[])
          // 表单对象的内容框就是它的裁剪范围
          const bb = args[1] as ArrayLike<number> | null | undefined
          if (bb && bb.length === 4) clipTo(rectOf(ctm, bb[0], bb[1], bb[2], bb[3]))
        }
        break
      }
      case OPS.restore:
      case OPS.paintFormXObjectEnd: {
        const s = stack.pop()
        if (s) ({ ctm, fill, clip } = s)
        break
      }
      case OPS.clip:
      case OPS.eoClip:
        pendingClip = true
        break
      case OPS.transform:
        ctm = Util.transform(ctm, args as number[])
        break
      case OPS.setFillRGBColor:
        fill = typeof args[0] === 'string' ? args[0].toLowerCase() : fill
        break
      case OPS.beginText:
        tm = [1, 0, 0, 1, 0, 0]
        tlm = [1, 0, 0, 1, 0, 0]
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
        const [x, y] = apply([0, 0], Util.transform(ctm, tm))
        const c = clip as Box | null
        texts.push({ index: i, x, y, clipped: !!c && (x < c.x1 - 2 || x > c.x2 + 2 || y < c.y1 - 2 || y > c.y2 + 2) })
        break
      }
      // 图片按单位正方形经 CTM 变换后的外接框算覆盖范围
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject:
      case OPS.paintImageXObjectRepeat:
        covers.push({ index: i, box: rectOf(ctm, 0, 0, 1, 1) })
        break
      case OPS.constructPath: {
        const paint = args[0] as number
        if (pendingClip) {
          const cb = args[2] as ArrayLike<number> | undefined
          if (cb && cb.length === 4) clipTo(rectOf(ctm, cb[0], cb[1], cb[2], cb[3]))
          pendingClip = false
        }
        if ((paint === OPS.fill || paint === OPS.eoFill) && /^#f[a-f0-9]f[a-f0-9]f[a-f0-9]$/.test(fill)) {
          const b = args[2] as ArrayLike<number> | undefined
          if (b && b.length === 4) covers.push({ index: i, box: rectOf(ctm, b[0], b[1], b[2], b[3]) })
        }
        break
      }
    }
  }
  return {
    clipped: texts.filter((t) => t.clipped).map((t) => ({ x: t.x, y: t.y })),
    covered: texts
      .filter((t) => covers.some((c) => c.index > t.index && t.x >= c.box.x1 - 1 && t.x <= c.box.x2 + 1 && t.y >= c.box.y1 - 1 && t.y <= c.box.y2 + 1))
      .map((t) => ({ x: t.x, y: t.y }))
  }
}

const at = (o: { x: number; y: number }, it: TextLike): boolean => Math.abs(o.x - it.x) <= 2 && Math.abs(o.y - it.y) <= 2

/** 看不见的文字项：被裁掉的一律算；被盖住的只在它和别的文字叠在一起时才算（起点 ±2pt 对上就是同一次绘字） */
export function hiddenItems<T extends TextLike>(
  items: T[],
  colliding: Set<T>,
  origins: { clipped: { x: number; y: number }[]; covered: { x: number; y: number }[] }
): Set<T> {
  const hidden = new Set<T>()
  for (const it of items) {
    if (origins.clipped.some((o) => at(o, it))) hidden.add(it)
    else if (colliding.has(it) && origins.covered.some((o) => at(o, it))) hidden.add(it)
  }
  return hidden
}
