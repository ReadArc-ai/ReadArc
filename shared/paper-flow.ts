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
