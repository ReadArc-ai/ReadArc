import { describe, expect, it } from 'vitest'
import { marginBlocks, orphanBlocks } from './margins'
import type { PageItems, TextItem } from './layout'

const W = 612
const H = 792

function item(str: string, x: number, y: number, width: number, fontSize = 9): TextItem {
  return { str, x, y, width, height: fontSize, fontSize }
}

/** 一页：顶部页眉、正文两段（已成块）、底部页码；左缘一列逆时针竖排的 arXiv 水印 */
function page(): PageItems {
  return {
    page: 1,
    width: W,
    height: H,
    items: [
      item('Published as a conference paper at ICLR 2023', 108, 760, 230),
      item('Body text line one', 108, 600, 300, 10),
      item('Body text line two', 108, 588, 300, 10),
      item('3', 300, 30, 6),
      // 底部但被正文块（脚注）盖住的行：不算页边
      item('* Equal contribution.', 108, 60, 120, 8)
    ],
    rotated: [
      { str: 'arXiv:2210.03629v3', x: 30, y: 300, width: 10, height: 90, fontSize: 10, angle: Math.PI / 2 },
      { str: '[cs.CL]', x: 30, y: 395, width: 10, height: 40, fontSize: 10, angle: Math.PI / 2 },
      { str: '10 Mar 2023', x: 30, y: 440, width: 10, height: 60, fontSize: 10, angle: Math.PI / 2 }
    ]
  }
}

const bodyBlocks = [
  { page: 1, bbox: [100, 580, 320, 40] as [number, number, number, number] },
  { page: 1, bbox: [100, 50, 320, 20] as [number, number, number, number] }
]

describe('页边块', () => {
  it('页眉、页码、竖排水印各成一块；被正文块盖住的边缘行不算；序号从给定值起', () => {
    const out = marginBlocks([page()], bodyBlocks, 40)
    expect(out.map((b) => b.text)).toEqual([
      'Published as a conference paper at ICLR 2023',
      '3',
      'arXiv:2210.03629v3 [cs.CL] 10 Mar 2023'
    ])
    expect(out.every((b) => b.kind === 'margin' && b.section === null)).toBe(true)
    expect(out.map((b) => b.order)).toEqual([40, 41, 42])
  })

  it('竖排水印的外接框高而窄，横排页眉的外接框宽而矮', () => {
    const out = marginBlocks([page()], bodyBlocks, 0)
    const header = out[0].bbox
    const stamp = out[2].bbox
    expect(header[2]).toBeGreaterThan(header[3] * 5)
    expect(stamp[3]).toBeGreaterThan(stamp[2] * 5)
    expect(stamp).toEqual([30, 300, 10, 200])
  })

  it('图表块里的竖排坐标轴标签不成页边块（图已整块截图，再画一遍会叠字）', () => {
    const pg = page()
    pg.rotated!.push({ str: 'HotpotQA EM', x: 120, y: 420, width: 8, height: 60, fontSize: 8, angle: Math.PI / 2 })
    const figure = { page: 1, bbox: [110, 400, 300, 200] as [number, number, number, number] }
    const out = marginBlocks([pg], [...bodyBlocks, figure], 0)
    expect(out.map((b) => b.text)).not.toContain('HotpotQA EM')
    expect(out.map((b) => b.text)).toContain('arXiv:2210.03629v3 [cs.CL] 10 Mar 2023')
  })

  it('正文行不在页边带内，不会被误当页边', () => {
    const out = marginBlocks([page()], [], 0)
    expect(out.map((b) => b.text)).not.toContain('Body text line one')
  })

  it('没有旋转文本也没有边缘行的页面：什么都不补', () => {
    expect(marginBlocks([{ page: 2, width: W, height: H, items: [item('Body', 108, 400, 50)] }], [], 0)).toEqual([])
  })
})

describe('漏网文字补回', () => {
  const it2 = (str: string, x: number, y: number, width: number, fontSize = 9): TextItem => ({ str, x, y, width, height: fontSize, fontSize })
  const page: PageItems = {
    page: 1,
    width: 612,
    height: 792,
    items: [
      it2('Body paragraph text that the model found', 100, 500, 300),
      it2('CERN-EP-2026-068', 450, 712, 90, 10),
      it2('LHCb-PAPER-2025-064', 440, 697, 100, 10),
      it2('April 7, 2026', 470, 683, 60, 10),
      it2('2.5', 90, 300, 10, 6)
    ]
  }
  const blocks = [{ page: 1, bbox: [95, 495, 310, 15] as [number, number, number, number] }]

  it('没被任何块盖住的文字按行距聚段补回原位，盖住的不重复', () => {
    const out = orphanBlocks([page], blocks, 100)
    expect(out.map((b) => b.text)).toEqual(['CERN-EP-2026-068 LHCb-PAPER-2025-064 April 7, 2026', '2.5'])
    expect(out.every((b) => b.kind === 'para')).toBe(true)
    expect(out[0].order).toBe(100)
    const [x, y, w, h] = out[0].bbox
    expect(x).toBeCloseTo(440)
    expect(y).toBeLessThan(683)
    expect(y + h).toBeGreaterThan(712)
    expect(w).toBeGreaterThan(90)
  })
})
