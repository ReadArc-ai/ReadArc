import { describe, expect, it } from 'vitest'
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { BlockRow } from '../../shared/models'
import { footnoteRules, horizontalRules } from './pdf-rules'

const line = [OPS.stroke, [], new Float32Array([0, 0, 143.462, 0])]

describe('PDF 脚注分隔线', () => {
  it('保留 ReAct 第 3 页分隔线的平移、长度和线宽，并恢复保存的绘图状态', () => {
    const rules = horizontalRules({
      fnArray: [OPS.save, OPS.transform, OPS.setLineWidth, OPS.constructPath, OPS.restore, OPS.constructPath],
      argsArray: [null, [1, 0, 0, 1, 108, 72.79], [0.398], line, null, line]
    })
    expect(rules[0]).toMatchObject({ x: 108, y: 72.79, thickness: 0.398 })
    expect(rules[0].width).toBeCloseTo(143.462, 3)
    expect(rules[1]).toMatchObject({ x: 0, y: 0, thickness: 1 })
  })

  it('支持用细矩形填充画出的线，但忽略仅用于裁剪的路径和竖线', () => {
    const rules = horizontalRules({
      fnArray: [OPS.constructPath, OPS.constructPath, OPS.constructPath],
      argsArray: [
        [OPS.fill, [], [100, 72, 240, 72.5]],
        [OPS.endPath, [], [100, 72, 240, 72.5]],
        [OPS.stroke, [], [100, 20, 100, 200]]
      ]
    })
    expect(rules).toEqual([{ x: 100, y: 72.25, width: 140, thickness: 0.5 }])
  })

  it('嵌套变换和缩放下仍使用页面坐标', () => {
    const rules = horizontalRules({
      fnArray: [OPS.transform, OPS.paintFormXObjectBegin, OPS.setLineWidth, OPS.constructPath, OPS.paintFormXObjectEnd],
      argsArray: [[2, 0, 0, 2, 0, 0], [[1, 0, 0, 1, 54, 36.395]], [0.2], line, null]
    })
    expect(rules[0]).toMatchObject({ x: 108, y: 72.79, thickness: 0.4 })
    expect(rules[0].width).toBeCloseTo(286.924, 3)
  })

  const footnote = {
    block_id: 'note1', kind: 'para', text: '^1^We show some GPT-3 results.',
    bbox: '[118.653,60.138,370.323,11.018]'
  } as BlockRow
  const separator = { x: 108, y: 72.79, width: 143.462, thickness: 0.398 }

  it('绑定脚注上方原有横线，不把页眉线带到脚注上', () => {
    const result = footnoteRules([footnote], [
      { ...separator, y: 752.846, width: 396 }, separator
    ], 792)
    expect([...result]).toEqual([['note1', separator]])
  })

  it('没有横线时不自行添加，正文和远离脚注的线也不匹配', () => {
    expect(footnoteRules([footnote], [], 792).size).toBe(0)
    expect(footnoteRules([{ ...footnote, text: 'Regular paragraph' }], [separator], 792).size).toBe(0)
    expect(footnoteRules([footnote], [{ ...separator, y: 110 }], 792).size).toBe(0)
  })

  it('同一分隔线下有多条脚注时，只绑定最上面的一条', () => {
    const second = { ...footnote, block_id: 'note2', text: '^2^Second footnote.', bbox: '[118.653,52,370,10]' }
    expect([...footnoteRules([second, footnote], [separator], 792).keys()]).toEqual(['note1'])
  })
})
