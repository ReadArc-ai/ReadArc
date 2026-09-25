/**
 * AI 阅读笔记生成（工具栏「生成笔记」）：
 * 结构化上下文（标题+目录+各节首段）→ 模型产出要点笔记 → 作为一条笔记落盘，
 * 与手写笔记同文件共存，可在笔记面板编辑/删除。重复点击追加新条目（模型输出不稳定，允许重生成）。
 */
import { uiText } from '../i18n'
import type Database from 'better-sqlite3'
import { recordUsage } from '../db'
import { runTask, type AttemptRunner, type RouterContext } from '../model/router'
import { buildSummaryContext } from '../translate/summary'
import { looksLikeDigest } from '../model/output-check'
import { LANG_TEXT, targetLang } from '../translate/target-lang'
import type { ChatMessage } from '../model/transport'
import { addNote } from './service'
import type { NoteView } from '../../shared/models'


export async function generateReadingNotes(
  db: Database.Database,
  ctx: RouterContext,
  notesDir: string,
  paperId: string,
  runner?: AttemptRunner,
  onDelta: (d: string) => void = () => {},
  /** 第一次输出不合格要重来时调用：渲染端清掉已流出的草稿 */
  onReset: () => void = () => {},
  /** 推理模型的思考流，只给界面展示进度 */
  onThinking: (d: string) => void = () => {},
  /** 用户点「停止」时中止在途请求 */
  signal?: AbortSignal
): Promise<NoteView> {
  const context = buildSummaryContext(db, paperId)
  const lang = targetLang()
  const L = LANG_TEXT[lang]
  // 指令同时放 system 与 user：有的网关会丢掉 system，模型只看到论文文本就会用英文续写
  const messages: ChatMessage[] = [
    { role: 'system', content: `你是论文阅读笔记助手。${L.notes}` },
    { role: 'user', content: `${L.notes}\n\n论文结构摘要如下：\n${context}` }
  ]
  const record = (out: Awaited<ReturnType<typeof runTask>>): void =>
    recordUsage(db, 'notes-gen', out.attempt.slug, out.model, out.result.usage.inputTokens, out.result.usage.outputTokens)
  let out = await runTask('notes', { messages, temperature: 0.3, onThinking, signal }, ctx, onDelta, runner)
  record(out)
  let body = out.result.text.trim()
  if (!looksLikeDigest(body, context, lang)) {
    onReset()
    out = await runTask(
      'notes',
      {
        messages: [...messages, { role: 'assistant', content: body }, { role: 'user', content: L.notesRetry }],
        temperature: 0.3,
        onThinking,
        signal
      },
      ctx,
      onDelta,
      runner
    )
    record(out)
    body = out.result.text.trim()
    if (!looksLikeDigest(body, context, lang)) {
      throw new Error(L.notesFail(out.model))
    }
  }
  // 标题行跟目标语言走，英文笔记里不该出现中文标题
  const text = `**${L.notesHeading}**（${out.model}）\n\n${body}`
  const anchor = anchorBlockFor(db, paperId)
  if (!anchor) throw new Error(uiText('paper.pending'))
  return addNote(db, notesDir, paperId, anchor, text)
}

/**
 * 整篇维度的笔记锚在哪：优先第一个标题块（论文题目），没有标题再取首块。
 * 首块常常是页眉的版权声明或 arXiv 水印，锚在那里笔记文件里的摘录没法看。
 */
export function anchorBlockFor(db: Database.Database, paperId: string): string | null {
  const row = db
    .prepare(
      "SELECT block_id FROM blocks WHERE paper_id = ? ORDER BY CASE WHEN kind = 'heading' THEN 0 ELSE 1 END, block_order LIMIT 1"
    )
    .get(paperId) as { block_id: string } | undefined
  return row?.block_id ?? null
}
