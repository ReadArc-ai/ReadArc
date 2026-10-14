import { describe, expect, it } from 'vitest'
import type { BlockRow } from './models'
import { continuationChains, isReferencesSection, skipBlockTranslation } from './paper-flow'

let order = 0
function block(page: number, text: string, over: Partial<BlockRow> = {}): BlockRow {
  order++
  return {
    block_id: `p:${page}:${order}`,
    paper_id: 'p',
    page,
    block_order: order,
    kind: 'para',
    section: 'Introduction',
    text,
    bbox: JSON.stringify([72, 400, 220, 120]),
    simhash: '0',
    heading_level: null,
    font_size: 10,
    ...over
  }
}

const LONG_HEAD = 'Existing indexes organize the search around a single filtered attribute and then explore'
const ids = (chains: Map<string, BlockRow[]>): string[] => [...chains.values()].map((c) => c.map((b) => b.block_order).join('→'))

describe('参考文献', () => {
  it('认带章节号、各种写法的参考文献标题', () => {
    for (const s of ['References', 'REFERENCES', '7 References', 'Bibliography', '参考文献', 'Works Cited']) expect(isReferencesSection(s), s).toBe(true)
    for (const s of ['Related Work', 'A Appendix', 'References to prior art in Section 3', null]) expect(isReferencesSection(s), String(s)).toBe(false)
  })

  it('参考文献一节的正文整节跳过，标题本身照常翻译', () => {
    const entry = 'Alexandr Andoni and Piotr Indyk. Near-optimal hashing algorithms for approximate nearest neighbor in high dimensions.'
    expect(skipBlockTranslation({ kind: 'para', section: 'References', text: entry })).toBe(true)
    expect(skipBlockTranslation({ kind: 'heading', section: 'References', text: 'References' })).toBe(false)
    expect(skipBlockTranslation({ kind: 'para', section: 'Method', text: 'We propose a unified index for range filtered search.' })).toBe(false)
  })
})

describe('跨页 / 跨栏续段', () => {
  it('换页处半句接上，中间隔着图和页眉也能接', () => {
    order = 0
    const blocks = [
      block(1, `${LONG_HEAD} the remaining attributes during`),
      block(1, 'Figure 2', { kind: 'figure' }),
      block(2, 'Page header', { kind: 'margin' }),
      block(2, 'the graph traversal, which wastes most of the search budget.')
    ]
    expect(ids(continuationChains(blocks))).toEqual(['1→4'])
  })

  it('同页换栏也算；连字符断词照样接', () => {
    order = 0
    const a = block(3, `${LONG_HEAD} the remaining attributes gen-`, { bbox: JSON.stringify([72, 100, 220, 300]) })
    const b = block(3, 'eralize across domains.', { bbox: JSON.stringify([320, 100, 220, 600]) })
    expect(ids(continuationChains([a, b]))).toEqual(['1→2'])
  })

  it('段落被图和图注从中间隔开（同一栏上下）也接上', () => {
    order = 0
    const blocks = [
      block(1, `${LONG_HEAD} the remaining attributes and`, { bbox: JSON.stringify([72, 500, 450, 100]) }),
      block(1, 'Figure', { kind: 'figure', bbox: JSON.stringify([72, 300, 450, 180]) }),
      block(1, 'Figure 1: The dependency structure of the evaluation variables.', { bbox: JSON.stringify([72, 260, 450, 30]) }),
      block(1, 'should abstain from answering the question.', { bbox: JSON.stringify([72, 120, 450, 120]) })
    ]
    expect(ids(continuationChains(blocks))).toEqual(['1→4'])
  })

  it('三段连着断的接成一条链', () => {
    order = 0
    const blocks = [block(1, `${LONG_HEAD} the`), block(2, `remaining attributes during the traversal of the graph and the tree index with`), block(3, 'little overhead.')]
    expect(ids(continuationChains(blocks))).toEqual(['1→2→3'])
  })

  it('不接：句子已经结束、下一段大写开头、隔着公式、同一栏里连续、子图编号、脚注网址、参考文献', () => {
    order = 0
    const cases: BlockRow[][] = [
      [block(1, `${LONG_HEAD} the remaining attributes.`), block(2, 'then the graph is searched.')],
      [block(1, `${LONG_HEAD} the remaining`), block(2, 'However, the graph is searched.')],
      [block(1, `${LONG_HEAD} the remaining`), block(2, 'x = y', { kind: 'equation' }), block(2, 'where x is the query.')],
      [block(1, `${LONG_HEAD} the remaining`), block(1, 'attributes during traversal.', { bbox: JSON.stringify([72, 300, 220, 80]) })],
      [block(1, `${LONG_HEAD} the remaining attributes, specifically we`), block(2, '(a) In-domain results')],
      [block(1, 'See https://huggingface.co/openai-community/gpt2-xl'), block(2, 'https://huggingface.co/FacebookAI/xlm-roberta-base')],
      [block(1, `${LONG_HEAD} the remaining`, { section: 'References' }), block(2, 'attributes during traversal.', { section: 'References' })]
    ]
    for (const c of cases) expect(continuationChains(c).size, c.map((b) => b.text).join(' | ')).toBe(0)
  })
})
