// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { parseArxivHtml } from './arxiv-html'

const PID = 'a'.repeat(40)
const PAGE = `<!DOCTYPE html><html><body><nav class="ltx_TOC">目录</nav>
<article class="ltx_document">
<h1 class="ltx_title ltx_title_document">The RAT: A Bayesian Model</h1>
<div class="ltx_authors"><span class="ltx_personname">Pius von Däniken</span></div>
<section id="S1" class="ltx_section"><h2 class="ltx_title ltx_title_section"><span class="ltx_tag">1 </span>Introduction</h2>
<div id="S1.p1" class="ltx_para"><p class="ltx_p">Let <math alttext="R"><mi>R</mi></math> denote <span class="ltx_text ltx_font_bold">retrieval success</span>, where <math alttext="R=1"><mrow><mi>R</mi><mo>=</mo><mn>1</mn></mrow></math> means success.<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup><span class="ltx_note_type">footnote: </span>Code is available online for everyone.</span></span></span></p>
<table class="ltx_equation ltx_eqn_table"><tr><td><math alttext="P(R)" display="block"><mi>P</mi></math></td></tr></table></div>
<figure id="S1.F1" class="ltx_figure"><img src="2608.24753v1/figures/metrics.png" onerror="alert(1)" width="405" height="331"><object type="image/svg+xml" data="2608.24753v1/teaser.svg" width="548" height="449"></object><figcaption class="ltx_caption"><span class="ltx_tag">Figure 1: </span>The dependency structure of the variables.</figcaption></figure>
<div class="ltx_para"><p class="ltx_p">Let <math alttext="R"><mi>R</mi></math> denote retrieval success again later.<script>alert(1)</script></p></div>
</section>
<section class="ltx_bibliography"><h2 class="ltx_title">References</h2><ul><li class="ltx_bibitem"><span class="ltx_tag">Es et al. (2024)</span> S. Es, RAGAs: automated evaluation.</li></ul></section>
</article></body></html>`

describe('arXiv 网页版解析', () => {
  const units = parseArxivHtml(PAGE, PID)
  const by = (kind: string, role?: string) => units.filter((u) => u.kind === kind && (!role || u.role === role))

  it('标题、作者、章节、正文、脚注、公式、图、图注、参考文献按阅读顺序拆开，目录不进来', () => {
    expect(units.map((u) => `${u.kind}/${u.role}`)).toEqual([
      'heading/title', 'block/authors', 'heading/body', 'para/body', 'para/small', 'equation/body', 'figure/body', 'para/caption', 'para/body', 'heading/body', 'para/ref'
    ])
    expect(units.some((u) => u.html.includes('目录'))).toBe(false)
  })

  it('送去翻译的文本：公式换成 ⟦fN⟧，粗体写成 **…**，脚注只留标号', () => {
    const p = by('para', 'body')[0]
    expect(p.text).toBe('Let ⟦f1⟧ denote **retrieval success**, where ⟦f2⟧ means success.^1^')
    expect(p.maths).toHaveLength(2)
    expect(p.maths[1]).toContain('<mn>1</mn>')
    // 脚注单独成段，跟在这一段后面
    expect(by('para', 'small')[0].text).toBe('Code is available online for everyone.')
    expect(p.html).not.toContain('Code is available')
  })

  it('图片不直接加载，脚本和事件处理属性都去掉', () => {
    const fig = by('figure')[0]
    expect(fig.html).toContain('data-arxiv-src="2608.24753v1/figures/metrics.png"')
    // <object> 嵌入的 SVG 改写成按需加载的图片，不留插件容器
    expect(fig.html).toContain('data-arxiv-src="2608.24753v1/teaser.svg"')
    expect(fig.html).not.toContain('<object')
    expect(fig.html).not.toMatch(/\ssrc=|onerror|alert/)
    expect(units.some((u) => u.html.includes('<script'))).toBe(false)
    expect(by('para', 'caption')[0].text).toBe('Figure 1: The dependency structure of the variables.')
  })

  it('参考文献、作者栏不翻译；标题层级正确', () => {
    expect(by('para', 'ref')[0].translatable).toBe(false)
    expect(by('block', 'authors')[0].translatable).toBe(false)
    expect(by('heading', 'title')[0].level).toBe(0)
    expect(by('heading', 'body')[0]).toMatchObject({ level: 1, text: '1 Introduction' })
  })

  it('摘要标题（LaTeXML 的 h6）和第 1 节同级', () => {
    const page = `<article class="ltx_document"><div class="ltx_abstract"><h6 class="ltx_title ltx_title_abstract">Abstract</h6><p class="ltx_p">We study agents.</p></div>
<section class="ltx_section"><h2 class="ltx_title ltx_title_section"><span class="ltx_tag">1 </span>Introduction</h2></section>
<section class="ltx_paragraph"><h4 class="ltx_title ltx_title_paragraph">Domains</h4></section></article>`
    const heads = parseArxivHtml(page, PID).filter((u) => u.kind === 'heading').map((u) => [u.text, u.level])
    expect(heads).toEqual([['Abstract', 1], ['1 Introduction', 1], ['Domains', 3]])
  })

  it('span 拼的宽表还原成真正的表格，合并单元格保留', () => {
    const page = `<article class="ltx_document"><figure class="ltx_table"><div class="ltx_inline-block ltx_transformed_outer"><span class="ltx_transformed_inner"><p class="ltx_p"><span class="ltx_text"><span class="ltx_tabular ltx_align_middle">
<span class="ltx_tr"><span class="ltx_td"></span><span class="ltx_td ltx_colspan ltx_colspan_2">DetectRL</span></span>
<span class="ltx_tr"><span class="ltx_td">Model</span><span class="ltx_td">ArXiv</span><span class="ltx_td">Reddit</span></span>
</span></span></p></span></div><figcaption class="ltx_caption">Table 1: AUC.</figcaption></figure></article>`
    const fig = parseArxivHtml(page, PID).find((u) => u.kind === 'figure')
    const box = document.createElement('div')
    box.innerHTML = fig?.html ?? ''
    const table = box.querySelector('table.ltx_tabular')
    expect(table).not.toBeNull()
    expect(table?.querySelectorAll('tr')).toHaveLength(2)
    expect(table?.querySelector('td[colspan="2"]')?.textContent).toBe('DetectRL')
    expect(box.querySelector('p table')).toBeNull()
  })

  it('表格里的脚注只留标号', () => {
    const page = `<article class="ltx_document"><figure class="ltx_table"><table class="ltx_tabular"><tr><td>Method<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">4</sup><span class="ltx_note_outer"><span class="ltx_note_content">HotpotQA EM is 27.1 for Standard.</span></span></span></td></tr></table></figure></article>`
    const fig = parseArxivHtml(page, PID).find((u) => u.kind === 'figure')
    expect(fig?.html).toContain('ltx_note_mark')
    expect(fig?.html).not.toContain('HotpotQA EM')
  })

  it('id 按内容生成，同一页面两次解析结果一致；内容相同的段也不撞号', () => {
    const again = parseArxivHtml(PAGE, PID)
    expect(again.map((u) => u.id)).toEqual(units.map((u) => u.id))
    expect(new Set(units.map((u) => u.id)).size).toBe(units.length)
    expect(units.every((u) => u.id.startsWith(`${PID}:x:`))).toBe(true)
  })

  it('不是 LaTeXML 文档就不出单元', () => {
    expect(parseArxivHtml('<html><body><p>HTML is not available for this paper.</p></body></html>', PID)).toEqual([])
  })
})
