import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDb, replaceBlocks, upsertPaper } from '../db'
import { blockId, sha1, simhash64 } from '../docengine/anchor'
import { addHighlight, addNote, noteFileName, notesForPaper, removeHighlight, friendlyNoteError } from './service'

let db: Database.Database
let dir: string
const paperId = sha1('pdf')
const bid = blockId(paperId, 1, 0)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'readarc-notes-'))
  db = openDb(':memory:')
  upsertPaper(db, { id: paperId, file_path: '/x.pdf', title: 'RASR: Retrieval ASR', year: 2025, added_at: 1 })
  replaceBlocks(db, paperId, [
    {
      block_id: bid,
      paper_id: paperId,
      page: 1,
      block_order: 0,
      kind: 'para',
      section: '§3',
      text: 'Our method achieves a 14.2% relative WER reduction.',
      bbox: null,
      simhash: simhash64('Our method achieves a 14.2% relative WER reduction.'),
      heading_level: null,
    font_size: null
    }
  ])
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('noteFileName', () => {
  it('标题 slug + 年份，rasr-2025.md 风格', () => {
    expect(noteFileName('RASR: Retrieval ASR', 2025, paperId)).toBe('rasr-retrieval-asr-2025.md')
    expect(noteFileName(null, null, paperId)).toBe(`${paperId.slice(0, 8)}.md`)
  })
})

describe('addNote + notesForPaper', () => {
  it('落盘 → 读回：锚点带原文摘录，倒序排列，文件名可见', () => {
    addNote(db, dir, paperId, bid, '第一条：WER 降幅主要来自检索。')
    addNote(db, dir, paperId, bid, '第二条：和 §5 消融一致。')

    const notes = notesForPaper(db, dir, paperId)
    expect(notes.file).toBe('rasr-retrieval-asr-2025.md')
    expect(notes.entries).toHaveLength(2)
    expect(notes.entries[0].text).toContain('第二条') // 最新在前
    expect(notes.entries[1].anchor?.excerpt).toContain('WER reduction')
    expect(notes.entries[1].anchor?.block_id).toBe(bid)
  })

  it('文件是普通 Markdown：外部可读，用户手写内容在追加后保留', () => {
    addNote(db, dir, paperId, bid, '程序写的')
    const path = join(dir, 'rasr-retrieval-asr-2025.md')
    const raw = readFileSync(path, 'utf8')
    expect(raw).toContain('---') // front-matter
    expect(raw).toContain('程序写的')
    writeFileSync(path, raw + '\n用户手写的一行。\n')
    addNote(db, dir, paperId, bid, '又一条')
    const after = readFileSync(path, 'utf8')
    expect(after).toContain('用户手写的一行。')
    expect(after.indexOf('用户手写的一行')).toBeLessThan(after.indexOf('又一条'))
  })

  it('选区锚点：字符偏移与选区摘录；选区在段内找不到则退回整段', () => {
    const sel = 'relative WER reduction'
    const note = addNote(db, dir, paperId, bid, '关于降幅', sel)
    expect(note.anchor?.char_start).toBe(
      'Our method achieves a 14.2% relative WER reduction.'.indexOf(sel)
    )
    expect(note.anchor?.char_end).toBe(note.anchor!.char_start + sel.length)
    expect(note.anchor?.excerpt).toBe(sel)

    const fallback = addNote(db, dir, paperId, bid, 'x', '跨段选择的文本不在本段')
    expect(fallback.anchor?.char_start).toBe(0)
  })

  it('没有笔记文件时返回空列表而不报错', () => {
    expect(notesForPaper(db, dir, paperId)).toEqual({
      file: 'rasr-retrieval-asr-2025.md',
      entries: [],
      highlights: {}
    })
  })
})

describe('高亮落盘 [P6]', () => {
  it('添加 → 读回（字符偏移）→ 移除；与笔记同文件共存', () => {
    addNote(db, dir, paperId, bid, '先有一条笔记')
    const { id } = addHighlight(db, dir, paperId, bid, 'WER reduction')
    expect(id).toBe('h1')

    const notes = notesForPaper(db, dir, paperId)
    expect(notes.highlights[id]).toMatchObject({
      block_id: bid,
      char_start: 'Our method achieves a 14.2% relative WER reduction.'.indexOf('WER reduction'),
      excerpt: 'WER reduction'
    })
    expect(notes.entries).toHaveLength(1) // 笔记不受影响

    removeHighlight(db, dir, paperId, id)
    const after = notesForPaper(db, dir, paperId)
    expect(after.highlights).toEqual({})
    expect(after.entries).toHaveLength(1)
  })

  it('选区文字定位不到 → 不报错，退回整块范围（视觉精度由 rects 保证）', () => {
    const { anchor } = addHighlight(db, dir, paperId, bid, '不存在的文字')
    expect(anchor.char_start).toBe(0)
    expect(anchor.char_end).toBe('Our method achieves a 14.2% relative WER reduction.'.length)
  })

  it('选区矩形随锚点落盘并读回（原版页高亮绘制的数据源）', () => {
    const rects: [number, number, number, number, number][] = [
      [1, 72.5, 700.25, 200, 10.8],
      [1, 72.5, 688, 120, 10.8]
    ]
    const { id } = addHighlight(db, dir, paperId, bid, 'aug-\nmented text', rects)
    const notes = notesForPaper(db, dir, paperId)
    expect(notes.highlights[id].rects).toEqual(rects)
  })

  it('归一化匹配：跨行断词连字符与合字不影响定位', () => {
    const text = 'The models achieve signiﬁcantly better results with less training.'
    replaceBlocks(db, paperId, [
      {
        block_id: bid, paper_id: paperId, page: 1, block_order: 0, kind: 'para',
        section: null, text, bbox: null, simhash: simhash64(text), heading_level: null,
    font_size: null
      }
    ])
    // 选区来自文本层：断词 "signifi-\ncantly"、普通 fi 替代合字 ﬁ
    const { anchor } = addHighlight(db, dir, paperId, bid, 'achieve signifi-\ncantly better')
    expect(text.slice(anchor.char_start, anchor.char_end)).toBe('achieve signiﬁcantly better')
  })

  it('首尾锚定：选区中间夹带公式碎片时按头尾定位范围', () => {
    const text =
      'Attention maps a query and a set of key-value pairs to an output, where the weights are computed by softmax over scaled dot products.'
    replaceBlocks(db, paperId, [
      {
        block_id: bid, paper_id: paperId, page: 1, block_order: 0, kind: 'para',
        section: null, text, bbox: null, simhash: simhash64(text), heading_level: null,
    font_size: null
      }
    ])
    // 中段被文本层的公式符号污染，与块文本对不上
    const sel = 'maps a query and a set of QK√dk α∑ the weights are computed by softmax'
    const { anchor } = addHighlight(db, dir, paperId, bid, sel)
    expect(anchor.char_start).toBe(text.indexOf('maps a query'))
    expect(text.slice(anchor.char_start, anchor.char_end)).toContain('computed by softmax')
    expect(anchor.char_end).toBeLessThan(text.length) // 不是整块兜底
  })

  it('译文选区：文本定位失败时采用渲染端反投影的 hintRange，而非整块', () => {
    const sel = '我们提出了一种新的简单网络架构'
    const { anchor } = addHighlight(db, dir, paperId, bid, sel, undefined, [22, 35])
    expect(anchor.char_start).toBe(22)
    expect(anchor.char_end).toBe(35)
  })

  it('词元锚定：中文选区凭数字/术语在原文中定位（比占比投影准）', () => {
    const text =
      'Our model achieves 28.4 BLEU on the WMT 2014 English-to-German task. On English-to-French, we reach 41.8 after 3.5 days on eight GPUs.'
    replaceBlocks(db, paperId, [
      {
        block_id: bid, paper_id: paperId, page: 1, block_order: 0, kind: 'para',
        section: null, text, bbox: null, simhash: simhash64(text), heading_level: null,
    font_size: null
      }
    ])
    // 中文选区带共享词元 41.8 / 3.5 / GPU；hint 中点落在句子附近
    const sel = '我们在8个GPU上训练3.5天后达到41.8'
    const { anchor } = addHighlight(db, dir, paperId, bid, sel, undefined, [80, 130])
    const marked = text.slice(anchor.char_start, anchor.char_end)
    expect(marked).toContain('41.8')
    expect(marked).toContain('3.5 days')
    expect(anchor.char_start).toBeGreaterThan(60) // 没吞掉第一句
  })

  it('空白弹性匹配：原版页文本层选区的空白差异不影响定位', () => {
    // 块文本是 "a 14.2% relative"，文本层选区可能是 "a  14.2%\nrelative"
    const { anchor } = addHighlight(db, dir, paperId, bid, 'a  14.2%\n relative')
    expect(anchor.char_start).toBe('Our method achieves '.length)
    expect(anchor.char_end).toBe('Our method achieves a 14.2% relative'.length)
  })
})

describe('friendlyNoteError：笔记写不进去时说人话', () => {
  const DIR = '/Users/x/Documents/ReadArc/Notes'

  it('权限问题指出目录并给出解决办法', () => {
    const m = friendlyNoteError(new Error("EACCES: permission denied, open '/a/b.md'"), DIR)
    expect(m).toContain('的权限')
    expect(m).toContain(DIR)
    expect(m).toContain('检查目录权限')
  })

  it('只读卷同样归到权限一类', () => {
    expect(friendlyNoteError(new Error('EROFS: read-only file system'), DIR)).toContain(
      '的权限'
    )
  })

  it('磁盘满单独说', () => {
    expect(friendlyNoteError(new Error('ENOSPC: no space left on device'), DIR)).toContain(
      '磁盘空间不足'
    )
  })

  it('目录不存在单独说', () => {
    expect(friendlyNoteError(new Error("ENOENT: no such file or directory"), DIR)).toContain(
      '找不到目录'
    )
  })

  it('认不出的也包成中文并保留原文', () => {
    const m = friendlyNoteError(new Error('weird io failure 0x99'), DIR)
    expect(m).toContain('无法保存笔记')
    expect(m).toContain('weird io failure 0x99')
  })
})

describe('锚点重定位 [P6]：解析器升级后笔记仍指得回原文', () => {
  const TEXT = 'Our method achieves a 14.2% relative WER reduction.'

  /** 模拟解析器升级：同一段内容，块序号从 0 挪到 7（前面多插了几个块）。 */
  function reparseWithShiftedOrder(): string {
    const moved = blockId(paperId, 1, 7)
    replaceBlocks(db, paperId, [
      {
        block_id: blockId(paperId, 1, 3),
        paper_id: paperId,
        page: 1,
        block_order: 3,
        kind: 'para',
        section: '§3',
        text: 'An unrelated paragraph the new parser now emits.',
        bbox: null,
        simhash: simhash64('An unrelated paragraph the new parser now emits.'),
        heading_level: null,
        font_size: null
      },
      {
        block_id: moved,
        paper_id: paperId,
        page: 1,
        block_order: 7,
        kind: 'para',
        section: '§3',
        text: TEXT,
        bbox: null,
        simhash: simhash64(TEXT),
        heading_level: null,
        font_size: null
      }
    ])
    return moved
  }

  it('块序号偏移后，笔记锚点被找回到新的 block_id', () => {
    addNote(db, dir, paperId, bid, '这段的数字要核对')
    expect(notesForPaper(db, dir, paperId).entries[0].anchor?.block_id).toBe(bid)

    const moved = reparseWithShiftedOrder()
    const after = notesForPaper(db, dir, paperId).entries[0].anchor
    expect(after?.block_id).toBe(moved) // 不再是失效的老 id
    expect(after?.excerpt).toBeTruthy() // 其余字段原样保留
  })

  it('高亮锚点同样被找回', () => {
    addHighlight(db, dir, paperId, bid, '14.2% relative')
    const moved = reparseWithShiftedOrder()
    const hs = Object.values(notesForPaper(db, dir, paperId).highlights)
    expect(hs).toHaveLength(1)
    expect(hs[0].block_id).toBe(moved)
  })

  it('内容真的没了就保持原样，不错挂到别的段落', () => {
    addNote(db, dir, paperId, bid, '孤儿笔记')
    replaceBlocks(db, paperId, [
      {
        block_id: blockId(paperId, 2, 0),
        paper_id: paperId,
        page: 2,
        block_order: 0,
        kind: 'para',
        section: '§9',
        text: 'Completely different content about unrelated astronomy topics entirely.',
        bbox: null,
        simhash: simhash64('Completely different content about unrelated astronomy topics entirely.'),
        heading_level: null,
        font_size: null
      }
    ])
    const a = notesForPaper(db, dir, paperId).entries[0].anchor
    expect(a?.block_id).toBe(bid) // 原样保留，宁可「未定位」
  })

  it('块没变时不做任何改动', () => {
    addNote(db, dir, paperId, bid, '正常笔记')
    expect(notesForPaper(db, dir, paperId).entries[0].anchor?.block_id).toBe(bid)
  })
})

describe('标题变化与块 id 复用', () => {
  const para = (order: number, text: string) => ({
    block_id: blockId(paperId, 1, order),
    paper_id: paperId,
    page: 1,
    block_order: order,
    kind: 'para' as const,
    section: null,
    text,
    bbox: null,
    simhash: simhash64(text),
    heading_level: null,
    font_size: null
  })

  it('标题改了（后台识别换上模型标题）：按 front-matter 找回原笔记文件并继续写', () => {
    addNote(db, dir, paperId, bid, '识别前记的')
    upsertPaper(db, { id: paperId, file_path: '/x.pdf', title: 'RASR Retrieval-Augmented Speech Recognition', added_at: 1 })
    const notes = notesForPaper(db, dir, paperId)
    expect(notes.file).toBe('rasr-retrieval-asr-2025.md')
    expect(notes.entries.map((e) => e.text)).toEqual(['识别前记的'])
    addNote(db, dir, paperId, bid, '识别后记的')
    expect(notesForPaper(db, dir, paperId).entries).toHaveLength(2)
  })

  it('同一个块 id 换成了别的段落：高亮跟着原文走，不挂在新段落上', () => {
    const sel = 'relative WER reduction'
    addHighlight(db, dir, paperId, bid, sel)
    // 重新识别后序号 0 变成另一段，原文挪到序号 1
    replaceBlocks(db, paperId, [
      para(0, 'Speech recognition has long relied on acoustic models trained end to end.'),
      para(1, 'Our method achieves a 14.2% relative WER reduction.')
    ])
    const hl = Object.values(notesForPaper(db, dir, paperId).highlights)
    expect(hl).toHaveLength(1)
    expect(hl[0].block_id).toBe(blockId(paperId, 1, 1))
    expect(hl[0].char_start).toBe('Our method achieves a 14.2% relative WER reduction.'.indexOf(sel))
  })

  it('块 id 被别的段落占用、原文也找不回：不显示，不挂错', () => {
    addHighlight(db, dir, paperId, bid, 'relative WER reduction')
    replaceBlocks(db, paperId, [para(0, 'An entirely different paragraph about optimisers and learning rates.')])
    expect(Object.values(notesForPaper(db, dir, paperId).highlights)).toHaveLength(0)
  })
})
