import { describe, expect, it } from 'vitest'
import { classifyDrop, hasFiles } from './drop'

describe('拖入文件分拣', () => {
  it('有本机路径的 PDF 进导入列表（后缀不分大小写）', () => {
    const v = classifyDrop(
      [
        { name: 'a.pdf', type: 'application/pdf', path: '/x/a.pdf' },
        { name: 'B.PDF', type: '', path: '/x/B.PDF' },
        { name: 'c.txt', type: 'text/plain', path: '/x/c.txt' }
      ],
      (f) => f.path
    )
    expect(v).toEqual({ paths: ['/x/a.pdf', '/x/B.PDF'], problem: null })
  })

  it('看着是 PDF 却拿不到路径：no-path（浏览器 / 云盘拖出来的文件）', () => {
    const v = classifyDrop([{ name: 'a.pdf', type: 'application/pdf', path: '' }], (f) => f.path)
    expect(v).toEqual({ paths: [], problem: 'no-path' })
  })

  it('拖进来的根本不是 PDF：not-pdf', () => {
    const v = classifyDrop([{ name: 'notes.md', type: 'text/markdown', path: '/x/notes.md' }], (f) => f.path)
    expect(v).toEqual({ paths: [], problem: 'not-pdf' })
  })

  it('什么都没拖进来：不报问题', () => {
    expect(classifyDrop([], () => '')).toEqual({ paths: [], problem: null })
  })

  it('只认带文件的拖拽', () => {
    expect(hasFiles(['Files'])).toBe(true)
    expect(hasFiles(['text/plain', 'text/uri-list'])).toBe(false)
  })
})
