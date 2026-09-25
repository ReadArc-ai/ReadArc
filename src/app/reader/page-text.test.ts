import { describe, expect, it, vi } from 'vitest'
import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BlockRow } from '../../../shared/models'
import { isCenteredHeading, renderInline, type InlineCtx } from './page-text'

vi.mock('../../lib/use-figure', () => ({ useFigureSrc: () => 'data:image/png;base64,AA==' }))

describe('译文行内内容与样式', () => {
  const ctx: InlineCtx = {
    paperId: 'paper', blockId: 'paper:1:0', fontSize: 10,
    inlines: [{ n: 1, bbox: [0, 0, 20, 10], base: 0, text: 'x+y' }]
  }
  const html = (text: string): string => renderToStaticMarkup(createElement(Fragment, null, ...renderInline(text, 'test', ctx)))

  it('包含公式的整段粗体保留完整范围，不显示星号', () => {
    const result = html('**权重 ⟦f1⟧ 的定义**与正文。^5^')
    expect(result).toMatch(/<strong>权重 [\s\S]*<img[\s\S]*的定义<\/strong>/)
    expect(result).toContain('<sup>5</sup>')
    expect(result).not.toContain('**')
    expect(result).not.toContain('⟦f1⟧')
  })

  it('斜体、粗斜体与嵌套上下标保留', () => {
    expect(html('*斜体*和***粗斜体***')).toBe('<em>斜体</em>和<strong><em>粗斜体</em></strong>')
    expect(html('**粗体 *斜体* x~i~**')).toBe('<strong>粗体 <em>斜体</em> x<sub>i</sub></strong>')
    expect(html('原始 * 不配对')).toBe('原始 * 不配对')
  })
})

function heading(text: string, bbox: string | null): BlockRow {
  return { kind: 'heading', heading_level: 1, text, bbox } as BlockRow
}

describe('译文标题对齐', () => {
  it('ReAct 的一级章节标题保留左对齐', () => {
    expect(isCenteredHeading(heading('3 KNOWLEDGE-INTENSIVE REASONING TASKS',
      '[106.299,486.927,251.8146474609375,12.042451904296854]'), 612)).toBe(false)
  })

  it('论文总标题和摘要标题保留原本的居中', () => {
    expect(isCenteredHeading(heading('REACT: SYNERGIZING REASONING AND ACTING',
      '[106.036,676.627,398.189,36.434]'), 612)).toBe(true)
    expect(isCenteredHeading(heading('ABSTRACT', '[277.033,542.334,57.95,11.551]'), 612)).toBe(true)
  })

  it('接近整行宽度的编号章节也不会因框中心接近页面中心而居中', () => {
    for (const text of ['3 Results and discussion', '3.1 Setup', 'IV. Results', 'A. Appendix']) {
      expect(isCenteredHeading(heading(text, '[106,400,400,12]'), 612)).toBe(false)
    }
  })

  it('未编号的靠左标题不居中', () => {
    expect(isCenteredHeading(heading('RELATED WORK', '[106,300,150,12]'), 612)).toBe(false)
  })

  it('缺失或损坏的几何数据默认左对齐', () => {
    for (const bbox of [null, 'null', '{}', '[100]', 'bad json']) {
      expect(isCenteredHeading(heading('Title', bbox), 612)).toBe(false)
    }
  })
})
