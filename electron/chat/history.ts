import { uiText } from '../i18n'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ChatAnswer, ChatSession, ChatStoredMessage } from '../../shared/models'

interface SessionRow {
  id: string
  paper_id: string
  title: string | null
  created_at: number
  updated_at: number
}

interface MessageRow {
  role: 'user' | 'assistant'
  text: string
  persona: string | null
  citations_json: string | null
  model: string | null
  cost_usd: number | null
  tokens: number | null
  hops_json: string | null
  stopped: number
  image: string | null
  thinking: string | null
}

const view = (row: SessionRow): ChatSession => ({
  id: row.id,
  paperId: row.paper_id,
  title: row.title,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

function parseArray<T>(json: string | null): T[] | undefined {
  if (!json) return undefined
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) ? (value as T[]) : undefined
  } catch {
    return undefined
  }
}

function titleFromQuestion(question: string): string {
  // “问选中段落”会把引用上下文放在问题前；会话标题应该用用户真正输入的问题。
  const quoted = question.match(/^关于这段：「[\s\S]*?」\n\n([\s\S]+)$/)
  return (quoted?.[1] ?? question).replace(/\s+/g, ' ').trim().slice(0, 48)
}

export function listChatSessions(db: Database.Database, paperId: string): ChatSession[] {
  const rows = db
    .prepare('SELECT * FROM chat_sessions WHERE paper_id = ? ORDER BY updated_at DESC, created_at DESC')
    .all(paperId) as SessionRow[]
  return rows.map(view)
}

export function createChatSession(db: Database.Database, paperId: string): ChatSession {
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    'INSERT INTO chat_sessions (id, paper_id, title, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)'
  ).run(id, paperId, now, now)
  return { id, paperId, title: null, createdAt: now, updatedAt: now }
}

export function chatSessionBelongsToPaper(
  db: Database.Database,
  sessionId: string,
  paperId: string
): boolean {
  return !!db
    .prepare('SELECT 1 FROM chat_sessions WHERE id = ? AND paper_id = ?')
    .get(sessionId, paperId)
}

export function listChatMessages(
  db: Database.Database,
  paperId: string,
  sessionId: string
): ChatStoredMessage[] {
  if (!chatSessionBelongsToPaper(db, sessionId, paperId)) return []
  const rows = db
    .prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id')
    .all(sessionId) as MessageRow[]
  return rows.map((row) => ({
    role: row.role,
    text: row.text,
    ...(row.persona ? { persona: row.persona } : {}),
    ...(row.citations_json ? { citations: parseArray(row.citations_json) } : {}),
    ...(row.model ? { model: row.model } : {}),
    ...(row.cost_usd !== null ? { costUsd: row.cost_usd } : {}),
    ...(row.tokens !== null ? { tokens: row.tokens } : {}),
    ...(row.hops_json ? { hops: parseArray<string>(row.hops_json) } : {}),
    ...(row.stopped === 1 ? { stopped: true } : {}),
    ...(row.image ? { image: row.image } : {}),
    ...(row.thinking ? { thinking: row.thinking } : {})
  }))
}

/** 一轮完整返回后原子写入用户问题和回答，避免只留下半轮历史。 */
export function appendChatTurn(
  db: Database.Database,
  paperId: string,
  sessionId: string,
  question: string,
  persona: string | undefined,
  answer: ChatAnswer,
  /** 截图提问附的图（PNG data URL），挂在用户消息上 */
  image?: string
): void {
  if (!chatSessionBelongsToPaper(db, sessionId, paperId)) {
    throw new Error(uiText('chat.paper'))
  }
  const now = Date.now()
  const insert = db.prepare(
    `INSERT INTO chat_messages
       (session_id, role, text, persona, citations_json, model, cost_usd, tokens, hops_json, stopped, created_at, image, thinking)
     VALUES
       (@sessionId, @role, @text, @persona, @citations, @model, @costUsd, @tokens, @hops, @stopped, @createdAt, @image, @thinking)`
  )
  db.transaction(() => {
    insert.run({
      sessionId,
      role: 'user',
      text: question,
      persona: persona && persona !== 'default' ? persona : null,
      citations: null,
      model: null,
      costUsd: null,
      tokens: null,
      hops: null,
      stopped: 0,
      createdAt: now,
      image: image ?? null,
      thinking: null
    })
    insert.run({
      sessionId,
      role: 'assistant',
      text: answer.text,
      persona: null,
      citations: JSON.stringify(answer.citations),
      model: answer.model || null,
      costUsd: answer.costUsd,
      tokens: answer.usage.inputTokens + answer.usage.outputTokens,
      hops: JSON.stringify(answer.hops),
      stopped: answer.stopped ? 1 : 0,
      createdAt: now + 1,
      image: null,
      thinking: answer.thinking ?? null
    })
    db.prepare(
      `UPDATE chat_sessions
          SET title = COALESCE(title, ?), updated_at = MAX(updated_at + 1, ?)
        WHERE id = ?`
    ).run(titleFromQuestion(question), now, sessionId)
  })()
}

/** 重命名会话：空标题写回 NULL（恢复「取首个问题」的自动标题）；标题截到 80 字 */
export function renameChatSession(
  db: Database.Database,
  paperId: string,
  sessionId: string,
  title: string
): boolean {
  const clean = title.replace(/\s+/g, ' ').trim().slice(0, 80)
  return (
    db
      .prepare('UPDATE chat_sessions SET title = ? WHERE id = ? AND paper_id = ?')
      .run(clean || null, sessionId, paperId).changes > 0
  )
}

export function deleteChatSession(
  db: Database.Database,
  paperId: string,
  sessionId: string
): boolean {
  return db
    .prepare('DELETE FROM chat_sessions WHERE id = ? AND paper_id = ?')
    .run(sessionId, paperId).changes > 0
}
