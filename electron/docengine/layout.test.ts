import { describe, expect, it } from 'vitest'
import { isFormulaFragment, parsePages, type PageItems, type TextItem } from './layout'

/** 合成一个 letter 尺寸（612×792）的双栏论文页组。 */
function item(str: string, x: number, y: number, width: number, fontSize = 10): TextItem {
  return { str, x, y, width, height: fontSize, fontSize }
}

const HEADER = 'RASR · Conference 2025'

function fixturePages(): PageItems[] {
  const page1: PageItems = {
    page: 1,
    width: 612,
    height: 792,
    items: [
      // 页眉（三页重复）与页码
      item(HEADER, 220, 770, 170, 8),
      item('1', 300, 25, 10, 9),
      // 标题：全宽，大字号
      item('Retrieval-Augmented Speech Recognition', 106, 700, 400, 18),
      // 左栏（x 72–282）：节标题 + 两段；右栏（x 320–530）与左栏基线对齐
      item('1 Introduction', 72, 650, 90, 12),
      item('We propose a retrieval aug-', 72, 630, 210),
      item('mented model for speech', 72, 618, 210),
      item('recognition tasks.', 72, 606, 150),
      // 行距跳变 → 第二段
      item('Prior systems require large', 72, 580, 210),
      item('paired corpora.', 72, 568, 130),
      // 右栏一段（首行与左栏节标题同基线——不许被并成全宽行）
      item('Our retrieval index stores', 320, 650, 210),
      item('acoustic exemplars encoded', 320, 638, 210),
      item('by a frozen encoder.', 320, 626, 160)
    ]
  }
  const later = (n: number): PageItems => ({
    page: n,
    width: 612,
    height: 792,
    items: [
      item(HEADER, 220, 770, 170, 8),
      item(String(n), 300, 25, 10, 9),
      item(`Body paragraph of page ${n} spanning the full width of the page.`, 90, 700, 430)
    ]
  })
  return [page1, later(2), later(3)]
}

describe('parsePages（启发式版面解析，M0 验收路径）', () => {
  const result = parsePages(fixturePages())
  const texts = result.blocks.map((b) => b.text)

  it('页眉与页码被剔除', () => {
    expect(texts.some((t) => t.includes('Conference 2025'))).toBe(false)
    expect(texts).not.toContain('1')
  })

  it('阅读顺序：标题 → 节标题 → 左栏两段 → 右栏段', () => {
    const p1 = result.blocks.filter((b) => b.page === 1)
    expect(p1.map((b) => b.text.slice(0, 20))).toEqual([
      'Retrieval-Augmented ',
      '1 Introduction',
      'We propose a retriev',
      'Prior systems requir',
      'Our retrieval index '
    ])
  })

  it('左右栏同基线的行没有被并成全宽行', () => {
    // 若被并行，右栏文本会混进节标题块
    const heading = result.blocks.find((b) => b.text === '1 Introduction')
    expect(heading).toBeDefined()
    expect(heading!.kind).toBe('heading')
  })

  it('换行断词合并：aug- + mented → augmented', () => {
    const para = result.blocks.find((b) => b.text.startsWith('We propose'))!
    expect(para.text).toContain('retrieval augmented model')
    expect(para.text).not.toContain('aug-')
  })

  it('行距跳变切段：左栏是两个独立段落', () => {
    expect(texts.filter((t) => t.startsWith('We propose')).length).toBe(1)
    expect(texts.filter((t) => t.startsWith('Prior systems')).length).toBe(1)
  })

  it('节标题进入目录，后续段落挂到该节', () => {
    const intro = result.outline.find((o) => o.title === '1 Introduction')
    expect(intro).toBeDefined()
    expect(intro!.level).toBe(1)
    const para = result.blocks.find((b) => b.text.startsWith('Prior systems'))!
    expect(para.section).toBe('1 Introduction')
  })

  it('行内上下标吸附进所在行，不再产生打断段落的碎片行', () => {
    const mathPage: PageItems = {
      page: 1,
      width: 612,
      height: 792,
      items: [
        item('Attention weights are computed as follows.', 72, 700, 210),
        // 文本层把上下标拆成独立 item（基线偏移 ~4pt、字号更小）
        item('MultiHead(Q, K, V) = Concat(head , ..., head )W', 72, 670, 200),
        item('i', 100, 666, 4, 6),
        item('d ×d', 72, 650, 40),
        item('model k', 112, 646, 40, 6),
        item('W ∈ R', 72, 630, 50),
        item('The projections are parameter matrices learned end to end.', 72, 600, 210)
      ]
    }
    const { blocks } = parsePages([mathPage])
    // 上下标不再成为独立行/独立块——正文段保持连续
    const texts = blocks.map((b) => b.text)
    expect(texts.some((t) => t.trim() === 'i' || t.trim() === 'model k')).toBe(false)
    const joined = texts.join(' ')
    expect(joined).toContain('MultiHead')
    expect(joined).toContain('The projections')
    // 顺序保持视觉顺序：上标不会跳到公式前面（10^-22 不再变 "-22 10"）
    expect(joined.indexOf('MultiHead')).toBeLessThan(joined.indexOf('W ∈ R'))
  })

  it('抬升的全尺寸字形（√）归入其下方的行，不被上一行吸走', () => {
    // 真实几何来自 Attention 论文 p4："divide each by √dk"——
    // √ 是全尺寸字形但悬高 ~0.8em，离上一行基线（Δ3.2）反而比本行（Δ7.8）近
    const mathPage: PageItems = {
      page: 1,
      width: 612,
      height: 792,
      items: [
        item('queries and keys of dimension', 108, 403.8, 121),
        item('d', 231.7, 403.8, 5),
        item('. We compute the dot products of the', 356.2, 403.8, 148),
        item('k', 236.8, 402.3, 4, 7),
        item('√', 250, 400.6, 8.3),
        item('query with all keys, divide each by', 108, 392.8, 139.6),
        item('d', 258.4, 392.8, 5),
        item(', and apply a softmax function', 268.4, 392.8, 200),
        item('k', 263.5, 391.4, 4, 7)
      ]
    }
    const { blocks } = parsePages([mathPage])
    const joined = blocks.map((b) => b.text).join(' ')
    // √ 出现在 divide each by 之后、d 之前——不在上一行里
    expect(joined).toMatch(/divide each by\s*√\s*d~k~/)
    expect(joined).not.toMatch(/dimension\s*√/)
  })

  it('混合碎片簇（√+上标）折入下方行，且不折进隔壁栏（GEO600 10−22/√Hz）', () => {
    // 真实几何：双栏页右栏，√ 悬高被紧容差挡在行外后又吸走了上标 −22，
    // 形成 [√, −, 22] 混合簇；它必须整簇折进右栏下一行，而不是横向更近的左栏
    const mathPage: PageItems = {
      page: 1,
      width: 612,
      height: 792,
      items: [
        item('to the Advanced LIGO and Advanced Virgo detectors', 320.6, 99.9, 241.4),
        item('SGR 1935+2154 is not in a compact binary (Chrimes', 50.7, 99.9, 241.4),
        item('√', 363.8, 95.9, 8.3),
        item('−', 344.1, 91.1, 6.2, 7),
        item('22', 350.4, 91.1, 7.9, 7),
        item('et al. 2022) and has exhibited multiple periods of FRB', 50.7, 87.5, 241.4),
        item('(', 319.4, 87.5, 4),
        item('∼', 323.4, 87.5, 7.7),
        item('10', 334, 87.5, 10.2),
        item('/', 358.8, 87.5, 5),
        item('Hz at 1 kHz, see Fig. 1), but has strengths', 372.1, 87.5, 189.8)
      ]
    }
    const { blocks } = parsePages([mathPage])
    const joined = blocks.map((b) => b.text).join(' ')
    expect(joined).toContain('10^−22^/√Hz at 1 kHz')
    // 左栏行保持干净
    expect(joined).toMatch(/periods of FRB(?!.{0,6}√)/)
  })

  it('上下标标记：小字号基线偏移项包 ^…^ / ~…~（θ_R、10^-22 不再拍平）', () => {
    const pg: PageItems = {
      page: 1,
      width: 612,
      height: 792,
      items: [
        item('the model has parameters θ', 72, 700, 120),
        item('R', 192.5, 697, 5, 7),
        item('= P(R = 1) with sensitivity 10', 200, 700, 130),
        item('-22', 330.5, 703, 10, 7),
        item('as shown.', 343, 700, 45)
      ]
    }
    const { blocks } = parsePages([pg])
    const joined = blocks.map((b) => b.text).join(' ')
    expect(joined).toContain('θ~R~')
    expect(joined).toContain('10^-22^')
  })

  it('句末脚注编号与数字后的指数都保留为上标', () => {
    const pg: PageItems = {
      page: 1,
      width: 612,
      height: 792,
      items: [
        // "News → ArXiv.⁵ As baselines" 的几何：句号后跟小字号上标 5
        item('Each column averages News to ArXiv.', 72, 700, 160),
        item('5', 233, 703, 4, 6.5),
        item('As baselines, we include the strongest detectors.', 240, 700, 200),
        // 对照：数字后的上标（10⁻²²）不是脚注，必须保留
        item('sensitivity of 10', 72, 680, 80),
        item('-22', 152.5, 683, 10, 6.5),
        item('at 1 kHz.', 165, 680, 45)
      ]
    }
    const { blocks } = parsePages([pg])
    const joined = blocks.map((b) => b.text).join(' ')
    expect(joined).toContain('ArXiv.^5^ As baselines')
    expect(joined).not.toMatch(/ArXiv\.\s*5/)
    expect(joined).toContain('10^-22^')
  })

  it('混排行的粗体连续段包上 **……**；整行粗体（标题）不标注', () => {
    const bold = (str: string, x: number, y: number, w: number, f = 10): TextItem => ({ ...item(str, x, y, w, f), bold: true })
    const pg: PageItems = {
      page: 1,
      width: 612,
      height: 792,
      items: [
        // 整行粗体的节标题:不标注
        bold('2 Related Work', 72, 700, 90, 12),
        // 混排行:run-in 粗体引导词 + 常规正文
        bold('MGT probes', 72, 670, 55),
        item(': simple linear probes on frozen representations.', 127, 670, 210),
        item('Compared to prior detectors, our approach is direct.', 72, 650, 220)
      ]
    }
    const { blocks } = parsePages([pg])
    const joined = blocks.map((b) => b.text).join(' | ')
    expect(joined).toContain('**MGT probes**: simple linear probes')
    expect(joined).toContain('2 Related Work')
    expect(joined).not.toContain('**2 Related Work**')
  })

  it('跨行断开的 URL 直接续接，不掺空格', () => {
    const pg: PageItems = {
      page: 1,
      width: 612,
      height: 792,
      items: [
        item('Our code can be found at: https://github.com/', 72, 700, 200),
        item('vodezhaw/rat.', 72, 688, 60)
      ]
    }
    const { blocks } = parsePages([pg])
    expect(blocks.map((b) => b.text).join(' ')).toContain('https://github.com/vodezhaw/rat.')
  })

  it('isFormulaFragment：碎片判定不误伤正常短句', () => {
    expect(isFormulaFragment('i')).toBe(true)
    expect(isFormulaFragment('d ×d K')).toBe(true)
    expect(isFormulaFragment('vk k ,W ∈ R')).toBe(true)
    expect(isFormulaFragment('MultiHead(Q, K, V) = Concat(head, head)W')).toBe(true)
    expect(isFormulaFragment('In this work we employ h = 8 parallel')).toBe(false)
    expect(isFormulaFragment('Prior systems require large paired corpora.')).toBe(false)
  })

  it('后续整页正文按页序排列', () => {
    const pages = result.blocks.map((b) => b.page)
    expect(pages).toEqual([...pages].sort((a, b) => a - b))
    expect(texts.some((t) => t.includes('page 2'))).toBe(true)
    expect(texts.some((t) => t.includes('page 3'))).toBe(true)
  })
})
