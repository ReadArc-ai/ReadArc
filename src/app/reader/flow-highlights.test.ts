// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { buildTextIndex, compactForMatch, nearestOccurrence } from './flow-highlights'

describe('流式视图高亮的文字定位', () => {
  it('比较时忽略空白和不可见运算符，选区的换行不影响匹配', () => {
    expect(compactForMatch('large  language\nmodels')).toBe('largelanguagemodels')
    expect(compactForMatch('a⁢b')).toBe('ab')
  })

  it('索引跨节点，记得每个字符的来源；公式的 TeX 源码不算', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>Let <b>x y</b> be</p><math><mi>z</mi><annotation>\\frac{1}{2}</annotation></math>'
    const index = buildTextIndex([el])
    expect(index.text).toBe('Letxybez')
    expect(index.runs.map((r) => r.node.data)).toEqual(['Let ', 'x y', ' be', 'z'])
    expect(index.runs[1].offsets).toEqual([0, 2])
  })

  it('同一个词出现多次时取离预期位置最近的', () => {
    expect(nearestOccurrence('modelabcmodelabcmodel', 'model', 9)).toBe(8)
    expect(nearestOccurrence('modelabc', 'none', 0)).toBe(-1)
  })
})
