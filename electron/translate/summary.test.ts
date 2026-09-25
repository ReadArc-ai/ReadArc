import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb, replaceBlocks, upsertPaper, type BlockRow } from '../db'
import { blockId, sha1, simhash64 } from '../docengine/anchor'
import { DEFAULT_ROUTES } from '../config/tasks-config'
import type { ProviderDef } from '../config/providers-config'
import type { AttemptRunner, RouterContext } from '../model/router'
import type { ChatMessage } from '../model/transport'
import { assembleSummaryContext, generateSummary, getCachedSummary, summaryMessages } from './summary'

const paperId = sha1('react.pdf')
let db: Database.Database

const gateway: ProviderDef = {
  slug: 'gateway',
  name: 'Gateway',
  baseUrl: 'https://gateway.example/v1',
  keyEnv: 'GATEWAY_API_KEY',
  transport: 'openai_chat',
  source: 'readarc'
}

const ctx: RouterContext = {
  providers: [gateway],
  routes: DEFAULT_ROUTES,
  mainModel: { provider: 'gateway', model: 'claude-opus-5' },
  resolveKey: () => 'sk-test'
}

const ENGLISH_ECHO =
  'ReAct outperforms Act consistently Table 1 shows HotpotQA and Fever results using PaLM-540B as the base model with different prompting methods.'
const CHINESE = 'ReAct 让模型交替产出推理轨迹与行动，在问答与事实核查任务上稳定优于只行动的基线。结论只在 PaLM-540B 上验证过，别的模型未必成立。'

function block(order: number, text: string, kind: BlockRow['kind'], section: string): BlockRow {
  return {
    block_id: blockId(paperId, 1, order),
    paper_id: paperId,
    page: 1,
    block_order: order,
    kind,
    section,
    text,
    bbox: null,
    simhash: simhash64(text),
    heading_level: kind === 'heading' ? 1 : null,
    font_size: null
  }
}

/** 按顺序吐出给定文本的假模型，并记下每次收到的消息 */
function scripted(texts: string[]): { runner: AttemptRunner; calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = []
  const runner: AttemptRunner = async (_ep, _model, req, onChunk) => {
    calls.push(req.messages)
    const text = texts[Math.min(calls.length - 1, texts.length - 1)]
    onChunk(text)
    return { text, usage: { inputTokens: 10, outputTokens: 5 } }
  }
  return { runner, calls }
}

beforeEach(() => {
  db = openDb(':memory:')
  upsertPaper(db, { id: paperId, file_path: '/react.pdf', title: 'ReAct', added_at: 1 })
  replaceBlocks(db, paperId, [
    block(0, '3.3 Results', 'heading', '3.3 Results'),
    block(1, ENGLISH_ECHO + ' We note that ReAct is better than Act on both tasks.', 'para', '3.3 Results')
  ])
})

describe('摘要提示词', () => {
  it('指令同时出现在 system 与 user 消息里（防网关丢 system）', () => {
    const msgs = summaryMessages('CTX')
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('三句中文')
    expect(msgs[1].role).toBe('user')
    expect(msgs[1].content).toContain('三句中文')
    expect(msgs[1].content).toContain('CTX')
  })
})

describe('摘要输出体检', () => {
  it('第一次是英文照抄：带着它再要一次，第二次合格就用第二次并缓存', async () => {
    const { runner, calls } = scripted([ENGLISH_ECHO, CHINESE])
    const streamed: string[] = []
    let resets = 0
    const row = await generateSummary(db, ctx, paperId, runner, (d) => streamed.push(d), false, () => resets++)
    expect(row.text).toBe(CHINESE)
    expect(calls).toHaveLength(2)
    expect(calls[1].at(-2)).toEqual({ role: 'assistant', content: ENGLISH_ECHO })
    expect(calls[1].at(-1)?.content).toContain('必须是中文')
    expect(resets).toBe(1) // 重来前清掉已流出的英文
    expect(streamed).toEqual([ENGLISH_ECHO, CHINESE])
    expect(getCachedSummary(db, paperId)?.text).toBe(CHINESE)
  })

  it('两次都不合格：报错说明原因，什么都不缓存', async () => {
    const { runner, calls } = scripted([ENGLISH_ECHO, ENGLISH_ECHO])
    await expect(generateSummary(db, ctx, paperId, runner)).rejects.toThrow(/中文摘要/)
    expect(calls).toHaveLength(2)
    expect(getCachedSummary(db, paperId)).toBeNull()
  })

  it('第一次就合格：只调一次', async () => {
    const { runner, calls } = scripted([CHINESE])
    const row = await generateSummary(db, ctx, paperId, runner)
    expect(row.text).toBe(CHINESE)
    expect(calls).toHaveLength(1)
  })
})

describe('摘要上下文', () => {
  it('有标题结构：标题 + 目录 + 每节首段', () => {
    const ctx = assembleSummaryContext('T', [
      { kind: 'heading', section: null, text: 'Intro' },
      { kind: 'para', section: 'Intro', text: 'first para' },
      { kind: 'para', section: 'Intro', text: 'second para' }
    ])
    expect(ctx).toContain('## Intro')
    expect(ctx).toContain('first para')
    expect(ctx).not.toContain('second para')
  })
  it('没解析出标题：退回正文开头的段落，不能只给模型一个标题', () => {
    const ctx = assembleSummaryContext('cjk', [
      { kind: 'para', section: null, text: '本文提出一种面向长文档的稀疏注意力机制。' }
    ])
    expect(ctx).toContain('稀疏注意力')
  })
})
