import { describe, expect, it } from 'vitest'
import { appendNote, localStamp, newNotesFile, parseNotesFile, removeNote, serializeNotesFile } from './note-file'
import { simhash64 } from '../docengine/anchor'

const anchor = (text: string) => ({
  block_id: 'abc123:4:7',
  char_start: 0,
  char_end: text.length,
  simhash: simhash64(text),
  excerpt: text
})

describe('note-file', () => {
  it('新建 → 追加 → 序列化 → 解析 round-trip', () => {
    const { file, anchorId } = appendNote(
      newNotesFile('abc123', 'RASR: Retrieval-Augmented Speech Recognition'),
      anchor('Our method achieves a 14.2% relative WER reduction.'),
      '这里的 WER 降低主要来自检索样例，和 §5 的消融一致。',
      new Date(2026, 7, 20, 18, 20)
    )
    expect(anchorId).toBe('a1')

    const parsed = parseNotesFile(serializeNotesFile(file))
    expect(parsed.meta.paper).toBe('abc123')
    expect(parsed.meta.anchors['a1'].block_id).toBe('abc123:4:7')
    expect(parsed.meta.anchors['a1'].excerpt).toContain('WER')
    expect(parsed.body).toContain('## a1 · 2026-08-20 18:20')
    expect(parsed.body).toContain('消融')
  })

  it('多条笔记 id 递增，已有正文不被重排', () => {
    let state = appendNote(newNotesFile('p', 'T'), anchor('first block'), '第一条')
    state = appendNote(state.file, anchor('second block'), '第二条')
    expect(state.anchorId).toBe('a2')
    const text = serializeNotesFile(state.file)
    expect(text.indexOf('第一条')).toBeLessThan(text.indexOf('第二条'))
    expect(Object.keys(parseNotesFile(text).meta.anchors)).toEqual(['a1', 'a2'])
  })

  it('用户手改过的正文原样保留（文件属于用户）', () => {
    const { file } = appendNote(newNotesFile('p', 'T'), anchor('block'), '原始笔记')
    const edited = { ...file, body: file.body + '\n用户自己补充的一行，程序不许动。\n' }
    const { file: after } = appendNote(edited, anchor('another'), '新笔记')
    const out = serializeNotesFile(after)
    expect(out).toContain('用户自己补充的一行')
    expect(out.indexOf('用户自己补充的一行')).toBeLessThan(out.indexOf('新笔记'))
  })

  it('时间戳按本机时区写，不是 UTC', () => {
    expect(localStamp(new Date(2026, 8, 3, 11, 5))).toBe('2026-09-03 11:05')
    const { file } = appendNote(newNotesFile('p', 'T'), anchor('block'), '一条', new Date(2026, 8, 3, 11, 5))
    expect(file.body).toContain('## a1 · 2026-09-03 11:05')
  })

  it('删除一条：正文整节与锚点一起去掉，其余条目和用户手写内容不动', () => {
    let state = appendNote(newNotesFile('p', 'T'), anchor('first block'), '第一条')
    state = appendNote(state.file, anchor('second block'), '第二条\n\n第二条第二段')
    state = appendNote(state.file, anchor('third block'), '第三条')
    const edited = { ...state.file, body: state.file.body + '\n用户自己补充的一行。\n' }
    const after = removeNote(edited, 'a2')
    const out = serializeNotesFile(after)
    expect(out).not.toContain('第二条')
    expect(out).toContain('第一条')
    expect(out).toContain('第三条')
    expect(out).toContain('用户自己补充的一行')
    expect(Object.keys(after.meta.anchors)).toEqual(['a1', 'a3'])
    expect(after.body).not.toMatch(/\n{3,}/)
    // 删掉不存在的 id 不动正文
    expect(removeNote(after, 'a9').body).toBe(after.body)
  })
})
