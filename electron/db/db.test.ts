import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { migrateTranslationsBySimhash,
  deletePaperData,
  getBlocks,
  getPaper,
  getTranslation,
  listPapers,
  markStaleLayouts,
  openDb,
  putTranslation,
  recordProgress,
  replaceBlocks,
  searchBlocks,
  setLayoutState,
  upsertPaper,
  type BlockRow
} from './index'
import { blockId, sha1, simhash64 } from '../docengine/anchor'

let db: Database.Database
const fileHash = sha1('fake-pdf-bytes')

function makeBlock(order: number, text: string): BlockRow {
  return {
    block_id: blockId(fileHash, 1, order),
    paper_id: fileHash,
    page: 1,
    block_order: order,
    kind: 'para',
    section: '§1 Introduction',
    text,
    bbox: JSON.stringify([72, 100 + order * 40, 460, 36]),
    simhash: simhash64(text),
    heading_level: null,
    font_size: null
  }
}

beforeEach(() => {
  db = openDb(':memory:')
  upsertPaper(db, { id: fileHash, file_path: '/papers/rasr.pdf', added_at: Date.now() })
})

afterEach(() => db.close())

describe('papers', () => {
  it('文件移动后按内容哈希仍是同一篇 [P6]', () => {
    upsertPaper(db, { id: fileHash, file_path: '/moved/rasr-renamed.pdf', added_at: Date.now() })
    const paper = getPaper(db, fileHash)
    expect(paper?.file_path).toBe('/moved/rasr-renamed.pdf')
    expect(db.prepare('SELECT COUNT(*) AS n FROM papers').get()).toEqual({ n: 1 })
  })

  it('进度只增不减（回头重读不倒退）', () => {
    recordProgress(db, fileHash, 60, 0.6, '§3 Method')
    recordProgress(db, fileHash, 30, 0.3, '§2 Related Work')
    const paper = getPaper(db, fileHash)!
    expect(paper.progress).toBe(60)
    expect(paper.scroll_position).toBe(0.3) // 当前位置照实记录
    expect(paper.status).toBe('reading')
  })
})

describe('blocks + FTS5', () => {
  beforeEach(() => {
    replaceBlocks(db, fileHash, [
      makeBlock(0, 'We propose a retrieval-augmented speech recognition model.'),
      makeBlock(1, 'The training corpus consists of eight thousand hours of audio.'),
      makeBlock(2, 'Retrieval exemplars are encoded with a frozen audio encoder.')
    ])
  })

  it('按页码与块序取回', () => {
    const blocks = getBlocks(db, fileHash)
    expect(blocks.map((b) => b.block_order)).toEqual([0, 1, 2])
  })

  it('FTS 检索命中并限量（对话上下文 5–8 块）', () => {
    const hits = searchBlocks(db, fileHash, 'retrieval', 8)
    expect(hits.length).toBe(2)
    expect(hits.every((b) => /retrieval/i.test(b.text))).toBe(true)
  })

  it('重新解析（replaceBlocks）后 FTS 同步', () => {
    replaceBlocks(db, fileHash, [makeBlock(0, 'Completely new parse output.')])
    expect(searchBlocks(db, fileHash, 'retrieval')).toHaveLength(0)
    expect(searchBlocks(db, fileHash, 'parse')).toHaveLength(1)
  })
})

describe('translations 缓存', () => {
  const bid = blockId(fileHash, 1, 0)

  it('缺少公式或脚注的历史缓存不计作已译，缓存原始行仍保留', () => {
    const blocks = [makeBlock(0, 'The result is ⟦f1⟧.'), makeBlock(1, 'See data.^5^')]
    replaceBlocks(db, fileHash, blocks)
    for (const b of blocks) putTranslation(db, b.block_id, 1, 1, 'm', '不完整的译文。')
    expect(listPapers(db, 1, 1)[0].trans_done).toBe(0)
    expect(getTranslation(db, bid, 1, 1)).toBeUndefined()
    expect(db.prepare('SELECT COUNT(*) AS n FROM translations').get()).toEqual({ n: 2 })
  })

  it('键含 glossary_version 与 prompt_version：改术语表自然失效', () => {
    putTranslation(db, bid, 1, 1, 'qwen3-32b', '我们提出一种检索增强的语音识别模型。')
    expect(getTranslation(db, bid, 1, 1)?.text).toContain('检索增强')
    expect(getTranslation(db, bid, 2, 1)).toBeUndefined() // 术语表升级 → 未命中 → 重译
  })

  it('同键重译覆盖（单段重译）', () => {
    putTranslation(db, bid, 1, 1, 'qwen3-32b', '旧译文')
    putTranslation(db, bid, 1, 1, 'deepseek-v3', '新译文')
    const hit = getTranslation(db, bid, 1, 1)!
    expect(hit.text).toBe('新译文')
    expect(hit.model).toBe('deepseek-v3')
  })
})

describe('重解析译文迁移', () => {
  it('序号偏移后按 simhash 搬家；重复指纹不迁；孤儿行清除', () => {
    const paperId = fileHash
    const mk = (order: number, text: string): BlockRow => ({
      block_id: `${paperId}:1:${order}`, paper_id: paperId, page: 1, block_order: order,
      kind: 'para', section: null, text, bbox: null,
      simhash: simhash64(text), heading_level: null, font_size: null
    })
    const oldBlocks = [mk(0, 'Alpha text.'), mk(1, 'Beta text.'), mk(2, 'Gamma text.')]
    replaceBlocks(db, paperId, oldBlocks)
    putTranslation(db, oldBlocks[0].block_id, 1, 1, 'm', '阿尔法')
    putTranslation(db, oldBlocks[1].block_id, 1, 1, 'm', '贝塔')

    // 重解析：开头插入一个新块 → 全体序号 +1
    const newBlocks = [mk(0, 'New title.'), { ...mk(1, 'Alpha text.') }, { ...mk(2, 'Beta text.') }, { ...mk(3, 'Gamma text.') }]
    replaceBlocks(db, paperId, newBlocks)
    const moved = migrateTranslationsBySimhash(db, paperId, oldBlocks, newBlocks)
    expect(moved).toBe(2)
    expect(getTranslation(db, `${paperId}:1:1`, 1, 1)?.text).toBe('阿尔法')
    expect(getTranslation(db, `${paperId}:1:2`, 1, 1)?.text).toBe('贝塔')
    // 老 id 上的孤儿行已清（0 号现在是 New title，无译文）
    expect(getTranslation(db, `${paperId}:1:0`, 1, 1)).toBeUndefined()
  })
})

describe('deletePaperData', () => {
  it('清空论文的块/译文/摘要/FTS/论文行；不碰另一篇', () => {
    const blocks = [makeBlock(0, 'Retrieval augments generation.'), makeBlock(1, 'Second block here.')]
    replaceBlocks(db, fileHash, blocks)
    putTranslation(db, blocks[0].block_id, 0, 1, 'm', '检索增强生成。')
    db.prepare(
      'INSERT INTO summaries (paper_id, prompt_version, model, text, created_at) VALUES (?, 1, ?, ?, ?)'
    ).run(fileHash, 'm', '三句话', Date.now())

    // 另一篇论文的数据应完好
    const other = sha1('other-pdf')
    upsertPaper(db, { id: other, file_path: '/papers/other.pdf', added_at: Date.now() })
    const ob: BlockRow = { ...makeBlock(0, 'Other paper text.'), block_id: blockId(other, 1, 0), paper_id: other }
    replaceBlocks(db, other, [ob])
    putTranslation(db, ob.block_id, 0, 1, 'm', '另一篇。')

    deletePaperData(db, fileHash)

    expect(getPaper(db, fileHash)).toBeUndefined()
    expect(getBlocks(db, fileHash)).toHaveLength(0)
    expect(getTranslation(db, blocks[0].block_id, 0, 1)).toBeUndefined()
    expect(db.prepare('SELECT COUNT(*) AS n FROM summaries WHERE paper_id = ?').get(fileHash)).toEqual({ n: 0 })
    expect(searchBlocks(db, fileHash, 'retrieval')).toHaveLength(0)
    // 邻居完好
    expect(getPaper(db, other)).toBeDefined()
    expect(getBlocks(db, other)).toHaveLength(1)
    expect(getTranslation(db, ob.block_id, 0, 1)?.text).toBe('另一篇。')
  })
})

describe('译文迁移：位置被新内容占用时不得留旧译文', () => {
  it('新增脚注不能沿用相似指纹的旧译文', () => {
    const text = 'The nondetection of GW emission implies a limit on the energy.'
    const oldBlocks = [makeBlock(0, text)]
    replaceBlocks(db, fileHash, oldBlocks)
    putTranslation(db, oldBlocks[0].block_id, 0, 1, 'm', '未探测到 GW 辐射意味着能量上限。')
    const newBlocks = [makeBlock(0, text + '^5^')]
    migrateTranslationsBySimhash(db, fileHash, oldBlocks, newBlocks)
    replaceBlocks(db, fileHash, newBlocks)
    expect(getTranslation(db, newBlocks[0].block_id, 0, 1)).toBeUndefined()
  })

  it('公式序号没变但实际公式变了时不能沿用旧译文', () => {
    const old = { ...makeBlock(0, 'The result is ⟦f1⟧.'), inlines: JSON.stringify([{ n: 1, text: 'x=1' }]) }
    replaceBlocks(db, fileHash, [old])
    putTranslation(db, old.block_id, 0, 1, 'm', '结果是 ⟦f1⟧。')
    const changed = { ...old, inlines: JSON.stringify([{ n: 1, text: 'x=2' }]) }
    migrateTranslationsBySimhash(db, fileHash, [old], [changed])
    replaceBlocks(db, fileHash, [changed])
    expect(getTranslation(db, changed.block_id, 0, 1)).toBeUndefined()
  })
  it('同 id 换了完全不同的内容 → 旧译文丢弃，不会张冠李戴', () => {
    const oldBlocks = [makeBlock(0, 'Event SG-D 7.1×10 2020 April 28 Extended 3.4×10')]
    replaceBlocks(db, fileHash, oldBlocks)
    putTranslation(db, oldBlocks[0].block_id, 0, 1, 'm', '事件 SG-D 7.1×10 2020 年 4 月 28 日')

    // 重新解析：同一位置变成一段完全不同的正文
    const newBlocks = [makeBlock(0, 'The nondetection of GW emission from our analysis implies a limit.')]
    migrateTranslationsBySimhash(db, fileHash, oldBlocks, newBlocks)
    replaceBlocks(db, fileHash, newBlocks)

    expect(getTranslation(db, newBlocks[0].block_id, 0, 1)).toBeUndefined()
  })

  it('内容仅微调（同 id 指纹相近）→ 译文照留', () => {
    const oldBlocks = [makeBlock(0, 'The nondetection of GW emission implies a limit on the energy.')]
    replaceBlocks(db, fileHash, oldBlocks)
    putTranslation(db, oldBlocks[0].block_id, 0, 1, 'm', '未探测到 GW 辐射意味着能量上限。')
    const newBlocks = [makeBlock(0, 'The nondetection of GW emission implies a limit on the energy. ')]
    migrateTranslationsBySimhash(db, fileHash, oldBlocks, newBlocks)
    replaceBlocks(db, fileHash, newBlocks)
    expect(getTranslation(db, newBlocks[0].block_id, 0, 1)?.text).toBe('未探测到 GW 辐射意味着能量上限。')
  })
})

describe('deletePaperData：删干净，不留孤儿译文', () => {
  it('块已经不在了的译文也一并清掉（重解析残留 / 删除时在途的回写）', () => {
    const b = makeBlock(0, 'hello world')
    replaceBlocks(db, fileHash, [b])
    putTranslation(db, b.block_id, 1, 1, 'm', '你好世界')
    // 孤儿行：块早已不存在，译文却还挂着同一篇论文的 id 前缀
    putTranslation(db, `${fileHash}:9:9`, 1, 1, 'm', '孤儿译文')

    deletePaperData(db, fileHash)

    expect(db.prepare('SELECT COUNT(*) AS n FROM translations').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM blocks').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM papers').get()).toEqual({ n: 0 })
  })

  it('不碰别的论文的译文', () => {
    const other = sha1('other-pdf-bytes')
    upsertPaper(db, { id: other, file_path: '/papers/other.pdf', added_at: Date.now() })
    const mine = makeBlock(0, 'mine')
    replaceBlocks(db, fileHash, [mine])
    putTranslation(db, mine.block_id, 1, 1, 'm', '我的')
    putTranslation(db, `${other}:1:0`, 1, 1, 'm', '别人的')

    deletePaperData(db, fileHash)

    const rows = db.prepare('SELECT block_id FROM translations').all() as { block_id: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].block_id.startsWith(other)).toBe(true)
    expect(getPaper(db, other)).toBeDefined()
  })
})

describe('空译文行视同不存在（历史坏行自愈）', () => {
  it('getTranslation 不返回空内容的行——否则块永远卡在「有行但没内容」', () => {
    const b = makeBlock(0, 'hello world')
    replaceBlocks(db, fileHash, [b])
    putTranslation(db, b.block_id, 1, 1, 'm', '')
    expect(getTranslation(db, b.block_id, 1, 1)).toBeUndefined()

    putTranslation(db, b.block_id, 1, 1, 'm', '你好世界')
    expect(getTranslation(db, b.block_id, 1, 1)?.text).toBe('你好世界')
  })
})

describe('listPapers 的进度口径必须与阅读器一致', () => {
  it('只算可译块、只算当前版本、空内容不算', () => {
    const para = makeBlock(0, '一段正文')
    const heading = { ...makeBlock(1, '一个标题'), kind: 'heading' as const, heading_level: 1 }
    const figure = { ...makeBlock(2, '图注'), kind: 'figure' as const }
    replaceBlocks(db, fileHash, [para, heading, figure])

    putTranslation(db, para.block_id, 1, 1, 'm', '正文译文')
    putTranslation(db, heading.block_id, 1, 1, 'm', '') // 空：不算
    putTranslation(db, figure.block_id, 1, 1, 'm', '图注译文') // 非可译块：不算
    putTranslation(db, heading.block_id, 2, 1, 'm', '旧版本译文') // 别的术语表版本：不算

    const [row] = listPapers(db, 1, 1)
    expect(row.trans_total).toBe(2) // para + heading
    expect(row.trans_done).toBe(1) // 只有 para 数得上
  })

  it('换了术语表版本，进度归零而不是虚高', () => {
    const para = makeBlock(0, '一段正文')
    replaceBlocks(db, fileHash, [para])
    putTranslation(db, para.block_id, 1, 1, 'm', '正文译文')
    expect(listPapers(db, 1, 1)[0].trans_done).toBe(1)
    expect(listPapers(db, 2, 1)[0].trans_done).toBe(0)
  })
})

describe('版面解析版本', () => {
  it('用旧版规则识别的论文置回 pending；当前版本和正在识别的不动', () => {
    const db = openDb(':memory:')
    for (const id of ['old', 'cur', 'busy']) upsertPaper(db, { id, file_path: `/${id}.pdf`, title: id, added_at: 1 })
    setLayoutState(db, 'cur', 'done', 2)
    setLayoutState(db, 'old', 'done', 1)
    setLayoutState(db, 'busy', 'pending')
    expect(markStaleLayouts(db, 2)).toBe(1)
    expect(getPaper(db, 'old')?.layout_state).toBe('pending')
    expect(getPaper(db, 'cur')?.layout_state).toBe('done')
    // 重识别完记上新版本，下次启动不再重来
    setLayoutState(db, 'old', 'done', 2)
    expect(markStaleLayouts(db, 2)).toBe(0)
    db.close()
  })
})
