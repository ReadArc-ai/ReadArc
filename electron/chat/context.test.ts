import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb, putTranslation, replaceBlocks, upsertPaper, type BlockRow } from '../db'
import { blockId, sha1, simhash64 } from '../docengine/anchor'
import { CHAT_PERSONAS } from '../../shared/models'
import { resolvePersonaStyle } from './persona'
import {
  buildChatContext,
  buildMessages,
  cjkTermsFromQuestion,
  ftsQueryFromQuestion,
  isBroadQuestion,
  resolveCitations
} from './context'

let db: Database.Database
const paperId = sha1('pdf')

function block(order: number, text: string, kind: BlockRow['kind'] = 'para', section = '§3 Method'): BlockRow {
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

beforeEach(() => {
  db = openDb(':memory:')
  upsertPaper(db, { id: paperId, file_path: '/x.pdf', title: 'RASR', added_at: 1 })
  replaceBlocks(db, paperId, [
    block(0, '3 Method', 'heading'),
    block(1, 'The retrieval index stores acoustic exemplars.'),
    block(2, 'Training uses eight thousand hours of audio.'),
    block(3, 'WER drops by 14.2 percent relative on test-other.')
  ])
})

describe('ftsQueryFromQuestion', () => {
  it('英文词与中文单字都进查询且加引号', () => {
    const q = ftsQueryFromQuestion('retrieval 索引怎么建的？')
    expect(q).toContain('"retrieval"')
    expect(q).toContain('"索"')
    expect(q).toContain('"引"')
  })
  it('无有效词返回 null', () => {
    expect(ftsQueryFromQuestion('？！')).toBeNull()
  })
})

describe('buildChatContext', () => {
  it('命中块带 [B序号] 标签与章节页码；标号进 targets 映射', () => {
    const ctx = buildChatContext(db, paperId, 'how is the retrieval index built?')
    expect(ctx.contextBlock).toContain('[B1]（§3 Method · p.1）The retrieval index')
    expect(ctx.targets.get(1)?.blockId).toBe(blockId(paperId, 1, 1))
    expect(ctx.contextBlock).toContain('《RASR》')
    expect(ctx.contextBlock).toContain('目录：3 Method')
  })

  it('检索无命中时兜底取开头段落，绝不返回空上下文', () => {
    const ctx = buildChatContext(db, paperId, 'zzzz')
    expect(ctx.targets.size).toBeGreaterThan(0)
  })

  it('系统提示词禁止编造标号', () => {
    const ctx = buildChatContext(db, paperId, 'x')
    expect(ctx.system).toContain('不许发明标号')
  })
})

describe('讲法（读者人设）', () => {
  it('默认讲法：系统提示词保持克制、具体的要求', () => {
    const ctx = buildChatContext(db, paperId, 'x')
    expect(ctx.system).toContain('克制、具体')
  })

  it('太奶模式：系统提示词带人设段，事实规则与引用规则原样保留', () => {
    const ctx = buildChatContext(db, paperId, 'x', { style: resolvePersonaStyle('grandma') })
    expect(ctx.system).toContain('80 岁')
    expect(ctx.system).toContain('不要编造')
    expect(ctx.system).toContain('不许发明标号')
    expect(ctx.system).not.toContain('克制、具体')
  })

  it('五种内置讲法各有不同的人设段', () => {
    const systems = CHAT_PERSONAS.filter((p) => p !== 'default').map(
      (persona) => buildChatContext(db, paperId, 'x', { style: resolvePersonaStyle(persona) }).system
    )
    expect(new Set(systems).size).toBe(5)
  })

  it('自定义讲法的要求原样进系统提示词；未知 id 与空白要求按默认处理', () => {
    const custom = [{ id: 'custom-1', name: 'PM', style: '讲法：读者是产品经理，先讲能做什么功能。' }]
    expect(buildChatContext(db, paperId, 'x', { style: resolvePersonaStyle('custom-1', custom) }).system).toContain('产品经理')
    expect(buildChatContext(db, paperId, 'x', { style: resolvePersonaStyle('nope', custom) }).system).toContain('克制、具体')
    expect(buildChatContext(db, paperId, 'x', { style: '   ' }).system).toContain('克制、具体')
  })

  it('整篇提问：按目录取各节首段（太短的首段跳过），不按问句检索', () => {
    replaceBlocks(db, paperId, [
      block(0, '1 Introduction', 'heading', '1 Introduction'),
      block(1, 'Intro lead paragraph that is long enough to count as a real paragraph.', 'para', '1 Introduction'),
      block(2, 'Intro second paragraph mentioning retrieval index details.', 'para', '1 Introduction'),
      block(3, '2 Method', 'heading', '2 Method'),
      block(4, 'Figure 1: overview.', 'para', '2 Method'),
      block(5, 'Method lead paragraph describing the retrieval index construction in detail.', 'para', '2 Method')
    ])
    const ctx = buildChatContext(db, paperId, 'retrieval index', { whole: true })
    expect([...ctx.targets.keys()].sort((a, b) => a - b)).toEqual([1, 5])
    expect(ctx.contextBlock).toContain('论文各节开头')
  })

  it('整篇提问但各节都没有像样的段落：退回均匀取样，绝不返回空上下文', () => {
    replaceBlocks(db, paperId, [
      block(0, '1 Intro', 'heading', '1 Intro'),
      block(1, 'short one', 'para', '1 Intro'),
      block(2, 'short two', 'para', '1 Intro')
    ])
    const ctx = buildChatContext(db, paperId, 'x', { whole: true })
    expect(ctx.targets.size).toBeGreaterThan(0)
  })
})

describe('resolveCitations（100% 跳对的机制）', () => {
  it('只保留映射内的标号；未知标号与重复标号丢弃', () => {
    const ctx = buildChatContext(db, paperId, 'retrieval index')
    const cites = resolveCitations('依据 [B1] 与 [B1]，且 [B99] 是模型编的。', ctx.targets)
    expect(cites).toHaveLength(1)
    expect(cites[0]).toMatchObject({ order: 1, page: 1, section: '§3 Method' })
  })
})

describe('buildMessages', () => {
  it('system + 上下文 + 截断历史 + 问题', () => {
    const ctx = buildChatContext(db, paperId, 'x')
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `m${i}`
    }))
    const msgs = buildMessages(ctx, history, '新问题')
    expect(msgs[0].role).toBe('system')
    expect(msgs[1].content).toContain('论文片段')
    expect(msgs.filter((m) => typeof m.content === 'string' && /^m\d/.test(m.content))).toHaveLength(6) // 历史截到最近 6 条
    expect(msgs[msgs.length - 1].content).toBe('新问题')
  })
})

describe('中文提问：原文是英文时走译文检索', () => {
  it('cjkTermsFromQuestion 取实词 n-gram，纯虚词组合丢弃', () => {
    const terms = cjkTermsFromQuestion('这篇论文的核心贡献是什么？')
    expect(terms).toContain('核心')
    expect(terms).toContain('贡献')
    expect(terms).not.toContain('的是') // 纯停用字
    expect(terms).not.toContain('什么')
  })

  it('英文原文 + 中文问句：命中译文对应的块，而不是退化到开头版权段', () => {
    // 开头两段是版权与作者名单（真实论文的 p.1 就长这样），实质内容在后面
    const blocks = [
      block(0, 'Provided proper attribution is provided, Google hereby grants permission.'),
      block(1, 'Ashish Vaswani, Noam Shazeer, Niki Parmar. Google Brain.'),
      block(2, 'We propose a new simple network architecture, the Transformer.'),
      block(3, 'Multi-head attention allows the model to jointly attend to information.')
    ]
    replaceBlocks(db, paperId, blocks)
    putTranslation(db, blocks[0].block_id, 1, 1, 'm', '在提供适当署名的情况下，Google 特此授予许可。')
    putTranslation(db, blocks[1].block_id, 1, 1, 'm', 'Ashish Vaswani、Noam Shazeer、Niki Parmar。Google Brain。')
    putTranslation(db, blocks[2].block_id, 1, 1, 'm', '我们提出一种全新的简单网络架构 Transformer，这是本文的核心贡献。')
    putTranslation(db, blocks[3].block_id, 1, 1, 'm', '多头注意力让模型能够同时关注来自不同位置的信息。')

    const ctx = buildChatContext(db, paperId, '这篇论文的核心贡献是什么？')
    expect(ctx.targets.has(2)).toBe(true) // 讲核心贡献的那段
    expect(ctx.contextBlock).toContain('[B2]')
  })

  it('没有译文缓存时不报错，行为退回原有检索', () => {
    const ctx = buildChatContext(db, paperId, '这篇论文讲了什么？')
    expect(ctx.targets.size).toBeGreaterThan(0)
  })

  it('兜底取样沿全文铺开，不全挤在开头', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      block(i, `Section ${i}. ` + 'lorem ipsum dolor sit amet consectetur adipiscing elit. '.repeat(4))
    )
    replaceBlocks(db, paperId, many)
    const ctx = buildChatContext(db, paperId, 'zzzz')
    const orders = [...ctx.targets.keys()].sort((a, b) => a - b)
    expect(orders.length).toBeGreaterThan(1)
    expect(Math.max(...orders)).toBeGreaterThan(5) // 不是 0,1,2,3,4
  })
})

describe('整篇式提问', () => {
  it('中文问句只命中标题译文时，补上正文段，不能只给模型目录', () => {
    // 标题的译文里有「核心创新」，正文段的译文没有：按旧逻辑命中的只有标题
    putTranslation(db, blockId(paperId, 1, 0), 1, 1, 'm', '3 方法：核心创新')
    putTranslation(db, blockId(paperId, 1, 1), 1, 1, 'm', '检索索引存放声学样例。')
    const ctx = buildChatContext(db, paperId, '这篇论文的核心创新是什么？')
    expect(ctx.contextBlock).toMatch(/retrieval index stores|Training uses|WER drops/)
  })

  it('弱命中不能独自撑起上下文：「核心」只碰上硬件配置那段时，补上各节首段', () => {
    // 真实案例：问「核心创新是什么」，译文里只有 5.2 节硬件段带「核心」二字，
    // 旧逻辑因为命中了一个长正文段就不再补充，模型只能答「片段无法回答」
    const blocks = [
      block(0, 'Abstract', 'heading', 'Abstract'),
      block(1, 'We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.', 'para', 'Abstract'),
      block(2, '5.2 Hardware and Schedule', 'heading', '5.2 Hardware and Schedule'),
      block(3, 'We trained our models on one machine with 8 NVIDIA P100 GPUs, each with many cores, for 12 hours.', 'para', '5.2 Hardware and Schedule')
    ]
    replaceBlocks(db, paperId, blocks)
    putTranslation(db, blocks[1].block_id, 1, 1, 'm', '我们提出一种全新的简单网络架构 Transformer，完全基于注意力机制。')
    putTranslation(db, blocks[3].block_id, 1, 1, 'm', '我们在一台带 8 块 NVIDIA P100 GPU 的机器上训练，每块有很多核心，训练 12 小时。')
    const ctx = buildChatContext(db, paperId, '这篇论文的核心创新是什么？')
    expect(ctx.targets.has(3)).toBe(true) // 弱命中照样保留
    expect(ctx.targets.has(1)).toBe(true) // 但摘要段必须补进来
  })

  it('具体问法且译文命中够强时不额外补段，省 token', () => {
    const blocks = [
      block(0, 'Abstract', 'heading', 'Abstract'),
      block(1, 'We propose a new simple network architecture, the Transformer.', 'para', 'Abstract'),
      block(2, '3.2.2 Multi-Head Attention', 'heading', '3.2.2'),
      block(3, 'Multi-head attention allows the model to jointly attend to information from different subspaces.', 'para', '3.2.2'),
      block(4, 'Training uses eight thousand hours of audio.', 'para', '5 Training')
    ]
    replaceBlocks(db, paperId, blocks)
    putTranslation(db, blocks[1].block_id, 1, 1, 'm', '我们提出一种全新的简单网络架构 Transformer。')
    putTranslation(db, blocks[3].block_id, 1, 1, 'm', '多头注意力让模型能同时关注来自不同子空间的信息。')
    putTranslation(db, blocks[4].block_id, 1, 1, 'm', '训练用了八千小时音频。')
    const ctx = buildChatContext(db, paperId, '多头注意力比单头好在哪？')
    expect(ctx.targets.has(3)).toBe(true)
    expect(ctx.targets.has(4)).toBe(false) // 没补无关的训练段
  })
})

describe('isBroadQuestion', () => {
  it('问论文整体的中英文问法都算', () => {
    for (const q of ['这篇论文的核心创新是什么？', '主要贡献有哪些', '这篇论文讲了什么', '它解决了什么问题', 'What is the main contribution?', 'Give me an overview of this paper']) {
      expect(isBroadQuestion(q), q).toBe(true)
    }
  })
  it('具体问法不算', () => {
    for (const q of ['多头注意力比单头好在哪？', '为什么要除以 √dk', 'how is the retrieval index built?']) {
      expect(isBroadQuestion(q), q).toBe(false)
    }
  })
})
