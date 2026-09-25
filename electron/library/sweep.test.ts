import { describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sameContent, sweepOrphanCopies } from './service'

function dir(): string {
  return mkdtempSync(join(tmpdir(), 'readarc-sweep-'))
}

describe('sameContent', () => {
  it('内容相同为 true，差一个字节为 false', () => {
    const d = dir()
    const a = join(d, 'a.pdf')
    const b = join(d, 'b.pdf')
    const c = join(d, 'c.pdf')
    writeFileSync(a, 'same bytes')
    writeFileSync(b, 'same bytes')
    writeFileSync(c, 'same byteS')
    expect(sameContent(a, b)).toBe(true)
    expect(sameContent(a, c)).toBe(false)
  })

  it('文件不存在时返回 false 而不是抛异常', () => {
    const d = dir()
    writeFileSync(join(d, 'a.pdf'), 'x')
    expect(sameContent(join(d, 'a.pdf'), join(d, 'nope.pdf'))).toBe(false)
  })
})

describe('sweepOrphanCopies：只删没人引用的副本', () => {
  it('留下被引用的，删掉孤儿', () => {
    const d = dir()
    const keep = join(d, 'keep.pdf')
    const orphan1 = join(d, 'orphan1.pdf')
    const orphan2 = join(d, 'orphan2.pdf')
    for (const f of [keep, orphan1, orphan2]) writeFileSync(f, 'pdf')

    expect(sweepOrphanCopies(d, [keep])).toBe(2)
    expect(readdirSync(d)).toEqual(['keep.pdf'])
  })

  it('全部被引用时一个都不删', () => {
    const d = dir()
    const a = join(d, 'a.pdf')
    const b = join(d, 'b.pdf')
    writeFileSync(a, 'x')
    writeFileSync(b, 'y')
    expect(sweepOrphanCopies(d, [a, b])).toBe(0)
    expect(readdirSync(d).sort()).toEqual(['a.pdf', 'b.pdf'])
  })

  it('目录不存在时返回 0，不抛异常', () => {
    expect(sweepOrphanCopies(join(tmpdir(), 'readarc-no-such-dir-xyz'), [])).toBe(0)
  })

  it('空目录安全', () => {
    expect(sweepOrphanCopies(dir(), [])).toBe(0)
  })
})

describe('截图标记', () => {
  it('倍率或算法版本落后就重裁；当前标记不重裁；老格式（只有倍率）按版本 1 处理', async () => {
    const { cropMark, cropMarkCurrent } = await import('./import')
    expect(cropMarkCurrent(cropMark())).toBe(true)
    expect(cropMarkCurrent('4')).toBe(false)
    expect(cropMarkCurrent('2/2')).toBe(false)
    expect(cropMarkCurrent(null)).toBe(false)
    expect(cropMarkCurrent('9/9')).toBe(true)
  })
})
