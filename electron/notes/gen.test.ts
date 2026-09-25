import { describe, expect, it } from 'vitest'
import { openDb, replaceBlocks, upsertPaper, type BlockRow } from '../db'
import { blockId, sha1, simhash64 } from '../docengine/anchor'
import { anchorBlockFor } from './gen'

const paperId = sha1('pdf')
function block(order: number, kind: BlockRow['kind'], text: string): BlockRow {
  return { block_id: blockId(paperId, 1, order), paper_id: paperId, page: 1, block_order: order, kind, section: null, text, bbox: null, simhash: simhash64(text), heading_level: null, font_size: null }
}

describe('anchorBlockFor', () => {
  it('优先锚到第一个标题块，而不是页眉版权声明', () => {
    const db = openDb(':memory:')
    upsertPaper(db, { id: paperId, file_path: '/x.pdf', added_at: 0 })
    replaceBlocks(db, paperId, [block(0, 'para', 'Provided proper attribution is provided, Google hereby grants…'), block(1, 'heading', 'Attention Is All You Need'), block(2, 'para', 'Abstract …')])
    expect(anchorBlockFor(db, paperId)).toBe(blockId(paperId, 1, 1))
  })
  it('没有标题时退回首块；没有块返回 null', () => {
    const db = openDb(':memory:')
    upsertPaper(db, { id: paperId, file_path: '/x.pdf', added_at: 0 })
    expect(anchorBlockFor(db, paperId)).toBeNull()
    replaceBlocks(db, paperId, [block(0, 'para', 'first'), block(1, 'para', 'second')])
    expect(anchorBlockFor(db, paperId)).toBe(blockId(paperId, 1, 0))
  })
})
