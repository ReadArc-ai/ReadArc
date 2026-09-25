import { describe, expect, it } from 'vitest'
import { blocksFromRegions } from './regions-to-blocks'
import type { LayoutRegion } from './layout-ml'
import type { PageItems, TextItem } from './layout'

function item(str: string, x: number, y: number, width = 100, fontSize = 10): TextItem {
  return { str, x, y, width, height: fontSize, fontSize }
}

function region(label: string, x1: number, y1: number, x2: number, y2: number, order: number): LayoutRegion {
  return { label, score: 0.9, x1, y1, x2, y2, order }
}

const page: PageItems = {
  page: 1,
  width: 612,
  height: 792,
  items: [
    item('Attention Is All You Need', 200, 700, 220, 18),
    item('The dominant sequence', 100, 600, 180),
    item('models with dimension', 100, 588, 150),
    item('d', 250.5, 586, 6, 7), // 行内公式下标：落在 inline_formula 区域内，但必须留在段落里
    item('FFN(x) = max(0, xW + b)', 150, 500, 200),
    item('RASR Conference Header', 200, 780, 180, 8),
    item('3', 300, 20, 8, 9)
  ]
}

const regions = new Map<number, LayoutRegion[]>([
  [1, [
    region('header', 180, 775, 400, 790, 0),
    region('doc_title', 190, 695, 430, 720, 1),
    region('text', 95, 580, 300, 615, 2),
    region('inline_formula', 250, 584, 260, 594, 3), // 与 text 区域重叠
    region('display_formula', 140, 495, 360, 515, 4),
    region('image', 400, 300, 560, 450, 5),
    region('footer', 290, 15, 320, 30, 6)
  ]]
])

describe('blocksFromRegions（ML 区域 → 块）', () => {
  const result = blocksFromRegions([page], regions)

  it('doc_title → 标题与 heading；页眉/页脚文本被丢弃', () => {
    expect(result.title).toBe('Attention Is All You Need')
    expect(result.blocks[0].kind).toBe('heading')
    const all = result.blocks.map((b) => b.text).join('\n')
    expect(all).not.toContain('Conference Header')
    expect(all).not.toMatch(/^3$/m)
  })

  it('行内公式换成占位符留在段落里（句子不被抠洞），并记下截图框与原文', () => {
    const para = result.blocks.find((b) => b.kind === 'para')!
    // 「dimension」紧挨着下标 d（d_model），中间本来就没有空格
    expect(para.text).toContain('dimension⟦f1⟧')
    expect(para.inlines).toHaveLength(1)
    const f = para.inlines![0]
    expect(f.n).toBe(1)
    expect(f.text).toBe('d')
    // 主基线取同一行正文项的基线，不是下标自己的
    expect(f.base).toBe(588)
    // 截图框落在模型框内
    expect(f.bbox[0]).toBeGreaterThanOrEqual(250)
    expect(f.bbox[0] + f.bbox[2]).toBeLessThanOrEqual(260)
  })

  it('display_formula → equation 块；image → figure 占位', () => {
    const eq = result.blocks.find((b) => b.kind === 'equation')!
    expect(eq.text).toContain('FFN(x)')
    const fig = result.blocks.find((b) => b.kind === 'figure')!
    expect(fig.text).toBe('[图]')
  })

  it('阅读顺序按区域序；section 挂到最近标题；目录只含 heading', () => {
    expect(result.blocks.map((b) => b.kind)).toEqual(['heading', 'para', 'equation', 'figure'])
    const para = result.blocks.find((b) => b.kind === 'para')!
    expect(para.section).toBe('Attention Is All You Need')
    expect(result.outline).toHaveLength(1)
  })
})

describe('原文元素完整性', () => {
  it('右侧公式编号保持原位，不能被吸收到下一段正文', () => {
    const p: PageItems = { page: 1, width: 612, height: 792, items: [
      item('x = y', 220, 400, 50), item('(1)', 480, 400, 15),
      item('The following paragraph explains the equation.', 100, 380, 395)
    ] }
    const rs = new Map([[1, [region('display_formula', 218, 395, 272, 413, 0),
      region('formula_number', 478, 395, 498, 413, 1), region('text', 98, 376, 500, 393, 2)]]])
    const result = blocksFromRegions([p], rs)
    expect(result.blocks.filter(b => b.kind === 'equation').map(b => b.text)).toEqual(['x = y', '(1)'])
    expect(result.blocks.find(b => b.kind === 'para')!.text).toBe('The following paragraph explains the equation.')
  })

  it('图表下的注释属于可译内容，不能丢弃 vision_footnote', () => {
    const p: PageItems = { page: 1, width: 612, height: 792, items: [item('HotpotQA EM is 27.1, 28.9, 33.8.', 100, 350, 170, 8)] }
    const result = blocksFromRegions([p], new Map([[1, [region('vision_footnote', 98, 348, 275, 362, 0)]]]))
    expect(result.blocks).toHaveLength(1)
    expect(result.blocks[0].kind).toBe('para')
    expect(result.blocks[0].text).toContain('HotpotQA EM')
  })

  it('图片标题在检测框外时，截图框必须把标题包含在内', () => {
    const p: PageItems = { page: 1, width: 612, height: 792, items: [item('Input-Input Layer5', 120, 620, 120)] }
    const result = blocksFromRegions([p], new Map([[1, [region('image', 110, 200, 510, 615, 0)]]]))
    const b = result.blocks[0].bbox
    expect(b[1] + b[3]).toBeGreaterThanOrEqual(630)
  })

  it('无文本层的独立公式保留截图', () => {
    const p: PageItems = { page: 1, width: 612, height: 792, items: [] }
    const result = blocksFromRegions([p], new Map([[1, [region('display_formula', 110, 400, 510, 440, 0)]]]))
    expect(result.blocks).toHaveLength(1)
    expect(result.blocks[0].kind).toBe('equation')
  })
})

describe('图表噪声转截图', () => {
  it('纯数字刻度的 text 区域 → figure 占位；正常段落不受影响', () => {
    const regions = new Map([[1, [
      { label: 'text', x1: 50, y1: 400, x2: 300, y2: 600, score: 0.9, order: 0 },
      { label: 'text', x1: 50, y1: 100, x2: 300, y2: 200, score: 0.9, order: 1 }
    ]]])
    const items = [
      // 刻度噪声(落在第一个区域)
      ...'2.5 10 20 0.0 2 4 0 1 2 5 7.5 10'.split(' ').map((s, i) => ({ str: s, x: 60 + i * 18, y: 500, width: 14, height: 8, fontSize: 6 })),
      { str: 'PC1', x: 60, y: 480, width: 18, height: 8, fontSize: 6 },
      // 正常段落(第二个区域)
      { str: 'This is a normal paragraph about results.', x: 60, y: 150, width: 220, height: 10, fontSize: 10 }
    ]
    const { blocks } = blocksFromRegions([{ page: 1, width: 612, height: 792, items }], regions)
    const fig = blocks.find((b) => b.kind === 'figure')
    expect(fig).toBeDefined()
    expect(fig!.text).toBe('[图]')
    const para = blocks.find((b) => b.kind === 'para')
    expect(para!.text).toContain('normal paragraph')
  })

  it('目录页的点引导线不算刻度：整页目录仍是正文，照常翻译', () => {
    const regions = new Map([[1, [{ label: 'text', x1: 50, y1: 400, x2: 560, y2: 700, score: 0.9, order: 0 }]]])
    const lines = ['Abstract', 'Acknowledgments', 'List of Figures', 'List of Tables', '1 Introduction', '1.1 Language agents']
    const items = lines.flatMap((l, i) => [
      { str: l, x: 60, y: 680 - i * 14, width: l.length * 5, height: 10, fontSize: 10 },
      { str: '. . . . . . . . . . . . . . . . . . . .', x: 200, y: 680 - i * 14, width: 300, height: 10, fontSize: 10 },
      { str: String(3 + i * 4), x: 520, y: 680 - i * 14, width: 10, height: 10, fontSize: 10 }
    ])
    const { blocks } = blocksFromRegions([{ page: 1, width: 612, height: 792, items }], regions)
    expect(blocks.some((b) => b.kind === 'figure')).toBe(false)
    expect(blocks.map((b) => b.text).join(' ')).toContain('Acknowledgments')
  })
})

describe('表格碎片合并（模型漏检 table 时的兜底）', () => {
  const R = (label: string, x1: number, y1: number, w: number, h: number) => ({
    label, score: 0.9, order: 0, x1, y1, x2: x1 + w, y2: y1 + h
  })
  const item = (str: string, x: number, y: number, width: number, fontSize = 8) => ({
    str, x, y, width, height: fontSize, fontSize
  })

  it('数字型碎片成簇 → 合成单个 [表] 截图块，不再逐格翻译', () => {
    // 一张被拆成 8 个小块的表：两列 × 四行，单元格是数字/短标签
    const regions = [
      R('text', 60, 700, 240, 14), // 表题
      R('text', 60, 660, 110, 12), R('text', 180, 660, 110, 12),
      R('text', 60, 640, 110, 12), R('text', 180, 640, 110, 12),
      R('display_formula', 60, 620, 110, 12), R('text', 180, 620, 110, 12),
      R('text', 60, 600, 110, 12), R('text', 180, 600, 110, 12)
    ]
    const items = [
      item('Table 4. Upper limits on GW energy', 62, 702, 230, 10),
      item('Event 300 Hz', 62, 662, 100), item('1.2×10 2020 April', 182, 662, 100),
      item('SG-D 500 Hz', 62, 642, 100), item('3.4×10 2020 Oct', 182, 642, 100),
      item('7.1×10 2.0×10', 62, 622, 100), item('8.2×10 2022 Oct', 182, 622, 100),
      item('SG-L 1600 Hz', 62, 602, 100), item('5.8×10 2022 Dec', 182, 602, 100)
    ]
    const { blocks } = blocksFromRegions(
      [{ page: 1, width: 612, height: 792, items }],
      new Map([[1, regions]])
    )
    const tables = blocks.filter((b) => b.kind === 'table')
    expect(tables).toHaveLength(1)
    // 表格区域内的碎片都归表格，不再作为可翻译段落存在
    expect(blocks.some((b) => b.kind === 'para' && /×10/.test(b.text))).toBe(false)
    // 表题留在外面照常翻译
    expect(blocks.some((b) => /Table 4/.test(b.text) && b.kind === 'para')).toBe(true)
  })

  it('正常段落不会被误合成表格', () => {
    const regions = [
      R('text', 60, 700, 240, 40), R('text', 60, 650, 240, 40),
      R('text', 60, 600, 240, 40), R('text', 60, 550, 240, 40),
      R('text', 60, 500, 240, 40), R('text', 60, 450, 240, 40)
    ]
    const items = [700, 650, 600, 550, 500, 450].map((y, i) =>
      item(`This is paragraph ${i} of ordinary prose describing the method in detail.`, 62, y + 20, 230, 10)
    )
    const { blocks } = blocksFromRegions(
      [{ page: 1, width: 612, height: 792, items }],
      new Map([[1, regions]])
    )
    expect(blocks.filter((b) => b.kind === 'table')).toHaveLength(0)
    expect(blocks.filter((b) => b.kind === 'para')).toHaveLength(6)
  })
})

describe('单元格聚簇重建表格（模型把表格标成一堆 inline_formula）', () => {
  const R = (label: string, x1: number, y1: number, w: number, h: number) => ({
    label, score: 0.9, order: 0, x1, y1, x2: x1 + w, y2: y1 + h
  })
  const item = (str: string, x: number, y: number, width: number, fontSize = 8) => ({
    str, x, y, width, height: fontSize, fontSize
  })

  it('网格状 inline_formula 聚簇 → table 区域，正文段落不受污染', () => {
    const cells: ReturnType<typeof R>[] = []
    const items = []
    // 4 列 × 4 行单元格
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const x = 220 + col * 48
        const y = 600 - row * 24
        cells.push(R('inline_formula', x, y, 40, 11))
        items.push(item('1.2×10', x + 2, y + 2, 36))
      }
    }
    // 行首标签（游离项，不在任何文本区域内）
    for (let row = 0; row < 4; row++) items.push(item('SG-D', 150, 602 - row * 24, 30))
    // 一段正常正文
    const prose = R('text', 50, 300, 250, 60)
    items.push(item('This paragraph describes the search method and its sensitivity.', 52, 340, 240, 10))

    const { blocks } = blocksFromRegions(
      [{ page: 1, width: 612, height: 792, items }],
      new Map([[1, [...cells, prose]]])
    )
    const tables = blocks.filter((b) => b.kind === 'table')
    expect(tables).toHaveLength(1)
    // 行首标签被表格框吸收，不再单独成段
    expect(blocks.some((b) => b.kind === 'para' && b.text.includes('SG-D'))).toBe(false)
    // 正文完好
    const para = blocks.find((b) => b.kind === 'para' && b.text.includes('search method'))
    expect(para).toBeDefined()
    expect(para!.text).not.toContain('1.2×10')
  })

  it('段落里零星的行内公式不会被当成表格', () => {
    const regions = [
      R('text', 50, 600, 250, 80),
      R('inline_formula', 60, 640, 30, 10),
      R('inline_formula', 120, 620, 30, 10),
      R('inline_formula', 200, 600, 30, 10)
    ]
    const items = [
      item('The energy is given by E = mc squared in this formulation of the model.', 52, 660, 240, 10),
      item('E=mc', 62, 642, 26), item('x=1', 122, 622, 26), item('y=2', 202, 602, 26)
    ]
    const { blocks } = blocksFromRegions(
      [{ page: 1, width: 612, height: 792, items }],
      new Map([[1, regions]])
    )
    expect(blocks.filter((b) => b.kind === 'table')).toHaveLength(0)
  })
})


describe('行内公式占位符的取舍', () => {
  const text = (x1: number, y1: number, x2: number, y2: number): LayoutRegion => region('text', x1, y1, x2, y2, 0)

  it('两个公式按阅读顺序编号；文本层原文各自保留', () => {
    const page: PageItems = {
      page: 1, width: 612, height: 792,
      items: [
        item('space to', 100, 600, 40),
        item('ˆ', 146, 605, 4, 6),
        item('A = A ∪ L', 146, 600, 50),
        item(', where', 197, 600, 33),
        item('L', 236, 600, 6),
        item('is the space', 246, 600, 60)
      ]
    }
    const regions = new Map<number, LayoutRegion[]>([[1, [
      text(95, 590, 320, 615),
      region('inline_formula', 144, 596, 198, 612, 1),
      region('inline_formula', 234, 596, 244, 612, 2)
    ]]])
    const para = blocksFromRegions([page], regions).blocks.find((b) => b.kind === 'para')!
    expect(para.text).toBe('space to ⟦f1⟧, where ⟦f2⟧ is the space')
    // 帽子是独立的小字号项，行拼接把它折叠到公式末尾（与原有文本通道一致）
    expect(para.inlines!.map((f) => f.text)).toEqual(['A = A ∪ L^ˆ^', 'L'])
    expect(para.inlines!.map((f) => f.n)).toEqual([1, 2])
  })

  it('模型没框出来的数学字体字符也按公式截图：花体 L 与带下标的变量', () => {
    const page: PageItems = {
      page: 1, width: 612, height: 792,
      items: [
        item('as the language space', 100, 600, 100),
        { ...item('L', 203, 600, 7), math: true },
        item('is unlimited, at step', 213, 600, 90),
        { ...item('c', 306, 600, 5), math: true },
        { ...item('t', 311, 598, 3, 7), math: true },
        item('the agent', 317, 600, 40)
      ]
    }
    const regions = new Map<number, LayoutRegion[]>([[1, [text(95, 590, 400, 615)]]])
    const para = blocksFromRegions([page], regions).blocks.find((b) => b.kind === 'para')!
    expect(para.text).toBe('as the language space ⟦f1⟧ is unlimited, at step ⟦f2⟧ the agent')
    expect(para.inlines!.map((f) => f.text)).toEqual(['L', 'c~t~'])
  })

  it('模型误标的普通单词不换截图', () => {
    const page: PageItems = {
      page: 1, width: 612, height: 792,
      items: [item('the', 100, 600, 20), item('model', 124, 600, 30), item('learns', 158, 600, 36)]
    }
    const regions = new Map<number, LayoutRegion[]>([[1, [
      text(95, 590, 300, 615),
      region('inline_formula', 122, 596, 156, 612, 1)
    ]]])
    const para = blocksFromRegions([page], regions).blocks.find((b) => b.kind === 'para')!
    expect(para.text).toBe('the model learns')
    expect(para.inlines).toBeUndefined()
  })

  it('跨行的公式区域与整段都是公式的区域都留在文本里', () => {
    const page: PageItems = {
      page: 1, width: 612, height: 792,
      items: [item('let', 100, 600, 20), item('x ∈ R', 124, 600, 30), item('y ∈ R', 124, 588, 30), item('hold', 160, 588, 24)]
    }
    const tall = new Map<number, LayoutRegion[]>([[1, [
      text(95, 580, 300, 615),
      region('inline_formula', 122, 584, 156, 612, 1) // 高 28pt，跨两行
    ]]])
    const para = blocksFromRegions([page], tall).blocks.find((b) => b.kind === 'para')!
    expect(para.text).not.toContain('⟦')
    expect(para.inlines).toBeUndefined()

    const whole: PageItems = { page: 1, width: 612, height: 792, items: [item('x ∈ R', 124, 600, 30)] }
    const all = new Map<number, LayoutRegion[]>([[1, [text(95, 590, 300, 615), region('inline_formula', 122, 596, 156, 612, 1)]]])
    const only = blocksFromRegions([whole], all).blocks.find((b) => b.kind === 'para')!
    expect(only.text).toBe('x ∈ R')
    expect(only.inlines).toBeUndefined()
  })
})

describe('文字表逐格翻译（提示词、推理轨迹这类整页文字被模型标成 table）', () => {
  const fs = 7
  const t = (str: string, x: number, y: number, width: number): TextItem => item(str, x, y, width, fs)

  it('两栏对照的轨迹表：左右栏分开成格，同一行的左右两栏不拼在一起，先左栏后右栏', () => {
    const rows: [number, string, string][] = [
      [546, 'Action: search[sixteen pack apple cinnamon]', 'Action: search[sixteen pack apple cinnamon]'],
      [538, 'Observation: Page 1 (Total results: 50)', 'Observation: Page 1 (Total results: 50)'],
      [530, 'Nature’s Turn Freeze-Dried Fruit Snacks - Banana', 'Nature’s Turn Freeze-Dried Fruit Snacks - Banana'],
      [522, 'Action: click[B0061IVFZE]', 'Action: think[B0061IVFZE is strawberry banana, not apple cinnamon]'],
      [514, 'Observation: You have clicked the item page', 'Observation: OK.'],
      [506, 'flavor name [asian pear][banana][fuji apple]', 'Action: click[apple cinnamon]'],
      [498, 'Action: click[Buy Now]', 'Observation: You have clicked apple cinnamon.'],
      [490, 'Score: 0.125', 'Score: 1.0']
    ]
    const items: TextItem[] = [
      t('Instruction: get me a sixteen pack of apple cinnamon freeze dried banana chips, and price lower than 50.00 dollars', 113, 570, 390),
      t('Act', 200, 558, 15),
      t('ReAct', 400, 558, 25)
    ]
    for (const [y, l, r] of rows) {
      // 左栏参差不齐：有的行一直写到栏界边上（305），和右栏（317）只隔 12pt
      items.push(t(l, 113, y, l.startsWith('flavor') ? 192 : Math.min(186, l.length * 3.3)))
      items.push(t(r, 317, y, Math.min(190, r.length * 3.3)))
    }
    const res = blocksFromRegions(
      [{ page: 1, width: 612, height: 792, items }],
      new Map([[1, [region('table', 108, 485, 515, 580, 0)]]])
    )
    expect(res.blocks.some((b) => b.kind === 'table')).toBe(false)
    const texts = res.blocks.map((b) => b.text)
    // 没有一格同时含左栏独有和右栏独有的内容
    expect(texts.some((x) => x.includes('flavor name') && x.includes('apple cinnamon]'))).toBe(false)
    expect(texts.some((x) => x.includes('Score: 0.125') && x.includes('Score: 1.0'))).toBe(false)
    // 跨栏的 Instruction 自成一格；每个 Action / Observation 各自成格
    expect(texts.find((x) => x.startsWith('Instruction'))).toContain('50.00 dollars')
    expect(texts.filter((x) => /^Action:/.test(x)).length).toBeGreaterThanOrEqual(6)
    // 阅读顺序：左栏的 Score 在右栏第一格之前
    const leftScore = texts.indexOf('Score: 0.125')
    const rightFirst = texts.findIndex((x) => x.includes('think[B0061IVFZE'))
    expect(leftScore).toBeGreaterThan(-1)
    expect(leftScore).toBeLessThan(rightFirst)
  })

  it('左边是标签栏的提示词表：标签和内容同一行，换行续写并进同一格，Answer 另起一格', () => {
    const items: TextItem[] = [
      t('Question', 113, 640, 35), t('What is the elevation range for the area that the eastern sector of the', 179, 640, 300),
      t('Colorado orogeny extends into?', 179, 632, 120),
      t('Answer', 113, 624, 27), t('1,800 to 7,000 ft', 179, 624, 60),
      t('Question', 113, 608, 35), t('Musician and satirist Allie Goertz wrote a song about the Simpsons character', 179, 608, 305),
      t('Answer', 113, 600, 27), t('Richard Nixon', 179, 600, 50),
      t('Action 1', 113, 584, 30), t('Search[Colorado orogeny]', 179, 584, 95),
      t('Observation 1 The Colorado orogeny was an episode of mountain building in', 113, 576, 370),
      t('Colorado and surrounding areas.', 179, 568, 120),
      t('Action 2', 113, 560, 30), t('Lookup[eastern sector]', 179, 560, 90)
    ]
    const res = blocksFromRegions(
      [{ page: 1, width: 612, height: 792, items }],
      new Map([[1, [region('table', 108, 555, 500, 650, 0)]]])
    )
    const texts = res.blocks.map((b) => b.text)
    expect(texts.find((x) => x.startsWith('Observation 1'))).toContain('Colorado and surrounding areas.')
    expect(texts.find((x) => x.startsWith('Question What is'))).toContain('extends into?')
    expect(texts).toContain('Answer 1,800 to 7,000 ft')
    expect(texts).toContain('Action 2 Lookup[eastern sector]')
  })

  it('被标成 algorithm 的交互轨迹按段翻译：每个「>」动作连同环境反馈一格；带数学字体的伪代码仍截图', () => {
    const lines = [
      'You are in the middle of a room. Looking quickly around you, you see a cabinet',
      '13, a cabinet 12, a cabinet 11, a countertop 1, a diningtable 1, a drawer 1, a fridge 1, a',
      'garbagecan 1, a microwave 1, a shelf 3, a sinkbasin 1, and a toaster 1.',
      'Your task is to: put a clean lettuce in diningtable.',
      '> go to fridge 1',
      'The fridge 1 is closed.',
      '> open fridge 1',
      'You open the fridge 1. The fridge 1 is open. In it, you see a cup 3, a egg 2, a',
      'potato 3, and a potato 2.',
      '> go to diningtable 1',
      'On the diningtable 1, you see a apple 1, a bread 1, a butterknife 2, and a lettuce 1.'
    ]
    const items = lines.map((l, i) => t(l, 110, 680 - i * 8, l.length * 4.2))
    const res = blocksFromRegions(
      [{ page: 1, width: 612, height: 792, items }],
      new Map([[1, [region('algorithm', 105, 590, 480, 690, 0)]]])
    )
    const texts = res.blocks.map((b) => b.text)
    expect(res.blocks.some((b) => b.kind === 'equation')).toBe(false)
    expect(texts[0]).toMatch(/^You are in the middle of a room[\s\S]*Your task is to/)
    expect(texts).toContain('> go to fridge 1 The fridge 1 is closed.')
    expect(texts.find((x) => x.startsWith('> open fridge 1'))).toContain('potato 2.')

    const code = [
      'Algorithm 1 Beam search over reasoning traces with a learned value function and pruning',
      'for each step in the trajectory of the agent while the budget is not exhausted do',
      'compute the score for every candidate and keep the best ones in the frontier set',
      'update the value estimate using the observed reward and the discount factor of the task',
      'end for and return the highest scoring trajectory found during the whole search process'
    ].map((l, i) => ({ ...t(l, 110, 680 - i * 10, l.length * 4.2), math: i % 2 === 0 }))
    const res2 = blocksFromRegions(
      [{ page: 1, width: 612, height: 792, items: code }],
      new Map([[1, [region('algorithm', 105, 630, 480, 690, 0)]]])
    )
    expect(res2.blocks.map((b) => b.kind)).toEqual(['equation'])
  })

  it('等宽字体各行空格对齐成的「河道」不当栏界：一段话不被竖着切开', () => {
    // 每个词一个文字项，词间一个字宽的空格；每行第 30 个字符处都是空格
    const cw = 4.2
    const rows = [
      'You are in the middle of a ro om. Looking quickly around you, you see a cabinet',
      'cabinet 5, a cabinet 4, a cab inet 3, a cabinet 2, a cabinet 1, a coffeemachine',
      '1, a countertop 3, a counter to p 2, a countertop 1, a drawer 3, a drawer 2, and',
      'fridge 1, a garbagecan 1, a m ic rowave 1, a shelf 3, a shelf 2, a shelf 1, a sink',
      'a stoveburner 4, a stoveburne r 3, a stoveburner 2, a stoveburner 1, and a toaster',
      'Your task is to: put a clean  knife in countertop and then check the drawer 2 now'
    ]
    const items: TextItem[] = []
    rows.forEach((row, r) => {
      let i = 0
      for (const w of row.split(' ')) {
        if (w) items.push(t(w, 110 + i * cw, 680 - r * 8, w.length * cw))
        i += w.length + 1
      }
    })
    const res = blocksFromRegions(
      [{ page: 1, width: 612, height: 792, items }],
      new Map([[1, [region('algorithm', 105, 630, 480, 690, 0)]]])
    )
    expect(res.blocks).toHaveLength(1)
    expect(res.blocks[0].text).toMatch(/^You are in the middle[\s\S]*countertop and then check the drawer 2 now$/)
  })

  it('数字结果表照旧截图', () => {
    const items: TextItem[] = [
      t('Model', 120, 640, 30), t('EN-DE', 300, 640, 25), t('EN-FR', 360, 640, 25),
      t('ByteNet', 120, 630, 35), t('23.75', 300, 630, 20), t('39.2', 360, 630, 20),
      t('ConvS2S', 120, 620, 35), t('25.16', 300, 620, 20), t('40.46', 360, 620, 20),
      t('Transformer (big)', 120, 610, 70), t('28.4', 300, 610, 20), t('41.8', 360, 610, 20)
    ]
    const res = blocksFromRegions(
      [{ page: 1, width: 612, height: 792, items }],
      new Map([[1, [region('table', 110, 600, 400, 650, 0)]]])
    )
    expect(res.blocks.map((b) => b.kind)).toEqual(['table'])
  })
})

describe('区域里相距很远的几行', () => {
  it('行距超过 3 倍字号就拆成两段，各在各的位置', () => {
    const items: TextItem[] = [item('Palaiseau, France', 70, 650, 80, 9), item('Netherlands', 70, 338, 50, 9)]
    const res = blocksFromRegions(
      [{ page: 1, width: 612, height: 792, items }],
      new Map([[1, [region('text', 65, 330, 160, 665, 0)]]])
    )
    expect(res.blocks.map((b) => b.text)).toEqual(['Palaiseau, France', 'Netherlands'])
    expect(res.blocks.every((b) => b.bbox[3] < 20)).toBe(true)
  })
})

describe('重叠的文字区域', () => {
  it('几乎重合的两个框并成一段；列表里相邻条目的框压一点边不合并', () => {
    const items: TextItem[] = [
      item('where p and q are the decay rates of the two channels', 70, 170, 380, 10),
      item('respectively, and z represents a point on the plane', 70, 158, 360, 10),
      item('Entry one of a list', 70, 100, 120, 9),
      item('Entry two of a list', 70, 89, 120, 9)
    ]
    const res = blocksFromRegions(
      [{ page: 1, width: 612, height: 792, items }],
      new Map([[1, [
        region('text', 68, 150, 460, 182, 0),
        region('text', 69, 148, 458, 184, 1), // 与上一个几乎重合
        region('text', 68, 97, 200, 112, 2),
        region('text', 68, 86, 200, 101, 3) // 与上一条压边 4pt
      ]]])
    )
    const texts = res.blocks.map((b) => b.text)
    expect(texts.filter((t) => t.startsWith('where'))).toHaveLength(1)
    expect(texts.find((t) => t.startsWith('where'))).toContain('respectively')
    expect(texts).toContain('Entry one of a list')
    expect(texts).toContain('Entry two of a list')
  })
})

describe('行内公式密集的段落', () => {
  it('十几个行内公式聚在一起也不当成表格：整段照常建段，公式换占位符', () => {
    const items: TextItem[] = []
    const regs: LayoutRegion[] = [region('text', 68, 86, 526, 182, 0)]
    const words = ['where', 'the', 'decay', 'rates', 'are', 'given', 'for', 'each', 'channel', 'and', 'the', 'coordinates']
    for (let row = 0; row < 4; row++) {
      const y = 170 - row * 14
      let x = 70
      for (let k = 0; k < 3; k++) {
        for (const w of words.slice(k * 3, k * 3 + 3)) {
          items.push(item(w, x, y, w.length * 5, 10))
          x += w.length * 5 + 4
        }
        items.push({ ...item('x', x, y, 18, 10), math: true })
        regs.push(region('inline_formula', x - 1, y - 2, x + 19, y + 11, regs.length))
        x += 24
      }
    }
    const res = blocksFromRegions([{ page: 1, width: 612, height: 792, items }], new Map([[1, regs]]))
    expect(res.blocks.some((b) => b.kind === 'table')).toBe(false)
    const para = res.blocks.find((b) => b.kind === 'para')!
    expect(para.text).toContain('⟦f1⟧')
    expect(para.text).toContain('⟦f12⟧')
  })
})
