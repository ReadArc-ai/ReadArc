import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, replaceBlocks, upsertPaper, type BlockRow } from '../db'
import { blockId, sha1, simhash64 } from '../docengine/anchor'
import { startMockServer, type MockServer } from '../model/mock-server'
import { askQuestion, stopQuestion } from './service'

const paperId = sha1('pdf')
let db: Database.Database
let base: string
let mock: MockServer

const sse = (content: string): string => JSON.stringify({ choices: [{ delta: { content } }] })

function block(order: number, text: string): BlockRow {
  return {
    block_id: blockId(paperId, 1, order),
    paper_id: paperId,
    page: 1,
    block_order: order,
    kind: 'para',
    section: '§1',
    text,
    bbox: null,
    simhash: simhash64(text),
    heading_level: null,
    font_size: null
  }
}

beforeEach(async () => {
  db = openDb(':memory:')
  upsertPaper(db, { id: paperId, file_path: '/x.pdf', title: 'Attention', added_at: 1 })
  replaceBlocks(db, paperId, [block(0, 'Attention is all you need.'), block(1, 'We propose the Transformer.')])

  base = mkdtempSync(join(tmpdir(), 'readarc-chat-'))
  const readarcDir = join(base, '.readarc')
  mkdirSync(readarcDir, { recursive: true })
  // 服务层通过 READARC_DIR 找配置；两个本机来源：默认模型走 m1（慢速流），m2 是降级链上的兜底
  process.env['READARC_DIR'] = readarcDir

  mock = await startMockServer([
    {
      path: '/v1/chat/completions',
      sse: [sse('第一'), sse('第二'), sse('第三'), JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 3 } })],
      sseDelayMs: 120
    },
    { path: '/other/chat/completions', sse: [sse('fallback')] }
  ])
  writeFileSync(
    join(readarcDir, 'config.yaml'),
    [
      'providers:',
      '  m1:',
      '    name: Mock',
      `    base_url: "${mock.url}/v1"`,
      '  m2:',
      '    name: Mock Fallback',
      `    base_url: "${mock.url}/other"`,
      'main:',
      '  provider: m1',
      '  model: mock-1',
      ''
    ].join('\n')
  )
})

afterEach(async () => {
  db.close()
  await mock.close()
  rmSync(base, { recursive: true, force: true })
  delete process.env['READARC_DIR']
})

describe('对话中途停止', () => {
  it('停止后带回已生成的部分（stopped=true），且不会顺着降级链再去请求下一家', async () => {
    const deltas: string[] = []
    const answer = await askQuestion(db, paperId, 'What does the paper propose?', [], (d) => {
      deltas.push(d)
      if (deltas.length === 1) stopQuestion(paperId)
    })
    expect(answer.stopped).toBe(true)
    expect(answer.text).toBe('第一')
    expect(answer.model).toBe('mock-1')
    // 只发出过这一次请求：没有去 m2 兜底，也没有去列模型
    expect(mock.requests.map((r) => r.path)).toEqual(['/v1/chat/completions'])
  })

  it('不停止时正常跑完：stopped 不出现，用量照记', async () => {
    const answer = await askQuestion(db, paperId, 'What does the paper propose?', [], () => {})
    expect(answer.stopped).toBeUndefined()
    expect(answer.text).toBe('第一第二第三')
    expect(answer.model).toBe('mock-1')
    expect(answer.usage).toEqual({ inputTokens: 10, outputTokens: 3 })
  })

  it('没有在途回答时停止是空操作', () => {
    expect(() => stopQuestion(paperId)).not.toThrow()
  })
})

describe('讲法（读者人设）经服务层进入请求', () => {
  it('太奶模式的人设段出现在发给模型的系统提示词里；整篇标记换成各节首段上下文', async () => {
    await askQuestion(db, paperId, '把这篇论文唠一遍', [], () => {}, { persona: 'grandma', whole: true })
    const body = JSON.parse(mock.requests[0].body) as { messages: { role: string; content: string }[] }
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content).toContain('80 岁')
    expect(body.messages[0].content).toContain('不许发明标号')
    expect(body.messages[1].content).toContain('论文各节开头')
  })

  it('自定义讲法：按 id 在用户列表里解析，要求原样进系统提示词', async () => {
    await askQuestion(db, paperId, 'q', [], () => {}, { persona: 'custom-1' }, [
      { id: 'custom-1', name: 'PM', style: '讲法：读者是产品经理。' }
    ])
    const body = JSON.parse(mock.requests[0].body) as { messages: { content: string }[] }
    expect(body.messages[0].content).toContain('产品经理')
  })

  it('不带选项时与从前一样：克制、具体，按问句检索', async () => {
    await askQuestion(db, paperId, 'What does the paper propose?', [], () => {})
    const body = JSON.parse(mock.requests[0].body) as { messages: { content: string }[] }
    expect(body.messages[0].content).toContain('克制、具体')
    expect(body.messages[1].content).toContain('论文片段')
  })
})
