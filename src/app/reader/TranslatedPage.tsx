/** 镜像译文页：按原版块位置排版译文，公式 / 图表用原图，页边块另排 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { horizontalRules, footnoteRules, type PdfRule } from '../../lib/pdf-rules'
import { dominantInk, pageDecor, paperDarkInk, type PdfDecor } from '../../lib/pdf-decor'
import { useT } from '../../i18n'
import type { BlockRow } from '../../../shared/models'
import { useApp } from '../../store/app'
import { usePaper } from '../../store/paper'
import { useNotes } from '../../store/notes'
import { useFigureSrc } from '../../lib/use-figure'
import { buildLine, inkRuns, inkXForChar, pickToken, tokenize, wordWithinToken, type Run } from '../../lib/word-select'
import { parseBbox, sharedTokens, rangeFromTokens, snapToSentenceStart, snapToSentenceEnd, renderInline, isBodyPara, isCenteredHeading, type InlineCtx } from './page-text'
import { parseInlines, placeholdersMatch, repairPlaceholders } from '../../../shared/inline-formula'
import { PageInfo } from './PdfPage'


export function FitBlock({
  block,
  pageWidth,
  ptScale,
  commonSize,
  onFit,
  onNeed,
  zhScale = 1,
  slotH = 0,
  ink,
  floorScale = 1
}: {
  block: BlockRow
  pageWidth: number
  ptScale: number
  /** 同页正文统一字号（各块拟合值的最小值）；null = 尚未汇总 */
  commonSize?: number | null
  onFit?: (id: string, size: number) => void
  /** 按下限字号排版至少需要多高（pt）；页面据此把槽位撑高，不再把译文裁掉 */
  onNeed?: (id: string, pt: number | null) => void
  /** 用户的译文字号偏好（1 = 原文字号 × 1.08） */
  zhScale?: number
  /** 当前槽位高度（pt）：槽位被撑高后要重新拟合，所以进依赖 */
  slotH?: number
  /** 原文这段的主色（非黑）：译文用同样的颜色 */
  ink?: string | null
  /** 整页放不下时页面把字号下限整体往下调的比例（1 = 不调） */
  floorScale?: number
}): JSX.Element {
  const t = useT()
  const state = usePaper((s) => s.translations[block.block_id])
  const notes = useNotes((s) => s.byPaper[block.paper_id])
  const ref = useRef<HTMLDivElement | null>(null)
  // 行内公式截图是异步加载的：图片到了才占出实际宽高，之前按空位量的字号和高度会偏小，
  // 最后一行被 overflow:hidden 裁掉。图片加载完成（成功或失败）后重新拟合一次
  const [imgTick, setImgTick] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const bump = (e: Event): void => {
      if (e.target instanceof HTMLImageElement) setImgTick((n) => n + 1)
    }
    el.addEventListener('load', bump, true)
    el.addEventListener('error', bump, true)
    return () => {
      el.removeEventListener('load', bump, true)
      el.removeEventListener('error', bump, true)
    }
  }, [])
  // 旧缓存里可能有占位符对不上的译文（翻译端加校验之前存下的）：显示时补齐，
  // 公式宁可挪到句末也不能从译文里消失，编出来的序号也不显示
  const zh = state?.text != null && !placeholdersMatch(block.text, state.text) ? repairPlaceholders(block.text, state.text) : state?.text
  const text = zh ?? block.text
  // 行内公式截图的取图键与尺寸换算依据；没有公式的块不建
  const inlineCtx = useMemo<InlineCtx | undefined>(() => {
    const inlines = parseInlines(block.inlines)
    if (inlines.length === 0) return undefined
    return { paperId: block.paper_id, blockId: block.block_id, inlines, fontSize: block.font_size }
  }, [block.inlines, block.paper_id, block.block_id, block.font_size])

  const marks = useMemo(() => {
    const out: { id: string; s: number; e: number }[] = []
    const srcLen = block.text.length || 1
    for (const [id, a] of Object.entries(notes?.highlights ?? {})) {
      if (a.block_id !== block.block_id) continue
      let s: number
      let e: number
      if (!zh) {
        s = a.char_start
        e = a.char_end
      } else {
        // ① 摘录直接定位：译文里划的高亮，选区原文就在 excerpt 里——零误差还原
        const idx = a.excerpt ? text.indexOf(a.excerpt) : -1
        if (idx >= 0) {
          s = idx
          e = idx + a.excerpt.length
          // excerpt 截断过（160 上限）则补齐到句尾
          if (a.excerpt.length >= 160) e = snapToSentenceEnd(text, e)
        } else {
          // ② 跨语言（原版页划的英文高亮）：先用共享词元（数字/术语）锚定，
          //    锚不到再退占比投影；两者都句读对齐
          const center = ((a.char_start + a.char_end) / 2 / srcLen) * text.length
          const tok = rangeFromTokens(text, sharedTokens(block.text.slice(a.char_start, a.char_end)), center)
          if (tok) {
            s = snapToSentenceStart(text, tok[0])
            e = snapToSentenceEnd(text, tok[1])
          } else {
            s = snapToSentenceStart(text, Math.floor((a.char_start / srcLen) * text.length))
            e = snapToSentenceEnd(text, Math.ceil((a.char_end / srcLen) * text.length))
          }
        }
      }
      s = Math.max(0, Math.min(s, text.length))
      e = Math.max(s, Math.min(e, text.length))
      if (e > s) out.push({ id, s, e })
    }
    return out.sort((a, b) => a.s - b.s)
  }, [notes, block, zh, text])

  const content = useMemo(() => {
    if (marks.length === 0) return renderInline(text, block.block_id, inlineCtx)
    const parts: (string | JSX.Element)[] = []
    let pos = 0
    for (const m of marks) {
      if (m.s < pos) continue // 重叠区间跳过
      if (m.s > pos) parts.push(...renderInline(text.slice(pos, m.s), `${block.block_id}:${pos}`, inlineCtx))
      parts.push(
        <mark
          key={`${m.id}:${m.s}`}
          className="tp-mark"
          title={t('sel.remove-highlight')}
          onClick={(ev) => {
            ev.stopPropagation()
            void useNotes.getState().removeHighlight(m.id)
          }}
        >
          {renderInline(text.slice(m.s, m.e), `${block.block_id}:mk${m.s}`, inlineCtx)}
        </mark>
      )
      pos = m.e
    }
    parts.push(...renderInline(text.slice(pos), `${block.block_id}:${pos}`, inlineCtx))
    return parts
  }, [marks, text, block.block_id, t, inlineCtx])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // 起步字号：优先用解析记录的原始字号 × 页面缩放（中文略放大 1.08 更易读），
    // 忠实还原原文的字体层级——脚注小、正文中、标题大；旧数据退回启发式
    let size: number
    // 各种像素下限跟着页面缩放走：页面按原大或更大显示时就是 5px；窗口窄、两侧面板打开时页面只有
    // 三百多像素宽，原文换算下来才 4px 左右，固定的 5px 下限会让译文比原文还大、整页被撑长错位
    const minPx = 5 * Math.min(1, ptScale > 0 ? ptScale : 1)
    if (block.font_size && ptScale > 0) {
      size = Math.max(minPx, Math.min(26 * zhScale, block.font_size * ptScale * 1.08 * zhScale))
    } else {
      const titleLike = block.kind === 'heading' && text.length <= 30
      size = (titleLike ? Math.max(9, Math.min(20, el.clientHeight * 0.8)) : 12) * zhScale
    }
    // 字号下限：起步字号的 80%——再往下就看不清了。下限也放不下的部分不再裁掉，
    // 而是报「至少需要多高」让槽位长高（页面随之变长）。按下限量出的高度只取决于
    // 槽宽与文字，与槽位当前高度无关，所以撑高后重新拟合不会来回抖
    // 字号下限：起步字号的 80%，不低于 minPx。整页排不下时（表格页几十个小格累加）按页统一往下调，
    // 先保证和原文页等高对齐
    const base = Math.min(size, Math.max(minPx, size * 0.8))
    const floor = floorScale < 1 ? Math.max(Math.min(3.5, minPx * 0.7), base * floorScale) : base
    el.style.fontSize = `${floor}px`
    // 量内容高度时把块高放开：scrollHeight 不会小于 clientHeight，槽位撑高后再量
    // 会把槽高本身量进去，每轮多出 2pt 的内边距就会无限长高
    el.style.height = 'auto'
    const needPx = el.offsetHeight
    el.style.height = ''
    onNeed?.(block.block_id, ptScale > 0 ? needPx / ptScale + 2 : null)
    el.style.fontSize = `${size}px`
    // 收缩到不溢出（高度或宽度）。二分而非逐步缩小：每次改字号再读
    // scrollHeight 都是一次强制同步布局，线性 40 步在整页挂载时会堆成长任务
    const overflows = (): boolean =>
      el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1
    if (overflows()) {
      let lo = floor
      let hi = size
      for (let i = 0; i < 6 && hi - lo > 0.3; i++) {
        const mid = (lo + hi) / 2
        el.style.fontSize = `${mid}px`
        if (!overflows()) lo = mid
        else hi = mid
      }
      size = lo
      el.style.fontSize = `${size}px`
    }
    // 页级归一：正文段统一采用同页各块拟合值的最小值，消除"一会大一会小"。
    // 拟合值 ≥8px 才参与汇总（病态小槽不拖垮整页）
    if (isBodyPara(block)) {
      if (size >= 8) onFit?.(block.block_id, size)
      if (commonSize != null && commonSize < size) {
        el.style.fontSize = `${commonSize}px`
      }
    }
  }, [text, block, ptScale, commonSize, onFit, onNeed, zhScale, slotH, floorScale, imgTick])

  const centered = isCenteredHeading(block, pageWidth)
  return (
    <div
      ref={ref}
      className={`tp-block${block.kind === 'heading' ? ' tp-block--heading' : ''}${
        centered ? ' tp-block--centered' : ''
      }${state?.pending ? ' tp-block--pending' : ''}${!state?.text ? ' tp-block--orig' : ''}`}
      data-order={block.block_order}
      title={state?.error ?? undefined}
      style={ink ? { color: ink } : undefined}
    >
      {content}
    </div>
  )
}

/* ---- 双击选词：pdf.js 文本层把单词任意拆进多个 span（"De|tectRL"），
   浏览器原生双击只在单 span 内选，选出的是碎片。跨相邻 span 扩展到整词。 ---- */
/**
 * 双击选词。透明文本层的字符坐标带漂移（回退字体字宽不同，整行按总宽缩放后中段能偏出好几个字母），
 * 用浏览器原生的双击选区当结果，选中的词与高亮位置都会错。这里改成：
 * 原生选区只用来认「点在哪一行」，然后扫这一行画布上的墨迹段，点击落在哪段就是哪个词
 * （段数与词数相等时一一对应，不等时按墨迹宽度比例映射），DOM 选区按这个词重建，高亮按墨迹段画。
 */
export function selectWordAtPoint(clientX: number): void {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const r0 = sel.getRangeAt(0)
  const anchorNode = r0.startContainer
  const anchorEl = (anchorNode.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : (anchorNode as Element)) as HTMLElement | null
  const layer = anchorEl?.closest('.textLayer') as HTMLElement | null
  const pageEl = layer?.closest('.pdf-page') as HTMLElement | null
  const canvas = pageEl?.querySelector('canvas')
  if (!anchorEl || !layer || !pageEl || !canvas) return
  if (anchorEl.style.getPropertyValue('--rotate') && anchorEl.style.getPropertyValue('--rotate') !== '0deg') return
  const ar = anchorEl.getBoundingClientRect()
  if (ar.width <= 0 || ar.height <= 0) return

  // 这一行：同层里与锚 span 垂直重叠过半、字号相近的 span，按左边排
  const fontPx = parseFloat(getComputedStyle(anchorEl).fontSize) || 12
  const spans = [...layer.querySelectorAll<HTMLElement>('span')]
    .filter((el) => el.firstChild?.nodeType === Node.TEXT_NODE && (el.textContent ?? '').trim().length > 0)
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ el, r }) => {
      if (r.width <= 0) return false
      const ov = Math.min(ar.bottom, r.bottom) - Math.max(ar.top, r.top)
      if (ov < Math.min(ar.height, r.height) * 0.5) return false
      const f = parseFloat(getComputedStyle(el).fontSize) || fontPx
      return Math.abs(f - fontPx) <= fontPx * 0.35 // 上标 / 脚注号不算同一行的正文
    })
    .sort((x, y) => x.r.left - y.r.left)
  if (spans.length === 0) return
  const segs = spans.map(({ el, r }, i) => {
    const prev = spans[i - 1]
    // 与前一段字形紧挨（间隙 ≈0）视为同一个词被拆开
    const glued = !!prev && r.left - prev.r.right > -2 && r.left - prev.r.right < Math.max(2, fontPx * 0.12)
    return { text: el.textContent ?? '', glued, node: el.firstChild as Text }
  })
  const line = buildLine(segs)
  const tokens = tokenize(line.text)
  if (tokens.length === 0) return

  // 扫这一行画布的墨迹列
  const cr = canvas.getBoundingClientRect()
  if (cr.width <= 0) return
  const sx = canvas.width / cr.width
  const sy = canvas.height / cr.height
  const left = spans[0].r.left
  const right = spans[spans.length - 1].r.right
  const x0 = Math.max(0, Math.round((left - 4 - cr.left) * sx))
  const x1 = Math.min(canvas.width, Math.round((right + 4 - cr.left) * sx))
  const y0 = Math.max(0, Math.round((ar.top - cr.top) * sy))
  const y1 = Math.min(canvas.height, Math.round((ar.bottom - cr.top) * sy))
  if (x1 - x0 < 4 || y1 - y0 < 2) return
  let runs: Run[]
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0)
    const W = x1 - x0
    const col = new Uint16Array(W)
    // 「墨迹」= 不是纸面底色：够暗，或者是彩色（红色版权声明、蓝色引用链接只看红通道会漏掉）
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        const r = img.data[i]
        const g = img.data[i + 1]
        const b = img.data[i + 2]
        if (img.data[i + 3] < 100) continue
        const lum = 0.299 * r + 0.587 * g + 0.114 * b
        const sat = Math.max(r, g, b) - Math.min(r, g, b)
        if (lum < 170 || sat > 70) col[x]++
      }
    // 间隙 ≥ max(2.5cssPx, 0.16×字号) 视为词间空隙
    runs = inkRuns(col, Math.max(2.5, fontPx * 0.16) * sx)
  } catch {
    return // 画布不可读：留给原生选区
  }
  const clickX = (clientX - cr.left) * sx - x0
  const picked = pickToken(tokens, runs, clickX)
  if (!picked) return
  const tok = tokens[picked.tokenIdx]
  const word = wordWithinToken(line.text, tok, picked.frac)
  if (!word) return

  // 行文本区间 → DOM 文本节点区间（补出来的空格不会落在词里）
  const from = line.map[word.s]
  const to = line.map[word.e - 1]
  if (!from || !to || from.seg < 0 || to.seg < 0) return
  const range = document.createRange()
  range.setStart(segs[from.seg].node, from.off)
  range.setEnd(segs[to.seg].node, to.off + 1)
  sel.removeAllRanges()
  sel.addRange(range)

  // 高亮按墨迹画。段数与词数相等时就用这一段（词只是 token 的一部分时按字符占比细分）；
  // 小字号下整行可能并成一段，这时按字符与墨迹的比例定位，别把整行都涂上
  let inkLeft: number
  let inkRight: number
  if (runs.length === tokens.length) {
    const run = runs[picked.runIdx]
    const runLeftCss = cr.left + (x0 + run.L) / sx
    const runWCss = (run.R - run.L + 1) / sx
    const fa = (word.s - tok.s) / (tok.e - tok.s)
    const fb = (word.e - tok.s) / (tok.e - tok.s)
    inkLeft = runLeftCss + runWCss * fa
    inkRight = runLeftCss + runWCss * fb
  } else {
    const xa = inkXForChar(tokens, runs, word.s)
    const xb = inkXForChar(tokens, runs, word.e)
    if (xa == null || xb == null) return
    inkLeft = cr.left + (x0 + xa) / sx
    inkRight = cr.left + (x0 + xb) / sx
  }
  showWordInk(pageEl, layer, { left: inkLeft - 1, right: inkRight + 1 }, ar.top - 1, ar.height + 2)
  // 通知选区浮层按这个词重建（它监听 mouseup 取选区）
  document.dispatchEvent(new MouseEvent('mouseup'))
}

/** 双击选词的高亮：原生选区视觉带漂移，藏起来，改画一个按墨迹对齐的色块，下一次按下 / 滚动 / 按键时撤掉 */
export function showWordInk(pageEl: HTMLElement, layer: HTMLElement, box: { left: number; right: number }, top: number, height: number): void {
  const pr = pageEl.getBoundingClientRect()
  const flash = document.createElement('div')
  flash.className = 'word-sel-flash'
  flash.style.left = `${((box.left - pr.left) / pr.width) * 100}%`
  flash.style.top = `${((top - pr.top) / pr.height) * 100}%`
  flash.style.width = `${((box.right - box.left) / pr.width) * 100}%`
  flash.style.height = `${(height / pr.height) * 100}%`
  pageEl.appendChild(flash)
  layer.classList.add('dbl-selecting')
  const cleanup = (): void => {
    flash.remove()
    layer.classList.remove('dbl-selecting')
    document.removeEventListener('mousedown', cleanup, true)
    document.removeEventListener('wheel', cleanup, true)
    document.removeEventListener('keydown', cleanup, true)
  }
  document.addEventListener('mousedown', cleanup, true)
  document.addEventListener('wheel', cleanup, true)
  document.addEventListener('keydown', cleanup, true)
}

/** 图/表/公式：原版截图原位摆放。 */
export function TpImage({ block, paperId }: { block: BlockRow; paperId: string }): JSX.Element | null {
  const src = useFigureSrc(paperId, block.block_id)
  if (!src) return null
  return <img className="tp-img" src={src} alt="" />
}

/**
 * 页边块（页眉页脚 / 页码 / 侧边水印）：原文原位、小字淡色，不翻译不拟合。
 * 高而窄的槽位是竖排水印（arXiv 编号那一列），按原版自下而上竖着排。
 */
export function MarginBlock({
  block,
  ptScale,
  rotated
}: {
  block: BlockRow
  ptScale: number
  rotated: boolean
}): JSX.Element {
  const size = block.font_size && ptScale > 0 ? Math.max(6, block.font_size * ptScale * 0.95) : 10
  const ref = useRef<HTMLDivElement | null>(null)
  // 竖排水印比槽位长时会被页面裁掉开头（arXiv 编号变成「04.10479v3 …」）：
  // 竖排下 scrollHeight 量的是文字长度，按它把字号收到放得下为止
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !rotated) return
    el.style.fontSize = `${size}px`
    let cur = size
    for (let i = 0; i < 8 && el.scrollHeight > el.clientHeight + 1 && cur > 5; i++) {
      cur *= 0.9
      el.style.fontSize = `${cur}px`
    }
  }, [rotated, size, block.text])
  return (
    <div
      ref={ref}
      className={`tp-block tp-block--margin${rotated ? ' tp-block--rotated' : ''}`}
      style={{ fontSize: `${size}px` }}
    >
      {block.text}
    </div>
  )
}

/**
 * 镜像译文页：与原版页同尺寸的白纸，所有块按原 bbox 绝对定位——
 * 文本放译文（未译先放原文），图/表/公式放原版截图。
 */
export interface SlotBox {
  b: BlockRow
  x: number
  y: number
  w: number
  h: number
  /** 图/表/公式不动，只作障碍物 */
  fixed: boolean
  /** 译文放不下、槽位比原框高：压到谁都得推开 */
  grown?: boolean
  /** 脚注分隔线和正文之间的预留空间，与脚注一起参与避让。 */
  leading?: number
}

/**
 * 碰撞消解：ML 检测框偶有重叠（典型：脚注区通讯作者/邮箱行交错），
 * 文本槽与已放置槽显著相交时推挤到其下缘——图片槽保持原位只作障碍物。
 * 正常页面（无重叠）位置逐像素不变。
 */
export function resolveCollisions(boxes: SlotBox[]): SlotBox[] {
  const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x)
  const placed: SlotBox[] = []
  for (const s of sorted) {
    if (!s.fixed) {
      for (let guard = 0; guard < 12; guard++) {
        const hit = placed.find((p) => {
          const xo = Math.min(s.x + s.w, p.x + p.w) - Math.max(s.x, p.x)
          const yo = Math.min(s.y + s.h, p.y + p.h) - Math.max(s.y, p.y)
          if (xo <= Math.min(s.w, p.w) * 0.5) return false
          // 原始检测框之间只处理明显相交（框的小幅重叠是常态，逐像素保持原位）；
          // 撑高过的槽位是真的多出了文字，压到谁都得推开
          return s.grown || p.grown ? yo > 1 : yo > Math.min(s.h, p.h) * 0.3
        })
        if (!hit) break
        s.y = hit.y + hit.h + 2
      }
    }
    placed.push(s)
  }
  return placed
}

export function TranslatedPage({
  doc,
  blocks,
  info,
  paperId,
  pageNum
}: {
  doc: PDFDocumentProxy
  blocks: BlockRow[]
  info: PageInfo
  paperId: string
  pageNum: number
}): JSX.Element {
  const pageRef = useRef<HTMLDivElement | null>(null)
  const [ptScale, setPtScale] = useState(0)
  // 懒渲染：41 页论文全量挂载 500+ 文本块（每块还有字号收缩循环）太重——
  // 进入视口 1000px 内才渲染内容，壳保持占位高度与选区所需的 data 属性
  const [visible, setVisible] = useState(false)
  const [rules, setRules] = useState<Map<string, PdfRule>>(() => new Map())
  const [decor, setDecor] = useState<PdfDecor | null>(null)
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    void doc.getPage(pageNum).then((page) => page.getOperatorList()).then((ops) => {
      if (cancelled) return
      setRules(footnoteRules(blocks, horizontalRules(ops), info.height))
      setDecor(pageDecor(ops, info))
    }).catch(() => { /* 装饰线读取失败不影响文字显示 */ })
    return () => { cancelled = true }
  }, [doc, pageNum, visible, blocks, info])
  const paperDark = useApp((s) => s.paperDark ?? false)
  // 各段原文的主色（非黑才有值）：译文照着上色
  const inks = useMemo(() => {
    const map = new Map<string, string>()
    if (!decor) return map
    for (const b of blocks) {
      if (b.kind !== 'para' && b.kind !== 'heading') continue
      const bbox = parseBbox(b)
      const ink = bbox ? dominantInk(decor.runs, bbox) : null
      if (ink) map.set(b.block_id, paperDark ? paperDarkInk(ink) : ink)
    }
    return map
  }, [decor, blocks, paperDark])
  // 页级字号归一：收集各正文块的拟合字号，取最小值统一应用
  const fittedSizes = useRef(new Map<string, number>())
  const fitRaf = useRef(0)
  const [common, setCommon] = useState<number | null>(null)
  const reportFit = useCallback((id: string, size: number) => {
    fittedSizes.current.set(id, size)
    cancelAnimationFrame(fitRaf.current)
    fitRaf.current = requestAnimationFrame(() => {
      const vals = [...fittedSizes.current.values()]
      if (vals.length === 0) return
      const min = Math.max(7, Math.min(...vals))
      setCommon((c) => (c !== null && Math.abs(c - min) < 0.3 ? c : min))
    })
  }, [])
  useEffect(() => {
    const el = pageRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '1000px' }
    )
    io.observe(el)
    // 窗口被遮挡/切走时浏览器不再派发 IntersectionObserver，回到前台后这页
    // 会一直是空白，直到用户滚动才补上。可见性变化时手动补一次判定。
    const recheck = (): void => {
      const r = el.getBoundingClientRect()
      if (r.bottom > -1000 && r.top < window.innerHeight + 1000) {
        setVisible(true)
        io.disconnect()
      }
    }
    document.addEventListener('visibilitychange', recheck)
    window.addEventListener('focus', recheck)
    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', recheck)
      window.removeEventListener('focus', recheck)
    }
  }, [])
  useLayoutEffect(() => {
    const el = pageRef.current
    if (!el || !visible) return
    const measure = (): void => setPtScale(el.clientWidth / info.width)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [info, visible])

  // 译文放不下时槽位可以长高：各文本块按下限字号报上来的「至少需要多高」（pt），
  // 以它重排推挤，页面随之变长——中文不必缩到看不清，也不再有被裁掉的段落
  const zhScale = useApp((s) => s.zhTextScale)
  const [needs, setNeeds] = useState<Map<string, number>>(() => new Map())
  const reportNeed = useCallback((id: string, pt: number | null) => {
    setNeeds((m) => {
      const cur = m.get(id)
      if (pt == null ? cur === undefined : cur !== undefined && Math.abs(cur - pt) < 0.5) return m
      const next = new Map(m)
      if (pt == null) next.delete(id)
      else next.set(id, pt)
      return next
    })
  }, [])

  // 槽位几何一律用 PDF 点：原 bbox 高度与「需要的高度」取大者，碰撞推挤后
  // 超出原页底的页面加长，样式再按加长后的页高换算成百分比
  const { slots, pageHeight } = useMemo(() => {
    const boxes: SlotBox[] = []
    // 页脚一带的页边块（页码、页脚）不当障碍物：否则正文被推到它下面，页码夹在正文中间
    const footMargins: SlotBox[] = []
    for (const b of blocks) {
      const bbox = parseBbox(b)
      if (!bbox) continue
      const [x, y, w, h] = bbox
      if (b.kind === 'margin' && y + h < info.height * 0.12) {
        footMargins.push({ b, x, y: info.height - (y + h), w, h, leading: 0, fixed: true, grown: false })
        continue
      }
      // 页边块也当固定障碍物：原位不动、不撑高
      const fixed = b.kind === 'figure' || b.kind === 'table' || b.kind === 'equation' || b.kind === 'margin'
      const need = fixed ? 0 : (needs.get(b.block_id) ?? 0)
      const rule = rules.get(b.block_id)
      const leading = rule ? Math.max(0, rule.y + rule.thickness / 2 - (y + h)) : 0
      boxes.push({
        b,
        x,
        y: info.height - (y + h) - leading,
        w,
        h: Math.max(h, need) + leading,
        leading,
        fixed,
        grown: need > h + 0.5
      })
    }
    const placed = resolveCollisions(boxes)
    const bottom = placed.reduce((m, s) => Math.max(m, s.y + s.h), 0)
    // 页脚页边块与页面底边的距离保持原样：页面被撑长时跟着到新的底部
    const foot = footMargins.length > 0 ? Math.min(...footMargins.map((m) => m.y)) : info.height
    const contentBottom = bottom + Math.max(12, info.height - foot)
    const height = contentBottom > info.height ? contentBottom : info.height
    for (const m of footMargins) m.y += height - info.height
    return { slots: [...placed, ...footMargins], pageHeight: height }
  }, [blocks, info, needs, rules])

  // 译文页比原文页长：把这一页的字号下限整体往下调一档再排，直到等高或到了下限，和原文页保持对齐。
  // 表格页几十个小格每格多一点就会把整页撑长，逐格长高又会让上下错位
  const [floorScale, setFloorScale] = useState(1)
  useEffect(() => {
    if (pageHeight <= info.height + 2 || floorScale <= 0.62) return
    // 等各块按新下限量完高度（同一帧里陆续上报）再决定下一档，下一帧再调
    const id = requestAnimationFrame(() =>
      setFloorScale((f) => Math.max(0.6, f * Math.max(0.85, info.height / pageHeight)))
    )
    return () => cancelAnimationFrame(id)
  }, [pageHeight, info.height, floorScale])

  // 表格线与彩色底块跟着译文走：译文比原文长，段落会被往下推、页面会变长。
  // 装饰原位不动，除非上方同一横向范围里的内容长到压住它，才跟着下移；
  // 竖线两端各算各的，随所在栏一起拉长。整个落在图 / 表截图里的不画（截图里已经有了）
  const decorItems = useMemo(() => {
    if (!decor) return { lines: [], fills: [] }
    const moved = slots.map((s) => {
      const bb = parseBbox(s.b)!
      return { x1: bb[0], x2: bb[0] + bb[2], origBottom: info.height - bb[1], newBottom: s.y + s.h, fixed: s.fixed }
    })
    // 只在被顶到时才让位：上方同一横向范围里的内容新的下边缘加上原有间距（最多 3pt）越过了它，才往下挪。
    // 取「被撑高多少就挪多少」会让离得很远的一格长高也把表格底线拖下去
    const shift = (top: number, x1: number, x2: number): number => {
      let need = top
      for (const m of moved) {
        if (m.origBottom > top + 1 || m.x2 < x1 || m.x1 > x2) continue
        need = Math.max(need, m.newBottom + Math.min(3, Math.max(0, top - m.origBottom)))
      }
      return need - top
    }
    // 和图 / 表 / 公式截图有交集的装饰都不画：截图里本来就有这些线和色块，再画一遍只会错位叠在上面
    const inFixed = (x1: number, y1: number, x2: number, y2: number): boolean =>
      slots.some((s) => {
        if (!s.fixed || s.b.kind === 'margin') return false
        const bb = parseBbox(s.b)!
        return Math.min(x2, bb[0] + bb[2]) - Math.max(x1, bb[0]) > -1 && Math.min(y2, bb[1] + bb[3]) - Math.max(y1, bb[1]) > -1
      })
    const footRules = [...rules.values()]
    // 落在正文段 / 标题里的线是文字本身的笔画（箭头「→」的杆、分数线、上划线、下划线）：
    // 译文换了排版，按原位画出来就是一截飘在字中间的黑线。表格线在单元格之间，不受影响
    const textBoxes = slots
      .filter((s) => s.b.kind === 'para' || s.b.kind === 'heading')
      .map((s) => parseBbox(s.b)!)
    const inText = (l: { x1: number; y1: number; x2: number; y2: number }): boolean =>
      textBoxes.some(([x, y, w, h]) => {
        const mx = (l.x1 + l.x2) / 2
        const my = (l.y1 + l.y2) / 2
        return mx > x + 0.5 && mx < x + w - 0.5 && my > y + 0.5 && my < y + h - 0.5
      })
    const lines = decor.lines
      .filter((l) => !inFixed(l.x1, l.y1, l.x2, l.y2))
      .filter((l) => !inText(l))
      .filter((l) => !footRules.some((r) => Math.abs(r.y - l.y1) < 1 && Math.abs(r.x - l.x1) < 1))
      .map((l) => {
        const top = info.height - Math.max(l.y1, l.y2)
        const bottom = info.height - Math.min(l.y1, l.y2)
        const vertical = l.x1 === l.x2
        const range: [number, number] = vertical ? [l.x1 - 150, l.x1 + 150] : [Math.min(l.x1, l.x2), Math.max(l.x1, l.x2)]
        const t = top + shift(top, ...range)
        const b = vertical ? bottom + shift(bottom, ...range) : t
        return { ...l, top: t, bottom: b, vertical }
      })
    const fills = decor.fills
      .filter((f) => !inFixed(f.x, f.y, f.x + f.width, f.y + f.height))
      .map((f) => {
        const top = info.height - (f.y + f.height)
        return { ...f, top: top + shift(top, f.x, f.x + f.width) }
      })
    return { lines, fills }
  }, [decor, slots, rules, info])

  return (
    <div
      ref={pageRef}
      className="tp-page"
      style={{ aspectRatio: `${info.width} / ${pageHeight}` }}
      data-page={pageNum}
      data-pw={info.width}
      data-ph={info.height}
    >
      {visible && (
        <>
      <div className="tp-decor" aria-hidden="true">
        {decorItems.fills.map((f, i) => (
          <div key={`f${i}`} style={{
            left: `${(f.x / info.width) * 100}%`,
            top: `${(f.top / pageHeight) * 100}%`,
            width: `${(f.width / info.width) * 100}%`,
            height: `${(f.height / pageHeight) * 100}%`,
            background: f.color
          }} />
        ))}
        {decorItems.lines.map((l, i) => (
          <div key={`l${i}`} style={l.vertical ? {
            left: `${((l.x1 - l.thickness / 2) / info.width) * 100}%`,
            top: `${(l.top / pageHeight) * 100}%`,
            width: `${(l.thickness / info.width) * 100}%`,
            height: `${((l.bottom - l.top) / pageHeight) * 100}%`,
            background: l.color
          } : {
            left: `${(Math.min(l.x1, l.x2) / info.width) * 100}%`,
            top: `${((l.top - l.thickness / 2) / pageHeight) * 100}%`,
            width: `${(Math.abs(l.x2 - l.x1) / info.width) * 100}%`,
            height: `${(l.thickness / pageHeight) * 100}%`,
            background: l.color
          }} />
        ))}
      </div>
      {slots.map((s) => {
        const leading = s.leading ?? 0
        const rule = rules.get(s.b.block_id)
        const style = {
          left: `${(s.x / info.width) * 100}%`,
          top: `${((s.y + leading) / pageHeight) * 100}%`,
          width: `${(s.w / info.width) * 100}%`,
          height: `${((s.h - leading) / pageHeight) * 100}%`
        }
        if (s.b.kind === 'margin') {
          return (
            <div key={s.b.block_id} className="tp-slot tp-slot--margin" style={style}>
              <MarginBlock block={s.b} ptScale={ptScale} rotated={s.h > s.w * 2.5} />
            </div>
          )
        }
        if (s.fixed) {
          return (
            <div key={s.b.block_id} className="tp-slot" style={style}>
              <TpImage block={s.b} paperId={paperId} />
            </div>
          )
        }
        return (
          <Fragment key={s.b.block_id}>
          {rule && <div aria-hidden="true" className="tp-footnote-rule" style={{
            left: `${(rule.x / info.width) * 100}%`,
            top: `${(s.y / pageHeight) * 100}%`,
            width: `${(rule.width / info.width) * 100}%`,
            height: `${(rule.thickness / pageHeight) * 100}%`
          }} />}
          <div className="tp-slot" style={style}>
            <FitBlock
              block={s.b}
              pageWidth={info.width}
              ptScale={ptScale}
              commonSize={common}
              onFit={reportFit}
              onNeed={reportNeed}
              zhScale={zhScale}
              slotH={s.h - leading}
              ink={inks.get(s.b.block_id)}
              floorScale={floorScale}
            />
          </div>
          </Fragment>
        )
      })}
        </>
      )}
    </div>
  )
}
