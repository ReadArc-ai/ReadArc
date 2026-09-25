import { describe, expect, it } from 'vitest'
import { INLINE_PLACEHOLDER_RE, hasInlinePlaceholder, inlineFigureKey, inlinePlaceholder, restoreInlines, placeholderNumbers, placeholdersMatch, repairPlaceholders } from './inline-formula'

const inlines = [
  { n: 1, bbox: [0, 0, 10, 10] as [number, number, number, number], base: 0, text: 'ˆA = A ∪ L' },
  { n: 2, bbox: [0, 0, 10, 10] as [number, number, number, number], base: 0, text: 'L' }
]

describe('行内公式占位符', () => {
  it('占位符与截图键的形态', () => {
    expect(inlinePlaceholder(3)).toBe('⟦f3⟧')
    expect(inlineFigureKey('abc:1:2', 3)).toBe('abc:1:2:f3')
  })

  it('模型换了括号形态也能认出序号', () => {
    for (const s of ['⟦f1⟧', '⟦ f1 ⟧', '[[f1]]', '[f1]', '【f1】']) {
      INLINE_PLACEHOLDER_RE.lastIndex = 0
      const m = INLINE_PLACEHOLDER_RE.exec(s)
      expect(m?.[1], s).toBe('1')
      expect(hasInlinePlaceholder(s), s).toBe(true)
    }
    expect(hasInlinePlaceholder('引用 [12] 和 f1 不算')).toBe(false)
  })

  it('判断过之后 matchAll 仍从头找起（全局正则的 lastIndex 归零）', () => {
    const text = '到 ⟦f1⟧，其中 ⟦f2⟧'
    expect(hasInlinePlaceholder(text)).toBe(true)
    expect([...text.matchAll(INLINE_PLACEHOLDER_RE)].map((m) => m[1])).toEqual(['1', '2'])
  })

  it('还原成文本层原文；没记录的序号去掉', () => {
    expect(restoreInlines('动作空间扩展为 ⟦f1⟧，其中 ⟦f2⟧ 是语言空间', inlines)).toBe('动作空间扩展为 ˆA = A ∪ L，其中 L 是语言空间')
    expect(restoreInlines('见 ⟦f9⟧。', JSON.stringify(inlines))).toBe('见 。')
    expect(restoreInlines('没有占位符', null)).toBe('没有占位符')
  })
})

describe('译文的公式占位符对应', () => {
  it('一一对应才算匹配：少了、多了（模型编的）都不行，括号写法不同不影响', () => {
    expect(placeholdersMatch('a ⟦f1⟧ b ⟦f2⟧', '甲 ⟦f2⟧ 乙 [[f1]]')).toBe(true)
    expect(placeholdersMatch('a ⟦f1⟧ b ⟦f2⟧', '甲 ⟦f1⟧ 乙')).toBe(false)
    expect(placeholdersMatch('a ⟦f1⟧', '甲 ⟦f1⟧ 乙 ⟦f3⟧')).toBe(false)
    expect(placeholderNumbers('⟦f3⟧ x ⟦f1⟧ ⟦f3⟧')).toEqual([1, 3])
  })

  it('修补：去掉编出来的序号，缺的补在句末标点前', () => {
    expect(repairPlaceholders('when ⟦f1⟧ and ⟦f2⟧ hold.', '当 ⟦f1⟧ 且 ⟦f6⟧ 成立。')).toBe('当 ⟦f1⟧ 且 成立 ⟦f2⟧。')
    expect(repairPlaceholders('x ⟦f1⟧', '没有公式')).toBe('没有公式 ⟦f1⟧')
  })
})
