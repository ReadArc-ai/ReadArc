import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { deletePaperData, openDb, upsertPaper } from '../db'
import {
  appendChatTurn,
  createChatSession,
  deleteChatSession,
  listChatMessages,
  listChatSessions,
  renameChatSession
} from './history'

let db: Database.Database
const paperId = 'paper-a'

beforeEach(() => {
  db = openDb(':memory:')
  upsertPaper(db, { id: paperId, file_path: '/a.pdf', added_at: 1 })
})

afterEach(() => db.close())

describe('对话历史', () => {
  it('按论文创建多会话，完成一轮后用首问命名并恢复完整消息元数据', () => {
    const older = createChatSession(db, paperId)
    const current = createChatSession(db, paperId)

    appendChatTurn(db, paperId, current.id, '  这篇论文的核心方法是什么？  ', 'reviewer', {
      text: '核心方法是检索增强。[B2]',
      citations: [{ marker: '[B2]', order: 2, page: 3, section: '§2 Method' }],
      model: 'mock-model',
      usage: { inputTokens: 20, outputTokens: 8 },
      costUsd: 0.001,
      stopped: true,
      hops: ['主模型']
    })

    const sessions = listChatSessions(db, paperId)
    expect(sessions.map((s) => s.id)).toEqual([current.id, older.id])
    expect(sessions[0].title).toBe('这篇论文的核心方法是什么？')
    expect(listChatMessages(db, paperId, current.id)).toEqual([
      { role: 'user', text: '  这篇论文的核心方法是什么？  ', persona: 'reviewer' },
      {
        role: 'assistant',
        text: '核心方法是检索增强。[B2]',
        citations: [{ marker: '[B2]', order: 2, page: 3, section: '§2 Method' }],
        model: 'mock-model',
        costUsd: 0.001,
        tokens: 28,
        hops: ['主模型'],
        stopped: true
      }
    ])
  })

  it('会话不能跨论文读取或删除', () => {
    const session = createChatSession(db, paperId)
    upsertPaper(db, { id: 'paper-b', file_path: '/b.pdf', added_at: 2 })

    expect(listChatMessages(db, 'paper-b', session.id)).toEqual([])
    expect(deleteChatSession(db, 'paper-b', session.id)).toBe(false)
    expect(listChatSessions(db, paperId)).toHaveLength(1)
  })

  it('删除会话清消息；删除论文级联清全部会话', () => {
    const first = createChatSession(db, paperId)
    const second = createChatSession(db, paperId)
    appendChatTurn(db, paperId, first.id, '问题', undefined, {
      text: '回答',
      citations: [],
      model: 'm',
      usage: { inputTokens: 1, outputTokens: 1 },
      costUsd: null,
      hops: []
    })

    expect(deleteChatSession(db, paperId, first.id)).toBe(true)
    expect(listChatMessages(db, paperId, first.id)).toEqual([])
    expect(listChatSessions(db, paperId).map((s) => s.id)).toEqual([second.id])

    deletePaperData(db, paperId)
    expect(listChatSessions(db, paperId)).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get()).toEqual({ n: 0 })
  })
})

describe('会话重命名', () => {
  const answer = {
    text: '回答',
    citations: [],
    model: 'm',
    usage: { inputTokens: 1, outputTokens: 1 },
    costUsd: null,
    hops: []
  }

  it('改名后列表里是新名字；空名字恢复自动标题（首个问题）；标题规整空白并截到 80 字', () => {
    const s = createChatSession(db, paperId)
    appendChatTurn(db, paperId, s.id, '首个问题', undefined, answer)
    expect(renameChatSession(db, paperId, s.id, '  我的  会话 ')).toBe(true)
    expect(listChatSessions(db, paperId)[0].title).toBe('我的 会话')
    expect(renameChatSession(db, paperId, s.id, '   ')).toBe(true)
    expect(listChatSessions(db, paperId)[0].title).toBeNull()
    // 自动标题只在 title 为 NULL 时补：下一轮问答会把它填回首问
    appendChatTurn(db, paperId, s.id, '第二个问题', undefined, answer)
    expect(listChatSessions(db, paperId)[0].title).toBe('第二个问题')
    renameChatSession(db, paperId, s.id, 'x'.repeat(200))
    expect(listChatSessions(db, paperId)[0].title).toHaveLength(80)
  })

  it('不能跨论文改名', () => {
    upsertPaper(db, { id: 'paper-b', file_path: '/b.pdf', added_at: 1 })
    const s = createChatSession(db, paperId)
    expect(renameChatSession(db, 'paper-b', s.id, '别人的')).toBe(false)
    expect(listChatSessions(db, paperId)[0].title).toBeNull()
  })

  it('截图与思考流随历史落库：用户消息带 image，回答带 thinking，重开会话还能看到', () => {
    const s = createChatSession(db, paperId)
    const png = 'data:image/png;base64,iVBORw0KGgo='
    appendChatTurn(
      db,
      paperId,
      s.id,
      '这个公式啥意思',
      undefined,
      { text: '这是注意力公式。', citations: [], model: 'm', usage: { inputTokens: 1, outputTokens: 1 }, costUsd: null, hops: [], thinking: '先看分母……' },
      png
    )
    const msgs = listChatMessages(db, paperId, s.id)
    expect(msgs[0]).toMatchObject({ role: 'user', text: '这个公式啥意思', image: png })
    expect(msgs[0].thinking).toBeUndefined()
    expect(msgs[1]).toMatchObject({ role: 'assistant', thinking: '先看分母……' })
    expect(msgs[1].image).toBeUndefined()
  })
})
