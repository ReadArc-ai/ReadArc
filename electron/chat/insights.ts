/**
 * 两个克制的 AI 增值点：
 * - 找矛盾（唯一的笔记 AI 功能）——指出哪几条笔记引用了结论相反的论文
 * - 检索总结（末尾虚线卡）——这批结果里先读哪篇、分几派
 */
import { uiText } from '../i18n'
import { LANG_TEXT, targetLang } from '../translate/target-lang'
import type Database from 'better-sqlite3'
import { allPaperRows, recordUsage } from '../db'
import { runTask } from '../model/router'
import { buildRouterContext } from '../translate/service'
import { notesForPaper } from '../notes/service'
import type { ChatMessage } from '../model/transport'
import type { SearchResultInput } from '../../shared/models'

export interface InsightResult {
  text: string
  model: string
}

export interface NoteItem {
  paper: string
  excerpt: string
  note: string
}

export function buildContradictionsMessages(items: NoteItem[]): ChatMessage[] {
  const listing = items
    .map((it, i) => `${i + 1}. 《${it.paper}》\n   原文摘录：${it.excerpt}\n   我的笔记：${it.note}`)
    .join('\n')
  return [
    {
      role: 'system',
      content:
        '你是文献综述助手。用户给出跨论文的笔记列表。找出结论互相矛盾或紧张的笔记组合（引用编号），说明矛盾点在哪、可能的原因（数据集/设定/口径差异）。没有矛盾就直说没有，不要硬找。' + LANG_TEXT[targetLang()].contradictionsTail
    },
    { role: 'user', content: listing }
  ]
}

export async function findContradictions(db: Database.Database, notesDir: string, onDelta: (d: string) => void = () => {}): Promise<InsightResult> {
  const items: NoteItem[] = []
  for (const paper of allPaperRows(db)) {
    const notes = notesForPaper(db, notesDir, paper.id)
    for (const e of notes.entries) {
      items.push({
        paper: paper.title ?? paper.file_path,
        excerpt: e.anchor?.excerpt ?? '',
        note: e.text
      })
    }
  }
  if (items.length < 2) {
    throw new Error(uiText('insights.notes'))
  }
  const out = await runTask(
    'ask',
    { messages: buildContradictionsMessages(items.slice(0, 60)), temperature: 0.3 },
    buildRouterContext(),
    onDelta
  )
  recordUsage(db, 'ask', out.attempt.slug, out.model, out.result.usage.inputTokens, out.result.usage.outputTokens)
  return { text: out.result.text.trim(), model: out.model }
}

export function buildSearchSummaryMessages(
  query: string,
  results: SearchResultInput[]
): ChatMessage[] {
  const listing = results
    .slice(0, 12)
    .map(
      (r, i) =>
        `${i + 1}. ${r.title}（${[r.source, r.year, r.citations != null ? `被引${r.citations}` : '']
          .filter(Boolean)
          .join(' · ')}）${r.abstract ? `\n   摘要：${r.abstract.slice(0, 300)}` : ''}`
    )
    .join('\n')
  return [
    {
      role: 'system',
      content:
        '你是论文检索助手。基于给出的检索结果列表回答：这批结果大致分几派、共识与分歧是什么、如果只读两篇先读哪两篇（给编号和一句理由）。只依据列表信息，不编造。' + LANG_TEXT[targetLang()].searchSummaryTail
    },
    { role: 'user', content: `检索问题：${query}\n\n结果：\n${listing}` }
  ]
}

export async function summarizeSearch(
  db: Database.Database,
  query: string,
  results: SearchResultInput[],
  onDelta: (d: string) => void = () => {}
): Promise<InsightResult> {
  if (results.length === 0) throw new Error(uiText('insights.search'))
  const out = await runTask(
    'ask',
    { messages: buildSearchSummaryMessages(query, results), temperature: 0.3 },
    buildRouterContext(),
    onDelta
  )
  recordUsage(db, 'ask', out.attempt.slug, out.model, out.result.usage.inputTokens, out.result.usage.outputTokens)
  return { text: out.result.text.trim(), model: out.model }
}
