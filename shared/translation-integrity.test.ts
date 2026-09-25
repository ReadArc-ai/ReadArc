import { describe, expect, it } from 'vitest'
import { preservesInlineContent } from './translation-integrity'

describe('译文中的不可改写内容', () => {
  it('公式可以随语序移动，支持渲染器识别的括号变体', () => {
    expect(preservesInlineContent('Compare ⟦f1⟧ with ⟦f2⟧.', '将 [[f2]] 与 【f1】 比较。')).toBe(true)
  })

  it('不接受公式缺失、重复、换号或多出公式', () => {
    for (const text of ['只有 ⟦f1⟧', '⟦f1⟧ ⟦f1⟧', '⟦f1⟧ ⟦f3⟧', '⟦f1⟧ ⟦f2⟧ ⟦f3⟧']) {
      expect(preservesInlineContent('Compare ⟦f1⟧ with ⟦f2⟧.', text), text).toBe(false)
    }
    expect(preservesInlineContent('No formula.', '凭空添加 ⟦f1⟧')).toBe(false)
  })

  it('脚注标号和上下标保留值、样式与次数', () => {
    const source = 'See data.^5^ The coefficient x~i~ is 10^−22^.'
    expect(preservesInlineContent(source, '系数 x~i~ 为 10^−22^，见数据。^5^')).toBe(true)
    for (const text of ['数据。5 系数 x~i~ 为 10^−22^', '数据。^5^ 系数 x^i^ 为 10^−22^', '数据。^5^ 系数 x~i~ 为 10^22^']) {
      expect(preservesInlineContent(source, text), text).toBe(false)
    }
  })
})
