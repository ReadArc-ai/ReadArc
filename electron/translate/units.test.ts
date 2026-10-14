import { describe, expect, it } from 'vitest'
import { joinUnit, splitUnit, PAGE_BREAK } from './units'

const A = { text: 'We first index all objects with ⟦f1⟧ and keep ⟦f2⟧ fixed, thereby preserving' }
const B = { text: 'the correlation between ⟦f1⟧ and the attributes.^3^' }

describe('续段单元', () => {
  it('拼接：断开处插 ⟦pb⟧，后一块的公式编号往后挪，不和前一块撞号', () => {
    expect(joinUnit([A, B])).toBe(
      `We first index all objects with ⟦f1⟧ and keep ⟦f2⟧ fixed, thereby preserving ${PAGE_BREAK} the correlation between ⟦f3⟧ and the attributes.^3^`
    )
  })

  it('切回：按 ⟦pb⟧ 切，公式编号还原到各自那一块', () => {
    const out = '我们先用 ⟦f1⟧ 索引所有对象并固定 ⟦f2⟧，从而保留 ⟦pb⟧ ⟦f3⟧ 与属性之间的相关性。^3^'
    expect(splitUnit([A, B], out)).toEqual(['我们先用 ⟦f1⟧ 索引所有对象并固定 ⟦f2⟧，从而保留', '⟦f1⟧ 与属性之间的相关性。^3^'])
  })

  it('模型写成 [[pb]] 或【pb】也认', () => {
    expect(splitUnit([A, B], '甲 ⟦f1⟧ ⟦f2⟧ 乙 [[pb]] 丙 ⟦f3⟧。^3^')).toEqual(['甲 ⟦f1⟧ ⟦f2⟧ 乙', '丙 ⟦f1⟧。^3^'])
    expect(splitUnit([A, B], '甲 ⟦f1⟧ ⟦f2⟧ 乙【pb】丙 ⟦f3⟧。^3^')).toEqual(['甲 ⟦f1⟧ ⟦f2⟧ 乙', '丙 ⟦f1⟧。^3^'])
  })

  it('丢了 ⟦pb⟧：按长度比例在句读处切，各块的公式与上下标补齐', () => {
    const pieces = splitUnit([A, B], '我们先用 ⟦f1⟧ 索引所有对象并固定 ⟦f2⟧，从而保留了 ⟦f3⟧ 与属性之间的相关性。^3^')
    expect(pieces).not.toBeNull()
    expect(pieces![0]).toContain('⟦f1⟧')
    expect(pieces![0]).toContain('⟦f2⟧')
    expect(pieces![1]).toContain('⟦f1⟧')
    expect(pieces![1]).toContain('^3^')
  })

  it('公式被模型挪过了断开处：去掉错位的编号，按原文补回', () => {
    // 后一块的 ⟦f3⟧ 跑到了 ⟦pb⟧ 前面
    const pieces = splitUnit([A, B], '我们先用 ⟦f1⟧ 和 ⟦f3⟧ 索引并固定 ⟦f2⟧，从而保留 ⟦pb⟧ 与属性之间的相关性。^3^')
    expect(pieces![0]).toBe('我们先用 ⟦f1⟧ 和 索引并固定 ⟦f2⟧，从而保留')
    // 公式补回后一块（位置可能挪到末尾，但不会丢），脚注标号也在
    expect(pieces![1]).toContain('⟦f1⟧')
    expect(pieces![1]).toContain('^3^')
    expect(pieces![1]).not.toContain('⟦f3⟧')
  })

  it('切出空片段时放弃，交给逐块翻译', () => {
    expect(splitUnit([A, B], '⟦pb⟧ 只有后半段 ⟦f1⟧ ⟦f2⟧ ⟦f3⟧ ^3^')).toBeNull()
  })
})

describe('arXiv 网页版单元的校验', () => {
  const pid = 'c'.repeat(40)
  it('只收这篇论文前缀的段落和标题，长度、个数有上限', async () => {
    const { unitBlocks } = await import('./units')
    const blocks = unitBlocks(pid, [
      { id: `${pid}:x:a`, kind: 'para', text: 'We study retrieval.', order: 3 },
      { id: `${pid}:x:b`, kind: 'heading', text: '1 Introduction', order: 4 },
      { id: `other:x:c`, kind: 'para', text: 'not this paper', order: 5 },
      { id: `${pid}:x:d`, kind: 'figure', text: 'x', order: 6 },
      { id: `${pid}:x:e`, kind: 'para', text: 'x'.repeat(20_001), order: 7 },
      { id: `${pid}:x:f`, kind: 'para', text: '   ', order: 8 },
      null
    ])
    expect(blocks.map((b) => [b.block_id, b.kind, b.block_order])).toEqual([
      [`${pid}:x:a`, 'para', 3],
      [`${pid}:x:b`, 'heading', 4]
    ])
    expect(unitBlocks(pid, 'nope')).toEqual([])
  })
})
