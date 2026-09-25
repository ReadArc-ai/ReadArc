/**
 * AI 三句话摘要（P1）：按需生成一次并缓存；
 * 必须包含「适用边界 / 局限」一句，不做无脑吹捧。
 * 上下文用结构摘要（标题 + 各节首段），不塞全文。
 */
import { restoreInlines } from '../../shared/inline-formula'
import type Database from 'better-sqlite3'
import { getBlocks, getPaper, recordUsage, type BlockRow } from '../db'
import { runTask, type AttemptRunner, type RouterContext } from '../model/router'
import type { ChatMessage } from '../model/transport'
import { looksLikeDigest } from '../model/output-check'
import { LANG_TEXT, promptVersionFor, targetLang } from './target-lang'

export const SUMMARY_PROMPT_VERSION = 1
const CONTEXT_CHAR_BUDGET = 6000


/**
 * 指令同时放在 system 与 user 里：有的网关会丢掉 system 消息，
 * 模型只看到论文文本时会用原文语言续写或直接复述，看起来就是「摘要变英文了」。
 */
export function summaryMessages(context: string, lang = targetLang()): ChatMessage[] {
  const instruction = LANG_TEXT[lang].summary
  return [
    { role: 'system', content: `你是论文速读助手。${instruction}` },
    { role: 'user', content: `${instruction}\n\n论文结构摘要如下：\n${context}` }
  ]
}

export interface SummaryRow {
  text: string
  model: string
  created_at: number
}

export function getCachedSummary(db: Database.Database, paperId: string): SummaryRow | null {
  return (
    (db
      .prepare(
        'SELECT text, model, created_at FROM summaries WHERE paper_id = ? AND prompt_version = ?'
      )
      .get(paperId, promptVersionFor(SUMMARY_PROMPT_VERSION, targetLang())) as SummaryRow | undefined) ?? null
  )
}

/** 结构化上下文：标题 + 目录 + 每节首段，控制在字符预算内。 */
export function buildSummaryContext(db: Database.Database, paperId: string): string {
  const paper = getPaper(db, paperId)
  return assembleSummaryContext(paper?.title ?? '', getBlocks(db, paperId))
}

/** 纯函数部分：标题 + 目录 + 每节首段；没解析出任何标题的论文（扫描件、排版简单的稿子）退回正文开头几段，
 *  否则模型只拿到一个标题，会凭标题编一篇不存在的论文。 */
export function assembleSummaryContext(title: string, blocks: Pick<BlockRow, 'kind' | 'section' | 'text' | 'inlines'>[]): string {
  const parts: string[] = [`Title: ${title}`]
  const sections = new Set<string>()
  let bodyAdded = false
  for (const b of blocks) {
    if (b.kind === 'heading') {
      parts.push(`\n## ${b.text}`)
      sections.add(b.text)
    } else if (b.kind === 'para' && b.section && sections.has(b.section)) {
      parts.push(restoreInlines(b.text, b.inlines))
      bodyAdded = true
      sections.delete(b.section) // 每节只取首段
    }
  }
  if (!bodyAdded) {
    for (const b of blocks) if (b.kind === 'para') parts.push(restoreInlines(b.text, b.inlines))
  }
  let out = ''
  for (const p of parts) {
    if (out.length + p.length > CONTEXT_CHAR_BUDGET) break
    out += p + '\n'
  }
  return out
}

export async function generateSummary(
  db: Database.Database,
  ctx: RouterContext,
  paperId: string,
  runner?: AttemptRunner,
  onDelta: (d: string) => void = () => {},
  /** 无视缓存重新生成（换了模型、或上一次生成得不好） */
  force = false,
  /** 第一次输出不合格要重来时调用：让渲染端把已流出的文字清掉，别把两次接在一起 */
  onReset: () => void = () => {},
  /** 推理模型的思考流，只给界面展示进度 */
  onThinking: (d: string) => void = () => {},
  /** 用户点「停止」时中止在途请求 */
  signal?: AbortSignal
): Promise<SummaryRow> {
  const cached = force ? null : getCachedSummary(db, paperId)
  if (cached) return cached

  const context = buildSummaryContext(db, paperId)
  const lang = targetLang()
  const L = LANG_TEXT[lang]
  const messages = summaryMessages(context, lang)
  let out = await runTask('summary', { messages, temperature: 0.3, onThinking, signal }, ctx, onDelta, runner)
  recordUsage(db, 'summary', out.attempt.slug, out.model, out.result.usage.inputTokens, out.result.usage.outputTokens)
  let text = out.result.text.trim()
  if (!looksLikeDigest(text, context, lang)) {
    // 英文或照抄原文：把这次的输出当反例再要一次；仍不合格就报错，不缓存
    onReset()
    out = await runTask(
      'summary',
      {
        messages: [...messages, { role: 'assistant', content: text }, { role: 'user', content: L.summaryRetry }],
        temperature: 0.3,
        onThinking,
        signal
      },
      ctx,
      onDelta,
      runner
    )
    recordUsage(db, 'summary', out.attempt.slug, out.model, out.result.usage.inputTokens, out.result.usage.outputTokens)
    text = out.result.text.trim()
    if (!looksLikeDigest(text, context, lang)) {
      throw new Error(L.summaryFail(out.model))
    }
  }
  db.prepare(
    `INSERT INTO summaries (paper_id, prompt_version, model, text, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(paper_id, prompt_version) DO UPDATE SET text = excluded.text, model = excluded.model`
  ).run(paperId, promptVersionFor(SUMMARY_PROMPT_VERSION, lang), out.model, text, Date.now())
  return { text, model: out.model, created_at: Date.now() }
}
