import { describe, expect, it } from 'vitest'
import { preservesInlineContent, repairScriptMarks } from './translation-integrity'

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

  it('原文里普通的波浪号不当成下标', () => {
    expect(preservesInlineContent('Gains of about ~10% and ~20% were seen.', '提升约 ~10% 和 ~20%。')).toBe(true)
    expect(preservesInlineContent('Gains of about ~10% and ~20% were seen.', '提升约 10% 和 20%。')).toBe(true)
  })
})

describe('上下标修补', () => {
  it('缺的标记补在句末标点前，多出来的去掉标记保留内容', () => {
    const source = 'See data.^5^ The coefficient x~i~ is small.'
    const fixed = repairScriptMarks(source, '系数 x~i~ 很小，见数据 ^7^。')
    expect(fixed).toBe('系数 x~i~ 很小，见数据 7^5^。')
    expect(preservesInlineContent(source, fixed)).toBe(true)
  })

  it('重复出现的标记按次数补齐，已经对得上的不动', () => {
    const source = 'A^1^ and B^1^ differ.'
    expect(repairScriptMarks(source, 'A^1^ 与 B 不同')).toBe('A^1^ 与 B 不同^1^')
    expect(repairScriptMarks(source, 'A^1^ 与 B^1^ 不同。')).toBe('A^1^ 与 B^1^ 不同。')
  })
})
