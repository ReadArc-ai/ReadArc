// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mdToHtml } from './md'

describe('AI 回答的 Markdown', () => {
  it('粗体紧挨中文标点时也渲染成粗体，不露出星号', () => {
    const html = mdToHtml('让 LLM 以**交错（interleaved）**的方式生成')
    expect(html).toContain('<strong>交错（interleaved）</strong>的方式')
    expect(html).not.toContain('**')
  })

  it('普通粗体、粗斜体、代码里的星号照旧', () => {
    expect(mdToHtml('a **b** c')).toContain('<strong>b</strong>')
    expect(mdToHtml('***x***')).toContain('<em><strong>x</strong></em>')
    expect(mdToHtml('`a**b**c`')).toContain('<code>a**b**c</code>')
    expect(mdToHtml('**粗体里有 `code`**')).toContain('<strong>粗体里有 <code>code</code></strong>')
  })
})
