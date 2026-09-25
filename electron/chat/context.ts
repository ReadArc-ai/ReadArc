/**
 * 对话上下文构造：**不塞全文**——
 * 结构摘要（标题+目录）+ FTS 检索命中的 5–8 个块。又省钱又能给出准确引用。
 *
 * 引用契约：每个上下文块带 [B<block_order>] 标签，系统提示词强制模型只用这些标号引用。
 * 标号→块的映射由我们持有，所以引用要么 100% 跳对、要么被丢弃（宁缺毋错）。
 */
import { restoreInlines } from '../../shared/inline-formula'
import { LANG_TEXT, targetLang } from '../translate/target-lang'
import type Database from 'better-sqlite3'
import { getBlocks, getPaper, listPaperTranslations, searchBlocks, type BlockRow } from '../db'
import type { ChatMessage } from '../model/transport'

export interface ChatContextOptions {
  /** 整篇维度的提问：按目录取各节首段，不按问句检索 */
  whole?: boolean
  /** 讲法（读者人设）的提示词段；空则用默认的克制表达要求 */
  style?: string | null
}

export interface CitationTarget {
  order: number
  blockId: string
  page: number
  section: string | null
}

export interface ChatContext {
  system: string
  contextBlock: string
  /** order → 可跳转目标；模型引用的标号只在这里面才算数 */
  targets: Map<number, CitationTarget>
}

/** 问题 → FTS5 安全查询：词与 CJK 单字加引号 OR 连接；空则返回 null。 */
export function ftsQueryFromQuestion(question: string): string | null {
  const latin = question.match(/[a-zA-Z0-9]{3,}/g) ?? []
  const cjk = question.match(/[一-鿿]/g) ?? []
  const terms = [...new Set([...latin, ...cjk])].slice(0, 12)
  if (terms.length === 0) return null
  return terms.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ')
}

/** 提问里没有区分度的字：命中它们等于没检索。 */
const CJK_STOP = new Set(
  '的了是在和与有这那什么怎样为何吗呢请问一个我你他它们上下中不也就都而及或把被给对从到说讲里篇文以及可能会要能'.split('')
)

/**
 * 中文问句 → 2–3 字词块。中文没有空格，逐字切等于全是停用词；
 * 取相邻 n-gram 再丢掉纯停用字组合，「核心贡献」这类实词就留下来了。
 */
export function cjkTermsFromQuestion(question: string): string[] {
  const out = new Set<string>()
  for (const run of question.match(/[一-鿿]{2,}/g) ?? []) {
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= run.length; i++) {
        const gram = run.slice(i, i + n)
        if ([...gram].every((c) => CJK_STOP.has(c))) continue
        out.add(gram)
      }
    }
  }
  return [...out].slice(0, 24)
}

/**
 * 在缓存译文里按词块打分选块。原文是英文、提问是中文时，FTS 打在原文上必然零命中
 * （兜底会退化成「论文开头几段」= 版权页与作者名单）；论文的中文译文本来就在库里，
 * 拿它来检索才对得上。命中太广的词块（>40% 的块都有）当噪音丢掉。
 */
function searchTranslations(
  rows: { block_id: string; text: string }[],
  terms: string[],
  limit: number
): Map<string, number> {
  if (rows.length === 0 || terms.length === 0) return new Map()
  const tooCommon = Math.max(1, Math.floor(rows.length * 0.4))
  const useful = terms.filter((t) => {
    const df = rows.reduce((n, r) => n + (r.text.includes(t) ? 1 : 0), 0)
    return df > 0 && df <= tooCommon
  })
  if (useful.length === 0) return new Map()
  const scored = rows
    .map((r) => ({
      id: r.block_id,
      // 长词块权重更高：「核心贡献」比「贡献」更能说明问的是什么
      score: useful.reduce((n, t) => n + (r.text.includes(t) ? t.length : 0), 0)
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
  return new Map(scored.map((x) => [x.id, x.score]))
}

/**
 * 译文命中的最低分：只碰上一个 2 字词块（如「核心」恰好出现在硬件配置那段）说明不了问题，
 * 这种命中不能独自撑起上下文，要再补各节首段。
 */
const STRONG_ZH_SCORE = 4

/**
 * 整篇式问法：问的是论文整体（贡献、创新、结论、讲了什么），词面检索天然对不上——
 * 「核心创新」四个字在正文里可能一次都不出现。这类问题固定补上各节首段。
 */
export function isBroadQuestion(question: string): boolean {
  return /核心|贡献|创新|主要|总结|概括|综述|讲了什么|讲的是什么|做了什么|解决.{0,3}什么|什么问题|结论|亮点|要点|大意|主旨|contribution|novel|innovation|summar|overview|main idea|key idea|takeaway|what (?:is|does) (?:this|the) paper|about\?/i.test(
    question
  )
}

const MAX_HITS = 8

/** 整篇取样的字符预算：与三句话摘要的结构化上下文同量级，够讲清骨架又不至于塞全文 */
const WHOLE_CHAR_BUDGET = 6000

/**
 * 整篇维度的取样：按目录顺序取每节第一个像样的段落（太短的多半是图注、脚注，跳过取下一段），
 * 装到字符预算为止。没有章节结构时返回空，由调用方退回均匀取样。
 */
export function sectionLeads(blocks: BlockRow[]): BlockRow[] {
  const taken = new Set<string>()
  const out: BlockRow[] = []
  let used = 0
  for (const b of blocks) {
    if (b.kind !== 'para' || !b.section || taken.has(b.section) || b.text.length < 40) continue
    if (used + b.text.length > WHOLE_CHAR_BUDGET) break
    taken.add(b.section)
    out.push(b)
    used += b.text.length
  }
  return out
}

export function buildChatContext(
  db: Database.Database,
  paperId: string,
  question: string,
  opts: ChatContextOptions = {}
): ChatContext {
  const paper = getPaper(db, paperId)
  const blocks = getBlocks(db, paperId)
  const outline = blocks.filter((b) => b.kind === 'heading').map((b) => b.text)

  let hits: BlockRow[] = []
  // 命中里有没有「站得住」的块：FTS 命中了英文实词，或译文命中分够高
  let strong = Boolean(opts.whole)
  if (opts.whole) {
    // 整篇维度的内置提问：问句本身没有检索价值（「把这篇论文讲一遍」），按目录取各节首段
    hits = sectionLeads(blocks)
  } else {
    const query = ftsQueryFromQuestion(question)
    if (query) {
      try {
        hits = searchBlocks(db, paperId, query, MAX_HITS)
      } catch {
        hits = []
      }
    }
    strong = hits.length > 0

    // 中文问句：再在译文里检索一遍，与原文命中合并（原文英文时这是唯一能对上的路）
    const cjkTerms = cjkTermsFromQuestion(question)
    if (cjkTerms.length > 0) {
      const zhScores = searchTranslations(listPaperTranslations(db, paperId), cjkTerms, MAX_HITS)
      if (zhScores.size > 0) {
        const seen = new Set(hits.map((b) => b.block_id))
        const zhHits = blocks.filter((b) => zhScores.has(b.block_id) && !seen.has(b.block_id))
        // 译文命中优先：中文提问时它比「问句里恰好夹带的英文词」更贴题
        hits = [...zhHits, ...hits].slice(0, MAX_HITS)
        strong = strong || [...zhScores.values()].some((score) => score >= STRONG_ZH_SCORE)
      }
    }
  }

  // 三种情况都要补上按目录取的各节首段，模型才有正文可依据：
  // 问的是论文整体（词面对不上）；命中都是弱命中（只碰上一个 2 字词块）；
  // 命中的都是短块（标题、图注、表头）
  const needLeads =
    !opts.whole &&
    (isBroadQuestion(question) || !strong || !hits.some((b) => b.kind === 'para' && b.text.length >= 40))
  if (needLeads) {
    const seen = new Set(hits.map((b) => b.block_id))
    hits = [...hits, ...sectionLeads(blocks).filter((b) => !seen.has(b.block_id))].slice(0, MAX_HITS + 6)
  }
  if (hits.length === 0 || (!strong && hits.length < 3)) {
    // 兜底：沿全文均匀取样补足。取「开头几段」会稳定落在版权声明与作者名单上，
    // 均匀取样至少能覆盖到摘要、方法与结论。（没有章节结构的论文各节首段也凑不够）
    const paras = blocks.filter((b) => b.kind === 'para')
    const meaty = paras.filter((b) => b.text.length > 120)
    const pool = meaty.length >= 5 ? meaty : paras
    const step = Math.max(1, Math.floor(pool.length / 5))
    const seen = new Set(hits.map((b) => b.block_id))
    hits = [...hits, ...pool.filter((b, i) => i % step === 0 && !seen.has(b.block_id)).slice(0, 5)]
  }
  hits = [...hits].sort((a, b) => a.page - b.page || a.block_order - b.block_order)

  const targets = new Map<number, CitationTarget>()
  const labeled = hits.map((b) => {
    targets.set(b.block_order, {
      order: b.block_order,
      blockId: b.block_id,
      page: b.page,
      section: b.section
    })
    return `[B${b.block_order}]（${b.section ?? '正文'} · p.${b.page}）${restoreInlines(b.text, b.inlines)}`
  })

  // 讲法（读者人设）只换表达要求；事实规则与引用规则对所有讲法一样
  const style = opts.style?.trim() || null
  const system = [
    '你是论文精读助手。只依据下面提供的论文片段回答；片段里没有的信息就说没有，不要编造。',
    '引用规则：陈述依据某段时，行内标注该段标号，如 [B12]。只允许引用给出的标号，不许发明标号。',
    style ? `${LANG_TEXT[targetLang()].answerIn}。${style}` : `${LANG_TEXT[targetLang()].answerIn}，克制、具体。`
  ].join('\n')

  const contextBlock = [
    `《${paper?.title ?? ''}》`,
    outline.length > 0 ? `目录：${outline.join(' / ')}` : '',
    '',
    opts.whole ? '论文各节开头（按目录顺序）：' : '论文片段：',
    ...labeled
  ]
    .filter(Boolean)
    .join('\n')

  return { system, contextBlock, targets }
}

export interface ResolvedCitation {
  marker: string
  order: number
  page: number
  section: string | null
}

/** 从回答文本解析引用：只保留映射内的标号（错引用直接丢弃）。 */
export function resolveCitations(
  text: string,
  targets: Map<number, CitationTarget>
): ResolvedCitation[] {
  const out: ResolvedCitation[] = []
  const seen = new Set<number>()
  for (const m of text.matchAll(/\[B(\d+)\]/g)) {
    const order = Number(m[1])
    const target = targets.get(order)
    if (!target || seen.has(order)) continue
    seen.add(order)
    out.push({ marker: `[B${order}]`, order, page: target.page, section: target.section })
  }
  return out
}

/** 组装最终消息序列（带历史）。 */
export function buildMessages(
  ctx: ChatContext,
  history: { role: 'user' | 'assistant'; content: string }[],
  question: string,
  /** 截图提问：随最后一条用户消息一起发给模型（data URL） */
  image?: string
): ChatMessage[] {
  return [
    { role: 'system', content: ctx.system },
    { role: 'user', content: ctx.contextBlock },
    ...history.slice(-6),
    image
      ? { role: 'user', content: [{ type: 'image', dataUrl: image }, { type: 'text', text: question }] }
      : { role: 'user', content: question }
  ]
}
