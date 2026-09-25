import { describe, expect, it } from 'vitest'
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { dominantInk, isNeutralInk, pageDecor, paperDarkInk } from './pdf-decor'

const glyphs = (s: string): unknown[] => [...s].map((c) => ({ unicode: c, width: 500, isSpace: c === ' ' }))

describe('pageDecor（原版页的线条、底块、文字颜色）', () => {
  // 一条表格横线、一条竖线、一个彩色标签底块、一段蓝字和一段黑字
  const ops = {
    fnArray: [
      OPS.save, OPS.setStrokeRGBColor, OPS.transform, OPS.constructPath,
      OPS.constructPath,
      OPS.setFillRGBColor, OPS.constructPath, OPS.restore,
      OPS.beginText, OPS.setFont, OPS.setFillRGBColor, OPS.moveText, OPS.showText,
      OPS.setFillRGBColor, OPS.moveText, OPS.showText, OPS.endText
    ],
    argsArray: [
      null, ['#000000'], [1, 0, 0, 1, 100, 500], [OPS.stroke, [], [0, 0, 300, 0]],
      [OPS.stroke, [], [150, -200, 150, 0]],
      ['#00b9f2'], [OPS.fill, [], [10, 20, 30, 28]], null,
      null, ['f1', 10], ['#0000ff'], [110, 480], [glyphs('get me a pack')],
      ['#000000'], [0, -12], [glyphs('Observation')], null
    ]
  }
  const d = pageDecor(ops, { width: 612, height: 792 })

  it('横线、竖线按页面坐标取出，颜色随描边色', () => {
    expect(d.lines).toHaveLength(2)
    const h = d.lines.find((l) => l.y1 === l.y2)!
    expect([h.x1, h.x2, h.y1, h.color]).toEqual([100, 400, 500, '#000000'])
    const v = d.lines.find((l) => l.x1 === l.x2)!
    expect([v.x1, v.y1, v.y2]).toEqual([250, 300, 500])
  })

  it('彩色填充块作为底块；文字按绘制时的填充色记下', () => {
    expect(d.fills).toEqual([{ x: 110, y: 520, width: 20, height: 8, color: '#00b9f2' }])
    expect(d.runs.map((r) => [r.color, r.y])).toEqual([['#0000ff', 480], ['#000000', 468]])
    expect(d.runs[0].x2).toBeGreaterThan(d.runs[0].x1 + 40)
  })

  it('段落主色：非黑色占六成以上才上色', () => {
    expect(dominantInk(d.runs, [105, 476, 200, 10])).toBe('#0000ff')
    expect(dominantInk(d.runs, [105, 464, 200, 30])).toBeNull() // 蓝黑各半
    expect(isNeutralInk('#333333')).toBe(true)
    expect(isNeutralInk('#008080')).toBe(false)
  })

  it('夜间纸面：深蓝字换成浅色，和原文页的反色滤镜一致', () => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(paperDarkInk('#0000ff').slice(i, i + 2), 16))
    expect(b).toBeGreaterThan(200)
    expect(r + g).toBeGreaterThan(150)
  })
})

describe('裁剪范围', () => {
  it('柱状图的高矩形按坐标区裁剪：只剩看得见的那段，全在外面的不算', () => {
    const ops = {
      fnArray: [
        OPS.save, OPS.clip, OPS.constructPath, // 坐标区 100..300 × 400..500
        OPS.setFillRGBColor, OPS.constructPath, // 柱子画成 0..800 高
        OPS.constructPath, // 整个在坐标区外
        OPS.restore,
        OPS.constructPath // 裁剪恢复后的表格线
      ],
      argsArray: [
        null, null, [OPS.endPath, [], [100, 400, 300, 500]],
        ['#1f77b4'], [OPS.fill, [], [150, 0, 170, 800]],
        [OPS.fill, [], [500, 0, 520, 800]],
        null,
        [OPS.stroke, [], [50, 300, 550, 300]]
      ]
    }
    const d = pageDecor(ops, { width: 612, height: 792 })
    expect(d.fills).toEqual([{ x: 150, y: 400, width: 20, height: 100, color: '#1f77b4' }])
    expect(d.lines.map((l) => [l.x1, l.x2, l.y1])).toEqual([[50, 550, 300]])
  })
})
