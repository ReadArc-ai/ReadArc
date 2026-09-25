/**
 * 段落级对照翻译（P0）：
 * - 译文永久缓存，键含 glossary_version 与 prompt_version——改术语表自然失效
 * - 每段带前后各一段做上下文，但只译本段
 * - 术语表强制生效；单段可重译（force）
 * - AI 失败不阻塞阅读 [P4]：错误逐段上报，已有译文永不清空
 */
import { uiText } from '../i18n'
import { LANG_TEXT, promptVersionFor, targetLang } from './target-lang'
import { inlinePlaceholder, placeholderNumbers, placeholdersMatch, repairPlaceholders } from '../../shared/inline-formula'
import { scriptCounts, scriptOf, type TargetLang } from '../../shared/lang'
import { looksReferenceEntry, skipTranslation } from '../../shared/lang'
import type Database from 'better-sqlite3'
import { getBlocks, getPaper, getTranslation, putTranslation, recordUsage, type BlockRow } from '../db'
import {
  NoRouteError,
  defaultRunner,
  friendlyModelError,
  runTask,
  type AttemptRunner,
  type RouterContext
} from '../model/router'
import type { Glossary } from './glossary'
import { preservesInlineContent } from '../../shared/translation-integrity'

/** 提示词形状变更时递增——缓存键的一半 */
export const PROMPT_VERSION = 1

/**
 * 剥除模型偶发的元话语：「原文复述 Translation: 译文」「Bold: …」「译文：…」。
 * 提示词已禁止，此处兜底——元前缀一旦入缓存会永久显示。
 */
export function stripMetaPrefix(out: string): string {
  // 思考泄漏兜底（transport 已按流过滤；非流式路径或标签残缺时这里再剥一次）
  let t = out.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim()
  const marks = [...t.matchAll(/(?:^|\n|[.。!?]\s+)[-•*]?\s*(?:Translation|译文|Let me translate|以下是译文|开始翻译)\s*[:：]\s*/gi)]
  if (marks.length > 0) {
    const last = marks[marks.length - 1]
    t = t.slice((last.index ?? 0) + last[0].length).trim()
  }
  return t.replace(/^Bold\s*[:：]\s*/i, '').trim()
}

/**
 * 判定模型输出是否根本不是译文（如答成英文摘要、答非所问）。
 * 长英文散文段的中文译文不可能既无 CJK 字符、又比原文短一半以上；
 * 短段（作者栏、纯符号、参考文献条目原样保留）不受此约束。
 * 判定为真的输出不入缓存——缓存是永久的，一条坏译文会一直显示下去。
 */
/** 不用调模型的段落：纯数字符号、本来就是中文、参考文献条目。判据在 shared/lang.ts，渲染进程共用 */
export const isUntranslatable = (text: string, lang: TargetLang = targetLang()): boolean => skipTranslation(text, lang)

export { looksReferenceEntry }

/** 有没有小写英文单词：作者栏、机构名、全大写标题这类没有，模型交白卷时可原样当译文 */
export function hasLowercaseWord(text: string): boolean {
  return /\b[a-z]{2,}\b/.test(text)
}

/** 原样当译文写入缓存（model 记为 identity，横幅统计模型时不算它） */
export const IDENTITY_MODEL = 'identity'


export function looksUntranslated(src: string, out: string, lang: TargetLang = targetLang()): boolean {
  // 空输出永远不是译文。这一条必须排在所有豁免之前：文献条目豁免（下面那条）
  // 曾让模型返回的空串一路写进缓存，块从此「有行但没内容」——
  // 库卡片按行数算 100%，阅读器按内容算未译，点继续翻译又被空缓存当命中挡回去。
  if (!out.trim()) return true
  if (!preservesInlineContent(src, out)) return true
  // 思考标签（哪怕只剩半边）说明输出是推理模型的思考流，不是译文
  if (/<\/?think>/i.test(out)) return true
  if (lang !== 'zh') {
    // 非中文目标：按目标文字系统看输出。拉丁语言要求字母数不少于原文非拉丁字符的八成；
    // 日韩要求出现足够的假名 / 谚文。短段不约束
    const s = scriptCounts(src)
    const o = scriptCounts(out)
    const target = scriptOf(lang)
    if (target === 'latin') {
      const foreign = s.han + s.kana + s.hangul
      if (foreign < 40) return false
      return o.latin < foreign * 0.8
    }
    const srcLen = s.han + s.kana + s.hangul + s.latin
    if (srcLen < 120) return false
    return (target === 'kana' ? o.kana : o.hangul) < 10
  }
  const letters = (src.match(/[A-Za-z]/g) ?? []).length
  if (letters < 120) return false
  // 参考文献条目（[N] 开头）通常原样保留或压缩返回，不适用散文判据
  if (/^\s*\[\d+\]/.test(src)) return false
  // 作者—年份式条目同理
  if (looksReferenceEntry(src)) return false
  // 作者名单（大合作组几百个人名，"X. Yyyy" 缩写密集）：原样保留即正确译文
  if ((src.match(/\b[A-Z]\.\s/g) ?? []).length >= 8) return false
  // 全名式名单（"Aaron Hurst, Adam Lerer, …"）：逗号密集且大写开头词占比高
  const commas = (src.match(/,/g) ?? []).length
  if (commas >= 8) {
    const words = src.split(/\s+/).filter(Boolean)
    const caps = words.filter((w) => /^[A-Z]/.test(w)).length
    if (caps / Math.max(1, words.length) >= 0.6) return false
  }
  // 长英文散文段的中文译文必须含 CJK 字符——零中文的输出
  // 要么是原文复述、要么是英文计划书（推理模型的思考泄漏），一律拒收
  if (!/[一-鿿]/.test(out)) return true
  // 原文开头被整段复述进输出：不管后面跟了多少中文注释都不是译文。
  // 只对散文开头生效——人名/机构名/引文串（"LIGO Scientific Collaboration, Virgo …"）
  // 本来就该原样保留，用真实译文缓存审计过：不加这层约束会误伤致谢与参考文献段
  const head = src.trim().slice(0, 60)
  const proseWords = (head.match(/\b[a-z]{3,}\b/g) ?? []).length
  if (head.length >= 40 && proseWords >= 6 && out.includes(head)) return true
  // 汉字太少：按原文里可译的散文部分（小写单词的字母数）估算译文该有的汉字下限；
  // 专有名词、引文、软件名原样保留不计入。低于下限的是英文评注夹几个中文词
  // （推理模型不带标签的思考泄漏：「The abstract - need to translate carefully, "…" - 序列转导模型」）
  // 阈值 0.10 用真实缓存（344 段长散文）校准：正常译文最低约 0.11（致谢段保留大量机构名），
  // 评注型泄漏在 0.08 上下——再收紧就会误伤，误伤等于让用户重译白花钱
  const prose = (src.match(/\b[a-z]{2,}\b/g) ?? []).join('').length
  const cjk = (out.match(/[一-鿿]/g) ?? []).length
  return prose >= 120 && cjk < prose * 0.1
}

export interface TranslateDeps {
  ctx: RouterContext
  glossary: Glossary
  /** 测试注入；缺省走真实流式 transport */
  runner?: AttemptRunner
}

export interface BlockTranslation {
  blockId: string
  text: string
  cached: boolean
  model?: string
  usage?: { inputTokens: number; outputTokens: number }
}

function buildMessages(
  block: BlockRow,
  neighbors: { prev?: string; next?: string },
  glossary: Glossary,
  lang: TargetLang
): { role: 'system' | 'user'; content: string }[] {
  // 术语表是英译中的，目标英文时不用
  const glossaryLines =
    lang === 'zh'
      ? Object.entries(glossary.terms)
          .map(([en, zh]) => `${en} => ${zh}`)
          .join('\n')
      : ''
  const L = LANG_TEXT[lang]
  const system = [L.translateSingle, L.translateRules, glossaryLines ? `术语表（必须严格采用）：\n${glossaryLines}` : '']
    .filter(Boolean)
    .join('\n\n')

  const user = [
    neighbors.prev ? `【上文】${neighbors.prev}` : '',
    `【本段】${block.text}`,
    neighbors.next ? `【下文】${neighbors.next}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

/**
 * 写回译文缓存——但先确认论文还在。
 *
 * 用户可以在翻译进行中删除论文；并发批次此刻大多还在等模型返回，
 * 它们会在删除之后才回到这里，写下永远匹配不上任何块的孤儿译文。
 * 四个写入点（单段、流式回填、批次收尾、标题批量）必须都走这里。
 * 用量另记：token 是真花了，账本不能漏。
 */
function cacheTranslation(
  db: Database.Database,
  block: BlockRow,
  glossaryVersion: number,
  model: string,
  text: string,
  /** 按发起翻译时的目标语言入缓存：翻译途中改了目标语言，在途结果不能记到新语言名下 */
  lang: TargetLang
): void {
  if (!text.trim()) return // 空译文写进去等于制造一个永远修不好的「已译」块
  if (!preservesInlineContent(block.text, text)) throw new Error(uiText('translation.invalid', { model }))
  if (!getPaper(db, block.paper_id)) return
  putTranslation(db, block.block_id, glossaryVersion, promptVersionFor(PROMPT_VERSION, lang), model, text)
}

export async function translateBlock(
  db: Database.Database,
  deps: TranslateDeps,
  block: BlockRow,
  neighbors: { prev?: string; next?: string },
  force = false,
  lang: TargetLang = targetLang()
): Promise<BlockTranslation> {
  if (!force) {
    const hit = getTranslation(db, block.block_id, deps.glossary.version, promptVersionFor(PROMPT_VERSION, lang))
    if (hit) return { blockId: block.block_id, text: hit.text, cached: true, model: hit.model }
  }
  // 没有可译内容的段：原样即译文，不花请求，也不会永远挂着「未翻译」
  if (isUntranslatable(block.text, lang)) {
    cacheTranslation(db, block, deps.glossary.version, IDENTITY_MODEL, block.text, lang)
    return { blockId: block.block_id, text: block.text, cached: false, model: IDENTITY_MODEL }
  }

  const out = await runTask(
    'translate',
    { messages: buildMessages(block, neighbors, deps.glossary, lang), temperature: 0.2 },
    deps.ctx,
    () => {},
    deps.runner
  )
  let text = stripMetaPrefix(out.result.text)
  // 被完整性检查拒收的回答也已消耗 token，不能漏记。
  recordUsage(db, 'translate', out.attempt.slug, out.model, out.result.usage.inputTokens, out.result.usage.outputTokens)
  // 行内公式占位符必须一一对应：少了公式就从译文里消失，多了（模型编的序号）页面上会露出一串 ⟦f6⟧。
  // 对不上重试一次并把要保留的占位符点名给它；还不行就修补（去掉编的、缺的补在句末）
  if (!looksUntranslated(block.text, text, lang) && !placeholdersMatch(block.text, text)) {
    const need = placeholderNumbers(block.text).map(inlinePlaceholder).join(' ')
    const messages = buildMessages(block, neighbors, deps.glossary, lang)
    messages[0] = { ...messages[0], content: `${messages[0].content}\n\n${LANG_TEXT[lang].placeholderStrict(need || '（无）')}` }
    const again = await runTask('translate', { messages, temperature: 0.1 }, deps.ctx, () => {}, deps.runner)
    recordUsage(db, 'translate', again.attempt.slug, again.model, again.result.usage.inputTokens, again.result.usage.outputTokens)
    const retried = stripMetaPrefix(again.result.text)
    if (!looksUntranslated(block.text, retried, lang)) text = retried
    if (!placeholdersMatch(block.text, text)) text = repairPlaceholders(block.text, text)
  }
  if (looksUntranslated(block.text, text, lang)) {
    // 模型交了白卷、而原文本来就没有散文（作者栏、符号串、全大写短标题）：原样当译文，
    // 别让这一段每次都被拒、横幅永远显示「1 段未翻译」
    if (!text.trim() && !hasLowercaseWord(block.text)) {
      cacheTranslation(db, block, deps.glossary.version, IDENTITY_MODEL, block.text, lang)
      return {
        blockId: block.block_id,
        text: block.text,
        cached: false,
        model: IDENTITY_MODEL,
        usage: { inputTokens: out.result.usage.inputTokens, outputTokens: out.result.usage.outputTokens }
      }
    }
    throw new Error(uiText('translation.invalid', { model: out.model }))
  }
  cacheTranslation(db, block, deps.glossary.version, out.model, text, lang)
  return {
    blockId: block.block_id,
    text,
    cached: false,
    model: out.model,
    usage: { inputTokens: out.result.usage.inputTokens, outputTokens: out.result.usage.outputTokens }
  }
}

/** 当前术语表/提示词版本键下已缓存的译文（打开论文时随 bundle 带给渲染进程）。 */
export function cachedTranslations(
  db: Database.Database,
  paperId: string,
  glossaryVersion: number
): Record<string, { text: string; model: string }> {
  const rows = db
    .prepare(
      `SELECT t.block_id, t.text, t.model FROM translations t
       JOIN blocks b ON b.block_id = t.block_id
       WHERE b.paper_id = ? AND t.glossary_version = ? AND t.prompt_version = ?
         AND trim(t.text) <> '' AND t.text NOT LIKE '%think>%'
         AND inline_content_matches(b.text, t.text)`
    )
    .all(paperId, glossaryVersion, promptVersionFor(PROMPT_VERSION, targetLang())) as { block_id: string; text: string; model: string }[]
  return Object.fromEntries(rows.map((r) => [r.block_id, { text: r.text, model: r.model }]))
}

/* ---- 视口优先：渲染端随滚动上报当前可见块序号，
   工作池总是优先认领离视口最近的批次——用户看到哪里，哪里先出译文。 ---- */
const translateFocus = new Map<string, number>()

export function setTranslateFocus(paperId: string, blockOrder: number): void {
  translateFocus.set(paperId, blockOrder)
}

/* ---- 打包翻译：连续短段拼进一次请求（485 段 → 几十次调用），
   解析按【N】块标记回填；对不上的段退回逐段翻译，宁慢毋错。 ---- */
const BATCH_CHAR_BUDGET = 2600
const BATCH_MAX_PARAS = 6

export function makeBatches(paras: BlockRow[]): BlockRow[][] {
  const batches: BlockRow[][] = []
  let cur: BlockRow[] = []
  let curChars = 0
  for (const p of paras) {
    if (cur.length > 0 && (curChars + p.text.length > BATCH_CHAR_BUDGET || cur.length >= BATCH_MAX_PARAS)) {
      batches.push(cur)
      cur = []
      curChars = 0
    }
    cur.push(p)
    curChars += p.text.length
  }
  if (cur.length > 0) batches.push(cur)
  return batches
}

/** 解析模型输出的【N】分块；返回 编号→译文。 */
export function parseBatchOutput(text: string): Map<number, string> {
  const out = new Map<number, string>()
  const re = /^【(\d+)】[ \t]*/gm
  const marks: { n: number; start: number; end: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    marks.push({ n: Number(m[1]), start: m.index, end: m.index + m[0].length })
  }
  for (let i = 0; i < marks.length; i++) {
    const body = text.slice(marks[i].end, marks[i + 1]?.start ?? text.length).trim()
    if (body) out.set(marks[i].n, body)
  }
  return out
}

export interface ParaProgress {
  blockId: string
  text?: string
  /** 这段译文出自哪个模型 */
  model?: string
  error?: string
  /** 剩余未译段数（0 = 全文完成） */
  remaining: number
  /** 本轮累计 token（输入/输出） */
  usage?: { inputTokens: number; outputTokens: number }
}

/**
 * 全文段落翻译：顺序推进，逐段上报（已完成的段落立即可见，不等全文）。
 * 单段失败记入进度继续下一段；全链路失败（NoRoute）时由上层停止。
 */
export async function translateParas(
  db: Database.Database,
  deps: TranslateDeps,
  paperId: string,
  onProgress: (p: ParaProgress) => void,
  shouldStop: () => boolean = () => false,
  /** 整篇重译：不查缓存，译完覆盖写回（cacheTranslation 是 upsert） */
  force = false
): Promise<void> {
  const blocks = getBlocks(db, paperId)
  // 目标语言在发起时定下来，整轮都用它：途中改设置只影响下一轮
  const lang = targetLang()
  // 标题一并翻译（镜像译文页需要中文标题；短而便宜）
  const paras = blocks.filter((b) => b.kind === 'para' || b.kind === 'heading')
  let remaining = paras.length
  const cum = { inputTokens: 0, outputTokens: 0 }

  // 缓存命中直出，不占请求（重译模式下全部当作未译）
  const uncached: BlockRow[] = []
  for (const b of paras) {
    const hit = force ? undefined : getTranslation(db, b.block_id, deps.glossary.version, promptVersionFor(PROMPT_VERSION, lang))
    if (hit) {
      remaining--
      onProgress({ blockId: b.block_id, text: hit.text, model: hit.model, remaining, usage: { ...cum } })
    } else if (isUntranslatable(b.text, lang)) {
      // 纯数字 / 符号 / 公式碎片：原样即译文，不占请求，也不会一直挂着「未翻译」
      cacheTranslation(db, b, deps.glossary.version, IDENTITY_MODEL, b.text, lang)
      remaining--
      onProgress({ blockId: b.block_id, text: b.text, model: IDENTITY_MODEL, remaining, usage: { ...cum } })
    } else {
      uncached.push(b)
    }
  }

  // 打包 + 并发池：短段拼组一次请求，多路并行
  const batches = makeBatches(uncached)
  const CONCURRENCY = 6

  // 首帧提速：把离视口最近的批次拆出首段单独成批。
  // 单流生成速率有限（实测 ~20 字/s），首段可见时间从「批内首段生成完」
  // 缩到「单独一段生成完」；其余段靠流式增量回填陆续跟上。
  if (batches.length > 1) {
    const focus0 = translateFocus.get(paperId)
    let ni = 0
    if (focus0 !== undefined) {
      let bd = Infinity
      for (let i = 0; i < batches.length; i++) {
        const d = Math.abs(batches[i][0].block_order - focus0)
        if (d < bd) {
          bd = d
          ni = i
        }
      }
    }
    if (batches[ni].length > 1) {
      const [head, ...rest] = batches[ni]
      batches.splice(ni, 1, [head], rest)
    }
  }
  const claimed = new Set<number>()
  let abortAll: string | null = null

  // 视口优先：离当前可见块最近的未认领批次先做；无焦点则按文档序
  const pickNext = (): number => {
    const focus = translateFocus.get(paperId)
    let best = -1
    let bestDist = Infinity
    for (let i = 0; i < batches.length; i++) {
      if (claimed.has(i)) continue
      const dist = focus === undefined ? i : Math.abs(batches[i][0].block_order - focus)
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    }
    return best
  }

  const addUsage = (usage: { inputTokens: number; outputTokens: number }): void => {
    cum.inputTokens += usage.inputTokens
    cum.outputTokens += usage.outputTokens
  }
  const emitOk = (blockId: string, text: string, model?: string): void => {
    remaining--
    onProgress({ blockId, text, model, remaining, usage: { ...cum } })
  }
  const emitErr = (blockId: string, err: unknown): void => {
    remaining--
    onProgress({
      blockId,
      // 段落上显示的错误也要是人话：原始串带 HTTP 状态与 JSON，读者只想知道该做什么
      error: friendlyModelError(err instanceof Error ? err.message : String(err)),
      remaining
    })
  }

  const translateSingle = async (block: BlockRow): Promise<void> => {
    try {
      const result = await translateBlock(db, deps, block, {}, force, lang)
      if (result.usage) addUsage(result.usage)
      emitOk(block.block_id, result.text, result.model)
    } catch (err) {
      emitErr(block.block_id, err)
      // 连一个供应商都没有：全池停下 [P4]；其余失败继续下一段
      if (err instanceof NoRouteError && err.hops.length === 0) abortAll = err.message
    }
  }

  const translateGroup = async (group: BlockRow[]): Promise<void> => {
    if (group.length === 1) {
      await translateSingle(group[0])
      return
    }
    const glossaryLines =
      lang === 'zh'
        ? Object.entries(deps.glossary.terms)
            .map(([en, zh]) => `${en} => ${zh}`)
            .join('\n')
        : ''
    const L = LANG_TEXT[lang]
    const system = [L.translateBatch, L.translateBatchRules, glossaryLines ? `术语表（必须严格采用）：\n${glossaryLines}` : '']
      .filter(Boolean)
      .join('\n\n')
    const user = group.map((b, i) => `【${i + 1}】\n${b.text}`).join('\n\n')

    // 流式增量回填：不等整批生成完——流里一出现【N+1】标记，第 N 段即完成，
    // 立即入库上屏。首段可见时间从「整批耗时」缩到「首段生成时间」。
    // 换供应商重试时 runner 会重新调用，缓冲随之清零；已上屏的段不重复计数。
    const emitted = new Set<string>()
    const drainStream = (buf: string, model: string): void => {
      const marks = [...buf.matchAll(/^【(\d+)】[ \t]*/gm)]
      for (let k = 0; k < marks.length - 1; k++) {
        const b = group[Number(marks[k][1]) - 1]
        if (!b || emitted.has(b.block_id)) continue
        const body = stripMetaPrefix(
          buf.slice((marks[k].index ?? 0) + marks[k][0].length, marks[k + 1].index)
        )
        if (!body) continue
        // 非译文输出不上屏不入库，留给批次收尾按缺段回退逐段处理
        if (looksUntranslated(b.text, body, lang) || !placeholdersMatch(b.text, body)) continue
        emitted.add(b.block_id)
        cacheTranslation(db, b, deps.glossary.version, model, body, lang)
        emitOk(b.block_id, body, model)
      }
    }
    const baseRunner = deps.runner
    const streamingRunner: AttemptRunner = (ep, model, req, onChunk) => {
      let buf = ''
      const tap = (delta: string): void => {
        buf += delta
        drainStream(buf, model)
        onChunk(delta)
      }
      return (baseRunner ?? defaultRunner)(ep, model, req, tap)
    }

    try {
      const out = await runTask(
        'translate',
        {
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          temperature: 0.2
        },
        deps.ctx,
        () => {},
        streamingRunner
      )
      recordUsage(
        db,
        'translate',
        out.attempt.slug,
        out.model,
        out.result.usage.inputTokens,
        out.result.usage.outputTokens
      )
      addUsage(out.result.usage)
      const parsed = parseBatchOutput(out.result.text)
      const misses: BlockRow[] = []
      group.forEach((b, i) => {
        if (emitted.has(b.block_id)) return // 流式阶段已上屏
        const zh0 = parsed.get(i + 1)
        const zh = zh0 ? stripMetaPrefix(zh0) : zh0
        if (zh && !looksUntranslated(b.text, zh, lang) && placeholdersMatch(b.text, zh)) {
          cacheTranslation(db, b, deps.glossary.version, out.model, zh, lang)
          emitOk(b.block_id, zh, out.model)
        } else {
          misses.push(b)
        }
      })
      // 标记对不上的段：退回逐段翻译（宁慢毋错）
      for (const b of misses) {
        if (abortAll !== null || shouldStop()) {
          emitErr(b.block_id, new Error(abortAll ?? uiText('translation.paused')))
          continue
        }
        await translateSingle(b)
      }
    } catch (err) {
      if (err instanceof NoRouteError && err.hops.length === 0) {
        abortAll = err.message
        for (const b of group) {
          if (!emitted.has(b.block_id)) emitErr(b.block_id, err)
        }
        return
      }
      // 整组失败（超长/5xx）：退回逐段。流式阶段已上屏的段不重复处理
      for (const b of group) {
        if (emitted.has(b.block_id)) continue
        if (abortAll !== null || shouldStop()) {
          emitErr(b.block_id, err)
          continue
        }
        await translateSingle(b)
      }
    }
  }

  const worker = async (): Promise<void> => {
    for (;;) {
      if (shouldStop() || abortAll !== null) return
      const i = pickNext()
      if (i < 0) return
      claimed.add(i)
      await translateGroup(batches[i])
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => worker()))

  // 全池中止/暂停：未认领批次补事件，否则 UI 骨架行会永远挂着
  if (abortAll !== null) {
    for (let j = 0; j < batches.length; j++) {
      if (claimed.has(j)) continue
      for (const b of batches[j]) {
        remaining--
        onProgress({ blockId: b.block_id, error: abortAll, remaining })
      }
    }
  }
}

/**
 * 目录单独翻译：全部未译标题打包成一次模型调用（25 条短标题 ~3s，
 * 逐条走全文翻译会等 30s+）。按编号行回填、逐条写入同一份译文缓存——
 * 与全文翻译/镜像页/目录显示完全共享。
 */
export async function translateOutline(
  db: Database.Database,
  deps: TranslateDeps,
  paperId: string,
  onProgress: (p: ParaProgress) => void = () => {}
): Promise<number> {
  const lang = targetLang()
  const headings = getBlocks(db, paperId).filter((b) => b.kind === 'heading')
  const pending = headings.filter(
    (h) => !getTranslation(db, h.block_id, deps.glossary.version, promptVersionFor(PROMPT_VERSION, lang)) && !isUntranslatable(h.text, lang)
  )
  if (pending.length === 0) return 0

  // 术语表是英译中的，只在目标中文时用
  const glossaryLines =
    lang === 'zh'
      ? Object.entries(deps.glossary.terms)
          .map(([en, zh]) => `${en} => ${zh}`)
          .join('\n')
      : ''
  const L = LANG_TEXT[lang]
  const system = [L.headings, L.headingsRules, glossaryLines ? `术语表（必须严格采用）：\n${glossaryLines}` : '']
    .filter(Boolean)
    .join('\n\n')
  const user = pending.map((h, i) => `${i + 1}) ${h.text}`).join('\n')

  const out = await runTask(
    'translate',
    {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.2
    },
    deps.ctx,
    () => {},
    deps.runner
  )
  recordUsage(
    db,
    'translate',
    out.attempt.slug,
    out.model,
    out.result.usage.inputTokens,
    out.result.usage.outputTokens
  )

  // 解析「编号) 译文」行；对不上的行跳过（可重跑补齐），宁缺毋错
  const byIndex = new Map<number, string>()
  for (const line of out.result.text.split('\n')) {
    const m = /^\s*(\d+)\s*[)）.、．]\s*(.+)$/.exec(line)
    if (m) byIndex.set(Number(m[1]), m[2].trim())
  }

  let stored = 0
  pending.forEach((h, i) => {
    const zh = byIndex.get(i + 1)
    // 答成别的语言、原样照抄的行不入缓存（缓存是永久的），留给全文翻译补
    if (!zh || looksUntranslated(h.text, zh, lang)) return
    cacheTranslation(db, h, deps.glossary.version, out.model, zh, lang)
    stored++
    onProgress({ blockId: h.block_id, text: zh, model: out.model, remaining: pending.length - stored })
  })
  return stored
}
