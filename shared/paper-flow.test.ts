import { describe, expect, it } from 'vitest'
import type { BlockRow } from './models'
import { clusterFigures, containedFigures, continuationChains, figureLayout, isReferencesSection, skipBlockTranslation } from './paper-flow'

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

describe('图块归并', () => {
  type F = { id: string; box: [number, number, number, number] }
  const boxOf = (f: F): F['box'] => f.box
  const ids = (c: { blocks: F[] }): string[] => c.blocks.map((f) => f.id)

  it('一张长图被切成一排：归成一组，外接框是整张图', () => {
    const row: F[] = [70, 147, 223, 299, 378, 450].map((x, i) => ({ id: `p${i}`, box: [x, 701, 76, 71] }))
    const [only, ...rest] = clusterFigures(row, boxOf)
    expect(rest).toHaveLength(0)
    expect(only.blocks).toHaveLength(6)
    expect(only.box).toEqual([70, 701, 456, 71])
  })

  it('离得远的两张图不并；上下贴着的并', () => {
    const a: F = { id: 'a', box: [70, 600, 200, 100] }
    const below: F = { id: 'b', box: [70, 490, 200, 100] }
    const far: F = { id: 'c', box: [70, 100, 200, 100] }
    const out = clusterFigures([a, below, far], boxOf)
    expect(out.map(ids)).toEqual([['a', 'b'], ['c']])
  })

  it('占不满外接框的不并：外接框里可能框进别的内容', () => {
    const left: F = { id: 'l', box: [70, 600, 200, 100] }
    const right: F = { id: 'r', box: [290, 550, 200, 100] }
    expect(clusterFigures([left, right], boxOf).map(ids)).toEqual([['l'], ['r']])
  })

  it('全文归并：连续的碎块成组，隔着正文的不算，整图里的碎块标成重复', () => {
    const fig = (id: string, page: number, x: number, w = 76): { block_id: string; kind: BlockRow['kind']; page: number; bbox: string } => ({ block_id: id, kind: 'figure', page, bbox: JSON.stringify([x, 700, w, 70]) })
    const para = { block_id: 'p', kind: 'para' as const, page: 1, bbox: JSON.stringify([70, 500, 400, 100]) }
    const margin = { block_id: 'm', kind: 'margin' as const, page: 1, bbox: JSON.stringify([10, 10, 10, 10]) }
    const { clusterOf, duplicates } = figureLayout([fig('a', 1, 70), margin, fig('b', 1, 147), para, fig('c', 1, 224), fig('whole', 2, 70, 450), fig('piece', 2, 180, 100)])
    expect(clusterOf.get('a')?.blocks.map((b) => b.block_id)).toEqual(['a', 'b'])
    expect(clusterOf.has('c')).toBe(false)
    expect([...duplicates]).toEqual(['piece'])
    expect(clusterOf.has('whole')).toBe(false)
  })

  it('整图和它的碎块同时框出来时丢掉碎块，部分重叠的不丢', () => {
    const whole: F = { id: 'whole', box: [73, 695, 450, 76] }
    const piece: F = { id: 'piece', box: [186, 695, 110, 76] }
    const beside: F = { id: 'beside', box: [400, 650, 200, 100] }
    expect([...containedFigures([whole, piece, beside], boxOf)].map((f) => f.id)).toEqual(['piece'])
  })
})
