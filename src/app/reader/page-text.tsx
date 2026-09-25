/** 镜像页的纯文本处理：bbox 解析、句子边界、引用 / 链接 / 上下标的内联渲染 */
import { type JSX } from 'react'
import { tNow } from '../../i18n'
import type { BlockRow } from '../../../shared/models'
import { jumpToBlock } from '../../store/chat'
import { usePaper } from '../../store/paper'
import { findReference } from '../../lib/references'
import { useFigureSrc } from '../../lib/use-figure'
import { INLINE_PLACEHOLDER_RE, hasInlinePlaceholder, inlineFigureKey, type InlineFormula } from '../../../shared/inline-formula'


export const LIG: Record<string, string> = { 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl' }

/** 与后端一致的归一化长度：丢空白/连字符、展开合字。 */
export function normLen(s: string): number {
  let n = 0
  for (const ch of s) {
    if (/\s/.test(ch) || ch === '-') continue
    n += (LIG[ch] ?? ch).length
  }
  return n
}

export function parseBbox(b: BlockRow): [number, number, number, number] | null {
  if (!b.bbox) return null
  try {
    return JSON.parse(b.bbox) as [number, number, number, number]
  } catch {
    return null
  }
}

/** 标题层级不代表对齐方式：编号章节左对齐，其他标题仅在原框居中时居中。 */
export function isCenteredHeading(block: BlockRow, pageWidth: number): boolean {
  if (block.kind !== 'heading' || !(pageWidth > 0)) return false
  const text = block.text.replace(/\*\*/g, '').trim()
  if (/^(?:\d+(?:\.\d+)*[.)]?|[IVX]+[.)]|[A-Z][.)])\s/.test(text)) return false
  const box = parseBbox(block)
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) return false
  const [x, , width] = box
  return width > 0 && Math.abs(x + width / 2 - pageWidth / 2) <= pageWidth * 0.025
}

export const SNAP_DELIMS = '。！？；.!?;\n'

/** 翻译中原样保留的词元（数字/拉丁术语），跨语言高亮的对齐锚点。 */
export function sharedTokens(s: string): string[] {
  return [...new Set(s.match(/[A-Za-z][A-Za-z-]{2,}|\d+(?:\.\d+)?%?/g) ?? [])]
}

/** 每个词元取离 center 最近的出现位置，min..max 为区间；一个词元都找不到返回 null。 */
export function rangeFromTokens(text: string, tokens: string[], center: number): [number, number] | null {
  let min = -1
  let max = -1
  for (const t of tokens) {
    let best = -1
    let from = 0
    for (;;) {
      const i = text.indexOf(t, from)
      if (i < 0) break
      if (best < 0 || Math.abs(i - center) < Math.abs(best - center)) best = i
      from = i + 1
    }
    if (best < 0) continue
    if (min < 0 || best < min) min = best
    if (best + t.length > max) max = best + t.length
  }
  return min < 0 ? null : [min, max]
}

/** 从 idx 向后找最近句读，命中则返回其后位置（限 lookback 内），用于 mark 起点对齐。 */
export function snapToSentenceStart(text: string, idx: number, lookback = 40): number {
  for (let i = idx; i >= Math.max(0, idx - lookback); i--) {
    if (SNAP_DELIMS.includes(text[i - 1] ?? '')) return i
  }
  return idx
}

export function snapToSentenceEnd(text: string, idx: number, lookahead = 40): number {
  for (let i = idx; i <= Math.min(text.length, idx + lookahead); i++) {
    if (SNAP_DELIMS.includes(text[i - 1] ?? '')) return i
  }
  return idx
}

/** 文本块：绝对定位在原 bbox，字号自动缩到放得下（BabelDOC 式「放不下缩字号」）。
 *  高亮映射：译文与原文无字符对应，按「字符占比」把原文高亮区间投影到译文，
 *  再向句读对齐——标注的是对应内容而非对应位置（未译块直接用精确偏移）。 */
/** URL 链接化：点击走系统浏览器（window.open 已被主进程路由到 shell）。 */
export function linkify(s: string, keyBase: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = []
  let pos = 0
  for (const m of s.matchAll(/https?:\/\/[^\s)】」*]+/g)) {
    const i = m.index ?? 0
    // 句尾标点不算链接的一部分
    const url = m[0].replace(/[.,;:!?。，；]+$/, '')
    if (i > pos) parts.push(s.slice(pos, i))
    parts.push(
      <a
        key={`${keyBase}:a${i}`}
        className="tp-link"
        href={url}
        target="_blank"
        rel="noreferrer"
        onClick={(ev) => ev.stopPropagation()}
      >
        {url}
      </a>
    )
    pos = i + url.length
  }
  if (pos < s.length) parts.push(s.slice(pos))
  return parts
}

/** 点击引用（"Lewis et al., 2020"）→ 跳到参考文献里对应条目。 */
export function jumpToReference(cite: string): void {
  const blocks = usePaper.getState().bundle?.blocks ?? []
  const hit = findReference(cite, blocks)
  if (hit) jumpToBlock(hit.block_order)
}

/** 括号引用链接化。三种形态，避免误伤 "WMT 2014" 这类「缩写+年份」：
 *  ① Author et al./and/& 链 + 年份（逗号可选，天文学格式无逗号）
 *  ② 括号或分号紧跟的单姓氏 + 年份（"…; Bailes 2022"）
 *  ③ 显式逗号式 "Author, 2020" */
export const NAME = String.raw`[A-Z][\p{L}'’-]+`
export const CITE_RE = new RegExp(
  `${NAME}(?:\\s+(?:et al\\.|and\\s+${NAME}|&\\s+${NAME}))+[,，]?\\s*\\d{4}[a-z]?` +
    `|(?<=[（(;；]\\s?)${NAME}[,，]?\\s+\\d{4}[a-z]?` +
    `|${NAME},\\s*\\d{4}[a-z]?`,
  'gu'
)

export function linkifyCites(s: string, keyBase: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = []
  let pos = 0
  for (const m of s.matchAll(CITE_RE)) {
    const i = m.index ?? 0
    if (i > pos) parts.push(s.slice(pos, i))
    const cite = m[0]
    parts.push(
      <span
        key={`${keyBase}:c${i}`}
        className="tp-cite"
        title={tNow('sel.jump-refs')}
        onClick={(ev) => {
          ev.stopPropagation()
          jumpToReference(cite)
        }}
      >
        {cite}
      </span>
    )
    pos = i + cite.length
  }
  if (pos < s.length) parts.push(s.slice(pos))
  return parts
}

/** 上下标标记渲染：^……^ → <sup>，~……~ → <sub>（短运行，≤16 字符）。 */
export function renderScripts(s: string, keyBase: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = []
  let pos = 0
  for (const m of s.matchAll(/\^([^\s^~]{1,16})\^|~([^~^]{1,16})~/g)) {
    const i = m.index ?? 0
    if (i > pos) parts.push(s.slice(pos, i))
    if (m[1] !== undefined) parts.push(<sup key={`${keyBase}:s${i}`}>{m[1]}</sup>)
    else parts.push(<sub key={`${keyBase}:s${i}`}>{m[2]}</sub>)
    pos = i + m[0].length
  }
  if (pos < s.length) parts.push(s.slice(pos))
  return parts
}

export function linkifyAll(s: string, keyBase: string): (string | JSX.Element)[] {
  if (!INLINE_HINT.test(s)) return [s]
  return linkify(s, keyBase).flatMap((p, i) =>
    typeof p === 'string'
      ? linkifyCites(p, `${keyBase}:${i}`).flatMap((q, j) =>
          typeof q === 'string' ? renderScripts(q, `${keyBase}:${i}:${j}`) : [q]
        )
      : [p]
  )
}

/** 可能含行内标记（粗体/上下标/URL/引用年份/公式占位符）——一次廉价扫描即可整体短路。 */
export const INLINE_HINT = /[*^~⟦【]|\[\[?f\d|https?:\/\/|\d{4}/

/** 行内公式渲染所需的块上下文：截图按「块 id:fN」取，尺寸按块的原始字号换算成 em */
export interface InlineCtx {
  paperId: string
  blockId: string
  inlines: InlineFormula[]
  fontSize: number | null
}

/** 行内公式截图四周各留了 1px（4 倍渲染下 0.25pt）的余量，换算高度与基线偏移时要算进去 */
const CROP_PAD_PT = 0.25

/**
 * 行内公式：原版截图嵌在译文里，高度与基线按原文几何换算，随字号缩放。
 * 截图还没到（或裁失败）时退回文本层原文，至少句子是完整的。
 */
function InlineFigure({ ctx, formula }: { ctx: InlineCtx; formula: InlineFormula }): JSX.Element {
  const src = useFigureSrc(ctx.paperId, inlineFigureKey(ctx.blockId, formula.n))
  if (!src) return <span className="tp-inline-fig-text">{renderScripts(formula.text, `${ctx.blockId}:f${formula.n}`)}</span>
  const fs = ctx.fontSize && ctx.fontSize > 1 ? ctx.fontSize : 10
  const [, y, , h] = formula.bbox
  const heightEm = (h + CROP_PAD_PT * 2) / fs
  const belowBase = formula.base - y + CROP_PAD_PT
  return (
    <img
      className="tp-inline-fig"
      src={src}
      alt={formula.text}
      style={{ height: `${heightEm.toFixed(3)}em`, verticalAlign: `${(-belowBase / fs).toFixed(3)}em` }}
    />
  )
}

/** 行内标记渲染：**……** → <strong>，URL/引用 → 可点链接，⟦fN⟧ → 公式截图；不配对的 ** 原样输出。 */
export function renderInline(s: string, keyBase: string, ctx?: InlineCtx): (string | JSX.Element)[] {
  // 整页镜像块逐个跑三遍正则是挂载期的主要 JS 开销；无标记文本直接原样返回
  if (!INLINE_HINT.test(s)) return [s]
  // 先处理成对的强调范围，再在范围内嵌公式；先按公式切开会把 **文字 ⟦f1⟧**
  // 拆成两段不配对的星号，导致粗体丢失、标记裸露。递归也保留粗斜体与上下标的嵌套。
  const emphasis = [...s.matchAll(/\*\*\*([\s\S]+?)\*\*\*|\*\*([\s\S]+?)\*\*|(?<!\*)\*(?![\s*])([^\n]+?)(?<![\s*])\*(?!\*)/g)]
  if (emphasis.length > 0) {
    const parts: (string | JSX.Element)[] = []
    let pos = 0
    for (const m of emphasis) {
      const i = m.index ?? 0
      if (i > pos) parts.push(...renderInline(s.slice(pos, i), `${keyBase}:${pos}`, ctx))
      const content = renderInline(m[1] ?? m[2] ?? m[3], `${keyBase}:em${i}`, ctx)
      parts.push(m[1] !== undefined
        ? <strong key={`${keyBase}:${i}`}><em>{content}</em></strong>
        : m[2] !== undefined
          ? <strong key={`${keyBase}:${i}`}>{content}</strong>
          : <em key={`${keyBase}:${i}`}>{content}</em>)
      pos = i + m[0].length
    }
    if (pos < s.length) parts.push(...renderInline(s.slice(pos), `${keyBase}:${pos}`, ctx))
    return parts
  }
  if (ctx && ctx.inlines.length > 0 && hasInlinePlaceholder(s)) {
    const parts: (string | JSX.Element)[] = []
    let pos = 0
    for (const m of s.matchAll(INLINE_PLACEHOLDER_RE)) {
      const i = m.index ?? 0
      const formula = ctx.inlines.find((f) => f.n === Number(m[1]))
      // 没有对应记录的序号（模型编出来的）：不露出「⟦f6⟧」这样的字样，直接去掉
      if (!formula) {
        if (i > pos) parts.push(...renderInline(s.slice(pos, i), `${keyBase}:${pos}`))
        pos = i + m[0].length
        continue
      }
      if (i > pos) parts.push(...renderInline(s.slice(pos, i), `${keyBase}:${pos}`))
      parts.push(<InlineFigure key={`${keyBase}:f${i}`} ctx={ctx} formula={formula} />)
      pos = i + m[0].length
    }
    if (pos < s.length) parts.push(...renderInline(s.slice(pos), `${keyBase}:${pos}`))
    return parts
  }
  return linkifyAll(s, keyBase)
}

/** 正文段判定：参与页级字号归一（脚注等小字号块不拖累正文）。 */
export function isBodyPara(block: BlockRow): boolean {
  return block.kind === 'para' && (block.font_size == null || block.font_size >= 9)
}
