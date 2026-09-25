import { describe, expect, it } from 'vitest'
import type { BlockRow } from '../../shared/models'
import { findReference } from './references'

function block(order: number, text: string, section: string | null = 'REFERENCES'): BlockRow {
  return { block_order: order, text, section, kind: 'para' } as BlockRow
}

describe('作者年份引用定位', () => {
  it.each([
    ['Vygotsky, 1987', 'Lev S Vygotsky. Thinking and speech. The collected works of LS Vygotsky, 1:39–285, 1987.'],
    ['Luria, 1965', 'Aleksandr Romanovich Luria. Ls vygotsky and the problem of localization of functions. Neuropsychologia, 3(4):387–392, 1965.'],
    ['Fernyhough, 2010', 'Charles Fernyhough. Vygotsky, luria, and the social brain. Self and social regulation, pp. 56–79, 2010.'],
    ['Baddeley, 1992', 'Alan Baddeley. Working memory. Science, 255(5044):556–559, 1992.'],
    ['Wei, 2022', 'J. S. Wei. A paper title. Journal, 2022.'],
    ['Li, 2022', 'X. Li. A paper title. Journal, 2022.']
  ])('单作者条目以句号分隔作者和标题：%s', (cite, text) => {
    const ref = block(1, text)
    expect(findReference(cite, [ref])).toBe(ref)
  })

  it('标题提及另一作者时仍只匹配条目的作者', () => {
    const ref = block(1, 'Charles Fernyhough. Vygotsky, luria, and the social brain. Journal, 2010.')
    expect(findReference('Vygotsky, 2010', [ref])).toBeUndefined()
  })

  it('同作者同年未标后缀时，用双作者和 et al. 区分', () => {
    const two = block(1, 'Antonia Creswell and Murray Shanahan. Faithful reasoning, 2022.')
    const three = block(2, 'Antonia Creswell, Murray Shanahan, and Irina Higgins. Selection-inference, 2022.')
    expect(findReference('Creswell & Shanahan, 2022', [two, three])).toBe(two)
    expect(findReference('Creswell et al., 2022', [two, three])).toBe(three)
    expect(findReference('Creswell & Higgins, 2022', [two, three])).toBeUndefined()
  })

  it('ReAct 的 Wei 2022 引用匹配第一作者，不跳到前面的合作者条目', () => {
    const wrong = block(117, 'Xuezhi Wang, Jason Wei, Dale Schuurmans. Self-consistency, 2022a.')
    const right = block(119, 'Jason Wei, Xuezhi Wang, Dale Schuurmans. Chain of thought prompting, 2022.')
    expect(findReference('Wei et al., 2022', [wrong, right])).toBe(right)
  })

  it('即使合作者条目的年份完全相同，也不把它当作第一作者', () => {
    const wrong = block(1, 'Xuezhi Wang, Jason Wei, Dale Schuurmans. A paper, 2022.')
    const right = block(2, 'Jason Wei, Xuezhi Wang. Another paper, 2022.')
    expect(findReference('Wei et al., 2022', [wrong, right])).toBe(right)
  })

  it('保留年份后缀，区分同作者同年多篇文献', () => {
    const a = block(1, 'Mohit Shridhar, Other Author. A paper, 2020a.')
    const b = block(2, 'Mohit Shridhar, Other Author. Another paper, 2020b.')
    expect(findReference('Shridhar et al., 2020b', [a, b])).toBe(b)
    expect(findReference('Shridhar et al., 2020', [a, b])).toBeUndefined()
  })

  it('支持编号、缩写名字和姓氏在前的格式', () => {
    for (const text of ['[12] J. Wei, X. Wang. Paper, 2022.', '12. Wei, Jason and Wang, Xuezhi. Paper, 2022.']) {
      const ref = block(1, text)
      expect(findReference('Wei et al., 2022', [ref])).toBe(ref)
    }
  })

  it('不匹配正文里的引用或更长姓氏的一部分', () => {
    expect(findReference('Wei et al., 2022', [
      block(1, 'Wei et al., 2022 showed this.', 'Introduction'),
      block(2, 'Jason Weisz, Other Author. Paper, 2022.')
    ])).toBeUndefined()
  })

  it('没有 section 时可通过参考文献标题定位', () => {
    const ref = block(3, 'Jason Wei, Xuezhi Wang. Paper, 2022.', null)
    const heading = { ...block(2, 'References', null), kind: 'heading' } as BlockRow
    expect(findReference('Wei et al., 2022', [block(1, 'Wei et al., 2022', null), heading, ref])).toBe(ref)
  })

  it('找不到目标或有歧义时不跳到任意正文段落', () => {
    expect(findReference('Wei et al., 2022', [block(1, 'Wei et al., 2022', null)])).toBeUndefined()
    expect(findReference('Wei et al., 2022', [
      block(1, 'Jason Wei, Xuezhi Wang. First paper, 2022.'),
      block(2, 'Jason Wei, Other Author. Second paper, 2022.')
    ])).toBeUndefined()
  })
})
