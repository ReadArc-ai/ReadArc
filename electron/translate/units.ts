/**
 * 跨页 / 跨栏续段的翻译单元：被截断的几块拼成一段一起译，译完再按断开处切回各块。
 * 各块仍各自存译文：原版对照视图照旧按原位摆放，流式视图把几块接成一段显示。
 *
 * 断开处插 ⟦pb⟧ 让模型原样带回；后面几块的公式占位符整体往后编号，免得和前一块的 ⟦f1⟧ 撞号，
 * 切回时再还原。模型丢了 ⟦pb⟧ 就按原文长度比例在句读处切，公式和上下标再各自修补。
 */
import type { BlockRow, FlowUnitInput } from '../../shared/models'
import {
  INLINE_PLACEHOLDER_RE,
  inlinePlaceholder,
  placeholderNumbers,
  placeholdersMatch,
  repairPlaceholders
} from '../../shared/inline-formula'
import { preservesInlineContent, repairScriptMarks } from '../../shared/translation-integrity'

export const PAGE_BREAK = '⟦pb⟧'
/** 模型偶尔把 ⟦⟧ 换成 [[ ]]、【】或方括号，和公式占位符一样放宽 */
const PAGE_BREAK_RE = /\s*(?:⟦|\[\[|【|\[)\s*pb\s*(?:⟧|\]\]|】|\])\s*/gi

/** 每一块的占位符编号偏移：第 k 块整体加上前面各块的最大编号 */
function offsets(parts: Pick<BlockRow, 'text'>[]): number[] {
  let acc = 0
  return parts.map((p) => {
    const own = acc
    acc += Math.max(0, ...placeholderNumbers(p.text))
    return own
  })
}

function shift(text: string, by: number): string {
  if (!by) return text
  return text.replace(new RegExp(INLINE_PLACEHOLDER_RE.source, 'g'), (_m, n: string) => inlinePlaceholder(Number(n) + by))
}

/** 拼成一段送去翻译 */
export function joinUnit(parts: Pick<BlockRow, 'text'>[]): string {
  const offs = offsets(parts)
  return parts.map((p, k) => shift(p.text, offs[k])).join(` ${PAGE_BREAK} `)
}

/** 按原文各块的长度比例切开（模型丢了 ⟦pb⟧ 时用），切点就近挪到句读处 */
function proportionalSplit(parts: Pick<BlockRow, 'text'>[], out: string): string[] {
  const total = parts.reduce((n, p) => n + p.text.length, 0) || 1
  const pieces: string[] = []
  let start = 0
  let acc = 0
  for (let k = 0; k < parts.length - 1; k++) {
    acc += parts[k].text.length
    const target = Math.round((acc / total) * out.length)
    const window = Math.max(8, Math.round(out.length * 0.15))
    let cut = target
    let best = Infinity
    for (let i = Math.max(start + 1, target - window); i <= Math.min(out.length - 1, target + window); i++) {
      if (/[，。；！？,.;!?]/.test(out[i - 1]) && Math.abs(i - target) < best) {
        best = Math.abs(i - target)
        cut = i
      }
    }
    cut = Math.min(Math.max(cut, start + 1), out.length)
    pieces.push(out.slice(start, cut))
    start = cut
  }
  pieces.push(out.slice(start))
  return pieces
}

/**
 * 把整段译文切回各块，并让每块的公式与上下标和该块原文一一对应。
 * 切不出和块数一样多的非空片段时返回 null，调用方退回逐块翻译。
 */
export function splitUnit(parts: Pick<BlockRow, 'text'>[], out: string): string[] | null {
  const offs = offsets(parts)
  let pieces = out.split(PAGE_BREAK_RE)
  if (pieces.length !== parts.length) pieces = proportionalSplit(parts, out.replace(PAGE_BREAK_RE, ' '))
  const result: string[] = []
  for (let k = 0; k < parts.length; k++) {
    const own = Math.max(0, ...placeholderNumbers(parts[k].text))
    // 还原编号；不属于这一块的编号（模型把公式挪过了断开处）记成 0，交给下面的修补去掉、再按原文补齐
    let s = pieces[k]
      .replace(new RegExp(INLINE_PLACEHOLDER_RE.source, 'g'), (_m, n: string) => {
        const back = Number(n) - offs[k]
        return inlinePlaceholder(back >= 1 && back <= own ? back : 0)
      })
      .trim()
    if (!s) return null
    if (!placeholdersMatch(parts[k].text, s)) s = repairPlaceholders(parts[k].text, s)
    if (!preservesInlineContent(parts[k].text, s)) s = repairScriptMarks(parts[k].text, s)
    if (!preservesInlineContent(parts[k].text, s)) return null
    result.push(s)
  }
  return result
}

/* ---- arXiv 网页版的翻译单元 ---- */

const MAX_UNITS = 8000
const MAX_UNIT_CHARS = 20_000

/**
 * arXiv HTML 的翻译单元（渲染进程解析、送来）→ 与 PDF 块同形的行，交给同一套翻译器。
 * 输入来自渲染进程：id 必须以「论文 id:x:」开头（删除论文时按前缀清理），长度、个数都设上限
 */
export function unitBlocks(paperId: string, units: unknown): BlockRow[] {
  if (!Array.isArray(units)) return []
  const prefix = `${paperId}:x:`
  const out: BlockRow[] = []
  for (const raw of units.slice(0, MAX_UNITS)) {
    const u = raw as Partial<FlowUnitInput> | null
    if (!u || typeof u.id !== 'string' || !u.id.startsWith(prefix) || u.id.length > 160) continue
    if (u.kind !== 'para' && u.kind !== 'heading') continue
    if (typeof u.text !== 'string' || !u.text.trim() || u.text.length > MAX_UNIT_CHARS) continue
    out.push({
      block_id: u.id,
      paper_id: paperId,
      page: 0,
      block_order: typeof u.order === 'number' && Number.isFinite(u.order) ? u.order : out.length,
      kind: u.kind,
      section: null,
      text: u.text,
      bbox: null,
      simhash: '',
      heading_level: null,
      font_size: null,
      inlines: null
    })
  }
  return out
}
