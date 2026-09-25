import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDb, replaceBlocks, upsertPaper, monthUsage, getBlocks, getTranslation, putTranslation, type BlockRow } from '../db'
import { blockId, sha1, simhash64 } from '../docengine/anchor'
import { glossaryFromText, EMPTY_GLOSSARY } from './glossary'
import { cachedTranslations, isUntranslatable, looksReferenceEntry, looksUntranslated, stripMetaPrefix, makeBatches, parseBatchOutput, setTranslateFocus, translateBlock, translateOutline, translateParas, PROMPT_VERSION } from './translator'
import type { RouterContext, AttemptRunner } from '../model/router'
import { DEFAULT_ROUTES } from '../config/tasks-config'
import type { ProviderDef } from '../config/providers-config'

const provider: ProviderDef = {
  slug: 'siliconflow',
  name: 'SF',
  baseUrl: 'https://sf.example/v1',
  keyEnv: 'K',
  transport: 'openai_chat',
  source: 'readarc'
}

const ctx: RouterContext = {
  providers: [provider],
  routes: { ...DEFAULT_ROUTES, translate: { provider: 'siliconflow', model: 'qwen' } },
  mainModel: null,
  resolveKey: () => 'sk'
}

let db: Database.Database
const paperId = sha1('pdf')

function para(order: number, text: string): BlockRow {
  return {
    block_id: blockId(paperId, 1, order),
    paper_id: paperId,
    page: 1,
    block_order: order,
    kind: 'para',
    section: null,
    text,
    bbox: null,
    simhash: simhash64(text),
    heading_level: null,
    font_size: null
  }
}

beforeEach(() => {
  db = openDb(':memory:')
  upsertPaper(db, { id: paperId, file_path: '/x.pdf', added_at: 1 })
  replaceBlocks(db, paperId, [para(0, 'First paragraph.'), para(1, 'Second paragraph.'), para(2, 'Third paragraph.')])
})

function fakeRunner(calls: { messages: string; model: string }[]): AttemptRunner {
  return async (_ep, model, req) => {
    calls.push({ messages: JSON.stringify(req.messages), model })
    return { text: `译文<${model}>`, usage: { inputTokens: 10, outputTokens: 5 } }
  }
}

describe('translateBlock', () => {
  it('丢失公式的回答不入缓存，但消耗仍记账', async () => {
    const block = para(0, 'We compare the results using ⟦f1⟧.')
    replaceBlocks(db, paperId, [block])
    const runner: AttemptRunner = async () => ({ text: '我们比较这些结果。', usage: { inputTokens: 12, outputTokens: 6 } })
    await expect(translateBlock(db, { ctx, glossary: EMPTY_GLOSSARY, runner }, block, {})).rejects.toThrow()
    expect(getTranslation(db, block.block_id, EMPTY_GLOSSARY.version, PROMPT_VERSION)).toBeUndefined()
    expect(monthUsage(db)).toEqual({ inputTokens: 12, outputTokens: 6 })
  })

  it('历史缓存缺少公式时重新翻译；有效结果才重新显示', async () => {
    const block = para(0, 'We compare the results using ⟦f1⟧.')
    replaceBlocks(db, paperId, [block])
    putTranslation(db, block.block_id, EMPTY_GLOSSARY.version, PROMPT_VERSION, 'old', '我们比较这些结果。')
    expect(cachedTranslations(db, paperId, EMPTY_GLOSSARY.version)).toEqual({})
    let calls = 0
    const runner: AttemptRunner = async () => {
      calls++
      return { text: '我们使用 ⟦f1⟧ 比较结果。', usage: { inputTokens: 12, outputTokens: 6 } }
    }
    const result = await translateBlock(db, { ctx, glossary: EMPTY_GLOSSARY, runner }, block, {})
    expect(calls).toBe(1)
    expect(result.cached).toBe(false)
    expect(cachedTranslations(db, paperId, EMPTY_GLOSSARY.version)[block.block_id].text).toBe(result.text)
  })
  it('缓存未命中 → 调模型并落缓存 + 记用量；再次调用命中缓存不再调模型', async () => {
    const calls: { messages: string; model: string }[] = []
    const deps = { ctx, glossary: EMPTY_GLOSSARY, runner: fakeRunner(calls) }
    const block = para(0, 'First paragraph.')

    const first = await translateBlock(db, deps, block, { next: 'Second paragraph.' })
    expect(first.cached).toBe(false)
    expect(first.text).toBe('译文<qwen>')
    expect(calls).toHaveLength(1)
    expect(monthUsage(db)).toEqual({ inputTokens: 10, outputTokens: 5 })

    const second = await translateBlock(db, deps, block, {})
    expect(second.cached).toBe(true)
    expect(calls).toHaveLength(1) // 同一篇重读零成本
  })

  it('术语表强制进提示词；改术语表 → 版本变 → 缓存失效重译', async () => {
    const calls: { messages: string; model: string }[] = []
    const g1 = glossaryFromText('terms:\n  ablation: 消融实验\n')
    const block = para(0, 'Ablation study.')

    await translateBlock(db, { ctx, glossary: g1, runner: fakeRunner(calls) }, block, {})
    expect(calls[0].messages).toContain('ablation => 消融实验')

    const g2 = glossaryFromText('terms:\n  ablation: 消融\n')
    expect(g2.version).not.toBe(g1.version)
    await translateBlock(db, { ctx, glossary: g2, runner: fakeRunner(calls) }, block, {})
    expect(calls).toHaveLength(2) // 版本不同 → 未命中 → 重译

    await translateBlock(db, { ctx, glossary: g1, runner: fakeRunner(calls) }, block, {})
    expect(calls).toHaveLength(2) // 老版本缓存还在
  })

  it('force 重译覆盖缓存（单段重译）', async () => {
    const calls: { messages: string; model: string }[] = []
    const deps = { ctx, glossary: EMPTY_GLOSSARY, runner: fakeRunner(calls) }
    const block = para(0, 'First paragraph.')
    await translateBlock(db, deps, block, {})
    await translateBlock(db, deps, block, {}, true)
    expect(calls).toHaveLength(2)
  })

  it('上下文进提示词但只译本段', async () => {
    const calls: { messages: string; model: string }[] = []
    await translateBlock(
      db,
      { ctx, glossary: EMPTY_GLOSSARY, runner: fakeRunner(calls) },
      para(1, 'Second paragraph.'),
      { prev: 'First paragraph.', next: 'Third paragraph.' }
    )
    expect(calls[0].messages).toContain('【上文】First paragraph.')
    expect(calls[0].messages).toContain('【本段】Second paragraph.')
    expect(calls[0].messages).toContain('【下文】Third paragraph.')
  })
})

/** 打包协议应答：按输入里的【N】标记逐段回填。 */
function batchRunner(calls: { messages: string; model: string }[]): AttemptRunner {
  return async (_ep, model, req) => {
    calls.push({ messages: JSON.stringify(req.messages), model })
    const user = String(req.messages[req.messages.length - 1].content)
    const ns = [...user.matchAll(/【(\d+)】/g)].map((m) => Number(m[1]))
    if (ns.length === 0) return { text: `译文<${model}>`, usage: { inputTokens: 10, outputTokens: 5 } }
    return {
      text: ns.map((n) => `【${n}】译${n}`).join('\n'),
      usage: { inputTokens: 10, outputTokens: 5 }
    }
  }
}

describe('translateParas（打包时代）', () => {
  it('流式批次里丢失的公式不上屏，退回逐段翻译补齐', async () => {
    const blocks = [para(0, 'Compare using ⟦f1⟧.'), para(1, 'See data.^5^')]
    replaceBlocks(db, paperId, blocks)
    const runner: AttemptRunner = async (_ep, _model, req, onChunk) => {
      const user = String(req.messages.at(-1)?.content)
      const text = user.includes('【1】') ? '【1】比较结果。\n【2】见数据。^5^' : '使用 ⟦f1⟧ 比较。'
      onChunk(text)
      return { text, usage: { inputTokens: 10, outputTokens: 5 } }
    }
    const texts: string[] = []
    await translateParas(db, { ctx, glossary: EMPTY_GLOSSARY, runner }, paperId, (p) => {
      if (p.text) texts.push(p.text)
    })
    expect(texts).not.toContain('比较结果。')
    expect(texts).toContain('使用 ⟦f1⟧ 比较。')
    expect(texts).toContain('见数据。^5^')
    expect(Object.keys(cachedTranslations(db, paperId, EMPTY_GLOSSARY.version))).toHaveLength(2)
  })
  it('短段打包成一次调用；第二次全命中缓存零调用', async () => {
    const calls: { messages: string; model: string }[] = []
    const deps = { ctx, glossary: EMPTY_GLOSSARY, runner: batchRunner(calls) }
    const events: { ok: boolean }[] = []
    await translateParas(db, deps, paperId, (p) => events.push({ ok: !!p.text }))
    expect(calls).toHaveLength(1) // 3 段 → 1 次调用
    expect(events.filter((e) => e.ok)).toHaveLength(3)

    await translateParas(db, deps, paperId, () => {})
    expect(calls).toHaveLength(1) // 缓存命中零调用
  })

  it('流式增量回填：【N+1】标记一出现，第 N 段立即上报，不等整批结束', async () => {
    const order: string[] = []
    const runner: AttemptRunner = async (_ep, _model, req, onChunk) => {
      const user = String(req.messages[req.messages.length - 1].content)
      if (![...user.matchAll(/【(\d+)】/g)].length) {
        return { text: '补译', usage: { inputTokens: 1, outputTokens: 1 } }
      }
      onChunk('【1】译一\n')
      order.push('chunk1')
      await new Promise((r) => setTimeout(r, 5))
      onChunk('【2】译二\n【3】')
      order.push('chunk2')
      await new Promise((r) => setTimeout(r, 5))
      onChunk('译三')
      order.push('done')
      return { text: '【1】译一\n【2】译二\n【3】译三', usage: { inputTokens: 1, outputTokens: 1 } }
    }
    const events: string[] = []
    await translateParas(db, { ctx, glossary: EMPTY_GLOSSARY, runner }, paperId, (p) => {
      if (p.text) {
        events.push(p.text)
        order.push(`emit:${p.text}`)
      }
    })
    // 段 1、2 在流还没结束时就已上报（出现在 done 之前）
    expect(order.indexOf('emit:译一')).toBeGreaterThan(order.indexOf('chunk1'))
    expect(order.indexOf('emit:译一')).toBeLessThan(order.indexOf('done'))
    expect(order.indexOf('emit:译二')).toBeLessThan(order.indexOf('done'))
    expect([...events].sort()).toEqual(['译一', '译二', '译三'].sort())
  })

  it('打包输出缺段 → 缺的段退回逐段翻译补齐', async () => {
    const calls: { messages: string; model: string }[] = []
    const runner: AttemptRunner = async (_ep, model, req) => {
      calls.push({ messages: JSON.stringify(req.messages), model })
      const user = String(req.messages[req.messages.length - 1].content)
      if (user.includes('【2】')) {
        // 批次调用：故意漏掉第 2 段
        return { text: '【1】译一\n【3】译三', usage: { inputTokens: 10, outputTokens: 5 } }
      }
      return { text: '补译', usage: { inputTokens: 3, outputTokens: 2 } }
    }
    const events: { ok: boolean }[] = []
    await translateParas(db, { ctx, glossary: EMPTY_GLOSSARY, runner }, paperId, (p) =>
      events.push({ ok: !!p.text })
    )
    expect(calls).toHaveLength(2) // 1 次批次 + 1 次补译
    expect(events.filter((e) => e.ok)).toHaveLength(3)
  })
})

describe('translateOutline（目录单独批量翻译）', () => {
  function headingRow(order: number, text: string): BlockRow {
    return { ...para(order, text), kind: 'heading', heading_level: 1 }
  }

  it('未译标题打包成一次调用；编号行回填缓存；已译标题不重复送', async () => {
    replaceBlocks(db, paperId, [
      headingRow(0, 'Attention Is All You Need'),
      headingRow(1, '3.2 Attention'),
      para(2, 'Body text stays out.')
    ])
    const calls: { messages: string; model: string }[] = []
    const runner: AttemptRunner = async (_ep, model, req) => {
      calls.push({ messages: JSON.stringify(req.messages), model })
      return {
        text: '1) 注意力就是你所需要的一切\n2) 3.2 注意力',
        usage: { inputTokens: 20, outputTokens: 15 }
      }
    }
    const deps = { ctx, glossary: EMPTY_GLOSSARY, runner }
    const events: string[] = []
    const n = await translateOutline(db, deps, paperId, (p) => events.push(p.text ?? ''))
    expect(n).toBe(2)
    expect(calls).toHaveLength(1) // 一次调用
    expect(calls[0].messages).toContain('1) Attention Is All You Need')
    expect(calls[0].messages).not.toContain('Body text') // 正文不进目录翻译
    expect(events).toEqual(['注意力就是你所需要的一切', '3.2 注意力'])

    // 缓存命中：再跑零调用
    const n2 = await translateOutline(db, deps, paperId, () => {})
    expect(n2).toBe(0)
    expect(calls).toHaveLength(1)
  })

  it('模型输出行对不上编号时跳过该条（宁缺毋错，可重跑补齐）', async () => {
    replaceBlocks(db, paperId, [headingRow(0, 'One'), headingRow(1, 'Two')])
    const runner: AttemptRunner = async () => ({
      text: '1) 一\n乱七八糟的行',
      usage: { inputTokens: 1, outputTokens: 1 }
    })
    const n = await translateOutline(db, { ctx, glossary: EMPTY_GLOSSARY, runner }, paperId, () => {})
    expect(n).toBe(1)
  })
})

describe('looksUntranslated（译文输出校验）', () => {
  const prose = 'Self-attention, sometimes called intra-attention is an attention mechanism relating different positions of a single sequence in order to compute a representation of the sequence. It has been used successfully in a variety of tasks.'
  it('长英文段答成英文摘要 → 判定为非译文', () => {
    expect(looksUntranslated(prose, 'About self-attention/intra-attention.')).toBe(true)
  })
  it('正常中文译文 → 通过', () => {
    expect(looksUntranslated(prose, '自注意力（有时称为内部注意力）是一种关联单个序列中不同位置以计算序列表示的注意力机制。')).toBe(false)
  })
  it('作者栏/短段原样保留 → 通过（不误伤）', () => {
    expect(looksUntranslated('Ashish Vaswani Google Brain avaswani@google.com', '*Ashish Vaswani Google Brain avaswani@google.com')).toBe(false)
  })
  it('作者名单（缩写密集）原样保留 → 通过（不误拒）', () => {
    const authors = 'A. G. Abac R. Abbott I. Abouelfettouh F. Acernese K. Ackley C. Adamcewicz S. Adhicary and many more collaborators from the LIGO Scientific Collaboration'
    expect(looksUntranslated(authors, authors)).toBe(false)
  })

  it('作者—年份式文献条目（无 [N] 编号）原样返回 → 通过（不再永远差一段）', () => {
    const ref = 'Ehsan Hosseini-Asl, Bryan McCann, Chien-Sheng Wu, Semih Yavuz, and Richard Socher. A simple language model for task-oriented dialogue. Advances in Neural Information Processing Systems, 33:20179–20191, 2020.'
    expect(looksReferenceEntry(ref)).toBe(true)
    expect(looksUntranslated(ref, ref)).toBe(false)
    const ref2 = 'Wenlong Huang, Pieter Abbeel, Deepak Pathak, and Igor Mordatch. Language models as zero-shot planners: Extracting actionable knowledge for embodied agents. arXiv preprint arXiv:2201.07207, 2022a.'
    expect(looksReferenceEntry(ref2)).toBe(true)
    const ref3 = 'Geoffrey Irving. Improving alignment of dialogue agents via targeted human judgements, 2022. URL https://storage.googleapis.com/deepmind-media/DeepMind.com/Authors-Notes/sparrow/sparrow-final.pdf.'
    expect(looksReferenceEntry(ref3)).toBe(true)
  })

  it('提到年份和会议名的正文散文 → 不算文献条目，仍按散文判据拒收英文输出', () => {
    const p = 'Recent work presented at the conference in 2020 showed that transformers, when trained on large corpora, generalize well to downstream tasks, and the journal version extends these results to vision.'
    expect(looksReferenceEntry(p)).toBe(false)
    expect(looksUntranslated(p, p)).toBe(true)
  })

  it('全名式作者名单（无缩写点）原样保留 → 通过', () => {
    const authors = 'OpenAI, :, Aaron Hurst, Adam Lerer, Adam Goucher, Aditya Ramesh, Aidan Clark, AJ Ostrow, Aki Hayashi, Alan Green, Alba Garcia, Alec Radford, Aleksander Madry, Alex Baker, Alex Carney, Alex Chow, Alex Kirillov, Alex Nichol'
    expect(looksUntranslated(authors, authors)).toBe(false)
  })

  it('批次回填遇到非译文段 → 不入缓存，按缺段回退逐段补齐', async () => {
    const runner: AttemptRunner = async (_ep, _model, req) => {
      const user = String(req.messages[req.messages.length - 1].content)
      if (user.includes('【2】')) {
        // 批次调用：第 1 段答成英文摘要，第 2、3 段正常
        return { text: '【1】About the first paragraph.\n【2】第二段译文\n【3】第三段译文', usage: { inputTokens: 10, outputTokens: 5 } }
      }
      return { text: '这是一段足够长的英文散文段落的真正中文译文，它包含许多词和完整的句子，详细描述了某件事情', usage: { inputTokens: 3, outputTokens: 2 } }
    }
    const long = 'This is a sufficiently long English prose paragraph that clearly requires an actual Chinese translation because it contains many words and full sentences describing something in detail.'
    replaceBlocks(db, paperId, [para(0, long), para(1, 'Second paragraph.'), para(2, 'Third paragraph.')])
    const events: { ok: boolean }[] = []
    await translateParas(db, { ctx, glossary: EMPTY_GLOSSARY, runner }, paperId, (p) => events.push({ ok: !!p.text }))
    expect(events.filter((e) => e.ok)).toHaveLength(3)
    const row = getBlocks(db, paperId)[0]
    expect(getTranslation(db, row.block_id, 0, 1)?.text).toBe('这是一段足够长的英文散文段落的真正中文译文，它包含许多词和完整的句子，详细描述了某件事情')
  })
})

describe('stripMetaPrefix（元话语剥除）', () => {
  it('「原文复述 Translation: 译文」→ 只留译文', () => {
    expect(stripMetaPrefix('The model parameters. Translation: 模型参数。')).toBe('模型参数。')
    expect(stripMetaPrefix('Bold: The Automated Judge Extension. Translation: 自动评判器扩展。')).toBe('自动评判器扩展。')
    expect(stripMetaPrefix('译文：这是译文。')).toBe('这是译文。')
    expect(stripMetaPrefix('(a) Retrieval judge.\n- Translation: (a) 检索判断器。')).toBe('(a) 检索判断器。')
    expect(stripMetaPrefix('This is the abstract. Key terms listed. Let me translate: 区分机器生成文本。')).toBe('区分机器生成文本。')
  })
  it('正常译文原样通过（含 Machine Translation 等词组不误剥）', () => {
    expect(stripMetaPrefix('机器翻译（Machine Translation）是一项任务。')).toBe('机器翻译（Machine Translation）是一项任务。')
    expect(stripMetaPrefix('**稀疏（S）**，使用 x~i~。')).toBe('**稀疏（S）**，使用 x~i~。')
  })
})

describe('PROMPT_VERSION', () => {
  it('是缓存键的一部分（防呆断言：改提示词记得递增）', () => {
    expect(PROMPT_VERSION).toBe(1)
  })
})

describe('打包翻译（核心提速）', () => {
  it('makeBatches：按字符预算与段数上限分组，长段独立', () => {
    const mk = (i: number, len: number): BlockRow => ({
      block_id: `${paperId}:1:${i}`, paper_id: paperId, page: 1, block_order: i,
      kind: 'para', section: null, text: 'x'.repeat(len), bbox: null,
      simhash: '0', heading_level: null, font_size: null
    })
    const batches = makeBatches([mk(0, 500), mk(1, 500), mk(2, 3000), mk(3, 100), mk(4, 100)])
    expect(batches.map((b) => b.length)).toEqual([2, 1, 2]) // 3000 超预算独立成组
  })

  it('parseBatchOutput：按【N】块回填，多行译文完整、缺段跳过', () => {
    const out = parseBatchOutput('【1】\n第一段译文\n跨了两行\n\n【3】第三段')
    expect(out.get(1)).toBe('第一段译文\n跨了两行')
    expect(out.get(2)).toBeUndefined()
    expect(out.get(3)).toBe('第三段')
  })
})

describe('视口优先翻译', () => {
  it('setTranslateFocus 后，离焦点最近的批次先被认领', async () => {
    // 12 段短文 → 2 段/批（预算压小靠 BATCH_MAX 不了，用长文本分批）
    const rows: BlockRow[] = []
    for (let i = 0; i < 8; i++) rows.push(para(i, `Paragraph ${i}. ` + 'x'.repeat(1200)))
    replaceBlocks(db, paperId, rows)

    const claimOrder: number[] = []
    const runner: AttemptRunner = async (_ep, _model, req) => {
      const user = String(req.messages[req.messages.length - 1].content)
      const m = /Paragraph (\d+)\./.exec(user)
      if (m) claimOrder.push(Number(m[1]))
      const ns = [...user.matchAll(/【(\d+)】/g)].map((x) => Number(x[1]))
      return {
        text: ns.map((n) => `【${n}】译${n}`).join('\n'),
        usage: { inputTokens: 1, outputTokens: 1 }
      }
    }
    setTranslateFocus(paperId, 6) // 用户正看第 6 段附近
    await translateParas(db, { ctx, glossary: EMPTY_GLOSSARY, runner }, paperId, () => {})
    // 首个被认领的批次应包含第 6 段（并发下其余顺序不作强断言）
    expect(claimOrder[0]).toBeGreaterThanOrEqual(5)
  })
})

describe('空译文永远不许入库', () => {
  const REF = '[17] Łukasz Kaiser and Ilya Sutskever. Neural GPUs learn algorithms. In International Conference on Learning Representations (ICLR), 2016. This entry is long enough to pass the prose length gate used by the heuristic.'

  it('文献条目豁免不能把空输出也放过（真实卡死案例）', () => {
    // [N] 开头的条目原样返回是合法的，但「什么都没返回」不是
    expect(looksUntranslated(REF, '')).toBe(true)
    expect(looksUntranslated(REF, '   \n  ')).toBe(true)
    // 原样保留仍然放行（豁免本身要保住）
    expect(looksUntranslated(REF, REF)).toBe(false)
  })

  it('短段的空输出同样被拒（短段本来免检）', () => {
    expect(looksUntranslated('Short source.', '')).toBe(true)
  })
})

describe('looksUntranslated：推理模型的思考泄漏与原文复述', () => {
  const src =
    'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder. The best performing models also connect the encoder and decoder through an attention mechanism.'

  it('带 <think> 标签（哪怕只剩半边）一律拒收', () => {
    expect(looksUntranslated(src, '<think>让我想想</think>主流的序列转导模型基于复杂的循环或卷积神经网络。')).toBe(true)
    expect(looksUntranslated(src, '图 1：Transformer 模型架构。</think>')).toBe(true)
  })

  it('英文评注夹几个中文词不是译文', () => {
    expect(
      looksUntranslated(
        src,
        'The abstract - need to translate carefully, keeping technical terms. "sequence transduction models" - 序列转导模型 or 序列转换模型? In ML context, "sequence transduction" is usually translated as 序列转导.'
      )
    ).toBe(true)
  })

  it('原文开头被整段复述进输出的也拒收', () => {
    expect(looksUntranslated(src, `${src.slice(0, 80)}\n\n主流的序列转导模型基于复杂的循环或卷积神经网络。`)).toBe(true)
  })

  it('正常译文（保留专有名词与缩写）放行', () => {
    expect(
      looksUntranslated(
        src,
        '主流的序列转导模型基于包含编码器与解码器的复杂循环或卷积神经网络。表现最好的模型还通过注意力机制连接编码器与解码器（Transformer、RNN、CNN、BLEU）。'
      )
    ).toBe(false)
  })

  it('stripMetaPrefix 剥掉整段思考块与残缺的闭合标签', () => {
    expect(stripMetaPrefix('<think>plan…</think>\n\n译文正文')).toBe('译文正文')
    expect(stripMetaPrefix('残留的思考 </think> 译文正文')).toBe('译文正文')
  })
})

describe('整篇重译（force）', () => {
  it('已缓存的段也重新调用模型，并用新译文覆盖缓存', async () => {
    const calls: string[] = []
    const runner: AttemptRunner = async (_ep, _model, req) => {
      const user = String(req.messages[req.messages.length - 1].content)
      calls.push(user)
      const n = (user.match(/【\d+】/g) ?? []).length
      if (n > 0) {
        return {
          text: Array.from({ length: n }, (_, i) => `【${i + 1}】新译文${i + 1}`).join('\n'),
          usage: { inputTokens: 5, outputTokens: 5 }
        }
      }
      return { text: '新译文', usage: { inputTokens: 1, outputTokens: 1 } }
    }
    replaceBlocks(db, paperId, [para(0, 'First paragraph.'), para(1, 'Second paragraph.')])
    const blocks = getBlocks(db, paperId)
    for (const b of blocks) putTranslation(db, b.block_id, 0, PROMPT_VERSION, 'old-model', '旧译文')

    // 不带 force：全部缓存命中，模型零调用
    await translateParas(db, { ctx, glossary: EMPTY_GLOSSARY, runner }, paperId, () => {})
    expect(calls).toHaveLength(0)

    // force：两段都重新翻译，缓存被覆盖
    const done: string[] = []
    await translateParas(db, { ctx, glossary: EMPTY_GLOSSARY, runner }, paperId, (p) => { if (p.text) done.push(p.text) }, () => false, true)
    expect(calls.length).toBeGreaterThan(0)
    expect(done.every((t) => t.startsWith('新译文'))).toBe(true)
    for (const b of blocks) expect(getTranslation(db, b.block_id, 0, PROMPT_VERSION)?.text).toMatch(/^新译文/)
  })
})

describe('进度事件带模型名（横幅「由 X 翻译」的依据）', () => {
  it('缓存命中、打包回填、逐段补译都带 model', async () => {
    const calls: { messages: string; model: string }[] = []
    const events: { text?: string; model?: string }[] = []
    await translateParas(db, { ctx, glossary: EMPTY_GLOSSARY, runner: batchRunner(calls) }, paperId, (p) => events.push({ text: p.text, model: p.model }))
    expect(events.filter((e) => e.text).every((e) => e.model === 'qwen')).toBe(true)
    // 第二遍全部缓存命中：model 来自缓存行
    const again: { model?: string }[] = []
    await translateParas(db, { ctx, glossary: EMPTY_GLOSSARY, runner: batchRunner(calls) }, paperId, (p) => again.push({ model: p.model }))
    expect(again.every((e) => e.model === 'qwen')).toBe(true)
    // cachedTranslations 也带 model
    const cached = cachedTranslations(db, paperId, 0)
    expect(Object.values(cached).every((c) => c.model === 'qwen' && c.text)).toBe(true)
  })
})

describe('原样即译文（没有可译内容的段不该永远「未翻译」）', () => {
  it('纯数字 / 符号 / 公式碎片：不调模型，原样入库，进度事件 model=identity', async () => {
    replaceBlocks(db, paperId, [para(0, '1'), para(1, '∑ x_i^2 ≤ 3.14'), para(2, 'Real prose paragraph here.')])
    const calls: { messages: string; model: string }[] = []
    const events: { text?: string; model?: string }[] = []
    await translateParas(db, { ctx, glossary: EMPTY_GLOSSARY, runner: fakeRunner(calls) }, paperId, (p) =>
      events.push({ text: p.text, model: p.model })
    )
    expect(events.filter((e) => e.model === 'identity').map((e) => e.text)).toEqual(['1', '∑ x_i^2 ≤ 3.14'])
    expect(calls).toHaveLength(1) // 只有真正的散文段去问了模型
    expect(getTranslation(db, blockId(paperId, 1, 0), EMPTY_GLOSSARY.version, PROMPT_VERSION)?.text).toBe('1')
  })

  it('作者栏这类没有小写单词的段，模型交白卷 → 原样当译文；有散文的段交白卷仍然报错', async () => {
    const blank: AttemptRunner = async () => ({ text: '', usage: { inputTokens: 5, outputTokens: 0 } })
    const deps = { ctx, glossary: EMPTY_GLOSSARY, runner: blank }
    const authors = para(0, 'Shunyu Yao, Jeffrey Zhao, Dian Yu, Nan Du')
    const r = await translateBlock(db, deps, authors, {})
    expect(r.model).toBe('identity')
    expect(r.text).toBe(authors.text)
    await expect(translateBlock(db, deps, para(1, 'Real prose paragraph here.'), {})).rejects.toThrow(/未返回有效译文/)
  })
})

describe('isUntranslatable', () => {
  it('纯数字符号、以及本来就是中文的段落都不用调模型', () => {
    expect(isUntranslatable('3.14 (2)')).toBe(true)
    expect(isUntranslatable('摘要：本文提出一种面向长文档的稀疏注意力机制，在 Transformer 上验证。')).toBe(true)
    expect(isUntranslatable('The dominant sequence transduction models are based on recurrent networks.')).toBe(false)
  })
})
